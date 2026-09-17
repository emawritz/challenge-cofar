# Decisiones de diseño — Sistema de tickets v1

Este documento es autosuficiente: describe lo que está construido en este repositorio y por qué.

## 1. Contexto e hipótesis de producto

Una organización de ~800 personas gestiona soporte por correo y planillas. Nadie sabe cuántas solicitudes
hay abiertas, cuánto demoran ni quién las tiene.

Hipótesis de v1: si las solicitudes entran por un solo canal, con estado y dueño visibles, la organización
obtiene por primera vez una línea base medible (volumen, aging, tiempo hasta la toma, tiempo hasta la
resolución). Esa línea base es prerrequisito para definir SLA, prioridades y áreas.

**v1 mide; no compromete.** Todo lo que exige acordar una política que la organización todavía no tiene
(plazos, escalamiento, quién responde qué) queda afuera a propósito, no por tiempo.

## 2. Stack y por qué

- Node 20, fijado en `.nvmrc`. pnpm con lockfile commiteado.
- NestJS 11 con vistas server-rendered (Handlebars). Un proceso, un comando.
- SQLite vía `better-sqlite3` 12.x, Drizzle ORM, migraciones generadas en `drizzle/`.
- Jest + supertest.
- Ejecución local solamente: `pnpm install && pnpm dev`. Sin Docker, sin deploy público.

**Server-rendered sobre SPA + API.** En un time box de 4-5 horas una SPA gasta cerca de dos en scaffolding,
CORS, cliente HTTP, estados de carga y DTOs duplicados. Nada de eso demuestra criterio de producto ni de
diseño de dominio, que es lo que el ejercicio evalúa.

**NestJS sobre un framework mínimo.** Módulos, guards y pipes de validación dan una estructura defendible
con vocabulario conocido, y es el stack en el que trabajo. El costo es algo de ceremonia; lo acepto porque
compra que la autorización viva en un lugar declarado y no repartida en los handlers.

**Drizzle + better-sqlite3 sobre Prisma.** Las transacciones síncronas hacen trivial la regla "ticket y
evento o nada". El `UPDATE` devuelve filas afectadas, que es lo que necesito para el control optimista. No
hay paso de generación de cliente. Límite consciente: el driver es síncrono y bloquea el event loop, algo
irrelevante en un proceso local de demo y caro en producción.

**Node 20 y `better-sqlite3` 12.x.** En una prueba previa al plan, `better-sqlite3@13` resultó requerir
Node ≥ 22 y hace segfault bajo Node 20. Con el repo pineado a Node 20 por `.nvmrc`, la dependencia quedó
pineada a `^12.0.0` y el lockfile resuelve 12.11.1. Es el tipo de incompatibilidad que sólo aparece al
correrlo, no al leer la documentación.

**Local sobre Docker o deploy.** El enunciado lo permite y un deploy agrega infraestructura sin validar
ninguna hipótesis del producto. La condición que me puse a cambio: `pnpm install && pnpm dev` verificado
desde un clone limpio, y seed idempotente.

## 3. Modelo de datos y por qué

```
users
  id            integer pk
  name          text not null
  email         text not null unique
  role          text not null check (role in ('REQUESTER','AGENT'))
  created_at    text not null            -- ISO 8601 UTC

categories
  id            integer pk
  name          text not null unique
  active        integer not null default 1

tickets
  id            integer pk
  title         text not null            -- 1..120 caracteres tras trim
  description   text not null            -- 1..5000 caracteres tras trim
  category_id   integer not null fk categories
  status        text not null check (status in ('OPEN','IN_PROGRESS','RESOLVED','CANCELLED'))
  requester_id  integer not null fk users
  assignee_id   integer null fk users
  version       integer not null default 1
  created_at    text not null
  updated_at    text not null
  resolved_at   text null

ticket_events
  id            integer pk autoincrement  -- ordena el historial
  ticket_id     integer not null fk tickets
  type          text not null check (type in ('CREATED','CLAIMED','RESOLVED','REOPENED','CANCELLED'))
  actor_id      integer not null fk users
  from_status   text null
  to_status     text not null
  occurred_at   text not null
```

Índices: `tickets(status, created_at)`, `tickets(assignee_id, status)`, `tickets(category_id)`,
`ticket_events(ticket_id, id)`. `PRAGMA foreign_keys = ON`. Timestamps ISO 8601 UTC, siempre derivados de
un `Clock` inyectable, nunca de un `new Date()` suelto: eso es lo que hace testeable el aging y la ventana
de 30 días con un reloj fijo.

