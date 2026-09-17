import { Body, Controller, Get, Inject, ParseIntPipe, Post, Render, Res, UnauthorizedException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { Response } from 'express';
import { SESSION_COOKIE } from '../app.setup';
import { DB, Db } from '../db/connection';
import { users } from '../db/schema';
import { Public } from './decorators';

@Controller()
export class AuthController {
  constructor(@Inject(DB) private readonly db: Db) {}

  @Get()
  root(@Res() res: Response): void {
    res.redirect('/tickets');
  }

  @Public()
  @Get('login')
  @Render('login')
  loginPage() {
    return { users: this.db.select().from(users).orderBy(users.id).all() };
  }

  @Public()
  @Post('login')
  login(@Body('userId', ParseIntPipe) userId: number, @Res() res: Response): void {
    const user = this.db.select().from(users).where(eq(users.id, userId)).get();
    if (!user) throw new UnauthorizedException('Usuario inexistente.');
    res.cookie(SESSION_COOKIE, String(user.id), { signed: true, httpOnly: true, sameSite: 'lax' });
    res.redirect('/tickets');
  }

  @Post('logout')
  logout(@Res() res: Response): void {
    res.clearCookie(SESSION_COOKIE);
    res.redirect('/login');
  }
}
