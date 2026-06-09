// Package main implements the video ingestion and transcoding service in Go.
//
// Contract (shared by all four language tracks):
//
//	POST /api/videos/transcode  body {"inputPath": "<minio object key>"}
//	  -> 202 Accepted {id, inputPath, outputPath, status, errorMessage, createdAt, updatedAt}
//	GET  /api/videos/transcode/:id
//	  -> 200 OK {id, inputPath, outputPath, status, errorMessage, outputUrl?, createdAt, updatedAt}
//
// The job lifecycle is PENDING -> PROCESSING -> COMPLETED | FAILED, persisted in
// PostgreSQL. FFmpeg runs as a child process via os/exec; the artifact is stored
// in MinIO and served through a time-limited presigned GET URL.
package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jmoiron/sqlx"
	_ "github.com/lib/pq"
	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

// Job represents a transcode_jobs row. Status drives the lifecycle.
type Job struct {
	ID         string    `db:"id"`
	InputPath  string    `db:"input_path"`
	Status     string    `db:"status"`
	OutputPath string    `db:"output_path"`
	Error      string    `db:"error"`
	CreatedAt  time.Time `db:"created_at"`
	UpdatedAt  time.Time `db:"updated_at"`
}

// config holds the runtime configuration read from environment variables.
type config struct {
	port        string
	dsn         string
	minioHost   string
	minioAccess string
	minioSecret string
	bucket      string
}

func loadConfig() config {
	return config{
		port:        envOr("PORT", "3000"),
		dsn:         envOr("POSTGRES_DSN", "postgres://transcode:transcode@postgres:5432/transcode?sslmode=disable"),
		minioHost:   envOr("MINIO_ENDPOINT", "minio:9000"),
		minioAccess: envOr("MINIO_ACCESS_KEY", "minioadmin"),
		minioSecret: envOr("MINIO_SECRET_KEY", "minioadmin"),
		bucket:      envOr("MINIO_BUCKET", "videos"),
	}
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// schema is applied at startup so the service owns the transcode_jobs table.
const schema = `
CREATE TABLE IF NOT EXISTS transcode_jobs (
    id          TEXT PRIMARY KEY,
    input_path  TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'PENDING',
    output_path TEXT NOT NULL DEFAULT '',
    error       TEXT NOT NULL DEFAULT '',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);`

// createJob inserts a new PENDING job and returns the full row.
func createJob(db *sqlx.DB, inputPath string) (Job, error) {
	id := uuid.New().String()
	const q = `
        INSERT INTO transcode_jobs (id, input_path, status, created_at, updated_at)
        VALUES ($1, $2, 'PENDING', NOW(), NOW())
        RETURNING id, input_path, status, output_path, error, created_at, updated_at
    `
	var job Job
	err := db.Get(&job, q, id, inputPath)
	return job, err
}

// findPendingJob returns an existing non-FAILED job for the same inputPath (idempotency).
func findPendingJob(db *sqlx.DB, inputPath string) (Job, bool) {
	var job Job
	const q = `SELECT * FROM transcode_jobs WHERE input_path = $1 AND status != 'FAILED' LIMIT 1`
	if err := db.Get(&job, q, inputPath); err != nil {
		return Job{}, false
	}
	return job, true
}

// updateJobStatus transitions the job to the next status.
func updateJobStatus(db *sqlx.DB, id, status, outputPath, errMsg string) error {
	const q = `
        UPDATE transcode_jobs
        SET status = $2, output_path = $3, error = $4, updated_at = NOW()
        WHERE id = $1
    `
	_, err := db.Exec(q, id, status, outputPath, errMsg)
	return err
}

// nullable returns nil for empty strings so the JSON field serializes as null.
func nullable(s string) any {
	if s == "" {
		return nil
	}
	return s
}

// jobResponse builds the flat response shape shared by all four languages.
func jobResponse(job Job, outputURL string) gin.H {
	resp := gin.H{
		"id":           job.ID,
		"inputPath":    job.InputPath,
		"outputPath":   nullable(job.OutputPath),
		"status":       job.Status,
		"errorMessage": nullable(job.Error),
		"createdAt":    job.CreatedAt,
		"updatedAt":    job.UpdatedAt,
	}
	if outputURL != "" {
		resp["outputUrl"] = outputURL
	}
	return resp
}

// truncate caps a string to n bytes so a long FFmpeg log fits the DB column.
func truncate(s string, n int) string {
	if len(s) > n {
		return s[:n]
	}
	return s
}

// TranscodeRequest is the POST body for /api/videos/transcode.
type TranscodeRequest struct {
	InputPath string `json:"inputPath" binding:"required"`
}

// runTranscode marks the job PROCESSING, downloads the source, spawns FFmpeg,
// uploads to MinIO, and transitions the job to COMPLETED or FAILED.
func runTranscode(db *sqlx.DB, mc *minio.Client, bucket, jobID, inputPath string) {
	_ = updateJobStatus(db, jobID, "PROCESSING", "", "")

	inPath := filepath.Join(os.TempDir(), jobID+"-in")
	outPath := filepath.Join(os.TempDir(), jobID+".mp4")
	defer os.Remove(inPath)
	defer os.Remove(outPath)

	if err := mc.FGetObject(context.Background(), bucket, inputPath, inPath,
		minio.GetObjectOptions{}); err != nil {
		_ = updateJobStatus(db, jobID, "FAILED", "", "minio fetch: "+err.Error())
		return
	}

	// FFmpeg: re-encode to H.264/AAC MP4 with a streaming-friendly moov atom.
	cmd := exec.Command("ffmpeg",
		"-i", inPath,
		"-c:v", "libx264",
		"-c:a", "aac",
		"-movflags", "faststart",
		"-y", outPath,
	)
	output, err := cmd.CombinedOutput()
	if err != nil {
		_ = updateJobStatus(db, jobID, "FAILED", "", truncate(string(output), 2048))
		return
	}

	objectKey := "transcoded/" + jobID + ".mp4"
	if _, err := mc.FPutObject(context.Background(), bucket, objectKey, outPath,
		minio.PutObjectOptions{ContentType: "video/mp4"}); err != nil {
		_ = updateJobStatus(db, jobID, "FAILED", "", "minio upload: "+err.Error())
		return
	}

	_ = updateJobStatus(db, jobID, "COMPLETED", objectKey, "")
}

// handleTranscode creates the job row and spawns the FFmpeg goroutine.
func handleTranscode(db *sqlx.DB, mc *minio.Client, bucket string) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req TranscodeRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		// Idempotency: same inputPath (not FAILED) -> return the existing job.
		if existing, ok := findPendingJob(db, req.InputPath); ok {
			c.JSON(http.StatusAccepted, jobResponse(existing, ""))
			return
		}

		job, err := createJob(db, req.InputPath)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create job"})
			return
		}

		go runTranscode(db, mc, bucket, job.ID, job.InputPath)

		// 202 Accepted: the job is created but FFmpeg has not finished.
		c.JSON(http.StatusAccepted, jobResponse(job, ""))
	}
}

