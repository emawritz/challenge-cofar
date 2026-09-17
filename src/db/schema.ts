import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const ROLES = ['REQUESTER', 'AGENT'] as const;
export type Role = (typeof ROLES)[number];
export const STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CANCELLED'] as const;
export type Status = (typeof STATUSES)[number];
export const EVENT_TYPES = ['CREATED', 'CLAIMED', 'RESOLVED', 'REOPENED', 'CANCELLED'] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const users = sqliteTable(
  'users',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    email: text('email').notNull().unique(),
    role: text('role', { enum: ROLES }).notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [check('users_role_chk', sql`${t.role} in ('REQUESTER','AGENT')`)],
);

export const categories = sqliteTable('categories', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
});

export const tickets = sqliteTable(
  'tickets',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    title: text('title').notNull(),
    description: text('description').notNull(),
    categoryId: integer('category_id').notNull().references(() => categories.id),
    status: text('status', { enum: STATUSES }).notNull(),
    requesterId: integer('requester_id').notNull().references(() => users.id),
    assigneeId: integer('assignee_id').references(() => users.id),
    version: integer('version').notNull().default(1),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    resolvedAt: text('resolved_at'),
  },
  (t) => [
    check('tickets_status_chk', sql`${t.status} in ('OPEN','IN_PROGRESS','RESOLVED','CANCELLED')`),
    index('tickets_status_created_idx').on(t.status, t.createdAt),
    index('tickets_assignee_status_idx').on(t.assigneeId, t.status),
    index('tickets_category_idx').on(t.categoryId),
  ],
);

export const ticketEvents = sqliteTable(
  'ticket_events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ticketId: integer('ticket_id').notNull().references(() => tickets.id),
    type: text('type', { enum: EVENT_TYPES }).notNull(),
    actorId: integer('actor_id').notNull().references(() => users.id),
    fromStatus: text('from_status', { enum: STATUSES }),
    toStatus: text('to_status', { enum: STATUSES }).notNull(),
    occurredAt: text('occurred_at').notNull(),
  },
  (t) => [
    check('events_type_chk', sql`${t.type} in ('CREATED','CLAIMED','RESOLVED','REOPENED','CANCELLED')`),
    index('events_ticket_id_idx').on(t.ticketId, t.id),
  ],
);

export type User = typeof users.$inferSelect;
export type Ticket = typeof tickets.$inferSelect;
export type NewTicket = typeof tickets.$inferInsert;
export type TicketEvent = typeof ticketEvents.$inferSelect;
export type NewEvent = typeof ticketEvents.$inferInsert;
