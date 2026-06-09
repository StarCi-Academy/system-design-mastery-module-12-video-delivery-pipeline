package com.starci.transcode;

/** Job lifecycle: PENDING -> PROCESSING -> COMPLETED | FAILED. */
public enum JobStatus {
    PENDING,
    PROCESSING,
    COMPLETED,
    FAILED
}
