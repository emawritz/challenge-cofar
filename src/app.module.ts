import { Module } from '@nestjs/common';
import { DbModule } from './db/connection';

@Module({ imports: [DbModule] })
export class AppModule {}
