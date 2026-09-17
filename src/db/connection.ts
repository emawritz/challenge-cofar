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
