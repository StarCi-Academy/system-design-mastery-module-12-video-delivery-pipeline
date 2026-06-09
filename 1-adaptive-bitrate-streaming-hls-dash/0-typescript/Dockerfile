# --- Build stage: compile TypeScript to JavaScript ---
FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY package.json ./
RUN npm install
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# --- Runtime stage: ffmpeg + production deps only ---
FROM node:20-bookworm-slim AS runtime
WORKDIR /app
# ffmpeg is the transcoding engine invoked by fluent-ffmpeg.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*
COPY package.json ./
RUN npm install --omit=dev
COPY --from=build /app/dist ./dist
# Generate a short synthetic test clip (12s, 1080p, with a tone) so the lesson
# runs without shipping a binary asset. Replace fixtures/sample.mp4 to use a real clip.
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
CMD ["node", "dist/main.js"]
