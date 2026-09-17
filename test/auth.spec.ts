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
