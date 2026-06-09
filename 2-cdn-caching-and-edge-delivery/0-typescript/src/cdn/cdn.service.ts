import { Injectable, Logger } from "@nestjs/common"
import { ConfigService } from "@nestjs/config"
import axios from "axios"

// Shape of a cacheable asset served by the origin.
export interface CdnAsset {
    type: "static" | "dynamic"
    data: unknown
}

@Injectable()
export class CdnService {
    private readonly logger = new Logger(CdnService.name)
    private readonly proxyUrl: string

    // In-memory asset store for demo purposes (real system uses object storage).
    private readonly assets: Record<string, CdnAsset> = {
        "thumbnail-001": {
            type: "static",
            data: { url: "https://cdn.example.com/t/001.jpg", width: 640, height: 360 },
        },
        "playlist-live": {
            type: "dynamic",
            data: { version: 1, segments: ["seg0.ts", "seg1.ts"] },
        },
    }

    constructor(private readonly config: ConfigService) {
        // Read proxy URL from config so it can be overridden in tests.
        this.proxyUrl = this.config.get<string>("app.proxyUrl") ?? "http://cdn-proxy:80"
    }

    getAsset(key: string): CdnAsset {
        return this.assets[key] ?? { type: "dynamic", data: { message: "not found" } }
    }

    async purgeFromProxy(key: string): Promise<boolean> {
        try {
            // Send HTTP PURGE to NGINX — the ngx_cache_purge module handles this verb.
            // URL must match the cache key pattern configured in nginx.conf.
            await axios.request({
                method: "PURGE",
                url: `${this.proxyUrl}/api/cdn/content/${key}`,
                // Do NOT send Accept-Encoding on PURGE: ngx_cache_purge uses
                // proxy_cache_key ("$request_uri") so the key is URI-only.
                // Including Vary-related headers causes a 412 Vary mismatch when
                // the cached variant was stored under a different encoding.
                decompress: false,
                timeout: 3000,
            })
            this.logger.log(`Cache purged for key: ${key}`)
            return true
        } catch (err) {
            // Log but do not throw — purge failure is non-fatal; CDN will expire naturally.
            this.logger.warn(`Purge failed for key ${key}: ${(err as Error).message}`)
            return false
        }
    }
}
