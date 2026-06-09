package com.starci.transcode;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface TranscodeJobRepository extends JpaRepository<TranscodeJob, String> {
    // Idempotency lookup: an existing non-FAILED job for the same input.
    Optional<TranscodeJob> findFirstByInputPathAndStatusNot(String inputPath, JobStatus status);
}
