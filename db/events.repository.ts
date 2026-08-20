import { wallTimeToUtcIso } from "../core/timezone/convert.js";
import type { TimedEvent } from "../core/model/event.js";
import { getDb, persist } from "./sqlite.js";

export interface NewTimedEvent {
  readonly title: string;
  readonly description?: string;
  readonly location?: string;
  readonly startDate: string;
  readonly startTime: string;
  readonly endDate: string;
  readonly endTime: string;
  readonly tzId: string;
}

export async function saveTimedEvent(event: NewTimedEvent): Promise<TimedEvent> {
  const db = await getDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const startUtc = wallTimeToUtcIso(event.startDate, event.startTime, event.tzId);
  const endUtc = wallTimeToUtcIso(event.endDate, event.endTime, event.tzId);

  db.run(
    `INSERT INTO events
      (id, kind, title, description, location, start_date, start_time, end_date, end_time, tz_id, start_utc, end_utc, created_at, updated_at)
     VALUES (?, 'timed', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      event.title,
      event.description ?? null,
      event.location ?? null,
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
  await persist();

  return {
    kind: "timed",
    id,
    title: event.title,
    ...(event.description !== undefined ? { description: event.description } : {}),
    ...(event.location !== undefined ? { location: event.location } : {}),
    startDate: event.startDate,
    startTime: event.startTime,
    endDate: event.endDate,
    endTime: event.endTime,
    tzId: event.tzId,
  };
}

/** Devuelve los eventos de hora absoluta que se solapan con [startUtc, endUtc). Sirve tanto para un día como para una semana o un mes -- el tamaño del rango lo decide quien llama. */
export async function listTimedEventsInRange(startUtc: string, endUtc: string): Promise<TimedEvent[]> {
  const db = await getDb();
  const result = db.exec(
    `SELECT id, title, description, location, start_date, start_time, end_date, end_time, tz_id
     FROM events
     WHERE kind = 'timed' AND start_utc < ? AND end_utc > ?
     ORDER BY start_utc ASC`,
    [endUtc, startUtc],
  );

  if (result.length === 0 || result[0] === undefined) return [];
  const { columns, values } = result[0];

  return values.map((row) => {
    const record: Record<string, unknown> = {};
    columns.forEach((col, i) => {
      record[col] = row[i];
    });
    const event: TimedEvent = {
      kind: "timed",
      id: record["id"] as string,
      title: record["title"] as string,
      ...(record["description"] != null ? { description: record["description"] as string } : {}),
      ...(record["location"] != null ? { location: record["location"] as string } : {}),
      startDate: record["start_date"] as string,
      startTime: record["start_time"] as string,
      endDate: record["end_date"] as string,
      endTime: record["end_time"] as string,
      tzId: record["tz_id"] as string,
    };
    return event;
  });
}
