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
    // supertest binds the underlying http.Server on first request; concurrent
    // logins race that bind and reset the connection, so log in sequentially.
    ana = await loginAs(app, 1);
    bruno = await loginAs(app, 2);
    carla = await loginAs(app, 3);
    diego = await loginAs(app, 4);
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
    expect((await http().get('/dashboard').set('Cookie', carla)).status).toBe(200);
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

    const res2 = await post(ana, '/tickets', { title: 'ok', description: 'ok', categoryId: '' });
    expect(res2.status).toBe(400);
    expect(res2.text).toContain('Elegí una categoría.');
  });
});
