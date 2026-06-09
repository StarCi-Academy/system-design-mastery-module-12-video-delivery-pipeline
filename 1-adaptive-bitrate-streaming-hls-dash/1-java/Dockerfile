# --- Build stage: compile the Spring Boot fat jar ---
FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /app
COPY pom.xml ./
RUN mvn -q -B dependency:go-offline
COPY src ./src
RUN mvn -q -B clean package -DskipTests

# --- Runtime stage: JRE + ffmpeg + the jar ---
FROM eclipse-temurin:21-jre-jammy AS runtime
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/target/streaming-service-1.0.0.jar ./app.jar
# Generate a short synthetic test clip so the lesson runs without a binary asset.
RUN mkdir -p fixtures \
    && ffmpeg -hide_banner -loglevel error \
       -f lavfi -i testsrc=duration=12:size=1920x1080:rate=30 \
       -f lavfi -i sine=frequency=440:duration=12 \
       -c:v libx264 -pix_fmt yuv420p -g 60 -c:a aac -shortest \
       fixtures/sample.mp4
ENV APP_STREAMS_DIR=/app/streams \
    APP_SOURCE_DIR=/app/fixtures
EXPOSE 3000
CMD ["java", "-jar", "app.jar"]
