import { EventType, Role, Status, Ticket } from '../db/schema';

export type Action = 'claim' | 'resolve' | 'reopen' | 'cancel';
export type Actor = { id: number; role: Role };
export type TicketState = Pick<Ticket, 'status' | 'requesterId' | 'assigneeId'>;
export type Reason = 'NOT_AUTHORIZED' | 'INVALID_STATE';
export type Verdict = { ok: true } | { ok: false; reason: Reason };

export const ACTIONS: Action[] = ['claim', 'resolve', 'reopen', 'cancel'];

export const TRANSITIONS: Record<Action, { from: Status[]; to: Status; type: EventType; label: string }> = {
  claim: { from: ['OPEN'], to: 'IN_PROGRESS', type: 'CLAIMED', label: 'tomar' },
  resolve: { from: ['IN_PROGRESS'], to: 'RESOLVED', type: 'RESOLVED', label: 'resolver' },
  reopen: { from: ['RESOLVED'], to: 'OPEN', type: 'REOPENED', label: 'reabrir' },
  cancel: { from: ['OPEN', 'IN_PROGRESS'], to: 'CANCELLED', type: 'CANCELLED', label: 'cancelar' },
};

export function canCreate(actor: Actor): boolean {
  return actor.role === 'REQUESTER';
}

export function canView(t: TicketState, actor: Actor): boolean {
  return actor.role === 'AGENT' || t.requesterId === actor.id;
}

function isAuthorized(t: TicketState, action: Action, actor: Actor): boolean {
  const isOwner = actor.role === 'REQUESTER' && t.requesterId === actor.id;
  const isAssignee = actor.role === 'AGENT' && t.assigneeId === actor.id;
  switch (action) {
    case 'claim':
      return actor.role === 'AGENT';
    case 'resolve':
      return isAssignee;
    case 'reopen':
      return isOwner || isAssignee;
    case 'cancel':
      return isOwner;
  }
}

export function canTransition(t: TicketState, action: Action, actor: Actor): Verdict {
  if (!isAuthorized(t, action, actor)) return { ok: false, reason: 'NOT_AUTHORIZED' };
  if (!TRANSITIONS[action].from.includes(t.status)) return { ok: false, reason: 'INVALID_STATE' };
  return { ok: true };
}

export function allowedActions(t: TicketState, actor: Actor): Action[] {
  return ACTIONS.filter((a) => canTransition(t, a, actor).ok);
}
