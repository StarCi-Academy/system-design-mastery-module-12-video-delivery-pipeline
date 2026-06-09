package com.starci.transcode;

import jakarta.annotation.PostConstruct;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.CreateBucketRequest;
import software.amazon.awssdk.services.s3.model.GetObjectRequest;
import software.amazon.awssdk.services.s3.model.HeadBucketRequest;
import software.amazon.awssdk.services.s3.model.NoSuchBucketException;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;
import software.amazon.awssdk.services.s3.presigner.model.GetObjectPresignRequest;

import java.io.File;
import java.nio.file.Path;
import java.time.Duration;

/** S3-compatible (MinIO) upload, download, presign, and startup seed. */
@Service
public class StorageService {

    private final S3Client s3;
    private final S3Presigner presigner;

    @Value("${app.minio.bucket}")
    private String bucket;

    @Value("${app.seed.source:}")
    private String seedSource;

    @Value("${app.seed.object:source/sample.mp4}")
    private String seedObject;

    public StorageService(S3Client s3, S3Presigner presigner) {
        this.s3 = s3;
        this.presigner = presigner;
    }

    @PostConstruct
    public void init() {
        ensureBucket();
        seed();
    }

    private void ensureBucket() {
        try {
            s3.headBucket(HeadBucketRequest.builder().bucket(bucket).build());
        } catch (NoSuchBucketException e) {
            s3.createBucket(CreateBucketRequest.builder().bucket(bucket).build());
        }
    }

    private void seed() {
        if (seedSource == null || seedSource.isBlank()) {
            return;
        }
        File f = new File(seedSource);
        if (!f.exists()) {
            return;
        }
        s3.putObject(
                PutObjectRequest.builder().bucket(bucket).key(seedObject).contentType("video/mp4").build(),
                RequestBody.fromFile(f.toPath())
        );
    }

    public void download(String key, Path target) {
        s3.getObject(GetObjectRequest.builder().bucket(bucket).key(key).build(), target);
    }

    public void upload(String key, Path file) {
        s3.putObject(
                PutObjectRequest.builder().bucket(bucket).key(key).contentType("video/mp4").build(),
                RequestBody.fromFile(file)
        );
    }

    public String presignedGetUrl(String key) {
        GetObjectPresignRequest req = GetObjectPresignRequest.builder()
                .signatureDuration(Duration.ofMinutes(15))
                .getObjectRequest(g -> g.bucket(bucket).key(key))
                .build();
        return presigner.presignGetObject(req).url().toString();
    }
}
