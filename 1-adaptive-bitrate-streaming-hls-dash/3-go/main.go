// Adaptive bitrate HLS streaming service (Go / net/http + os/exec FFmpeg).
// Same API contract as the TypeScript / Java / C# implementations:
//
//	POST /api/stream/{id}/encode          -> 200 { id, manifest, variants }
//	GET  /api/stream/{id}/manifest.m3u8   -> 200 application/vnd.apple.mpegurl
//	GET  /api/stream/{id}/{quality}/index.m3u8 -> 200 variant playlist
//	GET  /api/stream/{id}/{quality}/{seg}.ts   -> 200 video/mp2t (404 if missing)
package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

type rung struct {
	label        string
	width        int
	height       int
	videoBitrate string
	audioBitrate string
	bandwidth    int
}

// Canonical three-rung bitrate ladder shared across all languages.
var ladder = []rung{
	{"360p", 640, 360, "800k", "96k", 800000},
	{"720p", 1280, 720, "2800k", "128k", 2800000},
	{"1080p", 1920, 1080, "5000k", "192k", 5000000},
}

type server struct {
	streamsDir string
	sourceDir  string
}

// ensureTranscoded lazily runs FFmpeg once per video, then serves from disk.
func (s *server) ensureTranscoded(videoID string) error {
	outDir := filepath.Join(s.streamsDir, videoID)
	master := filepath.Join(outDir, "manifest.m3u8")
	if _, err := os.Stat(master); err == nil {
		return nil // idempotent: manifest already exists, skip re-encoding
	}
	source := filepath.Join(s.sourceDir, "sample.mp4")
	if _, err := os.Stat(source); err != nil {
		return fmt.Errorf("source video not found: %s", source)
	}
	for _, r := range ladder {
		rungDir := filepath.Join(outDir, r.label)
		if err := os.MkdirAll(rungDir, 0o755); err != nil {
			return err
		}
		args := []string{
			"-y", "-i", source,
			"-vf", fmt.Sprintf("scale=%d:%d", r.width, r.height),
			"-c:v", "libx264", "-b:v", r.videoBitrate,
			"-c:a", "aac", "-b:a", r.audioBitrate,
			"-hls_time", "6",
			"-hls_list_size", "0",
			"-hls_playlist_type", "vod",
			"-hls_segment_filename", filepath.Join(rungDir, "seg%03d.ts"),
			filepath.Join(rungDir, "index.m3u8"),
		}
		cmd := exec.Command("ffmpeg", args...)
		cmd.Stderr = os.Stderr
		if err := cmd.Run(); err != nil {
			return fmt.Errorf("ffmpeg %s: %w", r.label, err)
		}
	}
	return os.WriteFile(master, []byte(buildMasterPlaylist(videoID)), 0o644)
}

// buildMasterPlaylist assembles the HLS master playlist text in memory.
func buildMasterPlaylist(videoID string) string {
	var sb strings.Builder
	sb.WriteString("#EXTM3U\n#EXT-X-VERSION:3\n")
	for _, r := range ladder {
		sb.WriteString(fmt.Sprintf("#EXT-X-STREAM-INF:BANDWIDTH=%d,RESOLUTION=%dx%d\n", r.bandwidth, r.width, r.height))
		sb.WriteString(fmt.Sprintf("%s/index.m3u8\n", r.label))
	}
	return sb.String()
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func (s *server) handle(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	// Path shape: /api/stream/{id}/...
	parts := strings.Split(strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/stream/"), "/"), "/")
	if len(parts) < 1 || parts[0] == "" {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
		return
	}
	id := parts[0]

	// POST /api/stream/{id}/encode
	if r.Method == http.MethodPost && len(parts) == 2 && parts[1] == "encode" {
		if err := s.ensureTranscoded(id); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"id":       id,
			"manifest": "/api/stream/" + id + "/manifest.m3u8",
			"variants": []string{"360p", "720p", "1080p"},
		})
		return
	}

	// GET /api/stream/{id}/manifest.m3u8
	if r.Method == http.MethodGet && len(parts) == 2 && parts[1] == "manifest.m3u8" {
		if err := s.ensureTranscoded(id); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		w.Header().Set("Content-Type", "application/vnd.apple.mpegurl")
		w.Header().Set("Cache-Control", "no-cache")
		http.ServeFile(w, r, filepath.Join(s.streamsDir, id, "manifest.m3u8"))
		return
	}

	// GET /api/stream/{id}/{quality}/{file}
	if r.Method == http.MethodGet && len(parts) == 3 {
		quality, file := parts[1], parts[2]
		target := filepath.Join(s.streamsDir, id, quality, file)
		root := filepath.Join(s.streamsDir, id)
		clean := filepath.Clean(target)
		if !strings.HasPrefix(clean, filepath.Clean(root)) {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "invalid path"})
			return
		}
		if _, err := os.Stat(clean); err != nil {
			writeJSON(w, http.StatusNotFound, map[string]string{"id": id, "quality": quality, "segment": file, "error": "not found"})
			return
		}
		if strings.HasSuffix(file, ".m3u8") {
			w.Header().Set("Content-Type", "application/vnd.apple.mpegurl")
			w.Header().Set("Cache-Control", "no-cache")
		} else {
			// video/mp2t is the IANA media type for MPEG-2 Transport Stream.
			w.Header().Set("Content-Type", "video/mp2t")
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		}
		http.ServeFile(w, r, clean)
		return
	}

	writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
}

func getenv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func main() {
	s := &server{
		streamsDir: getenv("STREAMS_DIR", "/app/streams"),
		sourceDir:  getenv("SOURCE_DIR", "/app/fixtures"),
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/api/stream/", s.handle)
	mux.HandleFunc("/health", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	port := getenv("PORT", "3000")
	log.Printf("streaming-service listening on :%s", port)
	log.Fatal(http.ListenAndServe(":"+port, mux))
}
