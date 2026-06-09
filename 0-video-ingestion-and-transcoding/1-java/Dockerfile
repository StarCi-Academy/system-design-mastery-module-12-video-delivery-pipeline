# --- Build stage: compile the Spring Boot fat jar ---
FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /app
COPY pom.xml ./
RUN mvn -q dependency:go-offline
COPY src ./src
RUN mvn -q clean package -DskipTests

# --- Runtime stage: JRE + ffmpeg + the fat jar ---
FROM eclipse-temurin:21-jre-jammy AS runtime
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/target/transcode-service.jar ./transcode-service.jar
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
CMD ["java", "-jar", "transcode-service.jar"]
