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
