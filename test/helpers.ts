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
