# Documento de diseño

Este documento cubre las decisiones de diseño que condicionan todo lo demás. Nada de
esto está implementado todavía — es la base para discutir antes de escribir código.
Los puntos marcados **[A DISCUTIR]** son decisiones donde propongo una opción pero no
la doy por cerrada.

---

## 1. Esquema de base de datos

### 1.1 `events` — un registro por evento suelto o por serie maestra

```
id                  TEXT PK
calendar_id         TEXT FK        -- si hay multi-calendario; opcional en MVP
kind                TEXT           -- 'timed' | 'floating' | 'allday'
title               TEXT
description         TEXT NULL
location            TEXT NULL

-- Presentes solo si kind = 'timed':
start_date          TEXT NULL      -- 'YYYY-MM-DD', hora de pared
start_time          TEXT NULL      -- 'HH:mm:ss', hora de pared
end_date             TEXT NULL
end_time             TEXT NULL
tz_id               TEXT NULL      -- IANA, p.ej. 'America/New_York'

-- Presentes solo si kind = 'floating':
-- (reusa start_date/start_time/end_date/end_time; tz_id se queda NULL)

-- Presentes solo si kind = 'allday':
-- (reusa start_date/end_date; end_date es EXCLUSIVO, convención iCalendar;
--  start_time/end_time/tz_id se quedan NULL)

-- Derivado, cacheado, NO autoritativo — se recalcula al escribir:
start_utc           TEXT NULL      -- instante ISO UTC; NULL si kind='floating' o 'allday'
end_utc              TEXT NULL

-- Recurrencia (NULL si el evento no se repite):
rrule                TEXT NULL      -- string RFC5545, ej. 'FREQ=WEEKLY;BYDAY=MO,WE'

created_at, updated_at
```

`kind` determina qué columnas son válidas — se valida en `/core`, no se separan en tres
tablas para no complicar los JOINs de una vista de calendario que mezcla los tres tipos.
**[A DISCUTIR]**: si prefieres tres tablas separadas (más estricto a nivel de esquema,
pero une-y-ordena más costoso en cada query de rango visible) lo cambiamos; con
`CHECK` constraints por `kind` se puede recuperar bastante seguridad sin pagar el JOIN.

`start_utc`/`end_utc` solo existen para poder indexar y filtrar por rango en SQL
eficientemente. La fuente de verdad para expandir recurrencias siempre es
(hora de pared, tz_id), nunca estas columnas.

### 1.2 `event_exceptions` — una fila por ocurrencia individual modificada o cancelada

```
id                        TEXT PK
master_event_id           TEXT FK -> events.id
original_occurrence_date  TEXT     -- fecha (+hora si aplica) de la ocurrencia SEGÚN
                                    -- la rrule original, sin modificar. Es la clave de
                                    -- coincidencia durante la expansión (equivalente a
                                    -- RECURRENCE-ID en iCalendar).
status                    TEXT     -- 'cancelled' | 'moved'

-- Solo si status = 'moved' (NULL = hereda el valor del maestro):
new_start_date, new_start_time, new_end_date, new_end_time, new_tz_id   TEXT NULL
new_title, new_description, new_location                                TEXT NULL

-- Derivado, para poder encontrar instancias movidas fuera de su rango original:
new_start_utc, new_end_utc      TEXT NULL
```

Por qué una fila "sombra" con columnas y no un blob JSON de overrides: permite indexar
`new_start_utc` y encontrar instancias movidas cuyo horario nuevo cae dentro del rango
visible aunque su fecha *original* no caiga ahí (ver §2). **[A DISCUTIR]**: si el volumen
de campos editables por instancia va a crecer mucho (recordatorios, color, adjuntos...) un
JSON de overrides es más flexible a costa de perder esa indexación; para el MVP prefiero
columnas explícitas.

### 1.3 "Esta y las siguientes" — sin tabla propia

No se modela como un tercer tipo de excepción. Se resuelve con dos primitivas ya
existentes:

