# Sistema de tickets de soporte — diseño v1

Fecha: 2026-09-17
Contexto: ejercicio técnico para rol Head of Product & Engineering. Time box 4-5h. Se evalúan decisiones, no volumen de código ni diseño visual.

Convención de alcance: todo lo marcado **[núcleo]** se construye. Todo lo marcado **[stretch]** se construye solo si sobra tiempo, en el orden indicado en §14; si no entra, se documenta en DECISIONS.md y ESTRATEGIA-DE-CALIDAD.md como dejado fuera por tiempo, con cómo se haría.

## 1. Problema

Organización de ~800 personas gestiona soporte por correo y planillas. Nadie sabe cuántas solicitudes hay abiertas, cuánto demoran ni quién las tiene. Se pide la primera versión de un sistema de tickets.

Hipótesis de producto de v1: si las solicitudes entran por un solo canal con estado y dueño visibles, la organización obtiene por primera vez una línea base medible (volumen, aging, tiempo a toma, tiempo a resolución). Esa línea base es prerrequisito para definir SLA, prioridades y áreas. v1 mide; no compromete.

## 2. Alcance

### Obligatorio [núcleo]
1. Solicitante crea ticket (título, descripción, categoría).
2. Agente ve la cola, toma un ticket, cambia su estado.
3. Trazabilidad: qué pasó con un ticket y cuándo.
4. Dos perfiles con vistas distintas: solicitante / agente.

### Opcional elegido (2 de 8)
- **Dashboard de métricas** [núcleo: conteos, aging, resueltos y cancelados 30d] [stretch: medianas]: responde literalmente al problema planteado (cuántos, cuánto, quién).
- **Búsqueda y filtros** [núcleo] en la cola del agente: mismas tres preguntas a nivel fila; hace operable la cola y permite investigar los números del dashboard.

### Opcional descartado y criterio
Criterio: v1 mide la operación real; no simula procesos que la organización aún no definió ni agrega superficie técnica sin señal.

| Feature | Por qué no en v1 |
|---|---|
| SLA por prioridad | No hay línea base ni definición de prioridad, horario, pausas. Fijar plazos ahora es inventar números. Se define en v2 con datos del dashboard. |
| Comentarios | Abren política no acordada: quién comenta, si comentar reabre, si el agente "espera al solicitante". Cada respuesta es un estado nuevo. |
| Adjuntos | Storage, límites, MIME, descargas autorizadas, malware, retención. Mucho riesgo técnico, poca señal. |
| Notificaciones | Canales, reintentos, duplicados, preferencias. La cola visible cubre el flujo principal. |
| Reasignación | Requiere rol supervisor y política de motivo. Deuda declarada: ticket tomado por agente ausente queda bloqueado (ver §11). |
| Auto-categorización | Sin historial limpio ni taxonomía validada. Sería demo tecnológica, no solución. |

## 3. Stack

- Node 20 (pinneado en `.nvmrc`), pnpm con lockfile.
- NestJS con vistas server-rendered (Handlebars). Un proceso, un comando.
- SQLite vía `better-sqlite3`, Drizzle ORM.
- Jest + supertest. Playwright [stretch].
- Ejecución local únicamente: `pnpm install && pnpm dev`. Sin Docker, sin deploy público.

### Por qué
- Server-rendered sobre SPA+API: en 4-5h una SPA gasta ~2h en scaffolding, CORS, cliente HTTP, estados de carga, DTOs duplicados. Nada de eso puntúa.
- NestJS sobre framework mínimo: módulos, guards, pipes de validación dan estructura defendible con vocabulario conocido. Es el stack del candidato.
- Drizzle + better-sqlite3 sobre Prisma: transacciones síncronas simplifican "ticket + evento o nada"; `UPDATE` devuelve filas afectadas para concurrencia optimista; sin paso de generate. Límite consciente: driver síncrono bloquea el event loop; irrelevante para un proceso local de demo.
- Local sobre Docker/deploy: el enunciado lo permite; deploy agrega infraestructura sin validar ninguna hipótesis. Condición: `pnpm install && pnpm dev` verificado desde checkout limpio, seed idempotente.

## 4. Modelo de datos

