import { Body, Controller, Get, HttpCode, HttpStatus, NotFoundException, Param, Post } from "@nestjs/common"
import { TranscodeService } from "./transcode.service"

/** Request body for POST /api/videos/transcode. */
class CreateTranscodeDto {
    inputPath: string
}

@Controller("api/videos/transcode")
export class TranscodeController {
    constructor(private readonly transcodeService: TranscodeService) {}

    @Post()
    @HttpCode(HttpStatus.ACCEPTED) // 202: accepted, FFmpeg runs in the background.
    async create(@Body() dto: CreateTranscodeDto) {
        const job = await this.transcodeService.createJob(dto.inputPath)
        return {
            id: job.id,
            inputPath: job.inputPath,
            outputPath: job.outputPath ?? null,
            status: job.status,
            errorMessage: job.errorMessage ?? null,
            createdAt: job.createdAt,
            updatedAt: job.updatedAt,
        }
    }

    @Get(":id")
    async get(@Param("id") id: string) {
        const job = await this.transcodeService.findOne(id)
        if (!job) throw new NotFoundException("Job not found")
        const outputUrl = await this.transcodeService.presignedFor(job)
        return {
            id: job.id,
            inputPath: job.inputPath,
            outputPath: job.outputPath ?? null,
            status: job.status,
            errorMessage: job.errorMessage ?? null,
            outputUrl,
            createdAt: job.createdAt,
            updatedAt: job.updatedAt,
        }
    }
}
