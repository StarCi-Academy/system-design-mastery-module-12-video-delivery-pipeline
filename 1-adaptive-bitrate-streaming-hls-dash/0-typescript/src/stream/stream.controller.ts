import { Controller, Get, Param, Post, Res } from '@nestjs/common';
import { Response } from 'express';
import { StreamService } from './stream.service';

/**
 * HLS endpoints. Same contract in all four languages:
 *   POST /api/stream/:id/encode          -> 200 { id, manifest, variants }
 *   GET  /api/stream/:id/manifest.m3u8   -> 200 application/vnd.apple.mpegurl
 *   GET  /api/stream/:id/:quality/index.m3u8 -> 200 variant playlist
 *   GET  /api/stream/:id/:quality/:segment   -> 200 video/mp2t (404 if missing)
 */
@Controller('api/stream')
export class StreamController {
  constructor(private readonly streamService: StreamService) {}

  @Post(':id/encode')
  async encode(@Param('id') id: string, @Res() res: Response): Promise<void> {
    await this.streamService.ensureTranscoded(id);
    res.status(200).json({
      id,
      manifest: `/api/stream/${id}/manifest.m3u8`,
      variants: ['360p', '720p', '1080p'],
    });
  }

  @Get(':id/manifest.m3u8')
  async manifest(@Param('id') id: string, @Res() res: Response): Promise<void> {
    // Lazy transcode on first manifest request, then serve from disk.
    await this.streamService.ensureTranscoded(id);
    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.sendFile(this.streamService.masterPath(id));
  }

  @Get(':id/:quality/:segment')
  async segment(
    @Param('id') id: string,
    @Param('quality') quality: string,
    @Param('segment') segment: string,
    @Res() res: Response,
  ): Promise<void> {
    const filePath = this.streamService.resolveFile(id, quality, segment);
    if (!filePath) {
      res.status(404).json({ id, quality, segment, error: 'not found' });
      return;
    }
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (segment.endsWith('.m3u8')) {
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      res.setHeader('Cache-Control', 'no-cache');
    } else {
      // video/mp2t is the IANA media type for MPEG-2 Transport Stream segments.
      res.setHeader('Content-Type', 'video/mp2t');
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
    res.sendFile(filePath);
  }
}
