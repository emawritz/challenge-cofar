import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { Clock } from '../db/clock';
import { DB, Db } from '../db/connection';

export const WINDOW_HOURS = 720;
export const AGING_LABELS = ['< 24h', '24h a < 72h', '72h a < 168h', '≥ 168h'] as const;

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
  medianClaimHours: number | null;
  medianResolveHours: number | null;
};

export function bucketIndex(hours: number): 0 | 1 | 2 | 3 {
  if (hours < 24) return 0;
  if (hours < 72) return 1;
  if (hours < 168) return 2;
  return 3;
}

export function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
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

    const durations = (type: 'CLAIMED' | 'RESOLVED') =>
      this.db.all<{ h: number }>(sql`
        select (julianday(e.occurred_at) - julianday(t.created_at)) * 24 as h
        from (select ticket_id, min(id) as first_id from ticket_events where type = ${type} group by ticket_id) f
        join ticket_events e on e.id = f.first_id
        join tickets t on t.id = f.ticket_id
        where e.occurred_at between ${cutoff} and ${nowIso}`).map((r) => r.h);
    const medianClaimHours = median(durations('CLAIMED'));
    const medianResolveHours = median(durations('RESOLVED'));

    return {
      open, untaken, byAgent, byCategory, aging, created30, resolved30, cancelled30, cancelRate30,
      medianClaimHours, medianResolveHours,
    };
  }
}
