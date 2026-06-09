package main

import (
	"log"
	"os"

	"github.com/gin-gonic/gin"

	"cdn-origin/handler"
)

func main() {
	r := gin.Default()

	cdn := r.Group("/api/cdn")
	{
		// GET /api/cdn/content/:key — serve content with appropriate Cache-Control.
		cdn.GET("/content/:key", handler.GetContent)
		// POST /api/cdn/purge/:key — evict the cached key at the NGINX edge.
		cdn.POST("/purge/:key", handler.PurgeContent)
	}

	port := os.Getenv("APP_PORT")
	if port == "" {
		port = "3000"
	}
	log.Printf("cdn-origin listening on :%s", port)
	if err := r.Run(":" + port); err != nil {
		log.Fatalf("server error: %v", err)
	}
}
