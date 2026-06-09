package com.starci.transcode;

import org.springframework.stereotype.Service;

import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.Path;

/** Orchestrates job creation, FFmpeg execution, and MinIO upload. */
@Service
public class TranscodeService {

    private final TranscodeJobRepository jobRepository;
    private final StorageService storage;

    public TranscodeService(TranscodeJobRepository jobRepository, StorageService storage) {
        this.jobRepository = jobRepository;
        this.storage = storage;
    }

    // Create a PENDING job and run the transcode in the background (a virtual thread).
    // Returns immediately so the controller can reply with HTTP 202 Accepted.
    public TranscodeJob createJob(String inputPath) {
        // Idempotency: if a job for this inputPath already exists and is not FAILED, return it.
        return jobRepository.findFirstByInputPathAndStatusNot(inputPath, JobStatus.FAILED)
                .orElseGet(() -> {
                    TranscodeJob job = jobRepository.save(new TranscodeJob(inputPath));
                    Thread.ofVirtual().start(() -> runTranscode(job.getId()));
                    return job;
                });
    }

    private void runTranscode(String jobId) {
        TranscodeJob job = jobRepository.findById(jobId).orElseThrow();

        job.setStatus(JobStatus.PROCESSING);
        jobRepository.save(job);

        Path input = Path.of(System.getProperty("java.io.tmpdir"), job.getId() + "-input");
        Path output = Path.of(System.getProperty("java.io.tmpdir"), job.getId() + ".mp4");
        try {
            // Download the source from MinIO so FFmpeg can read it as a local file.
            storage.download(job.getInputPath(), input);

            // Build the FFmpeg command: re-encode to H.264/AAC, overwrite output.
            ProcessBuilder pb = new ProcessBuilder(
                    "ffmpeg", "-y",
                    "-i", input.toString(),
                    "-c:v", "libx264",
                    "-c:a", "aac",
                    "-preset", "fast",
                    output.toString()
            );
            pb.redirectErrorStream(true);
            Process proc = pb.start();
            // Drain stdout to prevent the child from blocking on a full pipe buffer.
            proc.getInputStream().transferTo(OutputStream.nullOutputStream());
            int exitCode = proc.waitFor();
            if (exitCode != 0) {
                job.setStatus(JobStatus.FAILED);
                job.setErrorMessage("FFmpeg exited with code " + exitCode);
                jobRepository.save(job);
                return;
            }

            String artifactKey = "transcoded/" + job.getId() + ".mp4";
            storage.upload(artifactKey, output);

            job.setOutputPath(artifactKey);
            job.setStatus(JobStatus.COMPLETED);
            jobRepository.save(job);
        } catch (Exception e) {
            job.setStatus(JobStatus.FAILED);
            job.setErrorMessage(e.getMessage());
            jobRepository.save(job);
        } finally {
            try {
                Files.deleteIfExists(input);
                Files.deleteIfExists(output);
            } catch (Exception ignored) {
                // Best-effort cleanup.
            }
        }
    }
}
