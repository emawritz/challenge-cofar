import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, inArray, isNull, like, SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { Clock } from '../db/clock';
import { DB, Db } from '../db/connection';
import { categories, NewEvent, Status, Ticket, ticketEvents, tickets, users } from '../db/schema';
import { Action, Actor, allowedActions, canCreate, canTransition, canView, TRANSITIONS } from './state-machine';

export type QueueFilters = { status?: string; category?: string; assignee?: string; q?: string };
export type QueueRow = Ticket & { categoryName: string; assigneeName: string | null; requesterName: string };
export type EventRow = { id: number; type: string; actorName: string; fromStatus: string | null; toStatus: string; occurredAt: string };
export type TicketDetail = {
  ticket: Ticket;
  requesterName: string;
  assigneeName: string | null;
  categoryName: string;
  events: EventRow[];
  actions: Action[];
};

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
const ACTIVE: Status[] = ['OPEN', 'IN_PROGRESS'];
const NOT_FOUND = 'Ticket no encontrado.';
const FORBIDDEN = 'No tenés permiso para esta acción.';

@Injectable()
export class TicketsService {
  constructor(@Inject(DB) private readonly db: Db, private readonly clock: Clock) {}

  activeCategories() {
    return this.db.select({ id: categories.id, name: categories.name }).from(categories).where(eq(categories.active, true)).orderBy(categories.id).all();
  }

  appendEvent(tx: Tx, ev: NewEvent): void {
    tx.insert(ticketEvents).values(ev).run();
  }

  create(input: { title: string; description: string; categoryId: number }, actor: Actor): number {
    if (!canCreate(actor)) throw new ForbiddenException(FORBIDDEN);
    const cat = this.db.select().from(categories).where(and(eq(categories.id, input.categoryId), eq(categories.active, true))).get();
    if (!cat) throw new BadRequestException('Categoría inválida.');
    const now = this.clock.now().toISOString();
    return this.db.transaction((tx) => {
      const r = tx.insert(tickets).values({
        title: input.title, description: input.description, categoryId: input.categoryId,
        status: 'OPEN', requesterId: actor.id, assigneeId: null, version: 1, createdAt: now, updatedAt: now, resolvedAt: null,
      }).run();
      const id = Number(r.lastInsertRowid);
      this.appendEvent(tx, { ticketId: id, type: 'CREATED', actorId: actor.id, fromStatus: null, toStatus: 'OPEN', occurredAt: now });
      return id;
    });
  }

  transition(id: number, version: number, action: Action, actor: Actor): Status {
    const now = this.clock.now().toISOString();
    return this.db.transaction((tx) => {
      const t = tx.select().from(tickets).where(eq(tickets.id, id)).get();
      if (!t || !canView(t, actor)) throw new NotFoundException(NOT_FOUND);
      if (t.version !== version) throw this.conflict(t);
      const v = canTransition(t, action, actor);
      if (!v.ok) {
        if (v.reason === 'NOT_AUTHORIZED') throw new ForbiddenException(FORBIDDEN);
        throw new BadRequestException(`No se puede ${TRANSITIONS[action].label} un ticket en estado ${t.status}.`);
      }
      const rule = TRANSITIONS[action];
      const effects: Partial<Ticket> =
        action === 'claim' ? { assigneeId: actor.id }
        : action === 'resolve' ? { resolvedAt: now }
        : action === 'reopen' ? { assigneeId: null, resolvedAt: null }
        : {};
      const r = tx.update(tickets)
        .set({ status: rule.to, version: t.version + 1, updatedAt: now, ...effects })
        .where(and(eq(tickets.id, id), eq(tickets.version, version)))
        .run();
      if (r.changes === 0) throw this.conflict(t);
      this.appendEvent(tx, { ticketId: id, type: rule.type, actorId: actor.id, fromStatus: t.status, toStatus: rule.to, occurredAt: now });
      return rule.to;
    });
  }

  list(actor: Actor, f: QueueFilters): QueueRow[] {
    const assignee = alias(users, 'assignee');
    const requester = alias(users, 'requester');
    const conds: SQL[] = [];
    if (actor.role === 'REQUESTER') {
      conds.push(eq(tickets.requesterId, actor.id));
    } else {
      if (f.status && f.status !== 'all') conds.push(eq(tickets.status, f.status as Status));
      else if (!f.status) conds.push(inArray(tickets.status, ACTIVE));
      if (f.category) conds.push(eq(tickets.categoryId, Number(f.category)));
      if (f.assignee === 'unassigned') conds.push(isNull(tickets.assigneeId));
      if (f.assignee === 'me') conds.push(eq(tickets.assigneeId, actor.id));
      if (f.q) conds.push(like(tickets.title, `%${f.q}%`));
    }
    return this.db
      .select({
        id: tickets.id, title: tickets.title, description: tickets.description, categoryId: tickets.categoryId,
        status: tickets.status, requesterId: tickets.requesterId, assigneeId: tickets.assigneeId, version: tickets.version,
        createdAt: tickets.createdAt, updatedAt: tickets.updatedAt, resolvedAt: tickets.resolvedAt,
        categoryName: categories.name, assigneeName: assignee.name, requesterName: requester.name,
      })
      .from(tickets)
      .innerJoin(categories, eq(categories.id, tickets.categoryId))
      .innerJoin(requester, eq(requester.id, tickets.requesterId))
      .leftJoin(assignee, eq(assignee.id, tickets.assigneeId))
      .where(and(...conds))
      .orderBy(asc(tickets.createdAt), asc(tickets.id))
      .all();
  }

  detail(id: number, actor: Actor): TicketDetail {
    const t = this.db.select().from(tickets).where(eq(tickets.id, id)).get();
    if (!t || !canView(t, actor)) throw new NotFoundException(NOT_FOUND);
    const name = (uid: number | null) => (uid === null ? null : this.db.select({ name: users.name }).from(users).where(eq(users.id, uid)).get()?.name ?? null);
    const categoryName = this.db.select({ name: categories.name }).from(categories).where(eq(categories.id, t.categoryId)).get()!.name;
    const events = this.db
      .select({ id: ticketEvents.id, type: ticketEvents.type, actorName: users.name, fromStatus: ticketEvents.fromStatus, toStatus: ticketEvents.toStatus, occurredAt: ticketEvents.occurredAt })
      .from(ticketEvents)
      .innerJoin(users, eq(users.id, ticketEvents.actorId))
      .where(eq(ticketEvents.ticketId, id))
      .orderBy(asc(ticketEvents.id))
      .all();
    return { ticket: t, requesterName: name(t.requesterId)!, assigneeName: name(t.assigneeId), categoryName, events, actions: allowedActions(t, actor) };
  }

  private conflict(t: Ticket): ConflictException {
    return new ConflictException({ message: 'El ticket cambió mientras lo veías.', ticketId: t.id, currentStatus: t.status });
  }
}