```
users
  id            integer pk
  name          text not null
  email         text not null unique
  role          text not null check (role in ('REQUESTER','AGENT'))
  created_at    text not null  -- ISO 8601 UTC

categories
  id            integer pk
  name          text not null unique
  active        integer not null default 1

tickets
  id            integer pk
  title         text not null         -- 1..120 chars tras trim
  description   text not null         -- 1..5000 chars tras trim
  category_id   integer not null fk categories
  status        text not null check (status in ('OPEN','IN_PROGRESS','RESOLVED','CANCELLED'))
  requester_id  integer not null fk users
  assignee_id   integer null fk users
  version       integer not null default 1
  created_at    text not null
  updated_at    text not null
  resolved_at   text null

ticket_events
  id            integer pk autoincrement   -- orden del historial
  ticket_id     integer not null fk tickets
  type          text not null check (type in ('CREATED','CLAIMED','RESOLVED','REOPENED','CANCELLED'))
  actor_id      integer not null fk users
  from_status   text null
  to_status     text not null
  occurred_at   text not null
```

Índices: `tickets(status, created_at)`, `tickets(assignee_id, status)`, `tickets(category_id)`, `ticket_events(ticket_id, id)`.

Foreign keys activadas (`PRAGMA foreign_keys = ON`). Timestamps ISO 8601 UTC. Reloj inyectable (`Clock` provider) para tests de aging. Los invariantes de §5 son de aplicación; la base solo restringe valores permitidos con `CHECK`.

### Decisiones
- `tickets` es la fuente del estado actual. La cola lee una tabla. `ticket_events` es auditoría append-only, no event sourcing.
- Tabla única de eventos con `type`: cronología ordenada por `id` en una query, nuevos tipos sin nuevas tablas. `from_status`/`to_status`/`actor_id`/`occurred_at` son columnas tipadas e indexables.
- `version`: control optimista. Toda mutación es `UPDATE ... WHERE id = ? AND version = ?` y sube `version + 1`. Evita updates perdidos y resuelve la carrera de dos agentes tomando el mismo ticket. Los formularios llevan `version` oculto.
- `categories` tabla y no enum: cambiar categorías sin migrar; futuro `area_id` cuelga de acá.
- Sin `sequence` por ticket: `id` autoincrement ordena. `MAX+1` agrega query y contención sin escalar mejor.
- Sin `payload` JSON: ningún evento de v1 tiene datos propios. `CLAIMED` ya tiene `actor_id`; `CREATED` duplicaría campos inmutables del ticket. Se agrega con la primera acción con datos propios (reasignación con motivo).
- Sin `priority`: va con SLA.

Un evento por acción, siempre en la misma transacción que la mutación del ticket. Nunca se actualizan ni borran eventos desde la aplicación.

## 5. Máquina de estados

```
                 crear              tomar               resolver
  ──────────────► OPEN ──────────► IN_PROGRESS ──────────► RESOLVED
                   │                   │                      │
                   │ cancelar          │ cancelar             │ reabrir
                   ▼                   ▼                      │
               CANCELLED           CANCELLED                  └──► OPEN
```

| Acción | Desde | Hacia | Actor | Efecto |
|---|---|---|---|---|
| crear | — | OPEN | solicitante | INSERT ticket con `assignee_id = null`, `version = 1` + evento CREATED, misma transacción |
| tomar | OPEN | IN_PROGRESS | cualquier agente | `assignee_id = actor` |
| resolver | IN_PROGRESS | RESOLVED | agente asignado (`assignee_id = actor`) | `resolved_at = now` |
| reabrir | RESOLVED | OPEN | solicitante dueño (`requester_id = actor`) o agente que resolvió (`assignee_id = actor`) | `assignee_id = null`, `resolved_at = null` |
| cancelar | OPEN, IN_PROGRESS | CANCELLED | solicitante dueño | terminal; `assignee_id` conserva su valor |

Invariantes de aplicación:
- `OPEN` ⇒ `assignee_id IS NULL AND resolved_at IS NULL`.
- `IN_PROGRESS` ⇒ `assignee_id IS NOT NULL AND resolved_at IS NULL`.
- `RESOLVED` ⇒ `assignee_id IS NOT NULL AND resolved_at IS NOT NULL`.
- `CANCELLED` ⇒ `resolved_at IS NULL`; `assignee_id` puede ser null (cancelado desde OPEN) o no (desde IN_PROGRESS): registra quién lo tenía.
- Cada transición produce exactamente un evento.
- No existe endpoint de cambio de estado genérico. Cada acción es su propia ruta.

