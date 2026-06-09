package com.starci.transcode;

import java.time.Instant;

/** Request body and response DTO for the transcode endpoints. */
public final class TranscodeDtos {

    public record TranscodeRequest(String inputPath) {
    }

    public record TranscodeJobDto(
            String id,
            String inputPath,
            String outputPath,
            String status,
            String errorMessage,
            String outputUrl,
            Instant createdAt,
            Instant updatedAt
    ) {
        public static TranscodeJobDto from(TranscodeJob job, String outputUrl) {
            return new TranscodeJobDto(
                    job.getId(),
                    job.getInputPath(),
                    job.getOutputPath(),
                    job.getStatus().name(),
                    job.getErrorMessage(),
                    outputUrl,
                    job.getCreatedAt(),
                    job.getUpdatedAt()
            );
        }
    }

    private TranscodeDtos() {
    }
}
