import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import hbs from 'hbs';
import { join } from 'path';
import { HttpErrorFilter } from './http-error.filter';

export const SESSION_COOKIE = 'uid';

export function configureApp(app: NestExpressApplication): void {
  const secret = process.env.SESSION_SECRET ?? 'dev-only-secret';
  app.use(cookieParser(secret));
  app.setBaseViewsDir(join(process.cwd(), 'views'));
  app.setViewEngine('hbs');
  hbs.registerHelper('eq', (a: unknown, b: unknown) => a === b);
  hbs.registerHelper('date', (iso: string) => iso ? iso.slice(0, 16).replace('T', ' ') + ' UTC' : '');
  hbs.registerHelper('fixed', (n: number | null) => n === null || n === undefined ? '—' : n.toFixed(1));
  hbs.registerHelper('toString', (v: unknown) => String(v));
  app.useGlobalFilters(new HttpErrorFilter());
}
