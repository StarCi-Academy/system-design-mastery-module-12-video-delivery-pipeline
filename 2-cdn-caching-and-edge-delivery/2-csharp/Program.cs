using System.Net.Http;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddSingleton<HttpClient>();
var app = builder.Build();

// Read configuration through the standard configuration layer.
var appPort = Environment.GetEnvironmentVariable("APP_PORT") ?? "3000";
var proxyUrl = Environment.GetEnvironmentVariable("PROXY_URL") ?? "http://cdn-proxy:8080";

// In-memory asset store for demo purposes (real system uses object storage).
var assets = new Dictionary<string, (string Type, object Data)>
{
    ["thumbnail-001"] = ("static", new { url = "https://cdn.example.com/t/001.jpg", width = 640, height = 360 }),
    ["playlist-live"] = ("dynamic", new { version = 1, segments = new[] { "seg0.ts", "seg1.ts" } }),
};

app.MapGet("/api/cdn/content/{key}", (string key, HttpContext ctx) =>
{
    var asset = assets.TryGetValue(key, out var a)
        ? a
        : ("dynamic", (object)new { message = "not found" });

    var cacheControl = asset.Item1 == "static"
        // Static assets: cache indefinitely at the CDN edge; browser never caches.
        ? "public, max-age=0, s-maxage=31536000, immutable"
        // Dynamic content: short TTL with stale-while-revalidate.
        : "public, max-age=5, s-maxage=10, stale-while-revalidate=5";

    ctx.Response.Headers["Cache-Control"] = cacheControl;
    // Vary on Accept-Encoding so gzip/br variants are cached separately.
    ctx.Response.Headers["Vary"] = "Accept-Encoding";
    return Results.Json(asset.Item2);
});

app.MapPost("/api/cdn/purge/{key}", async (string key, HttpClient http) =>
{
    var purged = await PurgeFromProxy(http, proxyUrl, key);
    return Results.Json(new { purged, key });
});

app.Run($"http://0.0.0.0:{appPort}");

// Send an HTTP PURGE to NGINX (ngx_cache_purge module).
static async Task<bool> PurgeFromProxy(HttpClient http, string proxyUrl, string key)
{
    try
    {
        var request = new HttpRequestMessage(new HttpMethod("PURGE"), $"{proxyUrl}/api/cdn/content/{key}");
        // Do NOT send Accept-Encoding: ngx_cache_purge uses proxy_cache_key
        // ("$request_uri") so the key is URI-only; including Vary-related
        // headers causes a 412 Vary mismatch.
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(3));
        var response = await http.SendAsync(request, cts.Token);
        return (int)response.StatusCode == 200;
    }
    catch
    {
        // Purge failure is non-fatal; the CDN will expire the entry naturally.
        return false;
    }
}
