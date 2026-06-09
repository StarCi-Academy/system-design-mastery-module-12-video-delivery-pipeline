using Amazon.S3;
using Amazon.S3.Model;

namespace TranscodeService;

// S3-compatible upload, download, presign, and startup seed (MinIO).
public class MinioStorageService
{
    private readonly IAmazonS3 _s3;
    private readonly string _bucket;
    private readonly ILogger<MinioStorageService> _logger;

    public MinioStorageService(IAmazonS3 s3, IConfiguration config, ILogger<MinioStorageService> logger)
    {
        _s3 = s3;
        _bucket = config["Minio:Bucket"] ?? "videos";
        _logger = logger;
    }

    public async Task EnsureBucketAsync()
    {
        var exists = await Amazon.S3.Util.AmazonS3Util.DoesS3BucketExistV2Async(_s3, _bucket);
        if (!exists)
        {
            await _s3.PutBucketAsync(new PutBucketRequest { BucketName = _bucket });
        }
    }

    public async Task SeedAsync()
    {
        var src = Environment.GetEnvironmentVariable("SEED_SOURCE");
        var obj = Environment.GetEnvironmentVariable("SEED_OBJECT") ?? "source/sample.mp4";
        if (string.IsNullOrWhiteSpace(src) || !File.Exists(src))
        {
            return;
        }
        await UploadAsync(obj, src);
        _logger.LogInformation("Seeded source object {Bucket}/{Object}", _bucket, obj);
    }

    public async Task DownloadAsync(string objectKey, string localPath)
    {
        using var response = await _s3.GetObjectAsync(_bucket, objectKey);
        await response.WriteResponseStreamToFileAsync(localPath, false, CancellationToken.None);
    }

    public async Task UploadAsync(string objectKey, string localFilePath)
    {
        await using var stream = File.OpenRead(localFilePath);
        var request = new PutObjectRequest
        {
            BucketName = _bucket,
            Key = objectKey,
            InputStream = stream,
            ContentType = "video/mp4",
        };
        await _s3.PutObjectAsync(request);
    }

    public string GetPresignedUrl(string objectKey, int expiresInMinutes = 60)
    {
        var request = new GetPreSignedUrlRequest
        {
            BucketName = _bucket,
            Key = objectKey,
            Expires = DateTime.UtcNow.AddMinutes(expiresInMinutes),
            Verb = HttpVerb.GET
        };
        return _s3.GetPreSignedURL(request);
    }
}
