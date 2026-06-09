package com.starci.streaming;

import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.Resource;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.List;
import java.util.Map;

/**
 * HLS endpoints. Same contract in all four languages:
 *   POST /api/stream/{id}/encode             -> 200 { id, manifest, variants }
 *   GET  /api/stream/{id}/manifest.m3u8      -> 200 application/vnd.apple.mpegurl
 *   GET  /api/stream/{id}/{quality}/index.m3u8 -> 200 variant playlist
 *   GET  /api/stream/{id}/{quality}/{seg}    -> 200 video/mp2t (404 if missing)
 */
@RestController
@RequestMapping("/api/stream")
public class StreamController {

    private final TranscodeService transcode;

    public StreamController(TranscodeService transcode) {
        this.transcode = transcode;
    }

    @PostMapping("/{id}/encode")
    public ResponseEntity<Map<String, Object>> encode(@PathVariable String id) throws Exception {
        transcode.ensureTranscoded(id);
        return ResponseEntity.ok(Map.of(
            "id", id,
            "manifest", "/api/stream/" + id + "/manifest.m3u8",
            "variants", List.of("360p", "720p", "1080p")
        ));
    }

    @GetMapping(value = "/{id}/manifest.m3u8", produces = "application/vnd.apple.mpegurl")
    public ResponseEntity<Resource> manifest(@PathVariable String id) throws Exception {
        transcode.ensureTranscoded(id);
        Path master = transcode.streamsDir().resolve(id).resolve("manifest.m3u8");
        if (!Files.exists(master)) {
            return ResponseEntity.notFound().build();
        }
        return ResponseEntity.ok()
            .header(HttpHeaders.CACHE_CONTROL, "no-cache")
            .header(HttpHeaders.ACCESS_CONTROL_ALLOW_ORIGIN, "*")
            .body(new FileSystemResource(master));
    }

    @GetMapping("/{id}/{quality}/{file}")
    public ResponseEntity<Resource> file(
            @PathVariable String id,
            @PathVariable String quality,
            @PathVariable String file) {
        Path target = transcode.streamsDir().resolve(id).resolve(quality).resolve(file).normalize();
        Path root = transcode.streamsDir().resolve(id).normalize();
        if (!target.startsWith(root) || !Files.exists(target)) {
            return ResponseEntity.status(404)
                .body(new org.springframework.core.io.ByteArrayResource(
                    ("{\"id\":\"" + id + "\",\"quality\":\"" + quality + "\",\"segment\":\"" + file + "\",\"error\":\"not found\"}").getBytes()));
        }
        if (file.endsWith(".m3u8")) {
            return ResponseEntity.ok()
                .contentType(MediaType.parseMediaType("application/vnd.apple.mpegurl"))
                .header(HttpHeaders.CACHE_CONTROL, "no-cache")
                .header(HttpHeaders.ACCESS_CONTROL_ALLOW_ORIGIN, "*")
                .body(new FileSystemResource(target));
        }
        // video/mp2t is the IANA media type for MPEG-2 Transport Stream segments.
        return ResponseEntity.ok()
            .contentType(MediaType.parseMediaType("video/mp2t"))
            .cacheControl(CacheControl.maxAge(Duration.ofDays(365)).cachePublic())
            .header(HttpHeaders.ACCESS_CONTROL_ALLOW_ORIGIN, "*")
            .body(new FileSystemResource(target));
    }
}