**`tickets` es la fuente del estado actual; `ticket_events` es auditoría append-only, no event sourcing.**
La cola lee una tabla y una sola. Reconstruir el estado desde eventos en cada request es el tipo de
complejidad que se paga todos los días para una necesidad que v1 no tiene.

**Una sola tabla de eventos con `type`.** La cronología completa de un ticket sale en una query ordenada
por `id`; agregar un tipo de evento nuevo no agrega una tabla. `from_status`, `to_status`, `actor_id` y
`occurred_at` son columnas tipadas e indexables, no un blob.

**`version` para control optimista.** Toda mutación es `UPDATE ... WHERE id = ? AND version = ?` y sube
`version + 1`. Los formularios llevan la versión en un campo oculto. Es lo que resuelve la carrera de dos
agentes tomando el mismo ticket, y lo que convierte un update perdido silencioso en un 409 visible.

**`categories` como tabla y no como enum.** Cambiar el catálogo no requiere migrar. El futuro `area_id`
cuelga de acá.

### Sin X porque

| Columna descartada | Por qué no |
|---|---|
| `sequence` por ticket | El `id` autoincrement ya ordena el historial. Un `MAX+1` por ticket agrega una query y contención de escritura sin ordenar mejor. |
| `payload` JSON en eventos | Ningún evento de v1 tiene datos propios. `CLAIMED` ya lleva `actor_id`; `CREATED` duplicaría campos inmutables del ticket. Se agrega con la primera acción que traiga datos propios (reasignación con motivo). |
| `priority` | Va junto con SLA, y SLA no entra en v1 (sección 6). Una prioridad sin plazo asociado es un campo que nadie sabe cómo llenar. |
| `schema_version` en eventos | Versionar el formato de un evento tiene sentido cuando el evento tiene formato propio. Sin `payload` no hay formato que versionar. |

**Un evento por acción, siempre en la misma transacción que la mutación del ticket.** La aplicación nunca
actualiza ni borra eventos.

## 4. Máquina de estados

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
| crear | — | OPEN | solicitante | INSERT del ticket con `assignee_id = null`, `version = 1`, más evento `CREATED`, misma transacción |
| tomar | OPEN | IN_PROGRESS | cualquier agente | `assignee_id = actor` |
| resolver | IN_PROGRESS | RESOLVED | agente asignado (`assignee_id = actor`) | `resolved_at = now` |
| reabrir | RESOLVED | OPEN | solicitante dueño (`requester_id = actor`) o el agente que resolvió (`assignee_id = actor`) | `assignee_id = null`, `resolved_at = null` |
| cancelar | OPEN, IN_PROGRESS | CANCELLED | solicitante dueño | terminal; `assignee_id` conserva su valor |

### Invariantes de aplicación

- `OPEN` ⇒ `assignee_id IS NULL AND resolved_at IS NULL`.
- `IN_PROGRESS` ⇒ `assignee_id IS NOT NULL AND resolved_at IS NULL`.
- `RESOLVED` ⇒ `assignee_id IS NOT NULL AND resolved_at IS NOT NULL`.
- `CANCELLED` ⇒ `resolved_at IS NULL`. `assignee_id` puede ser null (cancelado desde OPEN) o no (cancelado
  desde IN_PROGRESS): deja registro de quién lo tenía.
- Cada transición produce exactamente un evento.
- No existe un endpoint genérico de cambio de estado. Cada acción es su propia ruta POST.

La máquina vive en `src/tickets/state-machine.ts` como funciones puras sin base de datos (`canCreate`,
`canView`, `canTransition`, `allowedActions`). Es la única autoridad: el servicio la llama antes de tocar
datos y los controllers no reimplementan ninguna regla. La misma función que decide si una acción es
válida es la que decide qué botones se muestran, así que la vista no puede ofrecer algo que el servidor
vaya a rechazar.

### Por qué estos estados y no más

- Tres estados de flujo (`OPEN`, `IN_PROGRESS`, `RESOLVED`) alcanzan para medir demanda, trabajo en curso y
  resolución, que son las tres preguntas del problema.
- **`CANCELLED` existe porque cancelar y resolver son resultados distintos.** El solicitante creó por error
  o el problema se resolvió solo. Obligar al agente a "resolver" eso falsea la métrica de resolución.
  Se reporta con conteo y tasa propios y queda fuera del tiempo hasta la resolución.
