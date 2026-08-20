import initSqlJs, { type Database } from "sql.js";
import { describe, expect, it } from "vitest";
import { bootstrapSchema } from "./sqlite.js";

// Esquema de una base "vieja", de antes de que existieran `calendars` y
// `events.calendar_id` (lo que ya tiene guardado un usuario real en su
// IndexedDB). bootstrapSchema debe poder ponerla al día sin romperse --
// justo el caso que un test contra una base sql.js siempre-nueva no puede
// atrapar, y donde se coló el bug real: un CREATE INDEX sobre calendar_id
// en SCHEMA_SQL que se ejecutaba ANTES de que la migración añadiera la
// columna.
const LEGACY_SCHEMA_SQL = `
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
  start_utc   TEXT,
  end_utc     TEXT,
  rrule       TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
`;

async function makeLegacyDb(): Promise<Database> {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run(LEGACY_SCHEMA_SQL);
  db.run(
    `INSERT INTO events (id, kind, title, start_date, end_date, created_at, updated_at)
     VALUES ('e1', 'allday', 'Evento viejo', '2024-01-01', '2024-01-02', '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')`,
  );
  return db;
}

describe("bootstrapSchema -- migración de una base sin calendar_id", () => {
  it("no lanza al poner al día una base creada antes de que existiera calendar_id", async () => {
    const db = await makeLegacyDb();
    expect(() => bootstrapSchema(db)).not.toThrow();
    db.close();
  });

  it("crea un calendario por defecto y reasigna a él los eventos ya existentes", async () => {
    const db = await makeLegacyDb();
    bootstrapSchema(db);

    const calendars = db.exec("SELECT id FROM calendars");
    const calendarId = calendars[0]?.values[0]?.[0] as string;
    expect(calendarId).toBeTruthy();

    const events = db.exec("SELECT calendar_id FROM events WHERE id = 'e1'");
    expect(events[0]?.values[0]?.[0]).toBe(calendarId);
    db.close();
  });

  it("es idempotente: aplicarla dos veces no falla ni duplica el calendario por defecto", async () => {
    const db = await makeLegacyDb();
    bootstrapSchema(db);
    bootstrapSchema(db);
    const calendars = db.exec("SELECT id FROM calendars");
    expect(calendars[0]?.values).toHaveLength(1);
    db.close();
  });
});