1. **Cerrar la serie original**: reescribir su `rrule` añadiendo/ajustando `UNTIL` al
   instante justo antes de la ocurrencia donde se hizo el corte.
2. **Abrir una serie nueva**: crear una fila nueva en `events` (nuevo `id`, nuevo
   `rrule` que arranca en la fecha de corte) con los campos editados.
3. **Reparentar excepciones futuras**: cualquier fila en `event_exceptions` cuyo
   `original_occurrence_date` sea posterior o igual al punto de corte se actualiza
   para apuntar a `master_event_id` = la nueva serie.

Es el mismo mecanismo, a grandes rasgos, que usa Google Calendar internamente. Evita
inventar un cuarto concepto en el esquema — "editar esta y las siguientes" se reduce a
"partir la serie en dos series normales".

---

## 2. Expansión de una recurrencia a un rango visible

Nunca se materializan las ocurrencias infinitas de una serie sin `COUNT`/`UNTIL`.
Algoritmo para pedir "dame las ocurrencias visibles entre A y B":

1. Cargar la fila maestra (`events`) y su `rrule`.
2. Construir el objeto `RRule` de la librería `rrule` anclado en el `dtstart` del
   maestro — pero operando en una representación **"UTC ingenua"**: se toman los
   componentes de hora de pared (año, mes, día, hora, minuto — sin zona) y se le
   pasan a `rrule` como si fueran UTC. `rrule` no entiende zonas IANA ni DST; solo
   sabe hacer aritmética de calendario sobre componentes. Este es el truco estándar
   (el mismo que usan `dateutil`/`zoneinfo` en Python o las guías oficiales de
   `rrule.js`) para separar "qué días/horas de pared toca la regla" de "a qué
   instante UTC corresponde cada una", que se resuelven en pasos distintos.
3. Llamar a `.between(A, B, inclusive)` con algo de margen (padding) a ambos lados
   de la ventana, para no perder eventos que empiezan antes de A pero siguen
   visibles dentro de A–B. `rrule.between` itera perezosamente y se detiene al pasar
   `B`, así que una regla infinita (sin `UNTIL`/`COUNT`) sigue siendo eficiente.
4. Por cada candidato (hora de pared "ingenua"), volver a adjuntarle el `tz_id` real
   del evento y usar Luxon para calcular su instante UTC concreto — aquí es donde se
   aplica correctamente el DST vigente *para esa fecha específica*, no un offset
   global de la serie.
5. Para cada candidato, buscar en `event_exceptions` una fila con
   `original_occurrence_date` igual a esa ocurrencia:
   - si `status = cancelled` → se omite.
   - si `status = moved` → se emite la versión sobreescrita (campos no-NULL de la
     excepción, el resto heredado del maestro).
   - si no hay excepción → se emite la ocurrencia generada normalmente.
6. **Caso borde importante**: una instancia movida puede haber salido de la ventana
   A–B en su fecha original, o haber entrado a la ventana en su fecha *nueva* aunque
   la original quede fuera. Por eso, además del paso 3–5, se hace una query aparte:
   `event_exceptions` con `status='moved' AND new_start_utc BETWEEN A' AND B'`
   (usando la columna derivada `new_start_utc` de §1.2), y se unen los resultados
   con deduplicado por `id` de excepción.
7. Los eventos sueltos (no recurrentes) de los tres tipos se consultan aparte con
   filtros de rango apropiados a cada uno: `timed`/`floating` por `start_utc`/rango de
   hora de pared, `allday` por solape de fechas puras (sin hora).

Esta expansión vive enteramente en `/core`; recibe la fila del evento y las
excepciones ya cargadas (sin tocar la base de datos ella misma) y devuelve una lista
de "ocurrencias materializadas" en el rango pedido. Eso es lo que la hace testeable
sin SQLite.

---

## 3. Recurrencia y horario de verano (DST)

