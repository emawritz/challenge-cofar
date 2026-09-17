# Uso de IA

Este documento cuenta cómo se usó IA en este ejercicio, incluido lo que salió mal y lo que se descartó.
La sesión de diseño es parte del entregable, así que está registrada con el detalle suficiente para que se
pueda auditar quién propuso qué y quién decidió qué.

## 1. Herramientas

- **Claude Code (Fable 5.1)** — diseño del spec, escritura del plan, implementación y revisión. Es la
  herramienta principal.
- **Codex CLI** — segunda opinión independiente. Hizo una propuesta propia del modelo de datos sin ver la
  mía, y después tres rondas de revisión crítica del spec.
- **Skill de brainstorming** — obliga a tratar una decisión por mensaje en vez de aceptar un diseño
  completo de una sola respuesta. Es lo que hizo que cada decisión de este repositorio tenga un "por qué"
  discutido y no un "por qué" inventado después.

Usé dos modelos distintos a propósito. Un solo modelo revisándose a sí mismo confirma lo que ya escribió;
la mayor parte de los errores de diseño que aparecen abajo los encontró el modelo que no había escrito la
propuesta.

## 2. Cómo se estructuró el contexto

- **Spec** en `docs/superpowers/specs/2026-09-17-ticket-system-design.md`: modelo de datos, máquina de
  estados, matriz de autorización, contrato de métricas, estrategia de calidad y presupuesto de tiempo.
  Escrito y cerrado antes de la primera línea de código.
- **Plan** en `docs/superpowers/plans/2026-09-17-ticket-system.md`: el spec partido en tareas, cada una con
  sus archivos, sus interfaces explícitas (qué exporta, qué consume) y el código completo de lo que hay que
  escribir.
- **`CLAUDE.md`** en la raíz del repositorio, escrito antes del código: reglas inviolables del proyecto.
  Estados y transiciones permitidas, invariantes, la prohibición de un endpoint genérico de cambio de
  estado, la regla "toda mutación pasa por `TicketsService` y escribe un evento en la misma transacción",
  la precedencia de errores, y la política de tests. Ese archivo entra en el contexto de cada tarea, así
  que las reglas no dependen de que yo las repita.

La separación importa: el spec es la autoridad sobre qué se construye, el plan sobre cómo, y `CLAUDE.md`
sobre lo que no se puede romper en ninguna tarea. Cuando una tarea quiso apartarse de alguna de las tres,
hubo que decidirlo explícitamente y queda registrado.

## 3. Proceso de ejecución

1. Brainstorming, una decisión por mensaje, hasta cerrar el spec.
2. Tres rondas de revisión crítica de Codex sobre el spec, con correcciones antes de escribir código.
3. Plan con el código completo de cada tarea.
4. **Un subagente implementador nuevo por tarea**, sin el contexto de las tareas anteriores: recibe su
   encargo, el spec y `CLAUDE.md`. Que no arrastre contexto es deliberado: si una tarea sólo funciona
   porque el que la escribió recuerda una conversación de hace dos horas, el repositorio no es
   reproducible.
5. **Un revisor independiente por tarea**, también sin el contexto del implementador, que sólo ve el
   resultado y las reglas.
6. Cuando un hallazgo era real, un ciclo de corrección acotado y una re-revisión sobre el alcance del
   arreglo solamente.
7. Un registro de ejecución con cada hallazgo, la resolución tomada y el costo de equivocarse en esa
   resolución.

**Niveles de modelo, según el trabajo.** El modelo más barato para las tareas que son transcripción pura
(la máquina de estados, que es una tabla del spec pasada a TypeScript, y las re-revisiones acotadas). El
intermedio para la mayor parte de la implementación. El más capaz para lo que exige criterio y no
transcripción: la revisión del núcleo transaccional, la revisión de las métricas, y estos documentos. Usar
el modelo más caro en todo cuesta plata sin mejorar el resultado de copiar una tabla; usar el más barato en
la revisión de una transacción es donde se pierde un bug de atomicidad.

Resultado: un commit por tarea más los de corrección de revisión, 71 tests en 6 suites, `tsc --noEmit`
limpio, y `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm test`, `pnpm build` y el arranque del
servidor verificados desde un clone limpio.

## 4. Qué se delegó completo

- Scaffold del proyecto: `package.json`, `tsconfig`, configuración de Nest, `layout.hbs`.
- Schema de Drizzle y la migración generada.
- Vistas Handlebars.
- Los tests parametrizados de la máquina de estados, derivados directamente de la tabla de transiciones del
  spec: 24 combinaciones de estado, acción y actor con el motivo de rechazo esperado en cada una.

Todo eso es trabajo mecánico a partir de una especificación que ya estaba decidida. Es exactamente donde la
IA rinde y donde revisar la salida cuesta menos que escribirla.

## 5. Dónde intervine y por qué

