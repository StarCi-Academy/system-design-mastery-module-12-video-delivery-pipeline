package handler

import (
	"net/http"
	"net/url"
	"os"
	"time"

	"github.com/gin-gonic/gin"
)

// asset represents a cacheable content entry served by the origin.
type asset struct {
	assetType string
	data      gin.H
}

// assetStore is an in-memory content store for demo purposes.
var assetStore = map[string]asset{
	"thumbnail-001": {
		assetType: "static",
		data:      gin.H{"url": "https://cdn.example.com/t/001.jpg", "width": 640, "height": 360},
	},
	"playlist-live": {
		assetType: "dynamic",
		data:      gin.H{"version": 1, "segments": []string{"seg0.ts", "seg1.ts"}},
	},
}

// proxyURL is the NGINX edge base URL the origin sends PURGE requests to.
func proxyURL() string {
	if v := os.Getenv("PROXY_URL"); v != "" {
		return v
	}
	return "http://cdn-proxy:8080"
}

// GetContent serves a content item with Cache-Control headers tuned per asset type.
func GetContent(c *gin.Context) {
	key := c.Param("key")
	item, ok := assetStore[key]
	if !ok {
		item = asset{assetType: "dynamic", data: gin.H{"message": "not found"}}
	}

	if item.assetType == "static" {
		// Static assets: cache indefinitely at the CDN edge; browser never caches.
		c.Header("Cache-Control", "public, max-age=0, s-maxage=31536000, immutable")
	} else {
		// Dynamic content: short TTL with stale-while-revalidate.
		c.Header("Cache-Control", "public, max-age=5, s-maxage=10, stale-while-revalidate=5")
	}

	// Vary on Accept-Encoding so gzip/br variants are cached separately.
	c.Header("Vary", "Accept-Encoding")
	c.JSON(http.StatusOK, item.data)
}

// PurgeContent sends a PURGE request to the NGINX edge to evict the cached key.
func PurgeContent(c *gin.Context) {
	key := c.Param("key")
	purged := purgeFromProxy(key)
	c.JSON(http.StatusOK, gin.H{"purged": purged, "key": key})
}

// purgeFromProxy issues an HTTP PURGE to NGINX (ngx_cache_purge module).
func purgeFromProxy(key string) bool {
	target := proxyURL() + "/api/cdn/content/" + url.PathEscape(key)
	req, err := http.NewRequest("PURGE", target, nil)
	if err != nil {
		return false
	}
	// Do NOT send Accept-Encoding: ngx_cache_purge uses proxy_cache_key
	// ("$request_uri") so the key is URI-only; including Vary-related
	// headers causes a 412 Vary mismatch.

	client := &http.Client{Timeout: 3 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	return resp.StatusCode == http.StatusOK
}
