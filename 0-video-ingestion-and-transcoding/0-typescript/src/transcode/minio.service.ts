import { Injectable, OnModuleInit } from "@nestjs/common"
import { ConfigService } from "@nestjs/config"
import * as Minio from "minio"

@Injectable()
export class MinioService implements OnModuleInit {
    private readonly client: Minio.Client
    private readonly bucket: string

    constructor(private readonly cs: ConfigService) {
        // Initialize the MinIO SDK client from config — one shared client for the service.
        this.client = new Minio.Client({
            endPoint: cs.get<string>("MINIO_HOST", "minio"),
            port: parseInt(cs.get<string>("MINIO_PORT", "9000"), 10),
            useSSL: false,
            accessKey: cs.get<string>("MINIO_ACCESS_KEY", "minioadmin"),
            secretKey: cs.get<string>("MINIO_SECRET_KEY", "minioadmin"),
        })
        this.bucket = cs.get<string>("MINIO_BUCKET", "videos")
    }

    /** Create the bucket and seed a synthetic source clip on startup. */
    async onModuleInit(): Promise<void> {
        const exists = await this.client.bucketExists(this.bucket).catch(() => false)
        if (!exists) await this.client.makeBucket(this.bucket)

        const seedSource = process.env.SEED_SOURCE
        const seedObject = process.env.SEED_OBJECT || "source/sample.mp4"
        if (seedSource) {
            await this.client.fPutObject(this.bucket, seedObject, seedSource, {
                "Content-Type": "video/mp4",
            })
        }
    }

    /** Download an object from MinIO to a local file path (for FFmpeg to read). */
    async downloadToFile(objectPath: string, localPath: string): Promise<void> {
        await this.client.fGetObject(this.bucket, objectPath, localPath)
    }

    /** Upload a local file to MinIO at the given object path. */
    async uploadFromFile(localPath: string, objectPath: string): Promise<void> {
        await this.client.fPutObject(this.bucket, objectPath, localPath, {
            "Content-Type": "video/mp4",
        })
    }

    /**
     * Generate a presigned GET URL valid for the given number of seconds.
     * The client can download the artifact directly without any credentials.
     */
    async presignedGetUrl(objectPath: string, expirySeconds = 3600): Promise<string> {
        return this.client.presignedGetObject(this.bucket, objectPath, expirySeconds)
    }
}
