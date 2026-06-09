import { Injectable, Logger } from "@nestjs/common"
import { InjectRepository } from "@nestjs/typeorm"
import { Repository } from "typeorm"
import { spawn } from "child_process"
import * as path from "path"
import * as fs from "fs"
import * as os from "os"
import { TranscodeJobEntity, TranscodeStatus } from "./entities/transcode-job.entity"
import { MinioService } from "./minio.service"

@Injectable()
export class TranscodeService {
    private readonly logger = new Logger(TranscodeService.name)

    constructor(
        @InjectRepository(TranscodeJobEntity)
        private readonly jobRepo: Repository<TranscodeJobEntity>,
        private readonly minioService: MinioService,
    ) {}

    /**
     * Create a PENDING job row and fire FFmpeg in the background.
     * Returns immediately — do NOT await the transcode.
     */
    async createJob(inputPath: string): Promise<TranscodeJobEntity> {
        // Idempotency: return an existing non-FAILED job for the same inputPath.
        const existing = await this.jobRepo
            .createQueryBuilder("job")
            .where("job.inputPath = :inputPath", { inputPath })
            .andWhere("job.status != :failed", { failed: TranscodeStatus.FAILED })
            .getOne()
        if (existing) return existing

        // Insert job as PENDING synchronously — caller gets a jobId immediately.
        const job = this.jobRepo.create({ inputPath, status: TranscodeStatus.PENDING })
        await this.jobRepo.save(job)

        // Fire-and-forget: run FFmpeg without blocking the HTTP response.
        this.runTranscode(job).catch((err) => {
            this.logger.error(`Unexpected error outside runTranscode for job ${job.id}`, err)
        })

        return job
    }

    async findOne(id: string): Promise<TranscodeJobEntity | null> {
        return this.jobRepo.findOne({ where: { id } })
    }

    async presignedFor(job: TranscodeJobEntity): Promise<string | null> {
        if (job.status === TranscodeStatus.COMPLETED && job.outputPath) {
            return this.minioService.presignedGetUrl(job.outputPath)
        }
        return null
    }

    /** Execute the full transcode pipeline for a single job. All errors are caught and persisted. */
    private async runTranscode(job: TranscodeJobEntity): Promise<void> {
        await this.jobRepo.update(job.id, { status: TranscodeStatus.PROCESSING })

        const tmpInput = path.join(os.tmpdir(), `${job.id}-input`)
        const tmpOutput = path.join(os.tmpdir(), `${job.id}-output.mp4`)

        try {
            await this.minioService.downloadToFile(job.inputPath, tmpInput)
            await this.spawnFfmpeg(tmpInput, tmpOutput)

            const outputPath = job.inputPath.replace(/\.[^.]+$/, "-transcoded.mp4")
            await this.minioService.uploadFromFile(tmpOutput, outputPath)

            await this.jobRepo.update(job.id, {
                status: TranscodeStatus.COMPLETED,
                outputPath,
            })
            this.logger.log(`Job ${job.id} COMPLETED -> ${outputPath}`)
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : String(err)
            await this.jobRepo.update(job.id, { status: TranscodeStatus.FAILED, errorMessage })
            this.logger.error(`Job ${job.id} FAILED: ${errorMessage}`)
        } finally {
            for (const f of [tmpInput, tmpOutput]) {
                if (fs.existsSync(f)) fs.unlinkSync(f)
            }
        }
    }

    /** Wrap FFmpeg spawn in a Promise: resolves on exit 0, rejects on non-zero exit or spawn error. */
    private spawnFfmpeg(input: string, output: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const args = ["-y", "-i", input, "-vcodec", "libx264", "-acodec", "aac", "-movflags", "+faststart", output]
            const proc = spawn("ffmpeg", args)

            proc.stderr.on("data", (chunk: Buffer) => {
                this.logger.debug(`ffmpeg: ${chunk.toString().trim()}`)
            })

            proc.on("close", (code) => {
                if (code === 0) resolve()
                else reject(new Error(`FFmpeg exited with code ${code}`))
            })

            proc.on("error", (err) => {
                reject(new Error(`Failed to spawn FFmpeg: ${err.message}`))
            })
        })
    }
}
