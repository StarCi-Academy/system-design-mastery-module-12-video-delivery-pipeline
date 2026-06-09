# --- Build stage: compile the Go binary ---
FROM golang:1.22-bookworm AS build
WORKDIR /app
COPY go.mod ./
COPY main.go ./
RUN CGO_ENABLED=0 GOOS=linux go build -o streaming-service .

# --- Runtime stage: ffmpeg + the static binary ---
FROM debian:bookworm-slim AS runtime
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/streaming-service ./streaming-service
# Generate a short synthetic test clip so the lesson runs without a binary asset.
RUN mkdir -p fixtures \
    && ffmpeg -hide_banner -loglevel error \
       -f lavfi -i testsrc=duration=12:size=1920x1080:rate=30 \
       -f lavfi -i sine=frequency=440:duration=12 \
       -c:v libx264 -pix_fmt yuv420p -g 60 -c:a aac -shortest \
       fixtures/sample.mp4
ENV PORT=3000 \
    STREAMS_DIR=/app/streams \
    SOURCE_DIR=/app/fixtures
EXPOSE 3000
CMD ["./streaming-service"]
