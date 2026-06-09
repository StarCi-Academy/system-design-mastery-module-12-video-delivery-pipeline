# --- Build stage: publish the ASP.NET Core app ---
FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /app
COPY StreamingService.csproj ./
RUN dotnet restore
COPY Program.cs appsettings.json ./
RUN dotnet publish -c Release -o /out

# --- Runtime stage: ASP.NET runtime + ffmpeg ---
FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS runtime
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /out ./
# Generate a short synthetic test clip so the lesson runs without a binary asset.
RUN mkdir -p fixtures \
    && ffmpeg -hide_banner -loglevel error \
       -f lavfi -i testsrc=duration=12:size=1920x1080:rate=30 \
       -f lavfi -i sine=frequency=440:duration=12 \
       -c:v libx264 -pix_fmt yuv420p -g 60 -c:a aac -shortest \
       fixtures/sample.mp4
ENV STREAMS_DIR=/app/streams \
    SOURCE_DIR=/app/fixtures
EXPOSE 3000
CMD ["dotnet", "StreamingService.dll"]
