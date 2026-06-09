# syntax=docker/dockerfile:1

# ---- Build stage ----
FROM golang:1.22-alpine AS build
WORKDIR /app
COPY go.mod ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o /cdn-origin .

# ---- Runtime stage ----
FROM alpine:3.20
WORKDIR /app
COPY --from=build /cdn-origin /app/cdn-origin
EXPOSE 3000
CMD ["/app/cdn-origin"]
