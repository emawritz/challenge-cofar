# Sistema de tickets v1 — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sistema de tickets server-rendered con dos perfiles, máquina de estados con auditoría transaccional, cola con filtros y dashboard de métricas, en 5h de núcleo.

**Architecture:** Una app NestJS con vistas Handlebars, SQLite vía better-sqlite3 + Drizzle. `tickets` guarda estado actual; `ticket_events` es auditoría append-only escrita en la misma transacción síncrona. Reglas de transición en funciones puras (`state-machine.ts`); `TicketsService` es el único punto de mutación. Identidad simulada por cookie firmada; rol leído de DB en cada request.

**Tech Stack:** Node 20, pnpm, NestJS 11, hbs, better-sqlite3 12, drizzle-orm 0.45, drizzle-kit 0.31, cookie-parser, class-validator, class-transformer, Jest + ts-jest, supertest. Stretch: @playwright/test.

**Spec:** `docs/superpowers/specs/2026-09-17-ticket-system-design.md`

## Global Constraints

- Node `20` (`.nvmrc`). `better-sqlite3@12`: la 13 exige Node ≥22 y segfaultea en 20.
- Política de tests del proyecto: implementar primero, testear después (no TDD). Cada tarea termina con sus tests corriendo en verde y `tsc --noEmit` limpio.
- Toda mutación de ticket pasa por `TicketsService` y escribe exactamente un evento en la misma transacción.
- No existe endpoint genérico de cambio de estado.
- Precedencia de errores: guard 403 → 404 no visible → 409 versión → 403 no autorizado → 400 estado.
- Timestamps ISO 8601 UTC. `Clock` inyectable.
- Textos de UI en español. Mensajes de error exactos según spec §8.
- Tareas 1-9 son **[núcleo]**. 10-12 son **[stretch]**, en ese orden, solo si sobra tiempo.
- Commits por tarea con formato `<type>: <desc>`. Sin atribución de IA en el mensaje.

## Estructura de archivos

| Archivo | Responsabilidad |
|---|---|
| `CLAUDE.md` | Reglas del proyecto para el agente |
| `package.json`, `tsconfig.json`, `tsconfig.build.json`, `nest-cli.json`, `.nvmrc`, `.gitignore` | Toolchain |
| `drizzle.config.ts`, `drizzle/` | Config y migraciones generadas |
| `src/main.ts` | Bootstrap |
| `src/app.setup.ts` | `configureApp(app)`: vistas, cookies, filtro. Compartido con tests |
| `src/app.module.ts` | Raíz |
| `src/db/schema.ts` | Tablas, enums, tipos |
| `src/db/connection.ts` | `createDb(file)`, token `DB`, `DbModule` |
| `src/db/clock.ts` | `Clock` |
| `src/db/seed.ts` | `seed(db, nowIso)` idempotente + `SeedService` |
| `src/auth/*` | Login/logout, `SessionGuard`, `RolesGuard`, decoradores |
| `src/http-error.filter.ts` | Excepciones HTTP → `error.hbs`, 401 → redirect login |
| `src/tickets/state-machine.ts` | `canCreate`, `canView`, `canTransition`, `TRANSITIONS` |
| `src/tickets/tickets.service.ts` | create, transition, list, detail |
| `src/tickets/tickets.controller.ts` | Rutas y render |
| `src/tickets/create-ticket.dto.ts` | Validación de creación |
| `src/metrics/metrics.service.ts` | Contrato de métricas §9 |
| `src/metrics/metrics.controller.ts` | `/dashboard` |
| `views/*.hbs` | Plantillas |
| `test/helpers.ts` | `makeDb()`, `fixedClock()`, `loginAs()` |
| `test/*.spec.ts` | Tests 1-5 |
| `README.md`, `DECISIONS.md`, `AI-USAGE.md`, `QUALITY.md` | Entregables |

---

### Task 1: Scaffold, toolchain y CLAUDE.md

**Files:**
- Create: `package.json`, `tsconfig.json`, `tsconfig.build.json`, `nest-cli.json`, `.nvmrc`, `.gitignore`, `CLAUDE.md`, `src/main.ts`, `src/app.module.ts`, `src/app.setup.ts`, `views/layout.hbs`, `views/error.hbs`, `src/http-error.filter.ts`, `test/setup.ts`

**Interfaces:**
- Produces: `configureApp(app: NestExpressApplication): void`; `AppModule`; filtro `HttpErrorFilter`.

- [ ] **Step 1: Archivos de toolchain**

`.nvmrc`:
```
20
```

`.gitignore`:
```
node_modules
dist
data
test-results
playwright-report
```

`package.json`:
```json
{
  "name": "tickets",
  "version": "0.1.0",
  "private": true,
  "engines": { "node": "20.x" },
  "scripts": {
    "dev": "nest start --watch",
    "build": "nest build",
    "start": "node dist/main.js",
    "typecheck": "tsc --noEmit",
    "test": "jest",
    "db:generate": "drizzle-kit generate"
  },
  "dependencies": {
    "@nestjs/common": "^11.1.0",
    "@nestjs/core": "^11.1.0",
    "@nestjs/platform-express": "^11.1.0",
    "better-sqlite3": "^12.0.0",
    "class-transformer": "^0.5.1",
    "class-validator": "^0.14.1",
    "cookie-parser": "^1.4.7",
    "drizzle-orm": "^0.45.0",
    "hbs": "^4.2.0",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.1"
  },
  "devDependencies": {
    "@nestjs/cli": "^11.0.0",
    "@nestjs/testing": "^11.1.0",
    "@types/better-sqlite3": "^7.6.11",
    "@types/cookie-parser": "^1.4.8",
    "@types/express": "^5.0.0",
    "@types/jest": "^29.5.14",
    "@types/node": "^20.17.0",
    "@types/supertest": "^6.0.2",
    "drizzle-kit": "^0.31.0",
    "jest": "^29.7.0",
    "supertest": "^7.0.0",
    "ts-jest": "^29.2.5",
    "typescript": "^5.6.0"
  },
  "jest": {
    "rootDir": ".",
    "testRegex": "test/[^/]+\\.spec\\.ts$",
    "transform": { "^.+\\.ts$": "ts-jest" },
    "moduleFileExtensions": ["ts", "js"],
    "setupFiles": ["<rootDir>/test/setup.ts"],
    "testEnvironment": "node"
  }
}
```

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "module": "commonjs",
    "target": "es2021",
    "lib": ["es2021"],
    "outDir": "./dist",
    "baseUrl": "./",
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "esModuleInterop": true,
    "strict": true,
    "strictPropertyInitialization": false,
    "skipLibCheck": true,
    "sourceMap": true,
    "incremental": true
  },
  "include": ["src", "test", "drizzle.config.ts"]
}
```

`tsconfig.build.json`:
```json
{ "extends": "./tsconfig.json", "include": ["src"], "exclude": ["test", "dist"] }
```

`nest-cli.json`:
```json
{ "collection": "@nestjs/schematics", "sourceRoot": "src", "compilerOptions": { "deleteOutDir": true } }
```

`test/setup.ts`:
```ts
process.env.DB_FILE = ':memory:';
process.env.SESSION_SECRET = 'test-secret';
```

- [ ] **Step 2: Instalar y verificar el módulo nativo**

Run: `pnpm install && node -e "require('better-sqlite3')(':memory:').pragma('user_version'); console.log('sqlite ok')"`
Expected: `sqlite ok`. Si segfault o error de build: confirmar `node -v` es 20.x y que `better-sqlite3` resolvió a 12.x (`pnpm ls better-sqlite3`).

- [ ] **Step 3: CLAUDE.md del proyecto**

```markdown
# Tickets v1 — reglas del proyecto

Spec: docs/superpowers/specs/2026-09-17-ticket-system-design.md. Plan: docs/superpowers/plans/2026-09-17-ticket-system.md.

## Stack y comandos
NestJS 11 + hbs, SQLite (better-sqlite3@12, Node 20) + Drizzle. `pnpm dev`, `pnpm test`, `pnpm typecheck`, `pnpm db:generate`.

## Reglas inviolables
- Estados: OPEN, IN_PROGRESS, RESOLVED, CANCELLED. Transiciones solo las de `src/tickets/state-machine.ts`. No agregar estados ni transiciones sin actualizar spec §5.
- Invariantes: OPEN ⇒ sin asignado y sin resolved_at. IN_PROGRESS ⇒ asignado, sin resolved_at. RESOLVED ⇒ asignado y resolved_at. CANCELLED ⇒ sin resolved_at.
- Toda mutación de ticket pasa por `TicketsService` y escribe exactamente un `ticket_events` en la misma transacción. Nunca un UPDATE de ticket suelto.
- No existe endpoint genérico de cambio de estado. Una ruta POST por acción.
- `ticket_events` es append-only. Nunca UPDATE ni DELETE.
- Precedencia de errores: guard 403 → 404 no visible → 409 versión → 403 no autorizado → 400 estado.
- El rol se lee de DB en cada request. Nunca de formulario ni query.
- Contrato de métricas: spec §9, literal. Cada número lleva su definición en la vista.
- Timestamps ISO 8601 UTC. Usar `Clock`, nunca `new Date()` fuera de `Clock`.

