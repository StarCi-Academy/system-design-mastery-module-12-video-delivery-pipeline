import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm"

/** Lifecycle states a transcode job passes through. */
export enum TranscodeStatus {
    /** Job created but FFmpeg not yet started. */
    PENDING = "PENDING",
    /** FFmpeg is actively running for this job. */
    PROCESSING = "PROCESSING",
    /** FFmpeg exited 0 and artifact was uploaded to MinIO. */
    COMPLETED = "COMPLETED",
    /** FFmpeg exited non-zero or an upload error occurred. */
    FAILED = "FAILED",
}

/** Persistent record for a single transcode job. */
@Entity("transcode_job")
export class TranscodeJobEntity {
    @PrimaryGeneratedColumn("uuid")
    id: string

    /** Path inside MinIO bucket where the source video lives. */
    @Column()
    inputPath: string

    /** Path inside MinIO bucket where the transcoded artifact will be stored. */
    @Column({ nullable: true })
    outputPath: string | null

    /** Current lifecycle state of the job. */
    @Column({ type: "enum", enum: TranscodeStatus, default: TranscodeStatus.PENDING })
    status: TranscodeStatus

    /** Error message if status is FAILED. */
    @Column({ nullable: true })
    errorMessage: string | null

    @CreateDateColumn()
    createdAt: Date

    @UpdateDateColumn()
    updatedAt: Date
}