Por qué estos estados y no más:
- Tres estados de flujo (`OPEN`, `IN_PROGRESS`, `RESOLVED`) alcanzan para medir demanda, trabajo en curso y resolución.
- `CANCELLED` existe porque cancelar y resolver son resultados distintos: el solicitante creó por error o el problema se resolvió solo. Obligar al agente a "resolver" eso falsea el flujo. Se reporta como conteo y tasa propios y queda fuera del tiempo a resolución. Se permite desde `IN_PROGRESS` para que una carrera con el agente no convierta una solicitud cancelable en irretirable.
- Sin `CLOSED` (confirmación del solicitante): en la práctica nadie confirma; tickets quedan eternamente en RESOLVED. Auto-cierre es job + regla, v2.
- Sin `WAITING_FOR_REQUESTER`: necesita comentarios.
- Sin `ESCALATED`: necesita áreas y supervisor.

Implementación en `tickets/state-machine.ts`, funciones puras sin DB:
- `canCreate(actor): boolean` — solo `REQUESTER`.
- `canTransition(ticket, action, actor): { ok: true } | { ok: false, reason: 'NOT_AUTHORIZED' | 'INVALID_STATE' }`.

Son la única autoridad. Todas las mutaciones pasan por `TicketsService`, que las llama antes de tocar datos. Los controllers no reimplementan reglas.

## 6. Identidad y autorización

Identidad simulada, declarada como tal. No es autenticación.

- Seed idempotente: 2 solicitantes, 2 agentes, 5 categorías. Reiniciar el servidor no borra tickets ni duplica usuarios.
- `GET /login`: selector con un botón por usuario. `POST /login` setea cookie de sesión firmada (`HttpOnly`, `SameSite=Lax`) con `user_id` únicamente.
- `SessionGuard` lee la cookie, carga el usuario de DB en cada request, adjunta `req.user`. Si la cookie no existe, es inválida o el usuario no existe: limpia la cookie y redirige a `/login`. El rol nunca viaja en formularios ni query params.
- `RolesGuard` con `@Roles('AGENT')` en `/dashboard`, `POST claim`, `POST resolve`. Con `@Roles('REQUESTER')` en `GET /tickets/new`, `POST /tickets`, `POST cancel`. No en `/tickets` ni `/tickets/:id` (rutas compartidas).
- Ownership y reglas por estado se validan en `TicketsService`.

Matriz:

| Recurso | Solicitante | Agente |
|---|---|---|
| `GET /tickets` | solo propios; filtros ignorados | cola con filtros |
| `GET /tickets/:id` | solo propios; ajeno ⇒ 404 | todos |
| crear | sí | 403 |
| tomar | 403 | sí |
| resolver | 403 | solo el asignado; otro agente ⇒ 403 |
| reabrir | solo dueño; ajeno ⇒ 404 | solo quien resolvió; otro ⇒ 403 |
| cancelar | solo dueño; ajeno ⇒ 404 | 403 |
| `GET /dashboard` | 403 | sí |

Precedencia de errores, fija, en este orden:
1. Rol no admitido para la ruta (guard) ⇒ 403.
2. Ticket inexistente o no visible para el actor (servicio) ⇒ 404. No revela existencia.
3. `version` recibida ≠ `version` actual ⇒ 409.
4. `canTransition` devuelve `NOT_AUTHORIZED` ⇒ 403.
5. `canTransition` devuelve `INVALID_STATE` ⇒ 400.

Producción: reemplazar por OIDC corporativo manteniendo las mismas reglas de autorización en el dominio.

Supuesto declarado: un solo equipo de soporte confiable. Cola global expone todos los tickets a todos los agentes; tickets sensibles (RRHH, salud) requieren áreas con visibilidad por ámbito, v2.

## 7. Rutas

