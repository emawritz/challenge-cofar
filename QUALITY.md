# Estrategia de calidad

**72 tests en 6 suites, todos en verde. `tsc --noEmit` limpio.**

## 1. Criterio

El esfuerzo de testing va donde un fallo **corrompe el flujo o le miente al usuario**. Todo lo demás se
verifica más barato.

Corromper el flujo es que un ticket cambie de estado sin dejar evento, que dos agentes crean tener el mismo
ticket, que alguien vea o toque algo que no le corresponde. Mentirle al usuario es un número de dashboard
que no significa lo que dice la etiqueta, o un mensaje de error que le explica una regla con datos que él
nunca vio.

Lo que no cumple ninguna de las dos condiciones —cómo se ve una tabla, un controller que sólo delega— se
verifica leyéndolo y corriéndolo, no escribiendo un test que después hay que mantener.

## 2. Qué se probó

| Archivo | Tests | Qué cubre |
|---|---|---|
| `test/state-machine.spec.ts` | 28 | La máquina de estados completa |
| `test/tickets.service.spec.ts` | 14 | Trazabilidad, atomicidad, conflicto de versión, precedencia |
| `test/authz.spec.ts` | 10 | Autorización sobre HTTP real |
| `test/metrics.service.spec.ts` | 12 | La matemática del dashboard |
| `test/auth.spec.ts` | 5 | Sesión y cookie firmada |
| `test/seed.spec.ts` | 3 | Seed idempotente y arranque del módulo |

### `state-machine.spec.ts` — 28 tests, unitarios, sin base de datos

Una tabla parametrizada de **24 filas** recorre las cuatro acciones (`claim`, `resolve`, `reopen`,
`cancel`) contra los cuatro estados y los cuatro actores del seed, y cada fila afirma el veredicto exacto:
`ok`, `NOT_AUTHORIZED` o `INVALID_STATE`. Está cada transición permitida y cada una prohibida, con el
motivo correcto en cada caso. Algunas: *requester cannot claim* (`NOT_AUTHORIZED`), *agent cannot claim
IN_PROGRESS* (`INVALID_STATE`), *other agent cannot resolve* (`NOT_AUTHORIZED`), *owner cannot cancel
RESOLVED* (`INVALID_STATE`), *owner cancels IN_PROGRESS* (`ok`).

Cuatro tests más: *authorization is checked before state (403 wins over 400)*, que fija el orden entre los
dos motivos de rechazo; *only requesters create*; *agents view all, requesters only own*; y *lists exactly
the actions each actor can take*, que verifica que la lista de botones que se le ofrece a cada actor
coincide exactamente con lo que la máquina le va a permitir. Sin ese último, la vista podría ofrecer un
botón que el servidor rechaza.

### `tickets.service.spec.ts` — 14 tests, integración sobre SQLite en memoria

- **Creación** (3): *inserts OPEN ticket with version 1 and one CREATED event in the same transaction*,
  *rejects agents*, *rejects inactive category*.
- **Trazabilidad** (1): *create → claim → resolve → reopen → claim → cancel* recorre el ciclo de vida
  completo y afirma la lista entera de eventos —tipo, estado de origen, estado de destino y actor de cada
  uno— más la versión resultante. Seis acciones, seis eventos, ni uno de más.
- **Atomicidad** (1): *if the event insert fails, the ticket does not change*. Se inyecta un fallo en la
  inserción del evento y se verifica que el ticket quedó exactamente como estaba. Es el test que prueba que
  "ticket y evento o nada" es real y no una intención.
- **Conflicto de versión** (3): *second claim with the same version gets 409 and the first agent keeps the
  ticket*, *409 carries current status for the error page*, *409 is checked before 403 and 400*. Están
  nombrados "conflicto de versión" y no "concurrencia" a propósito: una conexión síncrona no prueba
  contención real (ver sección 4).
- **Precedencia de errores** (3): *404 for a ticket the requester does not own, even with wrong version*,
  *403 for unauthorized actor with right version*, *400 for invalid state with right version and authorized
  actor*. Cada uno fija un escalón del orden 404 → 409 → 403 → 400.
- **Filtros y detalle** (3): *requester sees only own tickets regardless of filters* (un solicitante que
  manda filtros a mano no ve nada ajeno), *agent default is active only; status=all shows terminals;
  assignee=me and q filter*, y *returns names, ordered events and allowed actions for the actor*.

### `authz.spec.ts` — 10 tests, HTTP real con supertest y cookie de sesión

Esta suite no llama al servicio: manda requests HTTP con la cookie de cada usuario y mira el código de
estado y el cuerpo. Es donde se verifica que los guards, el filtro de excepciones y el servicio coinciden.

