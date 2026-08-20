import type { Database } from "sql.js";
import { DEFAULT_EVENT_COLOR, type EventColor } from "../core/model/event.js";
import { execToRecords } from "./events.repository.js";
import { getDb, persist } from "./sqlite.js";

export interface Calendar {
  readonly id: string;
  readonly name: string;
  readonly color: EventColor;
}

export interface CalendarInput {
  readonly name: string;
  readonly color?: EventColor;
}

function rowToCalendar(record: Record<string, unknown>): Calendar {
  return {
    id: record["id"] as string,
    name: record["name"] as string,
    color: (record["color"] as EventColor | null) ?? DEFAULT_EVENT_COLOR,
  };
}

// --- Funciones puras sobre una Database ya abierta (ver events.repository.ts). ---

export function insertCalendarRow(db: Database, input: CalendarInput): Calendar {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const color = input.color ?? DEFAULT_EVENT_COLOR;
  db.run("INSERT INTO calendars (id, name, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?)", [
    id,
    input.name,
    color,
    now,
    now,
  ]);
  return { id, name: input.name, color };
}

export function queryAllCalendars(db: Database): Calendar[] {
  const rows = execToRecords(db, "SELECT id, name, color FROM calendars ORDER BY created_at ASC", []);
  return rows.map(rowToCalendar);
}

export function updateCalendarRow(db: Database, id: string, input: CalendarInput): Calendar {
  const color = input.color ?? DEFAULT_EVENT_COLOR;
  db.run("UPDATE calendars SET name = ?, color = ?, updated_at = ? WHERE id = ?", [
    input.name,
    color,
    new Date().toISOString(),
    id,
  ]);
  return { id, name: input.name, color };
}

/**
 * Borra un calendario y todo lo que contiene (sus eventos y las excepciones
 * de esos eventos). Nunca deja la app sin ningún calendario -- si es el
 * único que queda, se rechaza en vez de dejar eventos futuros sin dónde
 * vivir.
 */
export function deleteCalendarRow(db: Database, id: string): void {
  const remaining = execToRecords(db, "SELECT COUNT(*) as n FROM calendars", []);
  const count = Number(remaining[0]?.["n"] ?? 0);
  if (count <= 1) {
    throw new Error("No se puede eliminar el único calendario que queda.");
  }
  db.run(
    "DELETE FROM event_exceptions WHERE master_event_id IN (SELECT id FROM events WHERE calendar_id = ?)",
    [id],
  );
  db.run("DELETE FROM events WHERE calendar_id = ?", [id]);
  db.run("DELETE FROM calendars WHERE id = ?", [id]);
}

// --- Envoltorios ligados al singleton del navegador (ver events.repository.ts). ---

export async function createCalendar(input: CalendarInput): Promise<Calendar> {
  const db = await getDb();
  const created = insertCalendarRow(db, input);
  await persist();
  return created;
}

export async function listCalendars(): Promise<Calendar[]> {
  const db = await getDb();
  return queryAllCalendars(db);
}

export async function updateCalendar(id: string, input: CalendarInput): Promise<Calendar> {
  const db = await getDb();
  const updated = updateCalendarRow(db, id, input);
  await persist();
  return updated;
}

export async function deleteCalendar(id: string): Promise<void> {
  const db = await getDb();
  deleteCalendarRow(db, id);
  await persist();
}