**El modelo de datos: acepté un recorte, después de resistirlo.** Codex propuso el modelo completo, con
`version`, `sequence`, `payload` y `schema_version` en los eventos. Claude propuso recortar `version`,
`sequence` y `payload`. Mi primera decisión fue **mantener el modelo completo**: me pareció que el recorte
estaba optimizando líneas de código en vez de capacidad. En la segunda ronda Codex mantuvo `version` pero
descartó `sequence` (el `id` autoincrement ya ordena) y `schema_version` (no hay formato propio que
versionar mientras no haya `payload`), y acepté. En la tercera ronda descartó `payload` con el argumento de
que ningún evento de v1 tiene datos propios, y también acepté. El resultado es el de la sección 3 de
DECISIONS.md. Lo que cambió mi posición no fue la insistencia sino el argumento: "esto no sirve todavía" es
distinto de "esto es menos código".

**`CANCELLED` fue decisión mía.** No lo propuso ninguna de las dos herramientas; las dos habían llegado a
tres estados. Lo agregué porque cancelar y resolver son resultados distintos y meterlos en la misma bolsa
falsea la métrica de resolución. Lo había limitado a `OPEN`. Codex objetó que eso crea una carrera: si un
agente toma el ticket un segundo antes de que el solicitante lo cancele, la solicitud pasa a ser
irretirable. La objeción era correcta y **amplié `CANCELLED` a `IN_PROGRESS`**.

**Playwright, de obligatorio a stretch.** Lo había pedido como obligatorio. Codex objetó contra el time box
de 4-5 horas: un recorrido de navegador que no queda estable se come el presupuesto de los tests que sí
importan. Lo moví a stretch. Terminó no entrando, y está declarado en DECISIONS.md sección 10.

**Separar núcleo y stretch antes de implementar.** Claude estimó el trabajo en 330 minutos. Codex calificó
esa estimación de irreal (6,5 a 8 horas) y señaló el bloque de tests como el más subestimado. En vez de
empezar y ver qué pasaba, **recorté antes**: marqué cada punto del alcance como núcleo o stretch, con un
orden explícito de recorte y una lista de lo que no se recorta bajo ninguna circunstancia (flujo,
autorización, conflicto de versión, atomicidad de ticket más evento, documentos). Un presupuesto que se
descubre tarde se paga entregando la mitad de algo; uno que se recorta temprano se paga entregando menos
cosas, completas.

## 6. Qué salida se rechazó

**"Meter filtros en la cola sin llamarlos feature"** (propuesta de Claude). El spec declaraba búsqueda y
filtros como opcional descartado, y la propuesta era implementarlos igual sin contarlos como el opcional
elegido. Rechazado por inconsistente: o son una feature y se declaran, o no se construyen. Terminaron
siendo el segundo opcional elegido, declarado como tal.

**Comentarios como segundo opcional** (propuesta de Claude). Rechazado porque se aparta del problema
enunciado: el problema es que nadie sabe cuántas solicitudes hay ni cuánto demoran, y los comentarios no
contestan ninguna de esas dos preguntas. Además abren política de estados que la organización no definió.

**`sequence` y `schema_version`** (propuesta de Codex, descartados por Codex mismo en la segunda ronda).

**`payload` en los eventos** (propuesta de Codex, descartado en la tercera ronda).

**La primera versión del spec, en el orden de chequeo del flujo de transición.** Ver abajo.

## 7. Errores que las IA se encontraron entre sí

**Codex, ronda 3, sobre el spec de Claude:** el orden de chequeos del flujo de transición hacía imposible el
409 que el propio spec prometía. Con el chequeo de estado antes que el de versión, dos agentes tomando el
mismo ticket recibían un 400 "no se puede tomar un ticket en estado IN_PROGRESS" en vez de un 409. Es peor
que un código equivocado: le explica al usuario una regla usando datos que él nunca vio. Se corrigió en el
spec, antes de implementar, y hoy es la precedencia de errores de la sección 4 de DECISIONS.md, con tests
que la fijan.

**Codex, misma ronda:** el recorrido E2E propuesto verificaba una métrica del dashboard que no estaba
definida en el contrato de métricas. Un test que asegura algo que el sistema no promete es un test que va a
fallar o a mentir. Se corrigió el recorrido.

**Codex, sobre el contrato de métricas:** tramos de aging, cohortes y ventanas con bordes ambiguos. De ahí
salen las definiciones exactas de la sección 7 de DECISIONS.md (qué es "el primer evento de tipo T", si la
ventana incluye los extremos, qué se muestra con denominador cero) y los tests de límites exactos.

**Claude, en una prueba previa al plan:** `better-sqlite3@13` requiere Node ≥ 22 y hace segfault bajo Node
20, que es la versión fijada en `.nvmrc`. Apareció al ejecutarlo, no al leer la documentación. La
dependencia quedó pineada a 12.x y el lockfile resuelve 12.11.1.