*requester cannot see a ticket they do not own (404, not 403)* · *requester mutating a foreign ticket gets
404* · *requester cannot claim (guard 403) nor open the dashboard (403)*, que además afirma el 200 del
dashboard para un agente · *agent cannot create tickets (403)* · *requester list ignores filters and shows
only own tickets* · *hidden version cannot be used to skip rules: stale version → 409 page with current
status* · *non-assigned agent cannot resolve (403); assigned agent can* · *invalid state → 400 with the
exact message* · *non-numeric version is rejected (400), never treated as a match* · *validation errors
re-render the form with 400*, que cubre el título vacío y la categoría vacía.

Los dos que más importan son los que manipulan el campo oculto: un `version` viejo da 409 y un `version`
no numérico da 400, nunca se interpreta como coincidencia. Un campo oculto es entrada del usuario.

### `metrics.service.spec.ts` — 12 tests, unitarios con reloj fijo

Ocho casos parametrizados golpean los **límites exactos** de los tramos de aging: 0, 23.99, 24, 71.99, 72,
167.99, 168 y 5000 horas. Los bordes son donde un `<` en vez de un `<=` cambia un número que alguien lee.

*empty database: zeros and null rate* fija el comportamiento con denominador cero: la tasa y las dos
medianas son `null`, y la vista las muestra como "—", nunca como 0% ni como NaN.

*counts, aging, window and cohort rate follow the contract* arma una base con tickets en posiciones elegidas
respecto de la ventana de 720 horas y verifica el contrato entero: conteos, agrupación por agente y por
categoría, tramos de aging, creados, resueltos y cancelados en ventana, la tasa por cohorte de creación, y
las dos medianas. Incluye los casos que el contrato define y que son fáciles de romper. Un ticket creado
fuera de la ventana pero resuelto adentro **sí** cuenta como resuelto, porque la métrica es por evento de
resolución y no por fecha de creación. Un ticket reabierto y vuelto a resolver cuenta **por su primera resolución**: en la base de prueba, su primera resolución cae fuera de la ventana y su segunda adentro, y no
cuenta, que es lo que evita inflar el número contando dos veces el mismo ticket.

*30-day window includes the exact cutoff and now, excludes just before the cutoff* ejercita el borde exacto
que DECISIONS.md §7 declara: `cutoff <= occurred_at <= now`, con un ticket 3.6 segundos antes del cutoff que
queda afuera y dos exactamente en los bordes que quedan adentro.

*null on empty, middle on odd, mean of two middles on even* cubre la función de mediana con cardinalidad
par e impar y con cohorte vacía.

### `auth.spec.ts` y `seed.spec.ts` — 8 tests

*redirects anonymous to /login* · *logs in with a seeded user and sets a signed httpOnly cookie* · *rejects
a tampered cookie* · *rejects an unknown user id* · *loginAs helper yields a usable cookie*.

*is idempotent: running twice keeps 4 users and 5 categories* · *enforces CHECK on role* · *DbModule boots
through Nest DI and seeds on init*. El tercero se agregó durante una revisión: el resto de los tests
construye la base directamente y esquiva el contenedor de inyección de dependencias, así que un ciclo de
imports dejó la aplicación sin poder arrancar **con la suite en verde**. Ese test arranca el módulo por el
camino real.

## 3. Qué no se probó, y por qué

- **Render de las vistas.** Es verificación visual y no se evalúa diseño. Un test de markup se rompe con
  cada cambio de maqueta sin detectar un solo bug de dominio. Se verifica en el recorrido manual.
- **Controllers que sólo delegan.** Un test ahí prueba que Nest enruta, no que el sistema hace lo correcto.
  Lo que sí se prueba de los controllers está en `authz.spec.ts`, por HTTP, donde el comportamiento es real.
- **Los filtros de la cola, uno por uno.** Son cláusulas `WHERE` directas. La combinación principal está
  cubierta por un test del servicio y la regla que importa —que un solicitante no pueda usarlos para ver
  algo ajeno— está cubierta por HTTP. El resto lo cubre el recorrido manual.
- **Carga, cross-browser, snapshots y mutation testing automatizado.** Fuera de alcance para v1. La
  verificación de mutación se hizo a mano (sección 4).
- **Concurrencia real.** No hay forma honesta de probarla con una conexión síncrona única; ver la sección
  siguiente, que es exactamente sobre eso.

## 4. Verificación de mutación

Un test que pasa no prueba nada hasta verlo fallar. Antes de dar por buenos los tests del núcleo rompí tres
invariantes a propósito, corrí las suites, confirmé el fallo y restauré. Las tres mutaciones fueron
atrapadas, y en dos de los tres casos por más tests de los previstos.

| # | Mutación | Qué la atrapó | Resultado |
|---|---|---|---|
| 1 | Permitir `cancel` desde `RESOLVED` en la tabla de transiciones | `state-machine.spec.ts`: *owner cannot cancel RESOLVED* (esperado) **y** *lists exactly the actions each actor can take*, porque la lista de botones pasó a incluir "cancelar" | 2 fallos de 28 |
| 2 | Comentar la escritura del evento dentro de `transition` | `tickets.service.spec.ts`: el test de ciclo de vida (esperaba 6 eventos, recibió 1), el de atomicidad, el conteo de eventos del conflicto de versión, y el de detalle | 4 fallos de 14 |
| 3 | Sacar `version` del `WHERE` del `UPDATE` **y** comentar el chequeo previo de versión | `tickets.service.spec.ts`: los tres tests de conflicto de versión. El segundo claim devolvía 400 "no se puede tomar un ticket en estado IN_PROGRESS" en vez de 409 | 3 fallos de 14 |

