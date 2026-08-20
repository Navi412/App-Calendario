// Soporta los tres tipos de evento (timed/floating/allday, rebanadas 1-4),
// recurrencia caso feliz (rebanada 5), excepciones de instancia única
// (rebanada 6), "esta y las siguientes" (rebanada 7, sin tabla propia --
// ver DESIGN.md §1.3) y múltiples calendarios (rebanada 8). Ver DESIGN.md §1
// para el esquema completo.
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS calendars (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  color       TEXT NOT NULL DEFAULT 'blue',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id          TEXT PRIMARY KEY,
  calendar_id TEXT,
  kind        TEXT NOT NULL CHECK (kind IN ('timed', 'floating', 'allday')),
  title       TEXT NOT NULL,
  description TEXT,
  location    TEXT,
  color       TEXT NOT NULL DEFAULT 'blue',

  start_date  TEXT NOT NULL,
  start_time  TEXT,
  end_date    TEXT NOT NULL,
  end_time    TEXT,
  tz_id       TEXT,

  -- Derivado, no autoritativo: se recalcula en /core a partir de
  -- (start_date, start_time, tz_id). Solo existe para indexar por rango.
  start_utc   TEXT,
  end_utc     TEXT,

  rrule       TEXT,

  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_start_utc ON events (start_utc);
-- El índice de calendar_id NO va aquí: en una base ya existente de antes de
-- que existiera esa columna, CREATE TABLE IF NOT EXISTS no la añade y este
-- CREATE INDEX fallaría antes de que la migración en sqlite.ts tenga
-- ocasión de añadirla. Se crea allí, después de la migración.

-- Una fila por ocurrencia individual movida o cancelada de una serie
-- (DESIGN.md §1.2). original_start_date es la clave de coincidencia contra
-- la rrule original sin modificar -- equivalente a RECURRENCE-ID.
-- Sin new_start_utc/new_end_utc cacheados: a la escala de un calendario
-- personal, /core puede recalcularlos en cada expansión sin necesitar un
-- índice SQL aparte (ver DESIGN.md §2 paso 6 y core/recurrence/expandRecurrence.ts).
CREATE TABLE IF NOT EXISTS event_exceptions (
  id                  TEXT PRIMARY KEY,
  master_event_id     TEXT NOT NULL,
  original_start_date TEXT NOT NULL,
  status              TEXT NOT NULL CHECK (status IN ('cancelled', 'moved')),

  -- Presentes solo si status = 'moved':
  new_start_date      TEXT,
  new_start_time      TEXT,
  new_end_date        TEXT,
  new_end_time        TEXT,

  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_exceptions_master ON event_exceptions (master_event_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_exceptions_master_date ON event_exceptions (master_event_id, original_start_date);
`;