- **`CANCELLED` se permite también desde `IN_PROGRESS`**, no sólo desde `OPEN`. Si sólo se pudiera cancelar
  desde `OPEN`, un agente que toma el ticket un segundo antes convierte una solicitud cancelable en una
  irretirable, y el solicitante queda sin salida.
- Sin `CLOSED` (confirmación del solicitante): en la práctica nadie confirma y los tickets quedan eternamente
  en `RESOLVED`. El autocierre es un job más una regla de negocio, v2.
- Sin `WAITING_FOR_REQUESTER`: necesita comentarios, que están descartados (sección 6).
- Sin `ESCALATED`: necesita áreas y rol supervisor.

### Precedencia de errores

Fija, en este orden. Está implementada en este orden y hay tests que la fijan.

Antes de los cinco escalones hay uno previo: un `id` o un `version` que no sea un entero falla en el pipe de
parseo y devuelve **400** sin llegar a ninguna regla de dominio. Importa decirlo porque el `version` es un
campo oculto del formulario, es decir entrada del usuario: mandarlo vacío o con letras no es una forma de
esquivar el chequeo de versión, es un 400 inmediato. Hay un test HTTP que lo fija.

1. Rol no admitido para la ruta (guard) ⇒ **403**.
2. Ticket inexistente o no visible para el actor ⇒ **404**. No revela que el ticket existe.
3. `version` recibida distinta de la actual ⇒ **409**.
4. `canTransition` devuelve `NOT_AUTHORIZED` ⇒ **403**.
5. `canTransition` devuelve `INVALID_STATE` ⇒ **400**.

El orden importa y no es arbitrario. El 404 va antes que todo lo demás porque un solicitante no debe poder
distinguir "ese ticket no existe" de "ese ticket es de otro". El 409 va antes que el 403 y el 400 porque
cuando la versión está vieja, el estado que el usuario vio ya no es el estado real: contestarle "no se puede
tomar un ticket en estado IN_PROGRESS" sería explicarle una regla con datos que él no tenía. El 409 le dice
lo único cierto: cambió mientras mirabas, esto es lo que hay ahora.

Textos al usuario: 400 "No se puede {acción} un ticket en estado {estado}."; 403 "No tenés permiso para esta
acción."; 404 "Ticket no encontrado."; 409 "El ticket cambió mientras lo veías." más el estado actual y
links al ticket y a la cola. Ningún rechazo se traga en silencio: cada excepción de dominio se registra con
el logger antes de responder.

## 5. Identidad simulada y autorización

La identidad es **simulada y está declarada como tal** en la propia pantalla de login. No es autenticación.

- Seed idempotente: 2 solicitantes, 2 agentes, 5 categorías. Reiniciar el servidor no borra tickets ni
  duplica usuarios.
- `GET /login` muestra un botón por usuario. `POST /login` setea una cookie de sesión firmada
  (`HttpOnly`, `SameSite=Lax`) que contiene únicamente el `user_id`.
- `SessionGuard` lee la cookie, carga el usuario de la base **en cada request** y lo adjunta a la request.
  Si la cookie no existe, está mal firmada o el usuario no existe, limpia la cookie y redirige a `/login`.
- `RolesGuard` aplica `@Roles('AGENT')` en `/dashboard`, `POST claim` y `POST resolve`, y
  `@Roles('REQUESTER')` en `GET /tickets/new`, `POST /tickets` y `POST cancel`. Las rutas compartidas
  (`/tickets`, `/tickets/:id`, `POST reopen`) no llevan decorador de rol: ahí la regla depende del ticket,
  no del rol, y la resuelve el servicio.

**El rol nunca viaja en un formulario ni en un query param.** Siempre se lee de la fila de `users`. Es la
diferencia entre una identidad simulada y un agujero: podés elegir con quién entrar, pero no podés declarar
qué sos.

### Matriz

| Recurso | Solicitante | Agente |
|---|---|---|
| `GET /tickets` | sólo los propios; los filtros se ignoran | cola completa con filtros |
| `GET /tickets/:id` | sólo los propios; ajeno ⇒ 404 | todos |
| crear | sí | 403 |
| tomar | 403 | sí |
| resolver | 403 | sólo el asignado; otro agente ⇒ 403 |
| reabrir | sólo el dueño; ajeno ⇒ 404 | sólo quien lo resolvió; otro ⇒ 403 |
| cancelar | sólo el dueño; ajeno ⇒ 404 | 403 |
| `GET /dashboard` | 403 | sí |

