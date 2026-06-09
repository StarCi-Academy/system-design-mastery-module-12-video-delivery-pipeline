package com.starci.transcode;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.Instant;

@Entity
@Table(name = "transcode_jobs")
public class TranscodeJob {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private String id;

    // The raw input path inside the MinIO bucket.
    @Column(nullable = false)
    private String inputPath;

    // Populated only after the transcode completes successfully.
    @Column
    private String outputPath;

    // Job lifecycle: PENDING -> PROCESSING -> COMPLETED | FAILED.
    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private JobStatus status = JobStatus.PENDING;

    // Error detail when status is FAILED.
    @Column
    private String errorMessage;

    @CreationTimestamp
    private Instant createdAt;

    @UpdateTimestamp
    private Instant updatedAt;

    public TranscodeJob() {
    }

    public TranscodeJob(String inputPath) {
        this.inputPath = inputPath;
    }

    public String getId() {
        return id;
    }

    public String getInputPath() {
        return inputPath;
    }

    public String getOutputPath() {
        return outputPath;
    }

    public void setOutputPath(String outputPath) {
        this.outputPath = outputPath;
    }

    public JobStatus getStatus() {
        return status;
    }

    public void setStatus(JobStatus status) {
        this.status = status;
    }

    public String getErrorMessage() {
        return errorMessage;
    }

    public void setErrorMessage(String errorMessage) {
        this.errorMessage = errorMessage;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }
}