## Tests
Implementar primero, testear después. Esfuerzo en: máquina de estados, trazabilidad, conflicto de versión, autorización, matemática del dashboard. No testear vistas ni controllers triviales. Correr `pnpm test` y `pnpm typecheck` antes de dar una tarea por cerrada.

## Alcance
Núcleo vs stretch según plan. No implementar stretch sin que el núcleo esté verde y documentado.

## Estilo
Sin repositorios genéricos, sin CQRS, sin interfaces de un solo implementador. Textos de UI en español.
```

- [ ] **Step 4: Bootstrap, setup compartido, filtro de errores y layout**

`src/app.setup.ts`:
```ts
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import * as hbs from 'hbs';
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
  app.useGlobalFilters(new HttpErrorFilter());
}
```

`src/http-error.filter.ts`:
```ts
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
```

`src/main.ts`:
```ts
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  configureApp(app);
  await app.listen(Number(process.env.PORT ?? 3000));
}
bootstrap();
```

`src/app.module.ts` (se completa en tareas siguientes; ahora vacío):
```ts
import { Module } from '@nestjs/common';

@Module({ imports: [] })
export class AppModule {}
```

`views/layout.hbs`:
```hbs
<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Tickets</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 960px; margin: 0 auto; padding: 16px; }
    nav { display: flex; gap: 16px; align-items: center; border-bottom: 1px solid #ccc; padding-bottom: 8px; margin-bottom: 16px; }
    nav form { margin-left: auto; }
    table { border-collapse: collapse; width: 100%; }
    th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #eee; }
    .status { font-weight: 600; }
    .error { color: #b00020; }
    .muted { color: #666; font-size: 0.9em; }
    form.inline { display: inline; }
    fieldset { display: flex; gap: 12px; flex-wrap: wrap; align-items: end; }
    label { display: flex; flex-direction: column; gap: 4px; }
    .metric { display: inline-block; min-width: 160px; padding: 8px 12px; border: 1px solid #ddd; margin: 4px; }
    .metric strong { font-size: 1.6em; display: block; }
  </style>
</head>
<body>
  {{#if user}}
  <nav>
    <a href="/tickets">Tickets</a>
    {{#if (eq user.role "AGENT")}}<a href="/dashboard">Dashboard</a>{{/if}}
    {{#if (eq user.role "REQUESTER")}}<a href="/tickets/new">Nuevo ticket</a>{{/if}}
    <span class="muted">{{user.name}} · {{user.role}}</span>
    <form method="post" action="/logout"><button>Salir</button></form>
  </nav>
  {{/if}}
  <main>{{{body}}}</main>
</body>
</html>
```

`views/error.hbs`:
```hbs
<h1>Error {{status}}</h1>
<p class="error">{{message}}</p>
{{#if currentStatus}}<p>Estado actual: <span class="status">{{currentStatus}}</span></p>{{/if}}
{{#if ticketId}}<p><a href="/tickets/{{ticketId}}">Ver ticket</a> · <a href="/tickets">Volver a la lista</a></p>{{else}}<p><a href="/tickets">Volver a la lista</a></p>{{/if}}
```

- [ ] **Step 5: Verificar compilación**

Run: `pnpm typecheck && pnpm build && ls dist/main.js`
Expected: sin errores, `dist/main.js` existe.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: scaffold nest app, toolchain and project rules"
```

---

### Task 2: Schema, conexión, reloj, seed y migraciones

**Files:**
- Create: `src/db/schema.ts`, `src/db/connection.ts`, `src/db/clock.ts`, `src/db/seed.ts`, `drizzle.config.ts`, `drizzle/` (generado), `test/helpers.ts`, `test/seed.spec.ts`
- Modify: `src/app.module.ts`

**Interfaces:**
- Produces: tablas `users`, `categories`, `tickets`, `ticketEvents`; tipos `Role`, `Status`, `EventType`, `Ticket`, `NewTicket`, `NewEvent`; `DB` token; `Db` type; `createDb(file: string): Db`; `Clock { now(): Date }`; `seed(db, nowIso)`; `SEED_USERS`, `SEED_CATEGORIES`; helpers `makeDb(): Db`, `fixedClock(iso): Clock`.

- [ ] **Step 1: Schema**

`src/db/schema.ts`:
```ts
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
```

- [ ] **Step 2: Config y generación de migración**

`drizzle.config.ts`:
```ts
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema.ts',
  out: './drizzle',
});
```

Run: `pnpm db:generate && ls drizzle && grep -c "CHECK" drizzle/*.sql`
Expected: un `.sql` en `drizzle/` con `CREATE TABLE` para las 4 tablas y al menos 3 `CHECK`. Si el conteo de CHECK es 0, drizzle-kit no emitió constraints: editar el `.sql` a mano agregando `CHECK (...)` en las columnas `role`, `status`, `type` y seguir.

- [ ] **Step 3: Conexión, reloj, seed**

`src/db/clock.ts`:
```ts
import { Injectable } from '@nestjs/common';

@Injectable()
export class Clock {
  now(): Date {
    return new Date();
  }
}
```

`src/db/connection.ts`:
```ts
import { Global, Module } from '@nestjs/common';
import Database from 'better-sqlite3';
import { BetterSQLite3Database, drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { Clock } from './clock';
import * as schema from './schema';
import { SeedService } from './seed';

export const DB = Symbol('DB');
export type Db = BetterSQLite3Database<typeof schema>;

export function createDb(file: string): Db {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const raw = new Database(file);
  raw.pragma('foreign_keys = ON');
  const db = drizzle(raw, { schema });
  migrate(db, { migrationsFolder: join(process.cwd(), 'drizzle') });
  return db;
}

@Global()
@Module({
  providers: [
    { provide: DB, useFactory: () => createDb(process.env.DB_FILE ?? 'data/tickets.db') },
    Clock,
    SeedService,
  ],
  exports: [DB, Clock],
})
export class DbModule {}
```

`src/db/seed.ts`:
```ts
import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { Clock } from './clock';
import { DB, Db } from './connection';
import { categories, users } from './schema';

export const SEED_USERS = [
  { id: 1, name: 'Ana Pérez', email: 'ana@example.com', role: 'REQUESTER' as const },
  { id: 2, name: 'Bruno Díaz', email: 'bruno@example.com', role: 'REQUESTER' as const },
  { id: 3, name: 'Carla Soto', email: 'carla@example.com', role: 'AGENT' as const },
  { id: 4, name: 'Diego Ruiz', email: 'diego@example.com', role: 'AGENT' as const },
];
export const SEED_CATEGORIES = ['Hardware', 'Software', 'Accesos', 'Redes', 'Otros'];

export function seed(db: Db, nowIso: string): void {
  db.transaction((tx) => {
    for (const u of SEED_USERS) tx.insert(users).values({ ...u, createdAt: nowIso }).onConflictDoNothing().run();
    SEED_CATEGORIES.forEach((name, i) =>
      tx.insert(categories).values({ id: i + 1, name, active: true }).onConflictDoNothing().run(),
    );
  });
}

@Injectable()
export class SeedService implements OnModuleInit {
  constructor(@Inject(DB) private readonly db: Db, private readonly clock: Clock) {}
  onModuleInit(): void {
    seed(this.db, this.clock.now().toISOString());
  }
}
```

`src/app.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { DbModule } from './db/connection';

@Module({ imports: [DbModule] })
export class AppModule {}
```

- [ ] **Step 4: Helpers de test y test de seed idempotente**

`test/helpers.ts`:
```ts
import { Clock } from '../src/db/clock';
import { createDb, Db } from '../src/db/connection';
import { seed } from '../src/db/seed';

export const T0 = '2026-09-17T12:00:00.000Z';

export function fixedClock(iso: string = T0): Clock {
  return { now: () => new Date(iso) } as Clock;
}

export function makeDb(nowIso: string = T0): Db {
  const db = createDb(':memory:');
  seed(db, nowIso);
  return db;
}

export const ANA = { id: 1, role: 'REQUESTER' as const };
export const BRUNO = { id: 2, role: 'REQUESTER' as const };
export const CARLA = { id: 3, role: 'AGENT' as const };
export const DIEGO = { id: 4, role: 'AGENT' as const };
```

`test/seed.spec.ts`:
```ts
import { sql } from 'drizzle-orm';
import { seed } from '../src/db/seed';
import { makeDb, T0 } from './helpers';

describe('seed', () => {
  it('is idempotent: running twice keeps 4 users and 5 categories', () => {
    const db = makeDb();
    seed(db, T0);
    expect(db.get<{ n: number }>(sql`select count(*) as n from users`)!.n).toBe(4);
    expect(db.get<{ n: number }>(sql`select count(*) as n from categories`)!.n).toBe(5);
  });

  it('enforces CHECK on role', () => {
    const db = makeDb();
    expect(() => db.run(sql`insert into users (name,email,role,created_at) values ('x','x@x','BOSS',${T0})`)).toThrow();
  });
});
```

- [ ] **Step 5: Correr**

Run: `pnpm typecheck && pnpm test test/seed.spec.ts`
Expected: 2 tests PASS. Si el test de CHECK falla, la migración no tiene constraints: volver al Step 2.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: database schema, migrations, seed and injectable clock"
```

---

### Task 3: Identidad simulada y guards

**Files:**
- Create: `src/auth/auth.module.ts`, `src/auth/auth.controller.ts`, `src/auth/session.guard.ts`, `src/auth/roles.guard.ts`, `src/auth/decorators.ts`, `views/login.hbs`, `test/auth.spec.ts`
- Modify: `src/app.module.ts`, `test/helpers.ts`

**Interfaces:**
- Consumes: `DB`, `Db`, `users`, `User`.
- Produces: `@Public()`, `@Roles(...roles: Role[])`, `@CurrentUser()` (devuelve `User`), `SessionGuard`, `RolesGuard` (globales via `APP_GUARD`), rutas `GET /login`, `POST /login`, `POST /logout`, `GET /` → redirect `/tickets`. Helper `loginAs(app, userId): Promise<string>` que devuelve header cookie.

- [ ] **Step 1: Decoradores y guards**

`src/auth/decorators.ts`:
```ts
import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { Role, User } from '../db/schema';

export const IS_PUBLIC = 'isPublic';
export const ROLES_KEY = 'roles';
export const Public = () => SetMetadata(IS_PUBLIC, true);
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): User => ctx.switchToHttp().getRequest().user,
);
```

`src/auth/session.guard.ts`:
```ts
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
```

`src/auth/roles.guard.ts`:
```ts
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '../db/schema';
import { ROLES_KEY } from './decorators';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (!roles?.length) return true;
    const user = ctx.switchToHttp().getRequest().user;
    if (!user || !roles.includes(user.role)) throw new ForbiddenException('No tenés permiso para esta acción.');
    return true;
  }
}
```

- [ ] **Step 2: Controller, módulo, vista**

`src/auth/auth.controller.ts`:
```ts
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
```

`src/auth/auth.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthController } from './auth.controller';
import { RolesGuard } from './roles.guard';
import { SessionGuard } from './session.guard';

@Module({
  controllers: [AuthController],
  providers: [
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AuthModule {}
```

`src/app.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { DbModule } from './db/connection';

@Module({ imports: [DbModule, AuthModule] })
export class AppModule {}
```

`views/login.hbs`:
```hbs
<h1>Elegí una identidad</h1>
<p class="muted">Identidad simulada para la demo. No es autenticación: cualquiera puede elegir cualquier usuario.</p>
{{#each users}}
<form method="post" action="/login" style="margin: 8px 0">
  <input type="hidden" name="userId" value="{{id}}">
  <button>Entrar como {{name}} ({{#if (eq role "AGENT")}}agente{{else}}solicitante{{/if}})</button>
</form>
{{/each}}
```

- [ ] **Step 3: Helper de login para tests HTTP y test**

Agregar a `test/helpers.ts`:
```ts
import { INestApplication } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';

export async function makeApp(clock: Clock = fixedClock()): Promise<NestExpressApplication> {
  const mod = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(Clock)
    .useValue(clock)
    .compile();
  const app = mod.createNestApplication<NestExpressApplication>();
  configureApp(app);
  await app.init();
  return app;
}

export async function loginAs(app: INestApplication, userId: number): Promise<string> {
  const res = await request(app.getHttpServer()).post('/login').type('form').send({ userId });
  const cookie = res.headers['set-cookie']?.[0];
  if (!cookie) throw new Error(`login failed for ${userId}: ${res.status}`);
  return cookie.split(';')[0];
}
```

Nota: `makeApp` usa `DB_FILE=:memory:` de `test/setup.ts`; cada `makeApp` es una base nueva.

`test/auth.spec.ts`:
```ts
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { loginAs, makeApp } from './helpers';

describe('auth', () => {
  let app: NestExpressApplication;
  beforeAll(async () => { app = await makeApp(); });
  afterAll(() => app.close());

  it('redirects anonymous to /login', async () => {
    const res = await request(app.getHttpServer()).get('/');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/login');
  });

  it('logs in with a seeded user and sets a signed httpOnly cookie', async () => {
    const res = await request(app.getHttpServer()).post('/login').type('form').send({ userId: 1 });
    expect(res.status).toBe(302);
    expect(res.headers['set-cookie'][0]).toMatch(/uid=s%3A1\./);
    expect(res.headers['set-cookie'][0]).toMatch(/HttpOnly/);
  });

  it('rejects a tampered cookie', async () => {
    const res = await request(app.getHttpServer()).get('/').set('Cookie', 'uid=s%3A1.forged');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/login');
  });

  it('rejects an unknown user id', async () => {
    const res = await request(app.getHttpServer()).post('/login').type('form').send({ userId: 99 });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/login');
  });

  it('loginAs helper yields a usable cookie', async () => {
    const cookie = await loginAs(app, 3);
    const res = await request(app.getHttpServer()).get('/').set('Cookie', cookie);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/tickets');
  });
});
```

- [ ] **Step 4: Correr**

Run: `pnpm typecheck && pnpm test test/auth.spec.ts`
Expected: 5 PASS. Si "Cannot find module 'hbs'" con `import * as hbs`: cambiar a `import hbs from 'hbs'`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: simulated identity with signed cookie, session and roles guards"
```

---

### Task 4: Máquina de estados (funciones puras) + test 1

**Files:**
- Create: `src/tickets/state-machine.ts`, `test/state-machine.spec.ts`

**Interfaces:**
- Produces: `Action = 'claim' | 'resolve' | 'reopen' | 'cancel'`; `Actor = { id: number; role: Role }`; `TicketState = Pick<Ticket, 'status' | 'requesterId' | 'assigneeId'>`; `Verdict`; `TRANSITIONS: Record<Action, { from: Status[]; to: Status; type: EventType; label: string }>`; `canCreate(actor)`, `canView(t, actor)`, `canTransition(t, action, actor)`, `allowedActions(t, actor): Action[]`.

- [ ] **Step 1: Implementar**

`src/tickets/state-machine.ts`:
```ts
import { EventType, Role, Status, Ticket } from '../db/schema';

export type Action = 'claim' | 'resolve' | 'reopen' | 'cancel';
export type Actor = { id: number; role: Role };
export type TicketState = Pick<Ticket, 'status' | 'requesterId' | 'assigneeId'>;
export type Reason = 'NOT_AUTHORIZED' | 'INVALID_STATE';
export type Verdict = { ok: true } | { ok: false; reason: Reason };

export const ACTIONS: Action[] = ['claim', 'resolve', 'reopen', 'cancel'];

export const TRANSITIONS: Record<Action, { from: Status[]; to: Status; type: EventType; label: string }> = {
  claim: { from: ['OPEN'], to: 'IN_PROGRESS', type: 'CLAIMED', label: 'tomar' },
  resolve: { from: ['IN_PROGRESS'], to: 'RESOLVED', type: 'RESOLVED', label: 'resolver' },
  reopen: { from: ['RESOLVED'], to: 'OPEN', type: 'REOPENED', label: 'reabrir' },
  cancel: { from: ['OPEN', 'IN_PROGRESS'], to: 'CANCELLED', type: 'CANCELLED', label: 'cancelar' },
};

export function canCreate(actor: Actor): boolean {
  return actor.role === 'REQUESTER';
}

export function canView(t: TicketState, actor: Actor): boolean {
  return actor.role === 'AGENT' || t.requesterId === actor.id;
}

function isAuthorized(t: TicketState, action: Action, actor: Actor): boolean {
  const isOwner = actor.role === 'REQUESTER' && t.requesterId === actor.id;
  const isAssignee = actor.role === 'AGENT' && t.assigneeId === actor.id;
  switch (action) {
    case 'claim':
      return actor.role === 'AGENT';
    case 'resolve':
      return isAssignee;
    case 'reopen':
      return isOwner || isAssignee;
    case 'cancel':
      return isOwner;
  }
}

export function canTransition(t: TicketState, action: Action, actor: Actor): Verdict {
  if (!isAuthorized(t, action, actor)) return { ok: false, reason: 'NOT_AUTHORIZED' };
  if (!TRANSITIONS[action].from.includes(t.status)) return { ok: false, reason: 'INVALID_STATE' };
  return { ok: true };
}

export function allowedActions(t: TicketState, actor: Actor): Action[] {
  return ACTIONS.filter((a) => canTransition(t, a, actor).ok);
}
```

- [ ] **Step 2: Test parametrizado**

`test/state-machine.spec.ts`:
```ts
import { Action, allowedActions, canCreate, canTransition, canView, TicketState } from '../src/tickets/state-machine';
import { ANA, BRUNO, CARLA, DIEGO } from './helpers';

const open: TicketState = { status: 'OPEN', requesterId: 1, assigneeId: null };
const inProgress: TicketState = { status: 'IN_PROGRESS', requesterId: 1, assigneeId: 3 };
const resolved: TicketState = { status: 'RESOLVED', requesterId: 1, assigneeId: 3 };
const cancelled: TicketState = { status: 'CANCELLED', requesterId: 1, assigneeId: null };

type Row = [string, TicketState, Action, { id: number; role: 'REQUESTER' | 'AGENT' }, 'ok' | 'NOT_AUTHORIZED' | 'INVALID_STATE'];

const rows: Row[] = [
  // claim
  ['any agent claims OPEN', open, 'claim', CARLA, 'ok'],
  ['other agent claims OPEN', open, 'claim', DIEGO, 'ok'],
  ['requester cannot claim', open, 'claim', ANA, 'NOT_AUTHORIZED'],
  ['agent cannot claim IN_PROGRESS', inProgress, 'claim', DIEGO, 'INVALID_STATE'],
  ['agent cannot claim RESOLVED', resolved, 'claim', CARLA, 'INVALID_STATE'],
  ['agent cannot claim CANCELLED', cancelled, 'claim', CARLA, 'INVALID_STATE'],
  // resolve
  ['assignee resolves IN_PROGRESS', inProgress, 'resolve', CARLA, 'ok'],
  ['other agent cannot resolve', inProgress, 'resolve', DIEGO, 'NOT_AUTHORIZED'],
  ['requester cannot resolve', inProgress, 'resolve', ANA, 'NOT_AUTHORIZED'],
  ['nobody can resolve OPEN (no assignee)', open, 'resolve', CARLA, 'NOT_AUTHORIZED'],
  ['assignee cannot resolve RESOLVED again', resolved, 'resolve', CARLA, 'INVALID_STATE'],
  // reopen
  ['owner reopens RESOLVED', resolved, 'reopen', ANA, 'ok'],
  ['resolving agent reopens RESOLVED', resolved, 'reopen', CARLA, 'ok'],
  ['other requester cannot reopen', resolved, 'reopen', BRUNO, 'NOT_AUTHORIZED'],
  ['other agent cannot reopen', resolved, 'reopen', DIEGO, 'NOT_AUTHORIZED'],
  ['owner cannot reopen OPEN', open, 'reopen', ANA, 'INVALID_STATE'],
  ['owner cannot reopen CANCELLED', cancelled, 'reopen', ANA, 'INVALID_STATE'],
  // cancel
  ['owner cancels OPEN', open, 'cancel', ANA, 'ok'],
  ['owner cancels IN_PROGRESS', inProgress, 'cancel', ANA, 'ok'],
  ['other requester cannot cancel', open, 'cancel', BRUNO, 'NOT_AUTHORIZED'],
  ['agent cannot cancel', open, 'cancel', CARLA, 'NOT_AUTHORIZED'],
  ['assignee cannot cancel', inProgress, 'cancel', CARLA, 'NOT_AUTHORIZED'],
  ['owner cannot cancel RESOLVED', resolved, 'cancel', ANA, 'INVALID_STATE'],
  ['owner cannot cancel CANCELLED', cancelled, 'cancel', ANA, 'INVALID_STATE'],
];

describe('canTransition', () => {
  it.each(rows)('%s', (_name, t, action, actor, expected) => {
    const v = canTransition(t, action, actor);
    if (expected === 'ok') expect(v).toEqual({ ok: true });
    else expect(v).toEqual({ ok: false, reason: expected });
  });

  it('authorization is checked before state (403 wins over 400)', () => {
    expect(canTransition(resolved, 'claim', ANA)).toEqual({ ok: false, reason: 'NOT_AUTHORIZED' });
  });
});

describe('canCreate / canView / allowedActions', () => {
  it('only requesters create', () => {
    expect(canCreate(ANA)).toBe(true);
    expect(canCreate(CARLA)).toBe(false);
  });
  it('agents view all, requesters only own', () => {
    expect(canView(open, CARLA)).toBe(true);
    expect(canView(open, ANA)).toBe(true);
    expect(canView(open, BRUNO)).toBe(false);
  });
  it('lists exactly the actions each actor can take', () => {
    expect(allowedActions(open, ANA)).toEqual(['cancel']);
    expect(allowedActions(open, CARLA)).toEqual(['claim']);
    expect(allowedActions(inProgress, CARLA)).toEqual(['resolve']);
    expect(allowedActions(inProgress, DIEGO)).toEqual([]);
    expect(allowedActions(resolved, ANA)).toEqual(['reopen']);
    expect(allowedActions(cancelled, ANA)).toEqual([]);
  });
});
```

- [ ] **Step 3: Correr**

Run: `pnpm typecheck && pnpm test test/state-machine.spec.ts`
Expected: todos PASS (24 filas + 4).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: ticket state machine as pure functions with exhaustive transition table"
```

---

### Task 5: TicketsService (transacciones, trazabilidad, conflicto) + tests 2 y 3

**Files:**
- Create: `src/tickets/tickets.service.ts`, `src/tickets/tickets.module.ts`, `test/tickets.service.spec.ts`
- Modify: `src/app.module.ts`

**Interfaces:**
- Consumes: `DB`, `Db`, `Clock`, schema, state-machine.
- Produces:
  - `create(input: { title: string; description: string; categoryId: number }, actor: Actor): number` (id).
  - `transition(id: number, version: number, action: Action, actor: Actor): Status`.
  - `list(actor: Actor, f: QueueFilters): QueueRow[]` con `QueueFilters = { status?: string; category?: string; assignee?: string; q?: string }`.
  - `detail(id: number, actor: Actor): TicketDetail` con `{ ticket, requesterName, assigneeName, categoryName, events: EventRow[], actions: Action[] }`.
  - `appendEvent(tx, ev: NewEvent): void` (método público para poder inyectar fallo en tests).
  - `activeCategories(): { id: number; name: string }[]`.

- [ ] **Step 1: Implementar**

`src/tickets/tickets.service.ts`:
```ts
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
```

`src/tickets/tickets.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { TicketsService } from './tickets.service';

@Module({ providers: [TicketsService], exports: [TicketsService] })
export class TicketsModule {}
```

`src/app.module.ts`: agregar `TicketsModule` a `imports`.

- [ ] **Step 2: Tests de trazabilidad y conflicto**

`test/tickets.service.spec.ts`:
```ts
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
      try { svc.transition(id, 1, 'cancel', ANA); fail('expected conflict'); }
      catch (e) { expect((e as ConflictException).getResponse()).toMatchObject({ ticketId: id, currentStatus: 'IN_PROGRESS' }); }
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
```

- [ ] **Step 3: Correr**

Run: `pnpm typecheck && pnpm test test/tickets.service.spec.ts`
Expected: todos PASS. Si `like` es case-sensitive y falla `q: 'mouse'`: SQLite `LIKE` es case-insensitive para ASCII por defecto; si falla, revisar que el título sea 'Mouse roto'.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: tickets service with transactional audit trail and optimistic locking"
```

---

### Task 6: Controller y vistas de tickets

**Files:**
- Create: `src/tickets/tickets.controller.ts`, `src/tickets/create-ticket.dto.ts`, `views/tickets/list.hbs`, `views/tickets/new.hbs`, `views/tickets/detail.hbs`
- Modify: `src/tickets/tickets.module.ts`

**Interfaces:**
- Consumes: `TicketsService`, decoradores de auth, `TRANSITIONS`.
- Produces: rutas de spec §7.

- [ ] **Step 1: DTO**

`src/tickets/create-ticket.dto.ts`:
```ts
import { Transform, Type } from 'class-transformer';
import { IsInt, Length } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateTicketDto {
  @Transform(trim)
  @Length(1, 120, { message: 'El título debe tener entre 1 y 120 caracteres.' })
  title: string;

  @Transform(trim)
  @Length(1, 5000, { message: 'La descripción debe tener entre 1 y 5000 caracteres.' })
  description: string;

  @Type(() => Number)
  @IsInt({ message: 'Elegí una categoría.' })
  categoryId: number;
}
```

- [ ] **Step 2: Controller**

`src/tickets/tickets.controller.ts`:
```ts
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
```

`src/tickets/tickets.module.ts`: agregar `controllers: [TicketsController]`.

- [ ] **Step 3: Vistas**

`views/tickets/list.hbs`:
```hbs
<h1>{{#if isAgent}}Cola de tickets{{else}}Mis tickets{{/if}}</h1>

{{#if isAgent}}
<form method="get" action="/tickets">
  <fieldset>
    <label>Estado
      <select name="status">
        <option value="" {{#if (eq filters.status "")}}selected{{/if}}>Activos (abiertos + en progreso)</option>
        <option value="OPEN" {{#if (eq filters.status "OPEN")}}selected{{/if}}>OPEN</option>
        <option value="IN_PROGRESS" {{#if (eq filters.status "IN_PROGRESS")}}selected{{/if}}>IN_PROGRESS</option>
        <option value="RESOLVED" {{#if (eq filters.status "RESOLVED")}}selected{{/if}}>RESOLVED</option>
        <option value="CANCELLED" {{#if (eq filters.status "CANCELLED")}}selected{{/if}}>CANCELLED</option>
        <option value="all" {{#if (eq filters.status "all")}}selected{{/if}}>Todos</option>
      </select>
    </label>
    <label>Categoría
      <select name="category">
        <option value="">Todas</option>
        {{#each categories}}<option value="{{id}}" {{#if (eq ../filters.category (toString id))}}selected{{/if}}>{{name}}</option>{{/each}}
      </select>
    </label>
    <label>Asignación
      <select name="assignee">
        <option value="any" {{#if (eq filters.assignee "any")}}selected{{/if}}>Cualquiera</option>
        <option value="unassigned" {{#if (eq filters.assignee "unassigned")}}selected{{/if}}>Sin tomar</option>
        <option value="me" {{#if (eq filters.assignee "me")}}selected{{/if}}>Míos</option>
      </select>
    </label>
    <label>Título contiene <input name="q" value="{{filters.q}}"></label>
    <button>Filtrar</button>
    <a href="/tickets">Limpiar</a>
  </fieldset>
</form>
{{/if}}

{{#if rows.length}}
<table>
  <thead><tr><th>#</th><th>Título</th><th>Categoría</th><th>Estado</th>{{#if isAgent}}<th>Solicitante</th>{{/if}}<th>Asignado</th><th>Creado</th></tr></thead>
  <tbody>
  {{#each rows}}
    <tr>
      <td><a href="/tickets/{{id}}">{{id}}</a></td>
      <td><a href="/tickets/{{id}}">{{title}}</a></td>
      <td>{{categoryName}}</td>
      <td class="status">{{status}}</td>
      {{#if ../isAgent}}<td>{{requesterName}}</td>{{/if}}
      <td>{{#if assigneeName}}{{assigneeName}}{{else}}<span class="muted">—</span>{{/if}}</td>
      <td class="muted">{{date createdAt}}</td>
    </tr>
  {{/each}}
  </tbody>
</table>
<p class="muted">{{rows.length}} tickets, más viejo primero.</p>
{{else}}
<p class="muted">No hay tickets para mostrar.</p>
{{/if}}
```

Agregar helper en `src/app.setup.ts` junto a los otros: `hbs.registerHelper('toString', (v: unknown) => String(v));`

`views/tickets/new.hbs`:
```hbs
<h1>Nuevo ticket</h1>
<form method="post" action="/tickets" style="display:grid; gap:12px; max-width:600px">
  <label>Título
    <input name="title" value="{{values.title}}" maxlength="120" required>
    {{#if errors.title}}<span class="error">{{errors.title}}</span>{{/if}}
  </label>
  <label>Descripción
    <textarea name="description" rows="6" maxlength="5000" required>{{values.description}}</textarea>
    {{#if errors.description}}<span class="error">{{errors.description}}</span>{{/if}}
  </label>
  <label>Categoría
    <select name="categoryId" required>
      <option value="">Elegí una</option>
      {{#each categories}}<option value="{{id}}" {{#if (eq ../values.categoryId (toString id))}}selected{{/if}}>{{name}}</option>{{/each}}
    </select>
    {{#if errors.categoryId}}<span class="error">{{errors.categoryId}}</span>{{/if}}
  </label>
  <button>Crear ticket</button>
</form>
```

`views/tickets/detail.hbs`:
```hbs
<p><a href="/tickets">← Volver</a></p>
<h1>#{{ticket.id}} {{ticket.title}}</h1>
<p><span class="status">{{ticket.status}}</span> · {{categoryName}} · creado {{date ticket.createdAt}} por {{requesterName}}</p>
<p>Asignado: {{#if assigneeName}}{{assigneeName}}{{else}}<span class="muted">nadie</span>{{/if}}{{#if ticket.resolvedAt}} · resuelto {{date ticket.resolvedAt}}{{/if}}</p>
<pre style="white-space: pre-wrap; background:#f6f6f6; padding:12px">{{ticket.description}}</pre>

{{#if actionButtons.length}}
<p>
{{#each actionButtons}}
  <form class="inline" method="post" action="/tickets/{{../ticket.id}}/{{action}}">
    <input type="hidden" name="version" value="{{../ticket.version}}">
    <button>{{label}}</button>
  </form>
{{/each}}
</p>
{{/if}}

<h2>Historial</h2>
<table>
  <thead><tr><th>Cuándo</th><th>Qué</th><th>Quién</th><th>De</th><th>A</th></tr></thead>
  <tbody>
  {{#each events}}
    <tr><td class="muted">{{date occurredAt}}</td><td>{{type}}</td><td>{{actorName}}</td><td>{{#if fromStatus}}{{fromStatus}}{{else}}—{{/if}}</td><td>{{toStatus}}</td></tr>
  {{/each}}
  </tbody>
</table>
```

- [ ] **Step 4: Verificación manual**

Run: `pnpm typecheck && pnpm test && (pnpm dev &) ; sleep 6; curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/login`
Expected: typecheck limpio, tests verdes, `200`.

En browser: `http://localhost:3000/login` → entrar como Ana → Nuevo ticket → crear → detalle muestra CREATED y botón "cancelar" → Salir → entrar como Carla → cola muestra el ticket → abrir → "tomar" → historial con CLAIMED → "resolver" → RESOLVED. Enviar el form de crear con título vacío: re-render con mensaje por campo y status 400.

Detener el server: `pkill -f "nest start"`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: ticket views, creation form and per-action routes"
```

---

### Task 7: Dashboard núcleo (métricas §9) + test 5

**Files:**
- Create: `src/metrics/metrics.service.ts`, `src/metrics/metrics.controller.ts`, `src/metrics/metrics.module.ts`, `views/dashboard.hbs`, `test/metrics.service.spec.ts`
- Modify: `src/app.module.ts`

**Interfaces:**
- Consumes: `DB`, `Clock`, schema.
- Produces: `MetricsService.summary(): Summary` con
  ```ts
  type Summary = {
    open: number; untaken: number;
    byAgent: { name: string; n: number }[];
    byCategory: { name: string; n: number }[];
    aging: { label: string; n: number }[];       // 4 buckets en orden
    created30: number; resolved30: number; cancelled30: number;
    cancelRate30: number | null;                 // 0..1, null si denominador 0
  }
  ```
  y función exportada `bucketIndex(hours: number): 0 | 1 | 2 | 3`.

- [ ] **Step 1: Servicio**

`src/metrics/metrics.service.ts`:
```ts
import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { Clock } from '../db/clock';
import { DB, Db } from '../db/connection';

export const WINDOW_HOURS = 720;
export const AGING_LABELS = ['< 24h', '24h – 72h', '72h – 168h', '≥ 168h'] as const;

export type Summary = {
  open: number;
  untaken: number;
  byAgent: { name: string; n: number }[];
  byCategory: { name: string; n: number }[];
  aging: { label: string; n: number }[];
  created30: number;
  resolved30: number;
  cancelled30: number;
  cancelRate30: number | null;
};

export function bucketIndex(hours: number): 0 | 1 | 2 | 3 {
  if (hours < 24) return 0;
  if (hours < 72) return 1;
  if (hours < 168) return 2;
  return 3;
}

@Injectable()
export class MetricsService {
  constructor(@Inject(DB) private readonly db: Db, private readonly clock: Clock) {}

  summary(): Summary {
    const now = this.clock.now();
    const nowIso = now.toISOString();
    const cutoff = new Date(now.getTime() - WINDOW_HOURS * 3600_000).toISOString();
    const n = (q: ReturnType<typeof sql>) => this.db.get<{ n: number }>(q)!.n;

    const open = n(sql`select count(*) as n from tickets where status in ('OPEN','IN_PROGRESS')`);
    const untaken = n(sql`select count(*) as n from tickets where status = 'OPEN'`);
    const byAgent = this.db.all<{ name: string; n: number }>(sql`
      select u.name as name, count(*) as n from tickets t join users u on u.id = t.assignee_id
      where t.status = 'IN_PROGRESS' group by u.id order by n desc, u.name`);
    const byCategory = this.db.all<{ name: string; n: number }>(sql`
      select c.name as name, count(*) as n from tickets t join categories c on c.id = t.category_id
      where t.status in ('OPEN','IN_PROGRESS') group by c.id order by n desc, c.name`);

    const counts = [0, 0, 0, 0];
    for (const { createdAt } of this.db.all<{ createdAt: string }>(sql`select created_at as createdAt from tickets where status in ('OPEN','IN_PROGRESS')`)) {
      counts[bucketIndex((now.getTime() - Date.parse(createdAt)) / 3600_000)]++;
    }
    const aging = AGING_LABELS.map((label, i) => ({ label, n: counts[i] }));

    const created30 = n(sql`select count(*) as n from ticket_events where type = 'CREATED' and occurred_at between ${cutoff} and ${nowIso}`);
    const resolved30 = n(sql`
      select count(*) as n from (select ticket_id, min(id) as first_id from ticket_events where type = 'RESOLVED' group by ticket_id) f
      join ticket_events e on e.id = f.first_id where e.occurred_at between ${cutoff} and ${nowIso}`);
    const cancelled30 = n(sql`select count(*) as n from ticket_events where type = 'CANCELLED' and occurred_at between ${cutoff} and ${nowIso}`);
    const cohort = this.db.get<{ created: number; cancelled: number }>(sql`
      select count(*) as created, sum(case when status = 'CANCELLED' then 1 else 0 end) as cancelled
      from tickets where created_at between ${cutoff} and ${nowIso}`)!;
    const cancelRate30 = cohort.created === 0 ? null : (cohort.cancelled ?? 0) / cohort.created;

    return { open, untaken, byAgent, byCategory, aging, created30, resolved30, cancelled30, cancelRate30 };
  }
}
```

- [ ] **Step 2: Controller, módulo, vista**

`src/metrics/metrics.controller.ts`:
```ts
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
```

`src/metrics/metrics.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';

@Module({ controllers: [MetricsController], providers: [MetricsService] })
export class MetricsModule {}
```

`src/app.module.ts`: agregar `MetricsModule` a `imports`.

`views/dashboard.hbs`:
```hbs
<h1>Dashboard</h1>
<p class="muted">Todo en UTC. "30 días" = ventana móvil de 720 horas hasta ahora.</p>

<h2>Ahora</h2>
<div class="metric"><strong>{{open}}</strong>Abiertos<br><span class="muted">tickets en OPEN o IN_PROGRESS</span></div>
<div class="metric"><strong>{{untaken}}</strong>Sin tomar<br><span class="muted">tickets en OPEN (nadie los tiene)</span></div>

<h2>Quién los tiene</h2>
{{#if byAgent.length}}
<table><thead><tr><th>Agente</th><th>En progreso</th></tr></thead><tbody>
{{#each byAgent}}<tr><td>{{name}}</td><td>{{n}}</td></tr>{{/each}}
</tbody></table>
{{else}}<p class="muted">Nadie tiene tickets en progreso.</p>{{/if}}

<h2>Activos por categoría</h2>
{{#if byCategory.length}}
<table><thead><tr><th>Categoría</th><th>Activos</th></tr></thead><tbody>
{{#each byCategory}}<tr><td>{{name}}</td><td>{{n}}</td></tr>{{/each}}
</tbody></table>
{{else}}<p class="muted">Sin tickets activos.</p>{{/if}}

<h2>Edad desde creación (activos)</h2>
<p class="muted">Cuánto hace que se creó cada ticket activo, sin importar reaperturas.</p>
{{#each aging}}<div class="metric"><strong>{{n}}</strong>{{label}}</div>{{/each}}

<h2>Últimos 30 días</h2>
<div class="metric"><strong>{{created30}}</strong>Creados<br><span class="muted">eventos CREATED en la ventana</span></div>
<div class="metric"><strong>{{resolved30}}</strong>Resueltos<br><span class="muted">tickets cuya primera resolución cae en la ventana</span></div>
<div class="metric"><strong>{{cancelled30}}</strong>Cancelados<br><span class="muted">cancelaciones en la ventana</span></div>
<div class="metric"><strong>{{#if cancelRatePct}}{{cancelRatePct}}%{{else}}{{#if (eq cancelRatePct 0)}}0%{{else}}—{{/if}}{{/if}}</strong>Tasa de cancelación<br><span class="muted">de los creados en la ventana, cuántos están cancelados hoy</span></div>
```

- [ ] **Step 3: Test de matemática con reloj fijo**

`test/metrics.service.spec.ts`:
```ts
import { bucketIndex, MetricsService } from '../src/metrics/metrics.service';
import { TicketsService } from '../src/tickets/tickets.service';
import { ANA, BRUNO, CARLA, DIEGO, fixedClock, makeDb } from './helpers';

const NOW = '2026-09-17T12:00:00.000Z';
const hoursAgo = (h: number) => new Date(Date.parse(NOW) - h * 3600_000).toISOString();

describe('bucketIndex boundaries', () => {
  it.each([
    [0, 0], [23.99, 0], [24, 1], [71.99, 1], [72, 2], [167.99, 2], [168, 3], [5000, 3],
  ])('%s h → bucket %s', (h, b) => expect(bucketIndex(h)).toBe(b));
});

describe('MetricsService.summary', () => {
  it('empty database: zeros and null rate', () => {
    const s = new MetricsService(makeDb(), fixedClock(NOW)).summary();
    expect(s).toEqual({
      open: 0, untaken: 0, byAgent: [], byCategory: [],
      aging: [{ label: '< 24h', n: 0 }, { label: '24h – 72h', n: 0 }, { label: '72h – 168h', n: 0 }, { label: '≥ 168h', n: 0 }],
      created30: 0, resolved30: 0, cancelled30: 0, cancelRate30: null,
    });
  });

  it('counts, aging, window and cohort rate follow the contract', () => {
    const db = makeDb();
    const at = (iso: string) => new TicketsService(db, fixedClock(iso));
    const input = { title: 't', description: 'd', categoryId: 1 };

    // A: created 30h ago, claimed by Carla, still in progress → open, byAgent Carla, aging bucket 1
    const a = at(hoursAgo(30)).create(input, ANA);
    at(hoursAgo(29)).transition(a, 1, 'claim', CARLA);
    // B: created 200h ago, OPEN → open, untaken, aging bucket 3
    at(hoursAgo(200)).create({ ...input, categoryId: 2 }, BRUNO);
    // C: created 800h ago (outside window), resolved 10h ago (inside) → resolved30 counts by resolution time
    const c = at(hoursAgo(800)).create(input, ANA);
    at(hoursAgo(700)).transition(c, 1, 'claim', DIEGO);
    at(hoursAgo(10)).transition(c, 2, 'resolve', DIEGO);
    // D: created 5h ago, cancelled 4h ago → cancelled30, cohort cancelled
    const d = at(hoursAgo(5)).create(input, ANA);
    at(hoursAgo(4)).transition(d, 1, 'cancel', ANA);
    // E: resolved twice (reopen): first resolution 900h ago (outside), second 1h ago → NOT counted in resolved30
    const e = at(hoursAgo(1000)).create(input, BRUNO);
    at(hoursAgo(950)).transition(e, 1, 'claim', CARLA);
    at(hoursAgo(900)).transition(e, 2, 'resolve', CARLA);
    at(hoursAgo(50)).transition(e, 3, 'reopen', BRUNO);
    at(hoursAgo(2)).transition(e, 4, 'claim', CARLA);
    at(hoursAgo(1)).transition(e, 5, 'resolve', CARLA);

    const s = new MetricsService(db, fixedClock(NOW)).summary();
    expect(s.open).toBe(2);
    expect(s.untaken).toBe(1);
    expect(s.byAgent).toEqual([{ name: 'Carla Soto', n: 1 }]);
    expect(s.byCategory).toEqual([{ name: 'Hardware', n: 1 }, { name: 'Software', n: 1 }]);
    expect(s.aging.map((x) => x.n)).toEqual([0, 1, 0, 1]);
    expect(s.created30).toBe(3);       // A, B and D (C and E are older than 720h)
    expect(s.resolved30).toBe(1);      // C only; E's first resolution is outside the window
    expect(s.cancelled30).toBe(1);     // D
    expect(s.cancelRate30).toBeCloseTo(1 / 3, 10); // cohort A, B, D → only D cancelled
  });
});
```

- [ ] **Step 4: Correr todo**

Run: `pnpm typecheck && pnpm test`
Expected: todos los specs PASS.

Manual: entrar como Carla → Dashboard muestra los bloques con definición debajo de cada número.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: metrics dashboard with explicit metric contract"
```

---

### Task 8: Autorización sobre HTTP (test 4)

**Files:**
- Create: `test/authz.spec.ts`

**Interfaces:**
- Consumes: `makeApp`, `loginAs`.

- [ ] **Step 1: Test**

`test/authz.spec.ts`:
```ts
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { loginAs, makeApp } from './helpers';

describe('authorization over HTTP', () => {
  let app: NestExpressApplication;
  let ana: string, bruno: string, carla: string, diego: string;
  let ticketId: number;

  const http = () => request(app.getHttpServer());
  const post = (cookie: string, path: string, body: Record<string, unknown> = {}) => http().post(path).set('Cookie', cookie).type('form').send(body);

  beforeAll(async () => {
    app = await makeApp();
    [ana, bruno, carla, diego] = await Promise.all([1, 2, 3, 4].map((id) => loginAs(app, id)));
    const res = await post(ana, '/tickets', { title: 'Impresora', description: 'No imprime', categoryId: 1 });
    expect(res.status).toBe(302);
    ticketId = Number(res.headers.location.split('/').pop());
  });
  afterAll(() => app.close());

  it('requester cannot see a ticket they do not own (404, not 403)', async () => {
    expect((await http().get(`/tickets/${ticketId}`).set('Cookie', bruno)).status).toBe(404);
    expect((await http().get(`/tickets/${ticketId}`).set('Cookie', ana)).status).toBe(200);
  });

  it('requester mutating a foreign ticket gets 404', async () => {
    expect((await post(bruno, `/tickets/${ticketId}/cancel`, { version: 1 })).status).toBe(404);
    expect((await post(bruno, `/tickets/${ticketId}/reopen`, { version: 1 })).status).toBe(404);
  });

  it('requester cannot claim (guard 403) nor open the dashboard (403)', async () => {
    expect((await post(ana, `/tickets/${ticketId}/claim`, { version: 1 })).status).toBe(403);
    expect((await http().get('/dashboard').set('Cookie', ana)).status).toBe(403);
  });

  it('agent cannot create tickets (403)', async () => {
    expect((await post(carla, '/tickets', { title: 'x', description: 'y', categoryId: 1 })).status).toBe(403);
    expect((await http().get('/tickets/new').set('Cookie', carla)).status).toBe(403);
  });

  it('requester list ignores filters and shows only own tickets', async () => {
    await post(bruno, '/tickets', { title: 'Ticket de Bruno', description: 'z', categoryId: 2 });
    const res = await http().get('/tickets?status=all&assignee=any').set('Cookie', ana);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Impresora');
    expect(res.text).not.toContain('Ticket de Bruno');
  });

  it('hidden version cannot be used to skip rules: stale version → 409 page with current status', async () => {
    expect((await post(carla, `/tickets/${ticketId}/claim`, { version: 1 })).status).toBe(302);
    const res = await post(diego, `/tickets/${ticketId}/claim`, { version: 1 });
    expect(res.status).toBe(409);
    expect(res.text).toContain('IN_PROGRESS');
    expect(res.text).toContain(`/tickets/${ticketId}`);
  });

  it('non-assigned agent cannot resolve (403); assigned agent can', async () => {
    expect((await post(diego, `/tickets/${ticketId}/resolve`, { version: 2 })).status).toBe(403);
    expect((await post(carla, `/tickets/${ticketId}/resolve`, { version: 2 })).status).toBe(302);
  });

  it('invalid state → 400 with the exact message', async () => {
    const res = await post(ana, `/tickets/${ticketId}/cancel`, { version: 3 });
    expect(res.status).toBe(400);
    expect(res.text).toContain('No se puede cancelar un ticket en estado RESOLVED.');
  });

  it('non-numeric version is rejected (400), never treated as a match', async () => {
    expect((await post(ana, `/tickets/${ticketId}/reopen`, { version: 'abc' })).status).toBe(400);
  });

  it('validation errors re-render the form with 400', async () => {
    const res = await post(ana, '/tickets', { title: '   ', description: 'x', categoryId: 1 });
    expect(res.status).toBe(400);
    expect(res.text).toContain('El título debe tener entre 1 y 120 caracteres.');
  });
});
```

- [ ] **Step 2: Correr**

Run: `pnpm test test/authz.spec.ts`
Expected: todos PASS.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "test: authorization and error precedence over HTTP"
```

---

### Task 9: Documentos de entrega y verificación desde checkout limpio

**Files:**
- Create: `README.md`, `DECISIONS.md`, `AI-USAGE.md`, `QUALITY.md`

- [ ] **Step 1: README.md**

Contenido: qué es (2 líneas); requisitos (Node 20, pnpm); `pnpm install`, `pnpm dev`, abrir `http://localhost:3000`; usuarios de demo (tabla de `SEED_USERS` con rol); `pnpm test`, `pnpm typecheck`; dónde queda la DB (`data/tickets.db`) y cómo resetear (`rm -rf data`); recorrido de demo de 5 minutos (crear como Ana, tomar y resolver como Carla, historial, dashboard, 403 de Ana en `/dashboard`, 409 con dos pestañas tomando el mismo ticket); links a `DECISIONS.md`, `AI-USAGE.md`, `QUALITY.md`.

- [ ] **Step 2: DECISIONS.md**

Secciones, cada una derivada del spec (copiar la sustancia, no referenciar el spec):
1. Contexto e hipótesis de producto (spec §1).
2. Stack y por qué (spec §3), incluyendo el hallazgo `better-sqlite3@13` requiere Node ≥22.
3. Modelo de datos y por qué (spec §4), con el diagrama de tablas y la lista de "sin X porque".
4. Máquina de estados y por qué esos estados (spec §5), diagrama, tabla de transiciones, invariantes, precedencia de errores (§6).
5. Identidad simulada y autorización (spec §6): matriz, supuesto de un solo equipo confiable.
6. Opcionales: qué se eligió, qué se descartó y con qué criterio (spec §2).
7. Contrato de métricas (spec §9), marcando medianas como fuera de v1 si no entraron.
8. Qué se rompe a 50.000 tickets/mes y 5 áreas (spec §12).
9. Deuda técnica asumida (spec §11), tabla.
10. Qué quedó fuera por tiempo: lista real de lo stretch que no entró, con cómo se haría.

- [ ] **Step 3: AI-USAGE.md**

Secciones:
1. Herramientas: Claude Code (Fable 5.1) para diseño e implementación; Codex CLI como segunda opinión; skill de brainstorming (una decisión por mensaje).
2. Cómo se estructuró el contexto: spec en `docs/superpowers/specs/`, plan en `docs/superpowers/plans/`, `CLAUDE.md` con reglas inviolables escrito antes del código; cada tarea del plan con interfaces explícitas.
3. Qué se delegó completo: scaffold, schema Drizzle, vistas Handlebars, tests parametrizados a partir de la tabla de transiciones del spec.
4. Dónde intervino el candidato y por qué: elección de C sobre A/B; `CANCELLED` (no propuesto por ninguna IA); insistir en modelo completo y después aceptar el recorte con argumentos; Playwright de obligatorio a stretch; separar núcleo/stretch antes de implementar tras la crítica al presupuesto.
5. Qué salida se rechazó: propuesta de Claude de "meter filtros sin llamarlos feature"; comentarios como segundo opcional; `sequence` y `schema_version` de Codex; `payload` (Codex lo descartó en tercera ronda); primera versión del spec con el orden de chequeo que hacía imposible el 409.
6. Errores que las IA se encontraron entre sí: Codex detectó que el flujo original daba 400 antes que 409; que el E2E asumía una métrica inexistente; ambigüedades del contrato de métricas. Claude detectó que `better-sqlite3@13` segfaultea en Node 20 durante un probe previo al plan.
7. Qué se verificó a mano: (completar durante la implementación con lo que realmente pasó: tests que fallaron primero, código generado que hubo que corregir).

- [ ] **Step 4: QUALITY.md**

Secciones:
1. Criterio: esfuerzo donde un fallo corrompe el flujo o miente al usuario.
2. Qué se probó, con archivo y qué cubre: `state-machine.spec.ts` (24 transiciones + precedencia), `tickets.service.spec.ts` (un evento por acción, atomicidad con fallo inyectado, conflicto de versión, precedencia 404/409/403/400, filtros), `authz.spec.ts` (HTTP real con cookie: 404 ajeno, 403 por rol, 409 con estado actual, 400 con mensaje exacto, validación de form), `metrics.service.spec.ts` (límites exactos de buckets, ventana por evento final, reapertura no reescribe, cohorte de cancelación, denominador cero), `auth.spec.ts`, `seed.spec.ts`.
3. Qué no se probó y por qué (spec §10 "No se prueba").
4. Verificación de mutación: si se hizo (Task 12), cuáles y qué pasó; si no, decirlo.
5. Recorrido manual documentado (el mismo del README) y resultado.
6. Cómo correr: `pnpm test`, `pnpm typecheck`.

- [ ] **Step 5: Verificación desde checkout limpio**

Run:
```bash
git add -A && git commit -m "docs: README, DECISIONS, AI-USAGE, QUALITY" && \
rm -rf /tmp/tickets-clean && git clone -q . /tmp/tickets-clean && cd /tmp/tickets-clean && \
pnpm install --frozen-lockfile && pnpm typecheck && pnpm test && pnpm build && \
(PORT=3999 node dist/main.js & sleep 3; curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3999/login; pkill -f "dist/main.js")
```
Expected: install sin errores, tests verdes, build ok, `200`. Si algo falla acá, arreglar en el repo real y repetir.

---

### Task 10 [stretch]: Medianas de tiempo a toma y a resolución

**Files:**
- Modify: `src/metrics/metrics.service.ts`, `views/dashboard.hbs`, `test/metrics.service.spec.ts`

- [ ] **Step 1: Implementar**

Agregar a `Summary`: `medianClaimHours: number | null; medianResolveHours: number | null;`.

Función exportada:
```ts
export function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
```

En `summary()`, antes del `return`:
```ts
const durations = (type: 'CLAIMED' | 'RESOLVED') =>
  this.db.all<{ h: number }>(sql`
    select (julianday(e.occurred_at) - julianday(t.created_at)) * 24 as h
    from (select ticket_id, min(id) as first_id from ticket_events where type = ${type} group by ticket_id) f
    join ticket_events e on e.id = f.first_id
    join tickets t on t.id = f.ticket_id
    where e.occurred_at between ${cutoff} and ${nowIso}`).map((r) => r.h);
const medianClaimHours = median(durations('CLAIMED'));
const medianResolveHours = median(durations('RESOLVED'));
```
y agregarlos al objeto devuelto. Actualizar el test "empty database" con `medianClaimHours: null, medianResolveHours: null`.

Vista, en "Últimos 30 días":
```hbs
<div class="metric"><strong>{{fixed medianClaimHours}}</strong>Mediana horas hasta tomar<br><span class="muted">creación → primera toma, tickets tomados por primera vez en la ventana</span></div>
<div class="metric"><strong>{{fixed medianResolveHours}}</strong>Mediana horas hasta resolver<br><span class="muted">creación → primera resolución, tickets resueltos por primera vez en la ventana; excluye cancelados</span></div>
```

- [ ] **Step 2: Test**

Agregar a `test/metrics.service.spec.ts`:
```ts
describe('median', () => {
  it('null on empty, middle on odd, mean of two middles on even', () => {
    expect(median([])).toBeNull();
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
});
```
Y en el test grande, tras el `summary()`: con los datos de ese test, `CLAIMED` en ventana: A (30h→29h: 1h), C (800h→700h: 100h; 700h está dentro de 720h), E no cuenta (su primer CLAIMED fue hace 950h, fuera), D nunca tomado. Entonces `medianClaimHours` = (1+100)/2 = 50.5. `RESOLVED` en ventana: C (800h→10h: 790h). `medianResolveHours` = 790.
```ts
expect(s.medianClaimHours).toBeCloseTo(50.5, 5);
expect(s.medianResolveHours).toBeCloseTo(790, 5);
```
Agregar `median` al import de `../src/metrics/metrics.service` en la cabecera del spec.

- [ ] **Step 3: Correr y commit**

Run: `pnpm typecheck && pnpm test`
```bash
git add -A && git commit -m "feat: median time-to-claim and time-to-resolve on dashboard"
```

---

### Task 11 [stretch, tope 20 min]: Playwright, un recorrido

**Files:**
- Create: `playwright.config.ts`, `test/e2e/journey.pw.ts`
- Modify: `package.json` (scripts y devDependency)

- [ ] **Step 1: Instalar y configurar**

Run: `pnpm add -D @playwright/test && pnpm exec playwright install chromium`

`package.json` scripts: `"e2e": "rm -rf data/e2e.db && DB_FILE=data/e2e.db playwright test"`.

`playwright.config.ts`:
```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './test/e2e',
  testMatch: '**/*.pw.ts',
  timeout: 30_000,
  use: { baseURL: 'http://localhost:3456' },
  webServer: {
    command: 'pnpm build && PORT=3456 DB_FILE=data/e2e.db node dist/main.js',
    url: 'http://localhost:3456/login',
    reuseExistingServer: false,
  },
});
```

- [ ] **Step 2: Recorrido**

`test/e2e/journey.pw.ts`:
```ts
import { expect, Page, test } from '@playwright/test';

async function loginAs(page: Page, name: string) {
  await page.goto('/login');
  await page.getByRole('button', { name: new RegExp(`Entrar como ${name}`) }).click();
}

test('requester creates, agent claims and resolves, history and dashboard reflect it', async ({ page }) => {
  await loginAs(page, 'Ana');
  await page.goto('/tickets/new');
  await page.fill('input[name=title]', 'Pantalla parpadea');
  await page.fill('textarea[name=description]', 'Desde esta mañana');
  await page.selectOption('select[name=categoryId]', '1');
  await page.getByRole('button', { name: 'Crear ticket' }).click();
  await expect(page.locator('h1')).toContainText('Pantalla parpadea');
  await expect(page.locator('.status').first()).toHaveText('OPEN');
  const url = page.url();

  await page.getByRole('button', { name: 'Salir' }).click();
  await loginAs(page, 'Carla');
  await page.goto('/tickets?status=OPEN');
  await expect(page.getByRole('link', { name: 'Pantalla parpadea' })).toBeVisible();
  await page.goto(url);
  await page.getByRole('button', { name: 'tomar' }).click();
  await expect(page.locator('.status').first()).toHaveText('IN_PROGRESS');
  await page.getByRole('button', { name: 'resolver' }).click();
  await expect(page.locator('.status').first()).toHaveText('RESOLVED');
  await expect(page.locator('table tbody tr')).toHaveCount(3);

  await page.goto('/dashboard');
  await expect(page.locator('.metric', { hasText: 'Resueltos' })).toContainText('1');
});
```

- [ ] **Step 3: Correr con tope**

Run: `pnpm e2e`
Expected: 1 passed. Si a los 20 minutos de trabajo no está estable: `git checkout -- . && git clean -fd test/e2e playwright.config.ts`, quitar la dependencia, y registrar en QUALITY.md que el recorrido se validó a mano.

```bash
git add -A && git commit -m "test: playwright end-to-end journey"
```

---

### Task 12 [stretch, 15 min]: Verificación de mutación manual

- [ ] **Step 1: Tres mutaciones, una a la vez**

1. En `state-machine.ts`, cambiar `cancel: { from: ['OPEN', 'IN_PROGRESS'] ...` a `from: ['OPEN', 'IN_PROGRESS', 'RESOLVED']`. Run `pnpm test test/state-machine.spec.ts`. Expected: falla "owner cannot cancel RESOLVED". Revertir.
2. En `tickets.service.ts`, comentar la línea `this.appendEvent(tx, { ticketId: id, type: rule.type, ...` dentro de `transition`. Run `pnpm test test/tickets.service.spec.ts`. Expected: falla el test de lifecycle (eventos esperados 6, recibidos 1). Revertir.
3. En `tickets.service.ts`, cambiar `.where(and(eq(tickets.id, id), eq(tickets.version, version)))` por `.where(eq(tickets.id, id))` y comentar `if (t.version !== version) throw this.conflict(t);`. Run `pnpm test test/tickets.service.spec.ts`. Expected: fallan los tests de "version conflict". Revertir.

- [ ] **Step 2: Confirmar restauración y registrar**

Run: `git diff --stat` → vacío. `pnpm test` → verde. Anotar en QUALITY.md sección 4 las tres mutaciones y qué test las atrapó.

```bash
git add -A && git commit -m "docs: record manual mutation checks in QUALITY.md"
```
