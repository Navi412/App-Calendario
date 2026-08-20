// Esquema mínimo para la Rebanada 1: solo eventos de tipo 'timed', sin
// recurrencia ni excepciones todavía (eso llega en las rebanadas 5-7).
// Ver DESIGN.md §1 para el esquema completo objetivo.
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS events (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL CHECK (kind IN ('timed', 'floating', 'allday')),
  title       TEXT NOT NULL,
  description TEXT,
  location    TEXT,

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
`;
