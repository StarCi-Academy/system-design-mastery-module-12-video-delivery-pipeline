# syntax=docker/dockerfile:1

# ---- Build stage ----
FROM mcr.microsoft.com/dotnet/sdk:8.0-alpine AS build
WORKDIR /app
COPY CdnOrigin.csproj ./
RUN dotnet restore
COPY . .
RUN dotnet publish -c Release -o /out

# ---- Runtime stage ----
FROM mcr.microsoft.com/dotnet/aspnet:8.0-alpine
WORKDIR /app
COPY --from=build /out ./
EXPOSE 3000
ENTRYPOINT ["dotnet", "CdnOrigin.dll"]
