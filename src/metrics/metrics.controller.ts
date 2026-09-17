import { Controller, Get, Render } from '@nestjs/common';
import { CurrentUser, Roles } from '../auth/decorators';
import { User } from '../db/schema';
import { MetricsService } from './metrics.service';

@Controller('dashboard')
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get()
  @Roles('AGENT')
  @Render('dashboard')
  dashboard(@CurrentUser() user: User) {
    const s = this.metrics.summary();
    return { user, ...s, cancelRatePct: s.cancelRate30 === null ? null : Math.round(s.cancelRate30 * 100) };
  }
}
