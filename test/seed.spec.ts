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
