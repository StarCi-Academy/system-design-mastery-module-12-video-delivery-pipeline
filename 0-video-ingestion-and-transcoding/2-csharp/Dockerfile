# --- Build stage: publish the ASP.NET Core app ---
FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /app
COPY TranscodeService.csproj ./
RUN dotnet restore
COPY . ./
RUN dotnet publish -c Release -o /out

# --- Runtime stage: aspnet runtime + ffmpeg + the published app ---
FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS runtime
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /out ./
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
ENTRYPOINT ["dotnet", "TranscodeService.dll"]
