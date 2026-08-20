import type { Database } from "sql.js";
import { wallTimeToUtcIso } from "../core/timezone/convert.js";
import { DEFAULT_EVENT_COLOR, type EventColor, type TimedEvent } from "../core/model/event.js";
import { getDb, persist } from "./sqlite.js";

export interface TimedEventInput {
  readonly title: string;
  readonly description?: string;
  readonly location?: string;
  readonly color?: EventColor;
  readonly startDate: string;
  readonly startTime: string;
  readonly endDate: string;
  readonly endTime: string;
  readonly tzId: string;
}

type SqlParam = string | number | null;

function execToRecords(db: Database, sql: string, params: readonly SqlParam[]): Record<string, unknown>[] {
  const result = db.exec(sql, params as SqlParam[]);
  if (result.length === 0 || result[0] === undefined) return [];
  const { columns, values } = result[0];
  return values.map((row) => {
    const record: Record<string, unknown> = {};
    columns.forEach((col, i) => {
      record[col] = row[i];
    });
    return record;
  });
}

function rowToTimedEvent(record: Record<string, unknown>): TimedEvent {
  return {
    kind: "timed",
    id: record["id"] as string,
    title: record["title"] as string,
    color: (record["color"] as EventColor | null) ?? DEFAULT_EVENT_COLOR,
    ...(record["description"] != null ? { description: record["description"] as string } : {}),
    ...(record["location"] != null ? { location: record["location"] as string } : {}),
    startDate: record["start_date"] as string,
    startTime: record["start_time"] as string,
    endDate: record["end_date"] as string,
    endTime: record["end_time"] as string,
    tzId: record["tz_id"] as string,
  };
}

function buildTimedEvent(id: string, event: TimedEventInput): TimedEvent {
  return {
    kind: "timed",
    id,
    title: event.title,
    color: event.color ?? DEFAULT_EVENT_COLOR,
    ...(event.description !== undefined ? { description: event.description } : {}),
    ...(event.location !== undefined ? { location: event.location } : {}),
    startDate: event.startDate,
    startTime: event.startTime,
    endDate: event.endDate,
    endTime: event.endTime,
    tzId: event.tzId,
  };
}

// --- Funciones puras sobre una Database ya abierta: sin IndexedDB ni
// asunciones de entorno navegador, así que se pueden testear directamente
// contra una base sql.js en memoria (ver db/events.repository.test.ts). ---

export function insertTimedEventRow(db: Database, event: TimedEventInput): TimedEvent {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const color = event.color ?? DEFAULT_EVENT_COLOR;
  const startUtc = wallTimeToUtcIso(event.startDate, event.startTime, event.tzId);
  const endUtc = wallTimeToUtcIso(event.endDate, event.endTime, event.tzId);

  db.run(
    `INSERT INTO events
      (id, kind, title, description, location, color, start_date, start_time, end_date, end_time, tz_id, start_utc, end_utc, created_at, updated_at)
     VALUES (?, 'timed', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      event.title,
      event.description ?? null,
      event.location ?? null,
      color,
      event.startDate,
      event.startTime,
      event.endDate,
      event.endTime,
      event.tzId,
      startUtc,
      endUtc,
      now,
      now,
    ],
  );

  return buildTimedEvent(id, event);
}

/** Eventos de hora absoluta que se solapan con [startUtc, endUtc). Sirve tanto para un día como para una semana o un mes -- el tamaño del rango lo decide quien llama. */
export function queryTimedEventsInRange(db: Database, startUtc: string, endUtc: string): TimedEvent[] {
  const rows = execToRecords(
    db,
    `SELECT id, title, description, location, color, start_date, start_time, end_date, end_time, tz_id
     FROM events
     WHERE kind = 'timed' AND start_utc < ? AND end_utc > ?
     ORDER BY start_utc ASC`,
    [endUtc, startUtc],
  );
  return rows.map(rowToTimedEvent);
}

export function queryTimedEventById(db: Database, id: string): TimedEvent | null {
  const rows = execToRecords(
    db,
    `SELECT id, title, description, location, color, start_date, start_time, end_date, end_time, tz_id
     FROM events WHERE id = ? AND kind = 'timed'`,
    [id],
  );
  return rows.length > 0 ? rowToTimedEvent(rows[0]!) : null;
}

export function updateTimedEventRow(db: Database, id: string, event: TimedEventInput): TimedEvent {
  const color = event.color ?? DEFAULT_EVENT_COLOR;
  const startUtc = wallTimeToUtcIso(event.startDate, event.startTime, event.tzId);
  const endUtc = wallTimeToUtcIso(event.endDate, event.endTime, event.tzId);
  const now = new Date().toISOString();

  db.run(
    `UPDATE events SET
       title = ?, description = ?, location = ?, color = ?,
       start_date = ?, start_time = ?, end_date = ?, end_time = ?, tz_id = ?,
       start_utc = ?, end_utc = ?, updated_at = ?
     WHERE id = ? AND kind = 'timed'`,
    [
      event.title,
      event.description ?? null,
      event.location ?? null,
      color,
      event.startDate,
      event.startTime,
      event.endDate,
      event.endTime,
      event.tzId,
      startUtc,
      endUtc,
      now,
      id,
    ],
  );

  return buildTimedEvent(id, event);
}

export function deleteEventRow(db: Database, id: string): void {
  db.run(`DELETE FROM events WHERE id = ?`, [id]);
}

// --- Envoltorios ligados al singleton del navegador (sql.js + IndexedDB). ---

export async function saveTimedEvent(event: TimedEventInput): Promise<TimedEvent> {
  const db = await getDb();
  const created = insertTimedEventRow(db, event);
  await persist();
  return created;
}

export async function listTimedEventsInRange(startUtc: string, endUtc: string): Promise<TimedEvent[]> {
  const db = await getDb();
  return queryTimedEventsInRange(db, startUtc, endUtc);
}

export async function updateTimedEvent(id: string, event: TimedEventInput): Promise<TimedEvent> {
  const db = await getDb();
  const updated = updateTimedEventRow(db, id, event);
  await persist();
  return updated;
}

export async function deleteEvent(id: string): Promise<void> {
  const db = await getDb();
  deleteEventRow(db, id);
  await persist();
}