## 8. Qué se encontró durante la implementación

Cada hallazgo con la tarea en la que apareció. Ninguno de estos es teórico: todos rompían algo.

**Tarea 2 — un ciclo de imports dejaba la aplicación sin arrancar.** `connection.ts` importaba
`SeedService` antes de definir el token `DB`, y `seed.ts` importaba `DB` de `connection.ts`. En tiempo de
decoración, `@Inject(DB)` recibía `undefined` y el módulo de base de datos no podía resolverse: la
aplicación no booteaba. Los tests existentes no lo detectaban porque construían la base directamente,
esquivando el contenedor de inyección de dependencias. Lo encontró el revisor de la tarea. Se arregló
extrayendo el token a `src/db/token.ts`, y —esto es lo importante— **se agregó un test que arranca el
módulo a través del contenedor real de Nest**, porque el problema no era el ciclo sino que ese camino no
tenía cobertura.

**Tarea 3 — `import * as hbs from 'hbs'` pasaba el typecheck y rompía en runtime.** Con
`esModuleInterop`, el espacio de nombres importado no exponía `registerHelper` al ejecutarse, y las cinco
pruebas de autenticación fallaban con un `TypeError`. El plan ya tenía previsto ese caso y su corrección
(`import hbs from 'hbs'`); se aplicó. Es un recordatorio de que un typecheck limpio no es una prueba de que
el programa corre.

**Tarea 6 — una categoría vacía pasaba la validación.** El `<select>` de categorías tiene una opción
placeholder vacía. `@Type(() => Number)` convierte `""` en `0`, y `@IsInt()` acepta `0`. El DTO pasaba
validación y el valor inválido llegaba al servicio, que devolvía una página de error genérica en vez de
re-renderizar el formulario con el mensaje al lado del campo. Lo encontró el revisor. Se agregó
`@Min(1)` al DTO **y una prueba HTTP** que manda `categoryId=''` y verifica que la respuesta es el
formulario con el mensaje, no la página de error.

**Tarea 7 — el dashboard mentía por vocabulario.** Dos de las tablas no llevaban su frase de definición, y
la página usaba "abiertos" arriba y "activos" abajo para exactamente el mismo conjunto de tickets. Un
número que alguien lee para decidir algo tiene que decir qué mide, y dos palabras distintas para lo mismo
en la misma pantalla es suficiente para que alguien concluya que son cosas distintas. Se unificó el
vocabulario y cada tabla tiene su definición.

**Tarea 8 — `Promise.all` para los logins rompía el arranque del servidor de pruebas.** Las diez pruebas de
autorización fallaban con `ECONNRESET`. El implementador aisló la causa en un archivo de prueba mínimo
antes de tocar nada: no era la aplicación sino supertest, que dispara el bind del servidor con la primera
request; cuatro requests concurrentes contra una instancia que todavía no terminó de escuchar compiten por
el mismo socket. Se pasó a logins secuenciales. Ningún valor esperado se tocó.

## 9. Qué se verificó a mano

**Recorridos con `curl`, tarea 6.** Login como Ana, creación del ticket, detalle con el evento `CREATED` y
el botón de cancelar, título de sólo espacios rechazado con 400 y el mensaje exacto, login como Carla,
ticket visible en la cola, `claim` con la versión correcta, `CLAIMED` en el historial, `resolve`, estado
`RESOLVED`. Después del arreglo del DTO, un segundo recorrido confirmó que `categoryId=''` devuelve 400
**con el formulario re-renderizado**, y no la página de error.

**Recorridos con `curl`, tarea 7.** Dashboard con 200 para Carla, con las etiquetas esperadas en el cuerpo,
y 403 para Ana. El 403 del guard de rol verificado sobre HTTP real, no con un mock.

**Verificación de mutación, tarea 12.** Rompí tres invariantes a propósito, corrí las pruebas, confirmé que
fallaban y restauré. Un test que pasa no prueba nada hasta verlo fallar. Las tres mutaciones fueron
atrapadas, y por más pruebas de las previstas en cada caso. Una cuarta sonda mostró que la cláusula
`AND version = ?` del `UPDATE` es redundante mientras haya una sola conexión síncrona. El detalle, con qué
prueba atrapó qué, está en QUALITY.md.

**Escritura de estos documentos.** Poner el contrato de métricas en una frase por número y compararlo con
el texto que muestra la pantalla destapó un caso que ninguna de las dos herramientas había visto y que
ningún test cubría: un ticket resuelto, reabierto y después cancelado aporta su primera resolución a la
mediana de resolución, mientras la pantalla decía "excluye cancelados". Construí el caso, lo medí y corregí
el texto de la pantalla. El número estaba bien; la etiqueta mentía. Escribir la documentación no fue el
último paso administrativo: fue la verificación que encontró el último error.