```
GET  /login                  selector de identidad
POST /login                  setea cookie
POST /logout
GET  /                       redirige a /tickets
GET  /tickets                solicitante: mis tickets. agente: cola con filtros
GET  /tickets/new            form de creación (solicitante)
POST /tickets                crear
GET  /tickets/:id            detalle + historial + acciones disponibles según rol y estado
POST /tickets/:id/claim
POST /tickets/:id/resolve
POST /tickets/:id/reopen
POST /tickets/:id/cancel
GET  /dashboard              agente
```

Acciones son `POST` con formulario HTML y campo oculto `version`. Sin `PATCH` genérico.

### Validación de creación
- `title`, `description`: `trim`, luego longitud 1..120 y 1..5000.
- `category_id`: existe y `active = 1`.
- Error de validación ⇒ 400 con el formulario re-renderizado y mensajes por campo.

### Filtros de la cola (query params, solo agente)
- `status`: `OPEN | IN_PROGRESS | RESOLVED | CANCELLED | all`. Default: activos (`OPEN + IN_PROGRESS`).
- `category`: id. Default: todas.
- `assignee`: `any | unassigned | me`. Default: `any`. `me` incluye todos los estados con `assignee_id = actor`, incluidos resueltos y cancelados si el filtro de estado los admite.
- `q`: texto, `LIKE %q%` sobre título.
- Orden fijo: `created_at ASC` (más viejo primero).
- Sin paginación en v1 (deuda declarada, §11).

## 8. Flujo de una transición

1. `SessionGuard` carga usuario. `RolesGuard` valida rol de la ruta (403).
2. Controller valida DTO (`id` entero, `version` entero) con `class-validator`.
3. `TicketsService.<action>(id, version, actor)` abre transacción síncrona:
   a. Lee el ticket. Si no existe o el actor no puede verlo: `NotFoundException` (404).
   b. Si `ticket.version !== version`: `ConflictException` (409).
   c. `canTransition(ticket, action, actor)`. `NOT_AUTHORIZED` ⇒ `ForbiddenException` (403). `INVALID_STATE` ⇒ `BadRequestException` (400).
   d. `UPDATE tickets SET ..., version = version + 1, updated_at = now WHERE id = ? AND version = ?`. Si `changes === 0` (cambió entre a y d): `ConflictException` (409).
   e. `INSERT ticket_events (ticket_id, type, actor_id, from_status, to_status, occurred_at)`.
   f. Commit. Si cualquier paso lanza, rollback: el ticket no cambia y no hay evento.
4. Redirect a `/tickets/:id`.

Creación: `canCreate(actor)`, validación de §7, transacción con `INSERT tickets` + `INSERT ticket_events (CREATED, from_status null, to_status OPEN)`.

### Errores al usuario
- 400 transición inválida: "No se puede {acción} un ticket en estado {estado}."
- 403: "No tenés permiso para esta acción."
- 404: "Ticket no encontrado."
- 409: "El ticket cambió mientras lo veías. Estado actual: {estado}." con link al ticket y a la cola.
- Ningún rechazo se traga: cada excepción de dominio se registra con `Logger` de Nest (`ticketId`, `actorId`, `action`, `reason`) antes de responder.
- Handlebars mantiene escape HTML por defecto.

## 9. Dashboard: contrato de métricas

Solo agentes. Todo calculado sobre `tickets` y `ticket_events` en el request. Zona horaria: UTC.

Definiciones comunes:
- `now` = reloj inyectado.
- Ventana 30d = móvil, `cutoff = now - 720h`. Un evento está en ventana si `cutoff <= occurred_at <= now`.
- "Primer evento de tipo T de un ticket" = fila de `ticket_events` con menor `id` entre las de ese ticket y tipo.
- Activos = `status IN ('OPEN','IN_PROGRESS')`.
- Denominador cero ⇒ se muestra "—", nunca 0% ni NaN.
- Agrupaciones sin filas se omiten (no se listan agentes ni categorías con cero).
- Categoría inactiva con tickets activos se muestra por su nombre.
- Duraciones en horas con un decimal.

### [núcleo]

