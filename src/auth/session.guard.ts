import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { eq } from 'drizzle-orm';
import { SESSION_COOKIE } from '../app.setup';
import { DB, Db } from '../db/connection';
import { users } from '../db/schema';
import { IS_PUBLIC } from './decorators';

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, @Inject(DB) private readonly db: Db) {}

  canActivate(ctx: ExecutionContext): boolean {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()])) return true;
    const req = ctx.switchToHttp().getRequest();
    const id = Number(req.signedCookies?.[SESSION_COOKIE]);
    const user = Number.isInteger(id) ? this.db.select().from(users).where(eq(users.id, id)).get() : undefined;
    if (!user) throw new UnauthorizedException('Sesión inválida.');
    req.user = user;
    return true;
  }
}