**Supuesto declarado: un solo equipo de soporte, confiable.** La cola es global y expone todos los tickets a
todos los agentes. Un ticket sensible (RRHH, salud) no tiene dónde esconderse. Eso requiere áreas con
visibilidad por ámbito, y es parte de lo que se rompe al crecer (sección 8).

En producción se reemplaza el login por OIDC corporativo manteniendo exactamente las mismas reglas de
autorización en el dominio. Las reglas no están en el login, así que cambiar el login no las toca.

## 6. Opcionales: qué se eligió y con qué criterio

Criterio único: **v1 mide la operación real. No simula procesos que la organización todavía no definió, ni
agrega superficie técnica sin señal a cambio.**

### Elegidos (2 de 8)

**Dashboard de métricas.** Responde literalmente a las tres preguntas del problema: cuántas solicitudes hay,
cuánto demoran, quién las tiene. Sin esto, v1 ordena el flujo pero no entrega la línea base, que es la
hipótesis entera.

**Búsqueda y filtros en la cola del agente.** Las mismas tres preguntas a nivel de fila. Hace la cola
operable y, sobre todo, permite investigar los números del dashboard: un número sin forma de abrirlo y ver
qué tickets lo componen es un número en el que nadie confía.

### Descartados

| Opcional | Por qué no en v1 |
|---|---|
| SLA por prioridad | No hay línea base, ni definición de prioridad, ni de horario laboral, ni de pausas. Fijar plazos ahora es inventar números. Se define en v2 con los datos que produzca el dashboard. |
| Comentarios | Abren política no acordada: quién comenta, si comentar reabre el ticket, si el agente "queda esperando al solicitante". Cada respuesta a eso es un estado nuevo en la máquina. |
| Adjuntos | Storage, límites de tamaño, tipos MIME, descargas autorizadas, malware, retención. Mucho riesgo técnico y poca señal de producto. |
| Notificaciones | Canales, reintentos, duplicados, preferencias por usuario. La cola visible ya cubre el flujo principal. |
| Reasignación | Requiere rol supervisor y política de motivo. Se asume la deuda: un ticket tomado por un agente ausente queda bloqueado (sección 9). |
| Auto-categorización | Sin historial limpio ni taxonomía validada sería una demo tecnológica, no una solución. |

## 7. Contrato de métricas

Sólo agentes. Todo se calcula sobre `tickets` y `ticket_events` en el momento del request. Zona horaria UTC.

Definiciones comunes:

- `now` es el reloj inyectado.
- Ventana de 30 días = móvil, `cutoff = now - 720h`. Un evento está en ventana si
  `cutoff <= occurred_at <= now` (ambos extremos incluidos).
- "Primer evento de tipo T de un ticket" = la fila de `ticket_events` con menor `id` entre las de ese ticket
  y ese tipo.
- Abiertos = `status IN ('OPEN','IN_PROGRESS')`. El dashboard usa esa palabra y ninguna otra para ese
  conjunto: dos palabras distintas para lo mismo en la misma pantalla alcanzan para que alguien concluya que
  son cosas distintas.
- Denominador cero ⇒ se muestra "—", nunca 0% ni NaN.
- Agrupaciones sin filas se omiten: no se listan agentes ni categorías en cero.
- Una categoría desactivada que todavía tiene tickets abiertos se muestra por su nombre.
- Duraciones en horas con un decimal.

| Métrica | Definición exacta |
|---|---|
| Abiertos | `COUNT(*)` de `status IN ('OPEN','IN_PROGRESS')` |
| Sin tomar | `COUNT(*) WHERE status = 'OPEN'`. Por invariante equivale a "sin asignar"; se muestra una sola vez y con ese nombre |
| Quién los tiene | `COUNT(*) WHERE status = 'IN_PROGRESS' GROUP BY assignee_id`, orden descendente |
| Abiertos por categoría | `COUNT(*)` de abiertos `GROUP BY category_id`, orden descendente |
| Edad desde creación | tramos sobre `now - created_at` de los abiertos: `< 24h`, `[24h, 72h)`, `[72h, 168h)`, `>= 168h`. La etiqueta dice "edad desde creación", no "edad del ciclo actual": una reapertura no reinicia el contador |
| Creados (30d) | `COUNT` de eventos `CREATED` en ventana |
| Resueltos (30d) | `COUNT` de tickets cuyo **primer** evento `RESOLVED` cae en ventana |
| Cancelados (30d) | `COUNT` de tickets cuyo evento `CANCELLED` cae en ventana |
| Tasa de cancelación (30d) | cohorte de creación: tickets creados en ventana que hoy están `CANCELLED`, sobre tickets creados en ventana |
| Mediana horas hasta tomar (30d) | por ticket, `primer CLAIMED.occurred_at - created_at`; cohorte: tickets cuyo primer `CLAIMED` cae en ventana |
| Mediana horas hasta resolver (30d) | por ticket, `primer RESOLVED.occurred_at - created_at`; cohorte: tickets cuyo primer `RESOLVED` cae en ventana |

