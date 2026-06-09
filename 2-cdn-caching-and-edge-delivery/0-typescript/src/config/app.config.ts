import { registerAs } from "@nestjs/config"

// Centralized configuration namespace read through ConfigService.
// Do not read process.env directly outside this config layer.
export const appConfig = registerAs("app", () => ({
    port: Number(process.env.APP_PORT) || 3000,
    proxyUrl: process.env.PROXY_URL ?? "http://cdn-proxy:80",
}))
