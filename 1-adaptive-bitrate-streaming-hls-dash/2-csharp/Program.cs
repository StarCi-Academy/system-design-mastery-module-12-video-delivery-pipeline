using System.Diagnostics;
using System.Text;

// Adaptive bitrate HLS streaming service (C# / ASP.NET Core 8 minimal API).
// Same API contract as the TypeScript / Java / Go implementations.

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddSingleton<TranscodeService>();
// Register CORS services so UseCors() middleware can resolve ICorsService.
builder.Services.AddCors();
var app = builder.Build();

app.UseCors(p => p.AllowAnyOrigin());

var transcode = app.Services.GetRequiredService<TranscodeService>();

app.MapPost("/api/stream/{id}/encode", async (string id) =>
{
    await transcode.EnsureTranscodedAsync(id);
    return Results.Ok(new
    {
        id,
        manifest = $"/api/stream/{id}/manifest.m3u8",
        variants = new[] { "360p", "720p", "1080p" }
    });
});

app.MapGet("/api/stream/{id}/manifest.m3u8", async (string id, HttpResponse res) =>
{
    await transcode.EnsureTranscodedAsync(id);
    var master = Path.Combine(transcode.StreamsDir, id, "manifest.m3u8");
    if (!File.Exists(master)) return Results.NotFound();
    res.Headers.CacheControl = "no-cache";
    res.Headers.AccessControlAllowOrigin = "*";
    return Results.File(master, "application/vnd.apple.mpegurl");
});

app.MapGet("/api/stream/{id}/{quality}/{file}", (string id, string quality, string file, HttpResponse res) =>
{
    var root = Path.GetFullPath(Path.Combine(transcode.StreamsDir, id));
    var target = Path.GetFullPath(Path.Combine(root, quality, file));
    if (!target.StartsWith(root) || !File.Exists(target))
    {
        return Results.NotFound(new { id, quality, segment = file, error = "not found" });
    }
    res.Headers.AccessControlAllowOrigin = "*";
    if (file.EndsWith(".m3u8"))
    {
        res.Headers.CacheControl = "no-cache";
        return Results.File(target, "application/vnd.apple.mpegurl");
    }
    // video/mp2t is the IANA media type for MPEG-2 Transport Stream segments.
    res.Headers.CacheControl = "public, max-age=31536000, immutable";
    return Results.File(target, "video/mp2t");
});

app.MapGet("/health", () => Results.Ok(new { status = "ok" }));

app.Run();

/// <summary>Drives FFmpeg to produce the 360p/720p/1080p HLS ladder.</summary>
public sealed class TranscodeService
{
    public sealed record Rung(string Label, int Width, int Height, string VideoBitrate, string AudioBitrate, int Bandwidth);

    // Canonical three-rung ladder shared across all languages.
    private static readonly Rung[] Ladder =
    {
        new("360p", 640, 360, "800k", "96k", 800000),
        new("720p", 1280, 720, "2800k", "128k", 2800000),
        new("1080p", 1920, 1080, "5000k", "192k", 5000000),
    };

    public string StreamsDir { get; } = Environment.GetEnvironmentVariable("STREAMS_DIR") ?? "/app/streams";
    public string SourceDir { get; } = Environment.GetEnvironmentVariable("SOURCE_DIR") ?? "/app/fixtures";

    public async Task EnsureTranscodedAsync(string videoId)
    {
        var outDir = Path.Combine(StreamsDir, videoId);
        var master = Path.Combine(outDir, "manifest.m3u8");
        if (File.Exists(master)) return;

        var source = Path.Combine(SourceDir, "sample.mp4");
        if (!File.Exists(source)) throw new InvalidOperationException($"source video not found: {source}");

        foreach (var rung in Ladder)
        {
            var rungDir = Path.Combine(outDir, rung.Label);
            Directory.CreateDirectory(rungDir);
            var args = new[]
            {
                "-y", "-i", source,
                "-vf", $"scale={rung.Width}:{rung.Height}",
                "-c:v", "libx264", "-b:v", rung.VideoBitrate,
                "-c:a", "aac", "-b:a", rung.AudioBitrate,
                "-hls_time", "6",
                "-hls_list_size", "0",
                "-hls_playlist_type", "vod",
                "-hls_segment_filename", Path.Combine(rungDir, "seg%03d.ts"),
                Path.Combine(rungDir, "index.m3u8"),
            };
            var psi = new ProcessStartInfo("ffmpeg") { RedirectStandardError = true };
            foreach (var a in args) psi.ArgumentList.Add(a);
            using var proc = Process.Start(psi)!;
            await proc.WaitForExitAsync();
            if (proc.ExitCode != 0)
                throw new InvalidOperationException($"FFmpeg exited with {proc.ExitCode} for {rung.Label}");
        }

        await File.WriteAllTextAsync(master, BuildMasterPlaylist());
    }

    private static string BuildMasterPlaylist()
    {
        var sb = new StringBuilder("#EXTM3U\n#EXT-X-VERSION:3\n");
        foreach (var rung in Ladder)
        {
            sb.Append($"#EXT-X-STREAM-INF:BANDWIDTH={rung.Bandwidth},RESOLUTION={rung.Width}x{rung.Height}\n");
            sb.Append($"{rung.Label}/index.m3u8\n");
        }
        return sb.ToString();
    }
}
