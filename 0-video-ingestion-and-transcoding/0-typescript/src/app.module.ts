import { Module } from "@nestjs/common"
import { ConfigModule, ConfigService } from "@nestjs/config"
import { TypeOrmModule } from "@nestjs/typeorm"
import { TranscodeJobEntity } from "./transcode/entities/transcode-job.entity"
import { TranscodeController } from "./transcode/transcode.controller"
import { TranscodeService } from "./transcode/transcode.service"
import { MinioService } from "./transcode/minio.service"

@Module({
    imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        TypeOrmModule.forRootAsync({
            inject: [ConfigService],
            useFactory: (cs: ConfigService) => ({
                type: "postgres",
                host: cs.get<string>("DB_HOST", "postgres"),
                port: parseInt(cs.get<string>("DB_PORT", "5432"), 10),
                username: cs.get<string>("DB_USER", "transcode"),
                password: cs.get<string>("DB_PASSWORD", "transcode"),
                database: cs.get<string>("DB_NAME", "transcode"),
                entities: [TranscodeJobEntity],
                synchronize: true,
                retryAttempts: 30,
                retryDelay: 2000,
            }),
        }),
        TypeOrmModule.forFeature([TranscodeJobEntity]),
    ],
    controllers: [TranscodeController],
    providers: [TranscodeService, MinioService],
})
export class AppModule {}
