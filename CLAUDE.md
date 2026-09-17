# Tickets v1 — reglas del proyecto

Spec: docs/superpowers/specs/2026-09-17-ticket-system-design.md. Plan: docs/superpowers/plans/2026-09-17-ticket-system.md.

## Stack y comandos
NestJS 11 + hbs, SQLite (better-sqlite3@12, Node 20) + Drizzle. `pnpm dev`, `pnpm test`, `pnpm typecheck`, `pnpm db:generate`.

## Reglas inviolables
- Estados: OPEN, IN_PROGRESS, RESOLVED, CANCELLED. Transiciones solo las de `src/tickets/state-machine.ts`. No agregar estados ni transiciones sin actualizar spec §5.
- Invariantes: OPEN ⇒ sin asignado y sin resolved_at. IN_PROGRESS ⇒ asignado, sin resolved_at. RESOLVED ⇒ asignado y resolved_at. CANCELLED ⇒ sin resolved_at.
- Toda mutación de ticket pasa por `TicketsService` y escribe exactamente un `ticket_events` en la misma transacción. Nunca un UPDATE de ticket suelto.
- No existe endpoint genérico de cambio de estado. Una ruta POST por acción.
- `ticket_events` es append-only. Nunca UPDATE ni DELETE.
- Precedencia de errores: guard 403 → 404 no visible → 409 versión → 403 no autorizado → 400 estado.
- El rol se lee de DB en cada request. Nunca de formulario ni query.
- Contrato de métricas: spec §9, literal. Cada número lleva su definición en la vista.
- Timestamps ISO 8601 UTC. Usar `Clock`, nunca `new Date()` fuera de `Clock`.

## Tests
Implementar primero, testear después. Esfuerzo en: máquina de estados, trazabilidad, conflicto de versión, autorización, matemática del dashboard. No testear vistas ni controllers triviales. Correr `pnpm test` y `pnpm typecheck` antes de dar una tarea por cerrada.

## Alcance
Núcleo vs stretch según plan. No implementar stretch sin que el núcleo esté verde y documentado.

## Estilo
Sin repositorios genéricos, sin CQRS, sin interfaces de un solo implementador. Textos de UI en español.
