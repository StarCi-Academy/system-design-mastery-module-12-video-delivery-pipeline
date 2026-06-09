# --- Build stage: compile the NestJS app ---
FROM node:20-bookworm AS build
WORKDIR /app
COPY package.json ./
RUN npm install
COPY tsconfig.json nest-cli.json ./
COPY src ./src
RUN npm run build

# --- Runtime stage: ffmpeg + production deps + compiled dist ---
FROM node:20-bookworm-slim AS runtime
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY package.json ./
RUN npm install --omit=dev
COPY --from=build /app/dist ./dist
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
CMD ["node", "dist/main"]
