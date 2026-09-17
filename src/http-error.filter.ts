import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { Request, Response } from 'express';
import { SESSION_COOKIE } from './app.setup';

@Catch(HttpException)
export class HttpErrorFilter implements ExceptionFilter {
  private readonly log = new Logger('Http');

  catch(ex: HttpException, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request & { user?: { id: number } }>();
    const status = ex.getStatus();
    const raw = ex.getResponse();
    const body: Record<string, unknown> = typeof raw === 'string' ? { message: raw } : (raw as Record<string, unknown>);
    this.log.warn(`${status} ${req.method} ${req.path} user=${req.user?.id ?? '-'} ${JSON.stringify(body)}`);
    if (status === 401) {
      res.clearCookie(SESSION_COOKIE);
      res.redirect('/login');
      return;
    }
    res.status(status).render('error', { status, user: req.user, ...body });
  }
}
