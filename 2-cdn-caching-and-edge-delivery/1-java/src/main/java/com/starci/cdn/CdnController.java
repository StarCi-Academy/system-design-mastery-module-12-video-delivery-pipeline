package com.starci.cdn;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.List;
import java.util.Map;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/cdn")
public class CdnController {

    private final String proxyUrl;
    private final HttpClient httpClient = HttpClient.newHttpClient();

    // In-memory asset store for demo purposes (real system uses object storage).
    private record Asset(String type, Map<String, Object> data) {}

    private final Map<String, Asset> assets = Map.of(
        "thumbnail-001", new Asset("static",
            Map.of("url", "https://cdn.example.com/t/001.jpg", "width", 640, "height", 360)),
        "playlist-live", new Asset("dynamic",
            Map.of("version", 1, "segments", List.of("seg0.ts", "seg1.ts")))
    );

    public CdnController(@Value("${cdn.proxy-url}") String proxyUrl) {
        this.proxyUrl = proxyUrl;
    }

    @GetMapping("/content/{key}")
    public ResponseEntity<Object> getContent(@PathVariable String key) {
        Asset asset = assets.getOrDefault(key, new Asset("dynamic", Map.of("message", "not found")));

        String cacheControl;
        if ("static".equals(asset.type())) {
            // Static assets: cache indefinitely at the CDN edge; browser never caches.
            cacheControl = "public, max-age=0, s-maxage=31536000, immutable";
        } else {
            // Dynamic content: short TTL with stale-while-revalidate.
            cacheControl = "public, max-age=5, s-maxage=10, stale-while-revalidate=5";
        }

        return ResponseEntity.ok()
            .header("Cache-Control", cacheControl)
            // Vary on Accept-Encoding so gzip/br variants are cached separately.
            .header("Vary", "Accept-Encoding")
            .body(asset.data());
    }

    @PostMapping("/purge/{key}")
    public ResponseEntity<Map<String, Object>> purgeContent(@PathVariable String key) {
        boolean purged = purgeFromProxy(key);
        return ResponseEntity.ok(Map.of("purged", purged, "key", key));
    }

    private boolean purgeFromProxy(String key) {
        try {
            // Send an HTTP PURGE to NGINX (ngx_cache_purge module).
            // Do NOT send Accept-Encoding: ngx_cache_purge uses proxy_cache_key
            // ("$request_uri") so the key is URI-only; including Vary-related
            // headers causes a 412 Vary mismatch.
            HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create(proxyUrl + "/api/cdn/content/" + key))
                .timeout(Duration.ofSeconds(3))
                .method("PURGE", HttpRequest.BodyPublishers.noBody())
                .build();
            HttpResponse<Void> response = httpClient.send(request, HttpResponse.BodyHandlers.discarding());
            return response.statusCode() == 200;
        } catch (Exception e) {
            // Purge failure is non-fatal; the CDN will expire the entry naturally.
            return false;
        }
    }
}