| Métrica | Definición exacta |
|---|---|
| Abiertos | `COUNT(*)` de activos |
| Sin tomar | `COUNT(*) WHERE status = 'OPEN'`. Por invariante equivale a "sin asignar"; se muestra una sola vez con ese nombre |
| En progreso por agente | `COUNT(*) WHERE status = 'IN_PROGRESS' GROUP BY assignee_id`, ordenado desc |
| Activos por categoría | `COUNT(*)` de activos `GROUP BY category_id`, ordenado desc |
| Edad desde creación (activos) | buckets sobre `now - created_at`: `< 24h`, `[24h, 72h)`, `[72h, 168h)`, `>= 168h`. Etiqueta en la vista: "edad desde creación", no "edad del ciclo actual" |
| Creados (30d) | `COUNT` de eventos `CREATED` en ventana |
| Resueltos (30d) | `COUNT` de tickets cuyo primer evento `RESOLVED` está en ventana |
| Cancelados (30d) | `COUNT` de tickets cuyo evento `CANCELLED` está en ventana |
| Tasa de cancelación (30d) | cohorte de creación: tickets creados en ventana que hoy están `CANCELLED` / tickets creados en ventana |

### [stretch]

| Métrica | Definición exacta |
|---|---|
| Mediana tiempo a toma (30d) | por ticket: `primer CLAIMED.occurred_at - created_at`; cohorte: tickets cuyo primer CLAIMED está en ventana |
| Mediana tiempo a resolución (30d) | por ticket: `primer RESOLVED.occurred_at - created_at`; cohorte: tickets cuyo primer RESOLVED está en ventana |

Reglas de las medianas:
- Mediana, no promedio: pocos tickets viejos distorsionan el promedio. Cardinalidad par ⇒ promedio de los dos centrales.
- Reapertura no reescribe la primera toma ni la primera resolución. Ciclos posteriores no se miden en v1.
- Tickets nunca tomados o nunca resueltos no entran; su demora se ve en edad desde creación.
- `CANCELLED` nunca entra en tiempo a resolución.
- Cohorte vacía ⇒ "—".
- La query trae solo las duraciones de la cohorte; la mediana se calcula en JS. Pasar a agregado incremental cuando la latencia del dashboard sea perceptible en uso real.

Cada número lleva al lado su definición en una frase en la vista.

## 10. Estrategia de calidad

Esfuerzo va donde un fallo corrompe el flujo o miente al usuario. Orden de implementación = orden de prioridad.

### Se prueba [núcleo]
1. **Máquina de estados** (unitario, sin DB). Tabla parametrizada: toda transición permitida, toda prohibida, cada actor, con el `reason` esperado. Ej: agente no asignado resuelve ⇒ `NOT_AUTHORIZED`; solicitante toma ⇒ `NOT_AUTHORIZED`; cancelar desde RESOLVED ⇒ `INVALID_STATE`; reabrir por agente distinto al asignado ⇒ `NOT_AUTHORIZED`.
2. **Trazabilidad** (integración, SQLite en memoria). Crear/tomar/resolver/reabrir/cancelar producen exactamente un evento con `type`, `from_status`, `to_status`, `actor_id` correctos y `version` incrementada. Con fallo inyectado en el insert del evento, el ticket no cambia.
3. **Conflicto de versión** (integración). Dos claims con la misma `version`: el primero gana, el segundo recibe 409, `assignee_id` es el ganador. Nombrado "conflicto de versión", no "concurrencia": una conexión síncrona no prueba contención real.
4. **Autorización** (supertest sobre HTTP con cookie). Solicitante: `GET` ticket ajeno ⇒ 404; `POST cancel` y `POST reopen` sobre ajeno ⇒ 404; `POST claim` ⇒ 403; `GET /dashboard` ⇒ 403; `GET /tickets?assignee=any` devuelve solo propios. Agente no asignado: `POST resolve` ⇒ 403. Manipular `version` o `id` oculto no salta reglas.
5. **Matemática del dashboard** (unitario con reloj fijo). Buckets de edad en los límites exactos (23h59, 24h, 72h, 168h), tasa de cancelación por cohorte, denominador cero, resueltos tras reapertura cuenta una vez.

### Se prueba [stretch]
6. **Medianas** con cardinalidad par e impar, exclusión de CANCELLED, reapertura no reescribe.
7. **Playwright**, un recorrido: login solicitante → crear → login agente → cola con filtro `status=OPEN` muestra el ticket → tomar → resolver → historial muestra 3 eventos → dashboard muestra "Resueltos (30d): 1".