Principio base: la ancla de una serie es (hora de pared, tz_id), nunca un delta UTC
fijo. Cada ocurrencia recalcula su instante UTC de forma independiente a partir de su
propia fecha — nunca sumando una duración fija al instante UTC de la ocurrencia
anterior. Consecuencia esperada y correcta: en la semana donde cambia el horario, el
salto entre dos ocurrencias consecutivas de una serie diaria no es exactamente 24h
(23h o 25h) en tiempo UTC real, aunque siga siendo "a las 9:00" en hora local. Esto
se cubre con un test explícito (ver CLAUDE.md).

Dos casos borde reales de DST que hay que decidir explícitamente, no solo dejar que
"pase lo que pase":

- **Hora de pared inexistente** (spring-forward): con el reloj saltando de 2:00 a
  3:00, una serie "todos los días a las 2:30" no tiene 2:30 ese día. Comportamiento
  propuesto: desplazar hacia adelante a la hora equivalente tras el salto (esa
  ocurrencia pasa a las 3:30 solo ese día) — es el comportamiento por defecto de
  Luxon al construir una hora de pared inválida, y coincide con lo que hacen la
  mayoría de calendarios (Google, Outlook). Alternativa: omitir esa ocurrencia ese
  día. **[A DISCUTIR]** — lo propongo como comportamiento por defecto pero es una
  decisión de producto, no solo técnica.
- **Hora de pared ambigua** (fall-back): con el reloj retrocediendo de 2:00 a 1:00,
  "todos los días a la 1:30" ocurre dos veces esa madrugada. Propuesto: quedarnos
  con la primera ocurrencia (el offset previo a la transición), de forma
  determinista. **[A DISCUTIR]** — no se expone como opción configurable en el MVP.
- Los eventos de **día completo** son inmunes a todo esto por construcción (no tienen
  componente de hora). Los **flotantes** también son inmunes en cuanto a
  almacenamiento — el cambio de horario solo afecta a cómo se recalculan al
  renderizar, y eso ya sale gratis de "la conversión solo ocurre en presentación".

---

## 4. "Cada día 31" en meses de 30 días (o febrero)

`rrule` (y RFC 5545, del que es implementación) define que `FREQ=MONTHLY;BYMONTHDAY=31`
simplemente **no genera ninguna ocurrencia** en los meses que no tienen día 31 — no
hace clamp al día 30 ni se corre al 1 del mes siguiente. Es un comportamiento de la
librería, no algo que implementemos nosotros; lo documentamos porque hay que decidir
qué hacer con él en la capa de producto:

- El motor (`/core`) hereda tal cual el comportamiento de `rrule`: meses sin día 31 →
  cero ocurrencias ese mes. No se intenta "arreglar".
- En la capa de presentación, al crear una regla `BYMONTHDAY=31`, se avisa al usuario
  ("este evento no ocurrirá en los meses con menos de 31 días") — igual que hacen
  Google Calendar y Outlook.
- Si lo que el usuario realmente quiere es "el último día del mes" (que si tiene
  sentido en todos los meses), eso es un patrón `BYMONTHDAY=-1` — distinto y ya
  soportado por RFC 5545/`rrule`. Se debería ofrecer como opción explícita en el
  selector de recurrencia ("día 31" vs "último día del mes"), en vez de intentar
  adivinar cuál de las dos quiso decir el usuario.

---

## 5. Disposición de eventos solapados (vista de día)

Algoritmo determinista de dos pasadas sobre un conjunto de intervalos ya expandidos
(salida de §2) para un único día. Vive en `/core`, es una función pura
`layout(intervals) -> { interval, column, totalColumns }[]`.

**Pasada 1 — agrupar y colorear:**
1. Ordenar los eventos por hora de inicio (empate: el de mayor duración primero, para
   que "contenga" visualmente al más corto).
2. Agrupar en *clusters* de colisión: componentes conexas del grafo de solape (no
   solo pares — si A solapa con B y B con C, los tres van al mismo cluster aunque A y
   C no se toquen directamente).
