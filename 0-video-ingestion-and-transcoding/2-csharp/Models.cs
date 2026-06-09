using System.Text.Json.Serialization;

namespace TranscodeService;

// Explicit state machine; never use bool IsCompleted.
public enum TranscodeStatus
{
    Pending,
    Processing,
    Completed,
    Failed
}

// EF Core entity: one row per transcode request.
public class TranscodeJob
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public TranscodeStatus Status { get; set; } = TranscodeStatus.Pending;
    public string InputPath { get; set; } = string.Empty;
    public string? OutputPath { get; set; }
    public string? ErrorMessage { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

// Request body for POST /api/videos/transcode.
public record TranscodeRequest([property: JsonPropertyName("inputPath")] string InputPath);

// Flat response shape shared by all four languages.
public record TranscodeJobDto(
    string Id,
    string InputPath,
    string? OutputPath,
    string Status,
    string? ErrorMessage,
    string? OutputUrl,
    DateTime CreatedAt,
    DateTime UpdatedAt)
{
    public static TranscodeJobDto From(TranscodeJob job, string? outputUrl) => new(
        job.Id.ToString(),
        job.InputPath,
        job.OutputPath,
        job.Status.ToString().ToUpperInvariant(),
        job.ErrorMessage,
        outputUrl,
        job.CreatedAt,
        job.UpdatedAt);
}