### Técnica recomendada, no obligatoria
Antes de dar por válidos los tests 1-3: romper la línea, ver el test fallar, restaurar. Tres invariantes: quitar una transición prohibida de `canTransition`; comentar el insert del evento; quitar `AND version = ?` del UPDATE. Se documenta en ESTRATEGIA-DE-CALIDAD.md como método; si se hizo, se dice cuáles; si no, se dice por qué.

### No se prueba, deliberado
- Render de vistas (visual, no evaluado).
- Controllers que solo delegan.
- Filtros de la cola: `WHERE` directos; los cubre el recorrido Playwright si entra, o el recorrido manual.
- Carga, cross-browser, snapshots, mutation testing automatizado.

### Verificación de entrega [núcleo]
- `pnpm install && pnpm dev` desde checkout limpio.
- `pnpm test` verde. `tsc --noEmit` limpio.
- Recorrido manual documentado en ESTRATEGIA-DE-CALIDAD.md (mismo que el de Playwright) más: un 403 (solicitante en `/dashboard`), un 409 (dos pestañas, mismo claim).

## 11. Deuda técnica asumida

| Deuda | Por qué se asume | Cuándo pagar |
|---|---|---|
| Identidad simulada, sin auth | El enunciado lo permite; auth real no da señal | Antes de cualquier uso real: OIDC corporativo |
| Sin CSRF explícito | `SameSite=Lax` cubre la demo local | Con auth real: token por formulario |
| Ticket tomado por agente ausente queda bloqueado | Reasignación requiere supervisor | v2 con roles y áreas |
| Cola sin paginación | Volumen de demo | Cuando la cola activa deje de caber en una pantalla razonable: cursor sobre `(created_at, id)` |
| Dashboard calculado en vivo | Volumen de demo | Cuando su latencia sea perceptible: agregados incrementales |
| SQLite, un proceso | Demo local | Postgres + procesos stateless al salir de demo |
| Driver síncrono bloquea event loop | Irrelevante en un proceso local | Con el cambio a Postgres |
| Invariantes solo en aplicación | `CHECK` de valores en DB; relaciones estado/asignado en dominio | Con Postgres: constraints compuestas o triggers |
| Filtro de texto con `LIKE` | Suficiente para títulos | FTS cuando haya volumen y quejas |
| Sin comentarios | Descartado con criterio | v2 cuando el flujo esté validado |
| Sin `payload` en eventos | Ningún evento de v1 lleva datos propios | Con la primera acción con datos (reasignación con motivo) |

## 12. Qué se rompe a 50.000 tickets/mes y 5 áreas

1. **Modelo de roles y visibilidad.** `REQUESTER | AGENT` binario y cola global no sirven con 5 áreas. Hace falta `support_areas`, membresía agente-área, `categories.area_id`, enrutamiento por categoría, autorización por ámbito, rol supervisor con reasignación. Es el primer límite real, antes que el volumen.
2. **SQLite y proceso único.** Contención de escritura, backups, sin escalado horizontal. Postgres, pool, procesos stateless, migraciones automatizadas.
3. **Cola sin paginación ni índices compuestos por área.** Cursor sobre `(created_at, id)`, índices `(area_id, status, created_at)`, `(assignee_id, status)`.
4. **Dashboard en vivo.** Percentiles y aging sobre millones de eventos compiten con la cola operativa. Agregados incrementales por área, luego almacén analítico. Definir calendarios laborales y métrica de reapertura.
5. **Carrera de toma.** `version` sigue sirviendo, pero con múltiples procesos se agrega idempotencia por request y tests con conexiones concurrentes reales.

50k/mes no justifica microservicios. El límite es el modelo multiárea y las consultas, no el throughput de Postgres.

## 13. Estructura del proyecto

