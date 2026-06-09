import { Module } from "@nestjs/common"
import { ConfigModule } from "@nestjs/config"
import { appConfig } from "./config"
import { CdnController, CdnService } from "./cdn"

@Module({
    imports: [
        ConfigModule.forRoot({
            isGlobal: true,
            load: [appConfig],
        }),
    ],
    controllers: [CdnController],
    providers: [CdnService],
})
export class AppModule {}