3. Dentro de cada cluster, asignar columnas por *greedy interval graph coloring*:
   recorriendo en orden de inicio, cada evento se coloca en la primera columna donde
   quepa sin chocar con lo ya colocado ahí; si no cabe en ninguna, se abre una
   columna nueva. Este método es óptimo para grafos de intervalos — el número de
   columnas resultante es el mínimo posible (igual al máximo de solapes
   simultáneos), es un resultado conocido de teoría de grafos, no una heurística.

**Pasada 2 — expandir a espacio libre:**
4. El ancho ingenuo (`anchoCluster / numColumnas`) desperdicia espacio cuando un
   evento no tiene nada compitiendo a su derecha en el resto de columnas durante
   toda su duración. Para cada evento, se calcula hasta qué columna puede expandirse
   hacia la derecha sin invadir un evento con el que sí solapa, y se le da ese ancho
   — es el efecto visual que se ve en Google Calendar (columnas que "respiran" en
   vez de franjas iguales fijas).

Casos que fuerzan el diseño de la función y quedan como tests obligatorios (ver
CLAUDE.md): contención total (un evento corto dentro de uno largo), inicio idéntico,
back-to-back sin solape real (no deberían compartir cluster), y eventos de duración
cero (recordatorios puntuales).

Los eventos de día completo **no** entran en este algoritmo — viven en una franja
separada encima de la rejilla horaria, con su propia lógica de apilado (más simple:
solo se preocupa de solapes de fecha, no de minutos).

---

## 6. Plan de rebanadas verticales

Cada rebanada toca `/core` + `/db` + `/app` y termina en algo demostrable, no en una
capa aislada. El orden está pensado para que cada una dependa solo de las anteriores.

| # | Rebanada | Qué prueba |
|---|----------|------------|
| 0 | Andamiaje: proyecto TS, SQLite vacío, test runner corriendo | Que el pipeline existe |
| 1 | Crear y ver **un** evento suelto de hora absoluta, vista de día sin solapes | El pipeline completo: hora de pared+tz → UTC → SQLite → render, de punta a punta |
| 2 | Eventos de hora absoluta **solapados** en vista de día | El algoritmo de disposición (§5) aislado y testeado |
| 3 | Eventos de **día completo** | El segundo tipo de evento y su franja separada |
| 4 | Eventos de **hora local flotante** | El tercer tipo de evento; recalcular contra la zona del visor en presentación |
| 5 | **Recurrencia**, caso feliz (sin excepciones) | Expansión con `rrule` + truco DST (§2, §3) contra un rango visible |
| 6 | **Excepciones de instancia única**: borrar una, mover una | `event_exceptions`, doble indexado original/nuevo (§1.2, §2 paso 6) |
| 7 | **"Esta y las siguientes"** | Partición de serie (§1.3) |
| 8 (futuro) | Multi-día, vista de semana/mes, múltiples calendarios, búsqueda | Fuera del alcance del MVP — reutiliza los mismos primitivos de `/core` |

Cada rebanada de la 1 a la 7 solo empieza su parte de UI cuando la lógica nueva de
`/core` que necesita ya tiene sus tests, según la regla de CLAUDE.md.

---

## Resumen de puntos a discutir

1. Luxon vs Temporal.
2. Arquitectura de despliegue: ¿SQLite corriendo enteramente en el navegador (WASM +
   OPFS, sin backend) o un backend delgado con SQLite en disco? Condiciona cómo se ve
   `/db` pero no toca `/core`.
3. `event_exceptions` como fila-sombra con columnas explícitas vs. JSON de overrides.
4. Comportamiento en hora de pared inexistente (spring-forward): desplazar vs. omitir.
5. Comportamiento en hora de pared ambigua (fall-back): quedarse con la primera
   ocurrencia, sin exponerlo como opción todavía.
6. `events` como tabla única con `kind` + columnas nullable vs. tres tablas separadas
   por tipo.