Reglas de las medianas:

- Mediana y no promedio: unos pocos tickets muy viejos distorsionan el promedio y el número deja de
  describir el caso típico. Con cardinalidad par se promedian los dos centrales.
- Una reapertura no reescribe la primera toma ni la primera resolución. Los ciclos posteriores no se miden
  en v1.
- Los tickets nunca tomados o nunca resueltos no entran en ninguna mediana. Su demora se ve en "edad desde
  creación", que es justamente donde un ticket olvidado tiene que aparecer.
- **Un ticket que fue tomado y después cancelado SÍ entra en la mediana de tiempo hasta tomar**, porque la
  toma efectivamente ocurrió y esa métrica mide cuánto tarda el equipo en hacerse cargo, no cómo termina el
  ticket.
- **Un ticket cancelado sin haberse resuelto nunca entra en el tiempo hasta la resolución.** No tiene evento
  `RESOLVED`, y contar una cancelación como resolución inflaría artificialmente la capacidad del equipo.
  Hay un camino donde un ticket terminó `CANCELLED` y **sí** aporta a esa mediana: se resolvió, se reabrió y
  recién entonces se canceló. Ese ticket se resolvió de verdad una vez, y esa primera resolución es lo que
  se mide. Las dos cohortes se definen por el **evento**, no por el estado actual, que es la misma razón por
  la que una reapertura no borra la primera resolución. Verificado a mano: el caso está construido y
  medido, no supuesto.
- Cohorte vacía ⇒ "—".
- La query trae sólo las duraciones de la cohorte; la mediana se calcula en memoria.

Cada número lleva su definición en una frase debajo, en la propia vista. Un número de dashboard que alguien
lee para decidir algo tiene que decir qué mide, en la pantalla, no en un documento aparte.

## 8. Qué se rompe a 50.000 tickets/mes y 5 áreas

1. **El modelo de roles y visibilidad.** Es el primer límite real, y llega antes que el volumen.
   `REQUESTER | AGENT` binario y cola global no sirven con 5 áreas. Hace falta una tabla de áreas,
   membresía agente-área, `categories.area_id`, enrutamiento del ticket por categoría, autorización por
   ámbito y un rol supervisor que pueda reasignar. Nada de eso es un parche sobre lo que hay: cambia la
   matriz de autorización entera.
2. **SQLite y proceso único.** Contención de escritura, backups artesanales, sin escalado horizontal.
   Postgres, pool de conexiones, procesos stateless y migraciones automatizadas en el pipeline.
3. **Cola sin paginación ni índices compuestos por área.** Cursor sobre `(created_at, id)`, índices
   `(area_id, status, created_at)` y `(assignee_id, status)`.
4. **Dashboard calculado en vivo.** Percentiles y aging sobre millones de eventos compiten con la cola
   operativa por la misma base. Agregados incrementales por área y después un almacén analítico. En ese
   momento también hay que definir calendarios laborales (un ticket creado un viernes a las 18 no lleva 60
   horas de demora, lleva 4 horas hábiles) y una métrica de reapertura.
5. **La carrera de toma.** `version` sigue sirviendo, pero con varios procesos hay que agregar idempotencia
   por request y tests con conexiones concurrentes reales, no una conexión síncrona (ver sección 9).

50.000 tickets por mes no justifica microservicios. El límite es el modelo multiárea y las consultas, no el
throughput de Postgres.

## 9. Deuda técnica asumida

Todo lo de esta tabla es una decisión consciente, no un descuido. Está acá para que el que siga sepa qué
compró.

