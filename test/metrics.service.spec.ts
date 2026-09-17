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
