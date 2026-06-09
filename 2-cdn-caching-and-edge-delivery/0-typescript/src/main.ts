import { NestFactory } from "@nestjs/core"
import { ConfigService } from "@nestjs/config"
import { AppModule } from "./app.module"

async function bootstrap(): Promise<void> {
    const app = await NestFactory.create(AppModule)
    const config = app.get(ConfigService)
    const port = config.get<number>("app.port") ?? 3000
    // Bind to 0.0.0.0 so the container is reachable from the host via docker port mapping.
    await app.listen(port, "0.0.0.0")
}

void bootstrap()