| Deuda | Por qué se asume | Cuándo pagarla |
|---|---|---|
| Identidad simulada, sin autenticación | El enunciado lo permite y la autenticación real no da señal sobre el diseño del dominio | Antes de cualquier uso real: OIDC corporativo, con las mismas reglas de autorización |
| Sin protección CSRF explícita; sólo `SameSite=Lax` | Cubre la demo local, que no tiene origen externo | Junto con la autenticación real: token por formulario |
| Ticket tomado por un agente ausente queda bloqueado | La reasignación requiere rol supervisor y política de motivo | v2, con roles y áreas |
| Cola sin paginación | Volumen de demo. Toda la cola entra en una pantalla | Cuando la cola activa deje de caber: cursor sobre `(created_at, id)` |
| Dashboard calculado en vivo, en cada request | Volumen de demo | Cuando su latencia sea perceptible en uso real: agregados incrementales |
| SQLite y un solo proceso | Demo local | Al salir de demo: Postgres y procesos stateless |
| Driver síncrono que bloquea el event loop | Irrelevante en un proceso local; a cambio simplifica la transacción | Con el cambio a Postgres |
| Invariantes de estado sólo en la aplicación | La base restringe valores con `CHECK`; la relación estado/asignado vive en el dominio | Con Postgres: constraints compuestas o triggers |
| Filtro de texto con `LIKE '%q%'` sin escapar `%` ni `_` | Suficiente para buscar en títulos; el parámetro va bindeado, no concatenado, así que no hay inyección, pero un `%` que escriba el usuario actúa como comodín | Con FTS, cuando haya volumen y alguien se queje de los resultados |
| La cola usa `INNER JOIN` con categoría y solicitante | Con las FK activadas no puede haber huérfanos | Si alguna vez se permite borrar categorías o usuarios: un ticket huérfano desaparecería de la cola sin dejar rastro. Pasar a `LEFT JOIN` y mostrar el faltante |
| Filtro de categoría no valida el valor recibido | Un `category` no numérico se convierte en `NaN` y la cola sale vacía, sin decir por qué | Validar el query param y re-renderizar el filtro con un mensaje |
| La tasa de cancelación se redondea a porcentaje entero con `Math.round` | Con las decenas de tickets de la demo, un punto porcentual es más chico que un ticket: no hay precisión que mostrar | Muestra "0%" para un 0,4% real, que no es lo mismo que cero. Con volumen: un decimal o el conteo crudo al lado |
| `SESSION_SECRET` tiene un valor por defecto de desarrollo | Arranque sin configuración para la demo | Validar su presencia al bootear y fallar si falta, apenas exista un entorno que no sea local |
| Sin comentarios en los tickets | Descartado con criterio (sección 6) | v2, cuando el flujo esté validado |
| Sin `payload` en los eventos | Ningún evento de v1 lleva datos propios | Con la primera acción que traiga datos (reasignación con motivo) |
| `AND version = ?` en el `UPDATE` es defensa en profundidad | Con una única conexión síncrona el chequeo previo de versión ya intercepta todo conflicto, así que esa cláusula nunca se activa y ningún test la ejercita (verificado, ver QUALITY.md) | Se mantiene a propósito: es la única defensa que queda cuando haya varias conexiones o procesos. Se vuelve verificable con tests de concurrencia real |
| `conflict(t)` en la rama `changes === 0` reporta el estado leído al inicio de la transacción, que bajo una carrera real con varias conexiones podría estar obsoleto | Con una única conexión síncrona es inalcanzable: el chequeo previo de versión ya intercepta el conflicto antes de llegar al `UPDATE` | Con varias conexiones o procesos: releer la fila antes de construir el 409 |
| `HttpErrorFilter` sólo captura `HttpException` | Cubre todos los errores que la aplicación lanza a propósito | Un error inesperado del driver hoy devuelve el JSON de 500 de Nest en una app HTML; agregar un filtro catch-all que renderice `error.hbs` con 500 |

## 10. Qué quedó fuera por tiempo

Una sola cosa, y está declarada acá en vez de disimulada:

**Recorrido automatizado de navegador con Playwright.** Cubriría el camino completo de punta a punta en un
navegador real: login como solicitante, crear el ticket, login como agente, verificar que aparece en la cola
con el filtro `status=OPEN`, tomarlo, resolverlo, comprobar que el historial muestra los tres eventos y que
el dashboard pasa a mostrar "Resueltos: 1". Es el único bloque del plan que no entró.

No quedó sin cubrir: ese mismo recorrido está verificado a mano y documentado paso a paso en QUALITY.md, y
la autorización, la precedencia de errores y el 409 están cubiertos por tests HTTP reales con supertest, que
es donde estaba el riesgo verdadero. Lo que Playwright habría agregado por encima de eso es la garantía de
que los formularios y los links de las vistas siguen conectados entre sí, que es exactamente la parte que un
recorrido manual de cinco minutos detecta sin ambigüedad.

Todo el resto del alcance planeado —núcleo completo más las medianas y la verificación de mutación
manual— está construido y verificado.
