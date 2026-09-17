import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { DbModule } from './db/connection';
import { TicketsModule } from './tickets/tickets.module';

@Module({ imports: [DbModule, AuthModule, TicketsModule] })
export class AppModule {}
