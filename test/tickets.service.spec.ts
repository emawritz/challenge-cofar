import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { Db } from '../src/db/connection';
import { categories, ticketEvents, tickets } from '../src/db/schema';
import { TicketsService } from '../src/tickets/tickets.service';
import { ANA, BRUNO, CARLA, DIEGO, fixedClock, makeDb, T0 } from './helpers';

const input = { title: 'No anda la VPN', description: 'Desde ayer', categoryId: 4 };

describe('TicketsService', () => {
  let db: Db;
  let svc: TicketsService;
  beforeEach(() => {
    db = makeDb();
    svc = new TicketsService(db, fixedClock(T0));
  });

  const events = (id: number) => db.select().from(ticketEvents).where(eq(ticketEvents.ticketId, id)).orderBy(asc(ticketEvents.id)).all();
  const ticket = (id: number) => db.select().from(tickets).where(eq(tickets.id, id)).get()!;

  describe('create', () => {
    it('inserts OPEN ticket with version 1 and one CREATED event in the same transaction', () => {
      const id = svc.create(input, ANA);
      expect(ticket(id)).toMatchObject({ status: 'OPEN', requesterId: 1, assigneeId: null, version: 1, createdAt: T0, resolvedAt: null });
      expect(events(id)).toEqual([expect.objectContaining({ type: 'CREATED', actorId: 1, fromStatus: null, toStatus: 'OPEN', occurredAt: T0 })]);
    });
    it('rejects agents', () => {
      expect(() => svc.create(input, CARLA)).toThrow(ForbiddenException);
    });
    it('rejects inactive category', () => {
      db.update(categories).set({ active: false }).where(eq(categories.id, 4)).run();
      expect(() => svc.create(input, ANA)).toThrow(BadRequestException);
    });
  });

  describe('full lifecycle writes exactly one event per action', () => {
    it('create → claim → resolve → reopen → claim → cancel', () => {
      const id = svc.create(input, ANA);
      expect(svc.transition(id, 1, 'claim', CARLA)).toBe('IN_PROGRESS');
      expect(ticket(id)).toMatchObject({ status: 'IN_PROGRESS', assigneeId: 3, version: 2 });
      expect(svc.transition(id, 2, 'resolve', CARLA)).toBe('RESOLVED');
      expect(ticket(id)).toMatchObject({ status: 'RESOLVED', assigneeId: 3, resolvedAt: T0, version: 3 });
      expect(svc.transition(id, 3, 'reopen', ANA)).toBe('OPEN');
      expect(ticket(id)).toMatchObject({ status: 'OPEN', assigneeId: null, resolvedAt: null, version: 4 });
      expect(svc.transition(id, 4, 'claim', DIEGO)).toBe('IN_PROGRESS');
      expect(svc.transition(id, 5, 'cancel', ANA)).toBe('CANCELLED');
      expect(ticket(id)).toMatchObject({ status: 'CANCELLED', assigneeId: 4, resolvedAt: null, version: 6 });
      expect(events(id).map((e) => [e.type, e.fromStatus, e.toStatus, e.actorId])).toEqual([
        ['CREATED', null, 'OPEN', 1],
        ['CLAIMED', 'OPEN', 'IN_PROGRESS', 3],
        ['RESOLVED', 'IN_PROGRESS', 'RESOLVED', 3],
        ['REOPENED', 'RESOLVED', 'OPEN', 1],
        ['CLAIMED', 'OPEN', 'IN_PROGRESS', 4],
        ['CANCELLED', 'IN_PROGRESS', 'CANCELLED', 1],
      ]);
    });
  });

  describe('atomicity', () => {
    it('if the event insert fails, the ticket does not change', () => {
      const id = svc.create(input, ANA);
      jest.spyOn(svc, 'appendEvent').mockImplementation(() => { throw new Error('boom'); });
      expect(() => svc.transition(id, 1, 'claim', CARLA)).toThrow('boom');
      expect(ticket(id)).toMatchObject({ status: 'OPEN', assigneeId: null, version: 1 });
      expect(events(id)).toHaveLength(1);
    });
  });

  describe('version conflict', () => {
    it('second claim with the same version gets 409 and the first agent keeps the ticket', () => {
      const id = svc.create(input, ANA);
      svc.transition(id, 1, 'claim', CARLA);
      expect(() => svc.transition(id, 1, 'claim', DIEGO)).toThrow(ConflictException);
      expect(ticket(id)).toMatchObject({ status: 'IN_PROGRESS', assigneeId: 3, version: 2 });
      expect(events(id)).toHaveLength(2);
    });
    it('409 carries current status for the error page', () => {
      const id = svc.create(input, ANA);
      svc.transition(id, 1, 'claim', CARLA);
      let caught: unknown;
      try { svc.transition(id, 1, 'cancel', ANA); } catch (e) { caught = e; }
      expect(caught).toBeInstanceOf(ConflictException);
      expect((caught as ConflictException).getResponse()).toMatchObject({ ticketId: id, currentStatus: 'IN_PROGRESS' });
    });
    it('409 is checked before 403 and 400', () => {
      const id = svc.create(input, ANA);
      svc.transition(id, 1, 'claim', CARLA);
      expect(() => svc.transition(id, 1, 'resolve', DIEGO)).toThrow(ConflictException);
    });
  });

  describe('error precedence', () => {
    it('404 for a ticket the requester does not own, even with wrong version', () => {
      const id = svc.create(input, ANA);
      expect(() => svc.transition(id, 99, 'cancel', BRUNO)).toThrow(NotFoundException);
    });
    it('403 for unauthorized actor with right version', () => {
      const id = svc.create(input, ANA);
      expect(() => svc.transition(id, 1, 'claim', ANA)).toThrow(ForbiddenException);
    });
    it('400 for invalid state with right version and authorized actor', () => {
      const id = svc.create(input, ANA);
      expect(() => svc.transition(id, 1, 'reopen', ANA)).toThrow(BadRequestException);
      expect(() => svc.transition(id, 1, 'reopen', ANA)).toThrow('No se puede reabrir un ticket en estado OPEN.');
    });
  });

  describe('list', () => {
    it('requester sees only own tickets regardless of filters', () => {
      svc.create(input, ANA);
      svc.create({ ...input, title: 'Otro' }, BRUNO);
      const rows = svc.list(ANA, { status: 'all', assignee: 'any' });
      expect(rows.map((r) => r.requesterId)).toEqual([1]);
    });
    it('agent default is active only; status=all shows terminals; assignee=me and q filter', () => {
      const a = svc.create({ ...input, title: 'VPN caída' }, ANA);
      const b = svc.create({ ...input, title: 'Mouse roto', categoryId: 1 }, BRUNO);
      svc.transition(b, 1, 'cancel', BRUNO);
      svc.transition(a, 1, 'claim', CARLA);
      expect(svc.list(CARLA, {}).map((r) => r.id)).toEqual([a]);
      expect(svc.list(CARLA, { status: 'all' }).map((r) => r.id)).toEqual([a, b]);
      expect(svc.list(CARLA, { assignee: 'me' }).map((r) => r.id)).toEqual([a]);
      expect(svc.list(DIEGO, { assignee: 'me' })).toEqual([]);
      expect(svc.list(CARLA, { status: 'all', q: 'mouse' }).map((r) => r.id)).toEqual([b]);
      expect(svc.list(CARLA, { status: 'all', category: '1' }).map((r) => r.id)).toEqual([b]);
    });
  });

  describe('detail', () => {
    it('returns names, ordered events and allowed actions for the actor', () => {
      const id = svc.create(input, ANA);
      svc.transition(id, 1, 'claim', CARLA);
      const d = svc.detail(id, CARLA);
      expect(d.assigneeName).toBe('Carla Soto');
      expect(d.categoryName).toBe('Redes');
      expect(d.events.map((e) => e.type)).toEqual(['CREATED', 'CLAIMED']);
      expect(d.actions).toEqual(['resolve']);
      expect(svc.detail(id, ANA).actions).toEqual(['cancel']);
      expect(() => svc.detail(id, BRUNO)).toThrow(NotFoundException);
    });
  });
});
