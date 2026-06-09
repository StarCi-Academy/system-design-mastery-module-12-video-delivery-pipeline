import { Module } from '@nestjs/common';
import { StreamController } from './stream/stream.controller';
import { StreamService } from './stream/stream.service';

@Module({
  controllers: [StreamController],
  providers: [StreamService],
})
export class AppModule {}
