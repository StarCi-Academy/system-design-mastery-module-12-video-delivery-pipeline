using Amazon.Runtime;
using Amazon.S3;
using Microsoft.EntityFrameworkCore;
using TranscodeService;

var builder = WebApplication.CreateBuilder(args);

// PostgreSQL via EF Core.
var pgConn = builder.Configuration["Postgres:ConnectionString"]
             ?? "Host=postgres;Database=transcode;Username=transcode;Password=transcode";
builder.Services.AddDbContext<AppDbContext>(opt => opt.UseNpgsql(pgConn));

// AWSSDK.S3 pointed at MinIO (path-style).
builder.Services.AddSingleton<IAmazonS3>(_ =>
{
    var cfg = builder.Configuration;
    var s3Config = new AmazonS3Config
    {
        ServiceURL = cfg["Minio:Endpoint"] ?? "http://minio:9000",
        ForcePathStyle = true,
        AuthenticationRegion = "us-east-1"
    };
    var creds = new BasicAWSCredentials(
        cfg["Minio:AccessKey"] ?? "minioadmin",
        cfg["Minio:SecretKey"] ?? "minioadmin");
    return new AmazonS3Client(creds, s3Config);
});

builder.Services.AddSingleton<MinioStorageService>();
builder.Services.AddSingleton<TranscodeWorker>();

var app = builder.Build();

// Apply schema + ensure bucket + seed on startup (with retry for cold Postgres).
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    for (var i = 0; i < 30; i++)
    {
        try
        {
            await db.Database.EnsureCreatedAsync();
            break;
        }
        catch (Exception)
        {
            await Task.Delay(2000);
        }
    }

    var storage = scope.ServiceProvider.GetRequiredService<MinioStorageService>();
    await storage.EnsureBucketAsync();
    await storage.SeedAsync();
}

app.MapGet("/health", () => Results.Ok(new { status = "ok" }));

// POST /api/videos/transcode -> 202 Accepted.
app.MapPost("/api/videos/transcode", async (TranscodeRequest req, TranscodeWorker worker) =>
{
    var job = await worker.CreateJobAsync(req.InputPath);
    return Results.Json(TranscodeJobDto.From(job, null), statusCode: StatusCodes.Status202Accepted);
});

// GET /api/videos/transcode/{id} -> 200 OK (presigned URL when COMPLETED).
app.MapGet("/api/videos/transcode/{id}", async (string id, AppDbContext db, MinioStorageService storage) =>
{
    if (!Guid.TryParse(id, out var guid)) return Results.NotFound(new { error = "job not found" });
    var job = await db.TranscodeJobs.FindAsync(guid);
    if (job is null) return Results.NotFound(new { error = "job not found" });

    string? outputUrl = null;
    if (job.Status == TranscodeStatus.Completed && job.OutputPath is not null)
    {
        outputUrl = storage.GetPresignedUrl(job.OutputPath);
    }
    return Results.Ok(TranscodeJobDto.From(job, outputUrl));
});

app.Run($"http://0.0.0.0:{Environment.GetEnvironmentVariable("PORT") ?? "3000"}");
