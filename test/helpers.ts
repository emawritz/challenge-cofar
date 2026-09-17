import { INestApplication } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
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
