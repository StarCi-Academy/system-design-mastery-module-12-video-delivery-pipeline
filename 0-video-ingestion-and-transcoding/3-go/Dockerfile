# --- Build stage: compile the Go binary ---
FROM golang:1.22-bookworm AS build
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY main.go ./
RUN CGO_ENABLED=0 GOOS=linux go build -o transcode-service .

# --- Runtime stage: ffmpeg + the static binary ---
FROM debian:bookworm-slim AS runtime
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/transcode-service ./transcode-service
# Bake a short synthetic source clip so the lesson runs without a binary asset.
RUN mkdir -p /app/fixtures \
    && ffmpeg -hide_banner -loglevel error \
       -f lavfi -i testsrc=duration=4:size=640x360:rate=24 \
       -f lavfi -i sine=frequency=440:duration=4 \
       -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest \
       /app/fixtures/sample.mp4
ENV PORT=3000 \
    SEED_SOURCE=/app/fixtures/sample.mp4 \
    SEED_OBJECT=source/sample.mp4
EXPOSE 3000
CMD ["./transcode-service"]