// handleGetJob returns job status and, when COMPLETED, a presigned GET URL.
func handleGetJob(db *sqlx.DB, mc *minio.Client, bucket string) gin.HandlerFunc {
	return func(c *gin.Context) {
		id := c.Param("id")
		var job Job
		const q = `SELECT * FROM transcode_jobs WHERE id = $1`
		if err := db.Get(&job, q, id); err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "job not found"})
			return
		}

		outputURL := ""
		if job.Status == "COMPLETED" && job.OutputPath != "" {
			presigned, err := mc.PresignedGetObject(context.Background(), bucket,
				job.OutputPath, 15*time.Minute, nil)
			if err == nil {
				outputURL = presigned.String()
			}
		}

		c.JSON(http.StatusOK, jobResponse(job, outputURL))
	}
}

// ensureBucket creates the configured bucket if it does not already exist.
func ensureBucket(mc *minio.Client, bucket string) error {
	exists, err := mc.BucketExists(context.Background(), bucket)
	if err != nil {
		return err
	}
	if !exists {
		return mc.MakeBucket(context.Background(), bucket, minio.MakeBucketOptions{})
	}
	return nil
}

// seedSource uploads the baked synthetic clip to MinIO so the transcode flow has
// a real input object to read. It is a no-op when SEED_SOURCE is unset.
func seedSource(mc *minio.Client, bucket string) {
	src := os.Getenv("SEED_SOURCE")
	obj := envOr("SEED_OBJECT", "source/sample.mp4")
	if src == "" {
		return
	}
	if _, err := os.Stat(src); err != nil {
		log.Printf("seed source %s not found, skipping: %v", src, err)
		return
	}
	if _, err := mc.FPutObject(context.Background(), bucket, obj, src,
		minio.PutObjectOptions{ContentType: "video/mp4"}); err != nil {
		log.Printf("seed upload failed: %v", err)
		return
	}
	log.Printf("seeded source object %s/%s", bucket, obj)
}

func mustConnectDB(dsn string) *sqlx.DB {
	// Retry: the service may start before PostgreSQL accepts connections.
	for i := 0; i < 30; i++ {
		db, err := sqlx.Connect("postgres", dsn)
		if err == nil {
			return db
		}
		log.Printf("waiting for postgres (%d/30): %v", i+1, err)
		time.Sleep(2 * time.Second)
	}
	log.Fatal("could not connect to postgres")
	return nil
}

func main() {
	cfg := loadConfig()

	db := mustConnectDB(cfg.dsn)
	if _, err := db.Exec(schema); err != nil {
		log.Fatalf("schema init failed: %v", err)
	}

	mc, err := minio.New(cfg.minioHost, &minio.Options{
		Creds:  credentials.NewStaticV4(cfg.minioAccess, cfg.minioSecret, ""),
		Secure: false,
	})
	if err != nil {
		log.Fatalf("minio client init failed: %v", err)
	}
	if err := ensureBucket(mc, cfg.bucket); err != nil {
		log.Fatalf("bucket init failed: %v", err)
	}
	seedSource(mc, cfg.bucket)

	r := gin.Default()
	r.POST("/api/videos/transcode", handleTranscode(db, mc, cfg.bucket))
	r.GET("/api/videos/transcode/:id", handleGetJob(db, mc, cfg.bucket))
	r.GET("/health", func(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"status": "ok"}) })

	log.Printf("transcode-service listening on :%s", cfg.port)
	if err := r.Run(":" + cfg.port); err != nil {
		log.Fatal(err)
	}
}