```
CLAUDE.md                    reglas del proyecto para el agente (ver §15)
README.md
DECISIONS.md
AI-USAGE.md
ESTRATEGIA-DE-CALIDAD.md
.nvmrc
src/
  main.ts
  app.module.ts
  db/
    schema.ts          drizzle schema
    connection.ts      better-sqlite3 + PRAGMA foreign_keys
    seed.ts            idempotente
    clock.ts           Clock provider inyectable
  auth/
    auth.module.ts
    auth.controller.ts login/logout
    session.guard.ts
    roles.guard.ts
    roles.decorator.ts
  tickets/
    tickets.module.ts
    tickets.controller.ts
    tickets.service.ts     transacciones, llama a state-machine
    state-machine.ts       canCreate, canTransition puros
    dto/
  metrics/
    metrics.module.ts
    metrics.controller.ts
    metrics.service.ts
views/
  layout.hbs, login.hbs, tickets/*.hbs, dashboard.hbs, error.hbs
test/
  state-machine.spec.ts
  tickets.service.spec.ts     trazabilidad + conflicto de versión
  authz.e2e-spec.ts           supertest
  metrics.service.spec.ts
  e2e/journey.spec.ts         [stretch]
```

Sin repositorios genéricos, sin CQRS, sin interfaces de un solo implementador.

## 14. Presupuesto de tiempo

### Núcleo (objetivo 5h)

| Bloque | Min |
|---|---|
| CLAUDE.md, scaffold Nest + Drizzle + Handlebars, verificar que `better-sqlite3` instala | 30 |
| Schema, connection, seed, clock | 20 |
| Auth: login, cookie, guards | 30 |
| State machine + service con transacciones | 45 |
| Vistas: login, lista/cola con filtros, detalle con historial, form, error | 55 |
| Dashboard núcleo | 25 |
| Tests 1-5 | 60 |
| DECISIONS, AI-USAGE, QUALITY, README | 35 |
| **Total núcleo** | **300** |

### Stretch, en este orden, solo si sobra
1. Medianas + test 6 (30 min).
2. Playwright, tope 20 min; si no queda estable, se abandona.
3. Verificación de mutación manual (15 min).

Si el núcleo se pasa, el orden de recorte dentro del núcleo es: filtro `q` → tasa de cancelación → test 5. No se recorta: flujo, autorización, conflicto de versión, atomicidad ticket+evento, documentos. Todo lo dejado fuera se registra en DECISIONS.md con cómo se haría.

Verificación desde checkout limpio y recorrido manual de demo van dentro del bloque de documentos.

## 15. CLAUDE.md del proyecto y material para AI-USAGE.md

`CLAUDE.md` del repo, escrito antes de la primera línea de código, contiene: stack y comandos; máquina de estados con invariantes de §5 como reglas inviolables; prohibición de endpoint genérico de estado; regla "toda mutación pasa por `TicketsService` y genera un evento en la misma transacción"; precedencia de errores de §6; contrato de métricas de §9 por referencia; política de tests de §10; convención núcleo/stretch.

La sesión de diseño es parte del entregable. AI-USAGE.md registra:
- Herramientas: Claude Code (diseño, implementación), Codex CLI (propuesta independiente y tres rondas de revisión crítica), skill de brainstorming para forzar una decisión por vez.
- Propuesta inicial de Codex; recorte de Claude (sin `version`/`sequence`/`payload`); decisión del candidato de mantener el modelo completo; revisión de Codex que mantuvo `version` y descartó `sequence` y `schema_version`; tercera ronda de Codex que descartó `payload` por no tener datos propios; candidato aceptó en ambas.
- Decisión propia del candidato: `CANCELLED`, no propuesto por ninguna IA. Codex objetó limitarlo a OPEN por la carrera con el agente; candidato aceptó ampliarlo a IN_PROGRESS.
- Output rechazado: propuesta de Claude de "meter filtros en la cola sin llamarlos feature" mientras se declaraba descartado búsqueda/filtros. Rechazado por inconsistente. Propuesta de Claude de comentarios como segundo opcional: rechazada por apartarse del problema enunciado.
- Playwright: candidato lo pidió obligatorio; Codex objetó por time box; candidato lo movió a stretch.
- Presupuesto: Claude estimó 330 min; Codex lo calificó irreal (6,5-8h) y señaló tests como el bloque más subestimado; candidato eligió recortar antes de implementar, separando núcleo y stretch.
- Errores del spec que Codex encontró y se corrigieron: el orden del flujo hacía imposible el 409 prometido; el E2E asumía una métrica no definida; contrato de métricas con buckets, cohortes y ventanas ambiguas.
