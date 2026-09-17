import { Test } from '@nestjs/testing';
import { sql } from 'drizzle-orm';
import { Clock } from '../src/db/clock';
import { DB, Db, DbModule } from '../src/db/connection';
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

  it('DbModule boots through Nest DI and seeds on init', async () => {
    const mod = await Test.createTestingModule({ imports: [DbModule] })
      .overrideProvider(Clock)
      .useValue({ now: () => new Date(T0) })
      .compile();
    await mod.init();
    const db = mod.get<Db>(DB);
    expect(db.get<{ n: number }>(sql`select count(*) as n from users`)!.n).toBe(4);
    await mod.close();
  });
});
