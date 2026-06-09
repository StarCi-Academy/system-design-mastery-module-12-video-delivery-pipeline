// Shared HLS bitrate ladder and master-playlist builder.
// Identical contract across all four language implementations.

export interface BitrateRung {
  // Quality label used as the variant sub-directory name (e.g. "360p").
  label: string;
  // Target output width in pixels.
  width: number;
  // Target output height in pixels.
  height: number;
  // Target video bitrate in kilobits per second (e.g. "800k").
  videoBitrate: string;
  // Target audio bitrate in kilobits per second (e.g. "96k").
  audioBitrate: string;
  // BANDWIDTH advertised in the master playlist EXT-X-STREAM-INF, in bits/s.
  bandwidth: number;
}

// Canonical three-rung ladder shared by every language in this lesson.
export const BITRATE_LADDER: BitrateRung[] = [
  { label: '360p', width: 640, height: 360, videoBitrate: '800k', audioBitrate: '96k', bandwidth: 800000 },
  { label: '720p', width: 1280, height: 720, videoBitrate: '2800k', audioBitrate: '128k', bandwidth: 2800000 },
  { label: '1080p', width: 1920, height: 1080, videoBitrate: '5000k', audioBitrate: '192k', bandwidth: 5000000 },
];

/**
 * Builds the HLS master playlist text from the bitrate ladder.
 * The master playlist carries no media; it only lists each variant's
 * BANDWIDTH and RESOLUTION plus a relative URI to its variant playlist.
 */
export function buildMasterPlaylist(videoId: string): string {
  const lines: string[] = ['#EXTM3U', '#EXT-X-VERSION:3'];
  for (const rung of BITRATE_LADDER) {
    lines.push(`#EXT-X-STREAM-INF:BANDWIDTH=${rung.bandwidth},RESOLUTION=${rung.width}x${rung.height}`);
    lines.push(`${rung.label}/index.m3u8`);
  }
  return lines.join('\n') + '\n';
}
