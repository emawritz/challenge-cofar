# Sistema de tickets de soporte — v1

Aplicación web server-rendered para que una organización reciba solicitudes de soporte por un solo canal,
con estado y dueño visibles, historial de cada ticket y un dashboard de métricas para los agentes.
Corre local, en un proceso, sobre SQLite.

- [DECISIONS.md](DECISIONS.md) — modelo de datos, máquina de estados, alcance, límites y deuda asumida.
- [AI-USAGE.md](AI-USAGE.md) — cómo se usó IA en el diseño y en la implementación, y qué salidas se rechazaron.
- [ESTRATEGIA-DE-CALIDAD.md](ESTRATEGIA-DE-CALIDAD.md) — qué se probó, qué no, y cómo se verificó que los tests sirven.
- [docs/superpowers/](docs/superpowers/) — spec de diseño (`specs/`) y plan de implementación (`plans/`).

## Requisitos

- Node 20 (fijado en `.nvmrc`; `nvm use` lo toma). `better-sqlite3` está pineado a la 12.x porque la 13
  requiere Node ≥ 22 y segfaultea en 20.
- pnpm (el repo incluye `pnpm-lock.yaml`; usá `--frozen-lockfile` en checkout limpio).

## Instalación y arranque

```bash
nvm use
pnpm install
pnpm dev
```

Abrí `http://localhost:3000`. La raíz redirige a `/tickets`, pero el guard de sesión se aplica primero, así
que mientras no elegiste identidad caés directo en `/login`. El puerto se cambia con `PORT`.

El primer arranque crea la base, corre las migraciones de `drizzle/` y siembra usuarios y categorías.
El seed es idempotente: reiniciar no duplica usuarios ni borra tickets.

## Usuarios de demo

No hay contraseña. La pantalla de login es un selector de identidad simulada: elegís con quién entrar.

| id | Nombre | Rol | Qué puede hacer |
|---|---|---|---|
| 1 | Ana Pérez | REQUESTER | Crear tickets, ver los propios, cancelarlos, reabrir los propios resueltos |
| 2 | Bruno Díaz | REQUESTER | Lo mismo, sobre sus propios tickets |
| 3 | Carla Soto | AGENT | Ver la cola completa con filtros, tomar, resolver lo que tomó, reabrir lo que resolvió, ver el dashboard |
| 4 | Diego Ruiz | AGENT | Lo mismo |

## Base de datos

- Archivo: `data/tickets.db` (git-ignorado). Se cambia con la variable `DB_FILE`.
- Reset completo: `rm -rf data` y volver a arrancar. Se recrean esquema y seed, se pierden los tickets.

## Tests y tipos

```bash
pnpm test        # jest, 72 tests en 6 suites
pnpm typecheck   # tsc --noEmit
pnpm build       # nest build → dist/
```

## Recorrido de demo (5 minutos)

1. **Crear como solicitante.** `http://localhost:3000` → entrá como *Ana Pérez*. "Nuevo ticket", cargá título,
   descripción y categoría, y creá. Caés en el detalle del ticket: estado `OPEN`, sin asignado, historial con
   un evento `CREATED`.
2. **Ver la cola como agente.** "Salir" → entrá como *Carla Soto*. En `/tickets` ves la cola con filtros
   (estado, categoría, asignación, título contiene). El ticket de Ana aparece con el filtro por defecto,
   "Abiertos (OPEN + IN_PROGRESS)", más viejo primero.
3. **Tomar y resolver.** Abrí el ticket, "tomar" → `IN_PROGRESS` con Carla asignada. "resolver" → `RESOLVED`
   con fecha de resolución. El historial ahora muestra tres eventos: `CREATED`, `CLAIMED`, `RESOLVED`, cada uno
   con quién, cuándo, y de qué estado a cuál.
4. **Dashboard.** `/dashboard` (link en la barra, solo para agentes). Cada número lleva debajo la frase que
   dice qué mide exactamente: abiertos, sin tomar, quién los tiene, abiertos por categoría, edad desde
   creación por tramos, y la ventana de 30 días con creados, resueltos, cancelados, tasa de cancelación y las
   dos medianas. Después del paso 3 vas a ver que el bloque Resueltos muestra 1.
5. **Un 403.** "Salir" → entrá como *Ana Pérez* y pedí `http://localhost:3000/dashboard` a mano. Devuelve
   403 con "No tenés permiso para esta acción.". El link al dashboard ni siquiera se le muestra: el 403 lo
   pone el guard de rol, no la vista.
6. **Un 409.** Como Ana, creá un segundo ticket. Entrá como *Carla Soto* y abrí ese ticket en **dos pestañas**
   (las dos cargan el mismo número de versión oculto). Tomalo en la primera: queda `IN_PROGRESS`. Ahora tocá
   "tomar" en la segunda: devuelve 409 con "El ticket cambió mientras lo veías.", el estado actual y links al
   ticket y a la cola. Nada se pisó: el asignado sigue siendo quien ganó la carrera.

## Nota de seguridad

La identidad es simulada, no hay autenticación. La cookie de sesión va firmada con `SESSION_SECRET`, que
tiene un valor por defecto de desarrollo (`dev-only-secret`) si la variable no está seteada. Para cualquier
uso que no sea esta demo local hay que setearla y reemplazar el login por autenticación real.
