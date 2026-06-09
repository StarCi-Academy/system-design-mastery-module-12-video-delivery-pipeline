package com.starci.streaming;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

/**
 * Drives FFmpeg via ProcessBuilder to produce a 360p/720p/1080p HLS ladder.
 * Transcoding is lazy and idempotent: a master playlist on disk means done.
 */
@Service
public class TranscodeService {

    /** One rung of the canonical bitrate ladder, shared across all languages. */
    public record Rung(String label, int width, int height, String videoBitrate, String audioBitrate, int bandwidth) {
    }

    public static final List<Rung> LADDER = List.of(
        new Rung("360p", 640, 360, "800k", "96k", 800000),
        new Rung("720p", 1280, 720, "2800k", "128k", 2800000),
        new Rung("1080p", 1920, 1080, "5000k", "192k", 5000000)
    );

    private final Path streamsDir;
    private final Path sourceDir;

    public TranscodeService(
            @Value("${app.streams-dir:/app/streams}") String streamsDir,
            @Value("${app.source-dir:/app/fixtures}") String sourceDir) {
        this.streamsDir = Path.of(streamsDir);
        this.sourceDir = Path.of(sourceDir);
    }

    public Path streamsDir() {
        return streamsDir;
    }

    /** Transcodes the bundled sample into the HLS ladder if not already done. */
    public void ensureTranscoded(String videoId) throws IOException, InterruptedException {
        Path outDir = streamsDir.resolve(videoId);
        Path master = outDir.resolve("manifest.m3u8");
        if (Files.exists(master)) {
            return;
        }
        Path source = sourceDir.resolve("sample.mp4");
        if (!Files.exists(source)) {
            throw new IllegalStateException("source video not found: " + source);
        }
        for (Rung rung : LADDER) {
            Path rungDir = outDir.resolve(rung.label());
            Files.createDirectories(rungDir);
            List<String> cmd = new ArrayList<>(List.of(
                "ffmpeg", "-y", "-i", source.toString(),
                "-vf", "scale=" + rung.width() + ":" + rung.height(),
                "-c:v", "libx264", "-b:v", rung.videoBitrate(),
                "-c:a", "aac", "-b:a", rung.audioBitrate(),
                "-hls_time", "6",
                "-hls_list_size", "0",
                "-hls_playlist_type", "vod",
                "-hls_segment_filename", rungDir.resolve("seg%03d.ts").toString(),
                rungDir.resolve("index.m3u8").toString()
            ));
            Process process = new ProcessBuilder(cmd).inheritIO().start();
            int exit = process.waitFor();
            if (exit != 0) {
                throw new IllegalStateException("FFmpeg exited with code " + exit + " for " + rung.label());
            }
        }
        Files.writeString(master, buildMasterPlaylist());
    }

    /** Assembles the HLS master playlist text from the bitrate ladder. */
    public String buildMasterPlaylist() {
        StringBuilder sb = new StringBuilder("#EXTM3U\n#EXT-X-VERSION:3\n");
        for (Rung rung : LADDER) {
            sb.append("#EXT-X-STREAM-INF:BANDWIDTH=").append(rung.bandwidth())
              .append(",RESOLUTION=").append(rung.width()).append('x').append(rung.height()).append('\n');
            sb.append(rung.label()).append("/index.m3u8\n");
        }
        return sb.toString();
    }
}
