import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { DbModule } from './db/connection';
import { MetricsModule } from './metrics/metrics.module';
import { TicketsModule } from './tickets/tickets.module';

@Module({ imports: [DbModule, AuthModule, TicketsModule, MetricsModule] })
export class AppModule {}