**Sonda 4, la que dio el resultado interesante.** Saqué `AND version = ?` del `WHERE` del `UPDATE` pero dejé
el chequeo previo intacto. **La suite quedó verde, 14 de 14.**

Eso no es un agujero de cobertura: es la medición de un límite del entorno de pruebas. Con una única
conexión síncrona de `better-sqlite3`, entre la lectura del ticket y su `UPDATE` no puede colarse otra
escritura, así que el chequeo previo intercepta todo conflicto y la cláusula del `WHERE` nunca llega a
activarse. Las dos defensas están, una está bajo prueba y la otra no puede estarlo acá. La cláusula se
mantiene a propósito, porque es la única que sigue sirviendo cuando haya varias conexiones o varios
procesos, y entonces sí va a ser verificable con tests de concurrencia real. Está declarada como tal en la
tabla de deuda técnica de DECISIONS.md.

Es el tipo de cosa que sólo aparece si uno rompe el código a propósito. Sin la sonda 4, los tres tests de
conflicto de versión en verde habrían pasado por evidencia de que ambas defensas funcionan.

Tras cada mutación se restauró el archivo y se verificó el árbol limpio. Estado final: 72 de 72.

**Una sonda más, sobre el contrato de métricas.** Al escribir la definición de la mediana de resolución
construí a mano el único camino por el que un ticket puede terminar `CANCELLED` habiendo tenido antes un
evento `RESOLVED`: resolver, reabrir y recién entonces cancelar. Ese ticket **sí** aporta su primera
resolución a la mediana y al conteo de resueltos, porque las cohortes se definen por el evento y no por el
estado actual. Es el comportamiento correcto —la resolución ocurrió de verdad— pero la frase de definición
que la pantalla mostraba al lado del número decía "excluye cancelados", que en ese camino es falso. Se
corrigió el texto de la pantalla para que diga lo que el número mide: *un ticket cancelado sin haberse
resuelto nunca entra*.

Sólo aparece si uno escribe la definición en una frase y la compara con el texto de la pantalla. Ese camino
no tiene un test automatizado propio, y es el candidato número uno a agregarlo.

## 5. Recorrido manual

El mismo recorrido de la demo del README, ejecutado de punta a punta contra el binario compilado
(`pnpm build` y `node dist/main.js`) sobre una base vacía. Resultado: **todo como se espera**.

| Paso | Resultado |
|---|---|
| Ana entra, abre el formulario, crea un ticket | 302 al detalle del ticket 1; detalle en `OPEN`, con evento `CREATED` y el botón "cancelar" |
| Carla entra y abre la cola | El ticket de Ana aparece con el filtro por defecto |
| Carla lo toma con `version=1` | 302 al detalle; pasa a `IN_PROGRESS` |
| Carla lo resuelve con `version=2` | 302 al detalle; historial con `CREATED`, `CLAIMED`, `RESOLVED` |
| Carla abre el dashboard | 200. "Resueltos: 1", y las dos medianas con su valor |
| **Ana pide `/dashboard`** | **403** con "No tenés permiso para esta acción." |
| **Dos pestañas, mismo claim** | Ambas leen `version=1`. La primera: 302. La segunda: **409** con "El ticket cambió mientras lo veías." y "Estado actual: IN_PROGRESS" |
| **Carrera entre dos agentes distintos** | Carla toma con `version=1`, Diego toma con `version=1`: **409** para Diego. El ticket queda asignado a Carla y el historial tiene **exactamente un** evento `CLAIMED` |

Además se revisó el log del servidor: cada rechazo dejó su línea de `WARN` con el código, la ruta, el
usuario y el motivo, incluidos el 403 de Ana y los dos 409. Ningún rechazo se traga en silencio, que es una
regla del proyecto y no se puede verificar desde el navegador.

**Lo que no se hizo:** ese mismo recorrido automatizado en un navegador con Playwright. Se dejó fuera de
alcance en favor de la cobertura HTTP con supertest, que es donde estaba el riesgo real (autorización,
precedencia de errores, el 409). El recorrido se validó a mano, de punta a punta, con los resultados de
arriba.

## 6. Cómo correr las verificaciones

```bash
pnpm test        # 72 tests, 6 suites
pnpm typecheck   # tsc --noEmit
pnpm build       # nest build
```

`pnpm test` corre contra SQLite en memoria y no toca `data/tickets.db`. Los dos primeros comandos deben
estar limpios antes de considerar cerrado cualquier cambio.
