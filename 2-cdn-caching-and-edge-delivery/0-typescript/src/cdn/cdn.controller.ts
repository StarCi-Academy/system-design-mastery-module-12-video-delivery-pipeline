import { Controller, Get, Post, Param, Res } from "@nestjs/common"
import { Response } from "express"
import { CdnService } from "./cdn.service"

@Controller("api/cdn")
export class CdnController {
    constructor(private readonly cdnService: CdnService) {}

    // Serve a content item with Cache-Control headers tuned per asset type.
    @Get("content/:key")
    async getContent(@Param("key") key: string, @Res() res: Response): Promise<void> {
        const asset = this.cdnService.getAsset(key)

        if (asset.type === "static") {
            // Static assets (thumbnail, image): cache indefinitely at the CDN edge.
            // max-age=0 prevents browser cache; s-maxage=31536000 tells the CDN to hold 1 year.
            // immutable signals the browser that the resource will never change at this URL.
            res.setHeader("Cache-Control", "public, max-age=0, s-maxage=31536000, immutable")
        } else {
            // Dynamic content (HLS playlist, manifest): must stay fresh.
            // max-age=5 allows a 5-second browser cache; s-maxage=10 for the CDN edge.
            // stale-while-revalidate=5 lets the CDN serve stale while fetching a fresh copy.
            res.setHeader("Cache-Control", "public, max-age=5, s-maxage=10, stale-while-revalidate=5")
        }

        // Vary on Accept-Encoding so gzip/br variants are cached separately.
        res.setHeader("Vary", "Accept-Encoding")
        res.json(asset.data)
    }

    // Evict a cached key at the NGINX edge on demand.
    @Post("purge/:key")
    async purgeContent(@Param("key") key: string): Promise<{ purged: boolean; key: string }> {
        // Send PURGE to the NGINX proxy — requires the ngx_cache_purge module.
        const purged = await this.cdnService.purgeFromProxy(key)
        return { purged, key }
    }
}
