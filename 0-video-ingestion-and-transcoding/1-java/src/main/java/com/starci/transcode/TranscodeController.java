package com.starci.transcode;

import com.starci.transcode.TranscodeDtos.TranscodeJobDto;
import com.starci.transcode.TranscodeDtos.TranscodeRequest;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/videos/transcode")
public class TranscodeController {

    private final TranscodeService transcodeService;
    private final TranscodeJobRepository jobRepository;
    private final StorageService storage;

    public TranscodeController(TranscodeService transcodeService,
                               TranscodeJobRepository jobRepository,
                               StorageService storage) {
        this.transcodeService = transcodeService;
        this.jobRepository = jobRepository;
        this.storage = storage;
    }

    @PostMapping
    public ResponseEntity<TranscodeJobDto> createJob(@RequestBody TranscodeRequest req) {
        TranscodeJob job = transcodeService.createJob(req.inputPath());
        // 202 Accepted — the job is PENDING and FFmpeg runs in the background.
        return ResponseEntity.status(HttpStatus.ACCEPTED).body(TranscodeJobDto.from(job, null));
    }

    @GetMapping("/{id}")
    public ResponseEntity<TranscodeJobDto> getJob(@PathVariable String id) {
        TranscodeJob job = jobRepository.findById(id)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Job not found"));

        String outputUrl = null;
        if (job.getStatus() == JobStatus.COMPLETED && job.getOutputPath() != null) {
            outputUrl = storage.presignedGetUrl(job.getOutputPath());
        }
        return ResponseEntity.ok(TranscodeJobDto.from(job, outputUrl));
    }
}
