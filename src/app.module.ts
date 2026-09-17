import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { DbModule } from './db/connection';

@Module({ imports: [DbModule, AuthModule] })
export class AppModule {}
