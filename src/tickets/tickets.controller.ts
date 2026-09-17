import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, Render, Res } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Response } from 'express';
import { CurrentUser, Roles } from '../auth/decorators';
import { User } from '../db/schema';
import { CreateTicketDto } from './create-ticket.dto';
import { Action, TRANSITIONS } from './state-machine';
import { QueueFilters, TicketsService } from './tickets.service';

@Controller('tickets')
export class TicketsController {
  constructor(private readonly tickets: TicketsService) {}

  @Get()
  @Render('tickets/list')
  list(@CurrentUser() user: User, @Query() q: QueueFilters) {
    return {
      user,
      isAgent: user.role === 'AGENT',
      rows: this.tickets.list(user, q),
      filters: { status: q.status ?? '', category: q.category ?? '', assignee: q.assignee ?? 'any', q: q.q ?? '' },
      categories: this.tickets.activeCategories(),
    };
  }

  @Get('new')
  @Roles('REQUESTER')
  @Render('tickets/new')
  newForm(@CurrentUser() user: User) {
    return { user, categories: this.tickets.activeCategories(), values: {}, errors: {} };
  }

  @Post()
  @Roles('REQUESTER')
  async create(@CurrentUser() user: User, @Body() body: Record<string, string>, @Res() res: Response) {
    const dto = plainToInstance(CreateTicketDto, body);
    const found = await validate(dto);
    if (found.length) {
      const errors = Object.fromEntries(found.map((e) => [e.property, Object.values(e.constraints ?? {})[0]]));
      res.status(400).render('tickets/new', { user, categories: this.tickets.activeCategories(), values: body, errors });
      return;
    }
    const id = this.tickets.create(dto, user);
    res.redirect(`/tickets/${id}`);
  }

  @Get(':id')
  @Render('tickets/detail')
  detail(@CurrentUser() user: User, @Param('id', ParseIntPipe) id: number) {
    const d = this.tickets.detail(id, user);
    return { user, ...d, actionButtons: d.actions.map((a) => ({ action: a, label: TRANSITIONS[a].label })) };
  }

  @Post(':id/claim')
  @Roles('AGENT')
  claim(@CurrentUser() user: User, @Param('id', ParseIntPipe) id: number, @Body('version', ParseIntPipe) version: number, @Res() res: Response) {
    this.act(id, version, 'claim', user, res);
  }

  @Post(':id/resolve')
  @Roles('AGENT')
  resolve(@CurrentUser() user: User, @Param('id', ParseIntPipe) id: number, @Body('version', ParseIntPipe) version: number, @Res() res: Response) {
    this.act(id, version, 'resolve', user, res);
  }

  @Post(':id/reopen')
  reopen(@CurrentUser() user: User, @Param('id', ParseIntPipe) id: number, @Body('version', ParseIntPipe) version: number, @Res() res: Response) {
    this.act(id, version, 'reopen', user, res);
  }

  @Post(':id/cancel')
  @Roles('REQUESTER')
  cancel(@CurrentUser() user: User, @Param('id', ParseIntPipe) id: number, @Body('version', ParseIntPipe) version: number, @Res() res: Response) {
    this.act(id, version, 'cancel', user, res);
  }

  private act(id: number, version: number, action: Action, user: User, res: Response): void {
    this.tickets.transition(id, version, action, user);
    res.redirect(`/tickets/${id}`);
  }
}
