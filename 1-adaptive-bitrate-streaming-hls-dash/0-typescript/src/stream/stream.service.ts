import { Injectable, Logger } from '@nestjs/common';
import ffmpeg from 'fluent-ffmpeg';
import * as fs from 'fs';
import * as path from 'path';
import { BITRATE_LADDER, BitrateRung, buildMasterPlaylist } from './bitrate-ladder';

/**
 * Drives FFmpeg transcoding and resolves manifest/segment paths on disk.
 * Transcoding is lazy + idempotent: the first request for a video runs the
 * three-rung HLS ladder, subsequent requests are served straight from disk.
 */
@Injectable()
export class StreamService {
  private readonly logger = new Logger(StreamService.name);
  private readonly streamsDir = process.env.STREAMS_DIR || path.join(process.cwd(), 'streams');
  private readonly sourceDir = process.env.SOURCE_DIR || path.join(process.cwd(), 'fixtures');

  /** Transcodes the source into a 360p/720p/1080p HLS ladder if not done yet. */
  async ensureTranscoded(videoId: string): Promise<void> {
    const outputDir = path.join(this.streamsDir, videoId);
    const masterPath = path.join(outputDir, 'manifest.m3u8');
    if (fs.existsSync(masterPath)) return;

    const sourcePath = path.join(this.sourceDir, 'sample.mp4');
    if (!fs.existsSync(sourcePath)) {
      throw new Error(`Source video not found: ${sourcePath}`);
    }

    for (const rung of BITRATE_LADDER) {
      await this.transcodeRung(sourcePath, outputDir, rung);
    }

    // Write the master playlist once all variants exist on disk.
    fs.writeFileSync(masterPath, buildMasterPlaylist(videoId), 'utf8');
    this.logger.log(`Transcoded ${videoId}: ${BITRATE_LADDER.map((r) => r.label).join(', ')}`);
  }

  private transcodeRung(sourcePath: string, outputDir: string, rung: BitrateRung): Promise<void> {
    const rungDir = path.join(outputDir, rung.label);
    fs.mkdirSync(rungDir, { recursive: true });
    return new Promise<void>((resolve, reject) => {
      ffmpeg(sourcePath)
        // Scale to the target resolution for this rung.
        .videoFilters(`scale=${rung.width}:${rung.height}`)
        // H.264 + AAC is the baseline HLS codec pairing.
        .videoCodec('libx264')
        .audioCodec('aac')
        .outputOptions([
          `-b:v ${rung.videoBitrate}`,
          `-b:a ${rung.audioBitrate}`,
          // 6-second VOD segments named seg000.ts, seg001.ts, ...
          '-hls_time 6',
          '-hls_list_size 0',
          '-hls_playlist_type vod',
          `-hls_segment_filename ${path.join(rungDir, 'seg%03d.ts')}`,
        ])
        .output(path.join(rungDir, 'index.m3u8'))
        .on('end', () => resolve())
        .on('error', (err) => reject(err))
        .run();
    });
  }

  /** Absolute path of the master playlist for a video. */
  masterPath(videoId: string): string {
    return path.join(this.streamsDir, videoId, 'manifest.m3u8');
  }

  /** Absolute path of a variant playlist or .ts segment, or null if missing. */
  resolveFile(videoId: string, quality: string, file: string): string | null {
    const target = path.join(this.streamsDir, videoId, quality, file);
    const root = path.join(this.streamsDir, videoId);
    // Path-traversal guard: resolved path must stay inside the video directory.
    if (!path.resolve(target).startsWith(path.resolve(root))) return null;
    return fs.existsSync(target) ? target : null;
  }
}
