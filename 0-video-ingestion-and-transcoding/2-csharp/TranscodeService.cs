using System.Diagnostics;
using Microsoft.EntityFrameworkCore;

namespace TranscodeService;

// Orchestrates job creation, FFmpeg, and MinIO upload.
public class TranscodeWorker
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly MinioStorageService _storage;
    private readonly ILogger<TranscodeWorker> _logger;

    public TranscodeWorker(IServiceScopeFactory scopeFactory, MinioStorageService storage, ILogger<TranscodeWorker> logger)
    {
        _scopeFactory = scopeFactory;
        _storage = storage;
        _logger = logger;
    }

    // CreateJobAsync: insert a PENDING job row and fire FFmpeg in the background.
    // Returns immediately with HTTP 202 — the transcode is NOT awaited here.
    public async Task<TranscodeJob> CreateJobAsync(string inputPath)
    {
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        // Idempotency: same inputPath (not FAILED) -> return the existing job.
        var existing = await db.TranscodeJobs
            .FirstOrDefaultAsync(j => j.InputPath == inputPath && j.Status != TranscodeStatus.Failed);
        if (existing is not null) return existing;

        var job = new TranscodeJob { InputPath = inputPath };
        db.TranscodeJobs.Add(job);
        await db.SaveChangesAsync();

        // Fire-and-forget: run FFmpeg without blocking the HTTP response.
        _ = Task.Run(() => RunTranscodeAsync(job.Id));
        return job;
    }

    private async Task RunTranscodeAsync(Guid jobId)
    {
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var job = await db.TranscodeJobs.FindAsync(jobId);
        if (job is null) return;

        var inputFile = Path.Combine(Path.GetTempPath(), $"{job.Id}-input");
        var outputFile = Path.Combine(Path.GetTempPath(), $"{job.Id}.mp4");
        try
        {
            job.Status = TranscodeStatus.Processing;
            job.UpdatedAt = DateTime.UtcNow;
            await db.SaveChangesAsync();

            await _storage.DownloadAsync(job.InputPath, inputFile);

            // Re-encode to H.264/AAC MP4 via ffmpeg as a child process.
            var psi = new ProcessStartInfo("ffmpeg")
            {
                RedirectStandardError = true,
                UseShellExecute = false
            };
            foreach (var arg in new[] { "-y", "-i", inputFile, "-c:v", "libx264", "-c:a", "aac", "-movflags", "+faststart", outputFile })
            {
                psi.ArgumentList.Add(arg);
            }
            using var proc = Process.Start(psi)!;
            var stderr = await proc.StandardError.ReadToEndAsync();
            await proc.WaitForExitAsync();
            if (proc.ExitCode != 0)
            {
                throw new Exception($"FFmpeg exited with code {proc.ExitCode}: {Truncate(stderr, 1024)}");
            }

            var objectKey = $"transcoded/{job.Id}.mp4";
            await _storage.UploadAsync(objectKey, outputFile);

            job.Status = TranscodeStatus.Completed;
            job.OutputPath = objectKey;
            job.UpdatedAt = DateTime.UtcNow;
            await db.SaveChangesAsync();
        }
        catch (Exception ex)
        {
            job.Status = TranscodeStatus.Failed;
            job.ErrorMessage = ex.Message;
            job.UpdatedAt = DateTime.UtcNow;
            await db.SaveChangesAsync();
            _logger.LogError(ex, "Transcode failed for job {JobId}", job.Id);
        }
        finally
        {
            if (File.Exists(inputFile)) File.Delete(inputFile);
            if (File.Exists(outputFile)) File.Delete(outputFile);
        }
    }

    private static string Truncate(string s, int n) => s.Length > n ? s[..n] : s;
}
