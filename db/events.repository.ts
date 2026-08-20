import type { Database } from "sql.js";
import { wallTimeToUtcIso } from "../core/timezone/convert.js";
import {
  DEFAULT_EVENT_COLOR,
  type AllDayEvent,
  type EventColor,
  type FloatingEvent,
  type TimedEvent,
} from "../core/model/event.js";
import {
  closeRuleBefore,
  expandTimedRecurrence,
  parseRecurrenceRule,
  serializeRecurrenceRule,
  type ExceptionStatus,
  type RecurrenceException,
  type RecurrenceRule,
} from "../core/recurrence/expandRecurrence.js";
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
  /** Si se indica, este evento es el maestro de una serie recurrente (ver DESIGN.md §6, rebanada 5). */
  readonly rrule?: RecurrenceRule;
}

export interface FloatingEventInput {
  readonly title: string;
  readonly description?: string;
  readonly location?: string;
  readonly color?: EventColor;
  readonly startDate: string;
  readonly startTime: string;
  readonly endDate: string;
  readonly endTime: string;
}

/** `endDate` es EXCLUSIVO (convención iCalendar) -- ver CLAUDE.md. */
export interface AllDayEventInput {
  readonly title: string;
  readonly description?: string;
  readonly location?: string;
  readonly color?: EventColor;
  readonly startDate: string;
  readonly endDate: string;
}

export type SqlParam = string | number | null;

export function execToRecords(db: Database, sql: string, params: readonly SqlParam[]): Record<string, unknown>[] {
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
    ...(record["rrule"] != null ? { isRecurring: true } : {}),
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
    ...(event.rrule !== undefined ? { isRecurring: true } : {}),
  };
}

function rowToFloatingEvent(record: Record<string, unknown>): FloatingEvent {
  return {
    kind: "floating",
    id: record["id"] as string,
    title: record["title"] as string,
    color: (record["color"] as EventColor | null) ?? DEFAULT_EVENT_COLOR,
    ...(record["description"] != null ? { description: record["description"] as string } : {}),
    ...(record["location"] != null ? { location: record["location"] as string } : {}),
    startDate: record["start_date"] as string,
    startTime: record["start_time"] as string,
    endDate: record["end_date"] as string,
    endTime: record["end_time"] as string,
  };
}

function buildFloatingEvent(id: string, event: FloatingEventInput): FloatingEvent {
  return {
    kind: "floating",
    id,
    title: event.title,
    color: event.color ?? DEFAULT_EVENT_COLOR,
    ...(event.description !== undefined ? { description: event.description } : {}),
    ...(event.location !== undefined ? { location: event.location } : {}),
    startDate: event.startDate,
    startTime: event.startTime,
    endDate: event.endDate,
    endTime: event.endTime,
  };
}

function rowToAllDayEvent(record: Record<string, unknown>): AllDayEvent {
  return {
    kind: "allday",
    id: record["id"] as string,
    title: record["title"] as string,
    color: (record["color"] as EventColor | null) ?? DEFAULT_EVENT_COLOR,
    ...(record["description"] != null ? { description: record["description"] as string } : {}),
    ...(record["location"] != null ? { location: record["location"] as string } : {}),
    startDate: record["start_date"] as string,
    endDate: record["end_date"] as string,
  };
}

function buildAllDayEvent(id: string, event: AllDayEventInput): AllDayEvent {
  return {
    kind: "allday",
    id,
    title: event.title,
    color: event.color ?? DEFAULT_EVENT_COLOR,
    ...(event.description !== undefined ? { description: event.description } : {}),
    ...(event.location !== undefined ? { location: event.location } : {}),
    startDate: event.startDate,
    endDate: event.endDate,
  };
}

// --- Funciones puras sobre una Database ya abierta: sin IndexedDB ni
// asunciones de entorno navegador, así que se pueden testear directamente
// contra una base sql.js en memoria (ver db/events.repository.test.ts). ---

export function insertTimedEventRow(db: Database, event: TimedEventInput, calendarId: string): TimedEvent {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const color = event.color ?? DEFAULT_EVENT_COLOR;
  const startUtc = wallTimeToUtcIso(event.startDate, event.startTime, event.tzId);
  const endUtc = wallTimeToUtcIso(event.endDate, event.endTime, event.tzId);
  const rrule = event.rrule !== undefined ? serializeRecurrenceRule(event.rrule) : null;

  db.run(
    `INSERT INTO events
      (id, calendar_id, kind, title, description, location, color, start_date, start_time, end_date, end_time, tz_id, start_utc, end_utc, rrule, created_at, updated_at)
     VALUES (?, ?, 'timed', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      calendarId,
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
      rrule,
      now,
      now,
    ],
  );

  return buildTimedEvent(id, event);
}

export type ExceptionInput =
  | { readonly masterEventId: string; readonly originalStartDate: string; readonly status: "cancelled" }
  | {
      readonly masterEventId: string;
      readonly originalStartDate: string;
      readonly status: "moved";
      readonly newStartDate: string;
      readonly newStartTime: string;
      readonly newEndDate: string;
      readonly newEndTime: string;
    };

function rowToRecurrenceException(record: Record<string, unknown>): RecurrenceException {
  const status = record["status"] as ExceptionStatus;
  return {
    id: record["id"] as string,
    originalStartDate: record["original_start_date"] as string,
    status,
    ...(status === "moved"
      ? {
          newStartDate: record["new_start_date"] as string,
          newStartTime: record["new_start_time"] as string,
          newEndDate: record["new_end_date"] as string,
          newEndTime: record["new_end_time"] as string,
        }
      : {}),
  };
}

/** Crea o reemplaza la excepción de una ocurrencia -- como mucho una fila por (maestro, fecha original), ver el índice único en schema.ts. */
export function upsertEventException(db: Database, input: ExceptionInput): void {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.run(
    `INSERT INTO event_exceptions
      (id, master_event_id, original_start_date, status, new_start_date, new_start_time, new_end_date, new_end_time, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (master_event_id, original_start_date) DO UPDATE SET
       status = excluded.status,
       new_start_date = excluded.new_start_date,
       new_start_time = excluded.new_start_time,
       new_end_date = excluded.new_end_date,
       new_end_time = excluded.new_end_time,
       updated_at = excluded.updated_at`,
    [
      id,
      input.masterEventId,
      input.originalStartDate,
      input.status,
      input.status === "moved" ? input.newStartDate : null,
      input.status === "moved" ? input.newStartTime : null,
      input.status === "moved" ? input.newEndDate : null,
      input.status === "moved" ? input.newEndTime : null,
      now,
      now,
    ],
  );
}

export function queryExceptionsForMaster(db: Database, masterEventId: string): RecurrenceException[] {
  const rows = execToRecords(
    db,
    `SELECT id, original_start_date, status, new_start_date, new_start_time, new_end_date, new_end_time
     FROM event_exceptions WHERE master_event_id = ?`,
    [masterEventId],
  );
  return rows.map(rowToRecurrenceException);
}

function requireRecurringTimedMasterRow(db: Database, id: string): Record<string, unknown> {
  const rows = execToRecords(
    db,
    `SELECT id, calendar_id, start_date, start_time, end_date, end_time, tz_id, rrule FROM events WHERE id = ? AND kind = 'timed'`,
    [id],
  );
  const row = rows[0];
  if (!row || row["rrule"] == null) {
    throw new Error(`No existe una serie recurrente de hora absoluta con id "${id}"`);
  }
  return row;
}

/**
 * "Eliminar esta y las siguientes" (DESIGN.md §1.3): cierra la serie en el
 * día anterior a `cutDate` sin abrir una nueva -- las ocurrencias antes del
 * corte sobreviven, las de `cutDate` en adelante dejan de existir. Cualquier
 * excepción de una ocurrencia ya descartada también se descarta.
 */
export function closeTimedSeriesAndDropFollowing(db: Database, masterEventId: string, cutDate: string): void {
  const row = requireRecurringTimedMasterRow(db, masterEventId);
  const closed = closeRuleBefore(parseRecurrenceRule(row["rrule"] as string), cutDate);
  db.run(`UPDATE events SET rrule = ?, updated_at = ? WHERE id = ?`, [
    serializeRecurrenceRule(closed),
    new Date().toISOString(),
    masterEventId,
  ]);
  db.run(`DELETE FROM event_exceptions WHERE master_event_id = ? AND original_start_date >= ?`, [masterEventId, cutDate]);
}

/**
 * "Editar esta y las siguientes" (DESIGN.md §1.3): cierra la serie original
 * en el día anterior a `cutDate` y abre una serie nueva desde `cutDate` con
 * los campos de `patch`, heredando la misma regla de recurrencia original
 * (mismo patrón, solo cambia dónde arranca). Las excepciones de ocurrencias
 * en o después de `cutDate` se reparentan a la nueva serie -- seguían
 * siendo del futuro, solo que ahora ese futuro pertenece a otra fila.
 */
export function splitTimedSeriesAtOccurrence(
  db: Database,
  masterEventId: string,
  cutDate: string,
  patch: TimedEventInput,
): TimedEvent {
  const row = requireRecurringTimedMasterRow(db, masterEventId);
  const originalRrule = parseRecurrenceRule(row["rrule"] as string);
  const closed = closeRuleBefore(originalRrule, cutDate);
  db.run(`UPDATE events SET rrule = ?, updated_at = ? WHERE id = ?`, [
    serializeRecurrenceRule(closed),
    new Date().toISOString(),
    masterEventId,
  ]);

  const newSeries = insertTimedEventRow(db, { ...patch, rrule: originalRrule }, row["calendar_id"] as string);

  db.run(`UPDATE event_exceptions SET master_event_id = ? WHERE master_event_id = ? AND original_start_date >= ?`, [
    newSeries.id,
    masterEventId,
    cutDate,
  ]);

  return newSeries;
}

/**
 * Eventos de hora absoluta que se solapan con [startUtc, endUtc): tanto
 * sueltos como ocurrencias generadas de series recurrentes, con sus
 * excepciones de instancia ya aplicadas (DESIGN.md §2). Sirve tanto para un
 * día como para una semana o un mes -- el tamaño del rango lo decide quien
 * llama.
 */
export function queryTimedEventsInRange(
  db: Database,
  startUtc: string,
  endUtc: string,
  calendarId: string,
): TimedEvent[] {
  const singleRows = execToRecords(
    db,
    `SELECT id, title, description, location, color, start_date, start_time, end_date, end_time, tz_id
     FROM events
     WHERE kind = 'timed' AND rrule IS NULL AND calendar_id = ? AND start_utc < ? AND end_utc > ?`,
    [calendarId, endUtc, startUtc],
  );

  const masterRows = execToRecords(
    db,
    `SELECT id, title, description, location, color, start_date, start_time, end_date, end_time, tz_id, rrule
     FROM events
     WHERE kind = 'timed' AND rrule IS NOT NULL AND calendar_id = ?`,
    [calendarId],
  );

  const withSortKey: { event: TimedEvent; sortUtc: string }[] = singleRows.map((row) => ({
    event: rowToTimedEvent(row),
    sortUtc: wallTimeToUtcIso(row["start_date"] as string, row["start_time"] as string, row["tz_id"] as string),
  }));

  for (const row of masterRows) {
    const master = rowToTimedEvent(row);
    const rrule = parseRecurrenceRule(row["rrule"] as string);
    const exceptions = queryExceptionsForMaster(db, master.id);
    const occurrences = expandTimedRecurrence(
      { startDate: master.startDate, startTime: master.startTime, endDate: master.endDate, endTime: master.endTime, tzId: master.tzId, rrule },
      startUtc,
      endUtc,
      exceptions,
    );
    for (const occurrence of occurrences) {
      withSortKey.push({
        event: {
          ...master,
          startDate: occurrence.startDate,
          startTime: occurrence.startTime,
          endDate: occurrence.endDate,
          endTime: occurrence.endTime,
        },
        sortUtc: occurrence.startUtc,
      });
    }
  }

  withSortKey.sort((a, b) => a.sortUtc.localeCompare(b.sortUtc));
  return withSortKey.map((w) => w.event);
}

export interface EventSearchResult {
  readonly id: string;
  readonly kind: "timed" | "floating" | "allday";
  readonly title: string;
  /** Para una serie recurrente, la fecha ancla (primera ocurrencia) -- no se expande la recurrencia para buscar. */
  readonly startDate: string;
}

/** Busca por título dentro de un calendario, entre sus eventos sueltos y maestros de serie (sin expandir recurrencia). */
export function searchEventsByTitle(db: Database, calendarId: string, query: string): EventSearchResult[] {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const rows = execToRecords(
    db,
    `SELECT id, kind, title, start_date FROM events WHERE calendar_id = ? AND title LIKE ? ORDER BY start_date ASC LIMIT 25`,
    [calendarId, `%${trimmed}%`],
  );
  return rows.map((r) => ({
    id: r["id"] as string,
    kind: r["kind"] as EventSearchResult["kind"],
    title: r["title"] as string,
    startDate: r["start_date"] as string,
  }));
}

/** Un evento tal cual está en la fila, de cualquier tipo, sin expandir recurrencia -- para exportar a .ics (ver app/icsExport.ts). */
export interface ExportableEvent {
  readonly id: string;
  readonly kind: "timed" | "floating" | "allday";
  readonly title: string;
  readonly description?: string;
  readonly location?: string;
  readonly startDate: string;
  readonly startTime?: string;
  readonly endDate: string;
  readonly endTime?: string;
  readonly tzId?: string;
  readonly rrule?: RecurrenceRule;
}

export function queryAllEventsForExport(db: Database, calendarId: string): ExportableEvent[] {
  const rows = execToRecords(
    db,
    `SELECT id, kind, title, description, location, start_date, start_time, end_date, end_time, tz_id, rrule
     FROM events WHERE calendar_id = ?`,
    [calendarId],
  );
  return rows.map((r) => ({
    id: r["id"] as string,
    kind: r["kind"] as ExportableEvent["kind"],
    title: r["title"] as string,
    ...(r["description"] != null ? { description: r["description"] as string } : {}),
    ...(r["location"] != null ? { location: r["location"] as string } : {}),
    startDate: r["start_date"] as string,
    ...(r["start_time"] != null ? { startTime: r["start_time"] as string } : {}),
    endDate: r["end_date"] as string,
    ...(r["end_time"] != null ? { endTime: r["end_time"] as string } : {}),
    ...(r["tz_id"] != null ? { tzId: r["tz_id"] as string } : {}),
    ...(r["rrule"] != null ? { rrule: parseRecurrenceRule(r["rrule"] as string) } : {}),
  }));
}

/** Estructuralmente igual a `ParsedIcsEvent` de app/icsImport.ts -- sin importarlo, /db no depende de /app (ver CLAUDE.md). */
export interface ImportableEvent {
  readonly kind: "timed" | "floating" | "allday";
  readonly title: string;
  readonly description?: string;
  readonly location?: string;
  readonly startDate: string;
  readonly startTime?: string;
  readonly endDate: string;
  readonly endTime?: string;
  readonly tzId?: string;
  readonly rrule?: RecurrenceRule;
}

/** Inserta de golpe los eventos parseados de un .ics en un calendario. Sin deduplicar: importar el mismo archivo dos veces duplica los eventos. */
export async function importEvents(events: readonly ImportableEvent[], calendarId: string): Promise<number> {
  const db = await getDb();
  for (const event of events) {
    const shared = {
      title: event.title,
      ...(event.description !== undefined ? { description: event.description } : {}),
      ...(event.location !== undefined ? { location: event.location } : {}),
    };
    if (event.kind === "allday") {
      insertAllDayEventRow(db, { ...shared, startDate: event.startDate, endDate: event.endDate }, calendarId);
    } else if (event.kind === "timed") {
      insertTimedEventRow(
        db,
        {
          ...shared,
          startDate: event.startDate,
          startTime: event.startTime as string,
          endDate: event.endDate,
          endTime: event.endTime as string,
          tzId: event.tzId as string,
          ...(event.rrule !== undefined ? { rrule: event.rrule } : {}),
        },
        calendarId,
      );
    } else {
      insertFloatingEventRow(
        db,
        {
          ...shared,
          startDate: event.startDate,
          startTime: event.startTime as string,
          endDate: event.endDate,
          endTime: event.endTime as string,
        },
        calendarId,
      );
    }
  }
  await persist();
  return events.length;
}

export async function listEventsForExport(calendarId: string): Promise<ExportableEvent[]> {
  const db = await getDb();
  return queryAllEventsForExport(db, calendarId);
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

/**
 * Actualiza un evento de hora absoluta suelto o el maestro de una serie.
 * `event.rrule` reemplaza la regla existente tal cual (undefined = sin
 * recurrencia) -- quien llama es responsable de conservarla si no quiere
 * cambiarla (ver eventEditModal.ts, que bloquea la edición de campos de una
 * serie para no perderla por accidente en esta rebanada).
 */
export function updateTimedEventRow(db: Database, id: string, event: TimedEventInput): TimedEvent {
  const color = event.color ?? DEFAULT_EVENT_COLOR;
  const startUtc = wallTimeToUtcIso(event.startDate, event.startTime, event.tzId);
  const endUtc = wallTimeToUtcIso(event.endDate, event.endTime, event.tzId);
  const rrule = event.rrule !== undefined ? serializeRecurrenceRule(event.rrule) : null;
  const now = new Date().toISOString();

  db.run(
    `UPDATE events SET
       title = ?, description = ?, location = ?, color = ?,
       start_date = ?, start_time = ?, end_date = ?, end_time = ?, tz_id = ?,
       start_utc = ?, end_utc = ?, rrule = ?, updated_at = ?
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
      rrule,
      now,
      id,
    ],
  );

  return buildTimedEvent(id, event);
}

export function deleteEventRow(db: Database, id: string): void {
  db.run(`DELETE FROM events WHERE id = ?`, [id]);
  db.run(`DELETE FROM event_exceptions WHERE master_event_id = ?`, [id]);
}

/**
 * Cambia solo el título -- de cualquier tipo de evento, suelto o serie
 * completa. Existe aparte de `update*EventRow` (que exigen reconstruir todo
 * el evento) para poder corregir un título de una serie recurrente sin
 * tener que tocar (y arriesgar perder) su rrule -- ver eventEditModal.ts.
 */
export function renameEventRow(db: Database, id: string, title: string): void {
  db.run(`UPDATE events SET title = ?, updated_at = ? WHERE id = ?`, [title, new Date().toISOString(), id]);
}

// --- Hora local flotante: sin tz_id ni start_utc/end_utc (ver CLAUDE.md, "la regla de oro"). ---

export function insertFloatingEventRow(db: Database, event: FloatingEventInput, calendarId: string): FloatingEvent {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const color = event.color ?? DEFAULT_EVENT_COLOR;

  db.run(
    `INSERT INTO events
      (id, calendar_id, kind, title, description, location, color, start_date, start_time, end_date, end_time, created_at, updated_at)
     VALUES (?, ?, 'floating', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      calendarId,
      event.title,
      event.description ?? null,
      event.location ?? null,
      color,
      event.startDate,
      event.startTime,
      event.endDate,
      event.endTime,
      now,
      now,
    ],
  );

  return buildFloatingEvent(id, event);
}

/**
 * Eventos flotantes cuyo rango de fecha de pared solapa [startDate, endDateExclusive).
 * Sin UTC de por medio -- no existe un instante único que filtrar (ver CLAUDE.md).
 * A diferencia de `endDate` en eventos de día completo, aquí `end_date` NO es
 * exclusivo (es la fecha de pared en que termina la hora de fin), así que la
 * comparación de solape usa `>=` y no `>`.
 */
export function queryFloatingEventsInRange(
  db: Database,
  startDate: string,
  endDateExclusive: string,
  calendarId: string,
): FloatingEvent[] {
  const rows = execToRecords(
    db,
    `SELECT id, title, description, location, color, start_date, start_time, end_date, end_time
     FROM events
     WHERE kind = 'floating' AND calendar_id = ? AND start_date < ? AND end_date >= ?
     ORDER BY start_date ASC, start_time ASC`,
    [calendarId, endDateExclusive, startDate],
  );
  return rows.map(rowToFloatingEvent);
}

export function updateFloatingEventRow(db: Database, id: string, event: FloatingEventInput): FloatingEvent {
  const color = event.color ?? DEFAULT_EVENT_COLOR;
  const now = new Date().toISOString();

  db.run(
    `UPDATE events SET
       title = ?, description = ?, location = ?, color = ?,
       start_date = ?, start_time = ?, end_date = ?, end_time = ?, updated_at = ?
     WHERE id = ? AND kind = 'floating'`,
    [event.title, event.description ?? null, event.location ?? null, color, event.startDate, event.startTime, event.endDate, event.endTime, now, id],
  );

  return buildFloatingEvent(id, event);
}

// --- Día completo: sin hora, tz_id ni start_utc/end_utc. `endDate` exclusivo. ---

export function insertAllDayEventRow(db: Database, event: AllDayEventInput, calendarId: string): AllDayEvent {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const color = event.color ?? DEFAULT_EVENT_COLOR;

  db.run(
    `INSERT INTO events
      (id, calendar_id, kind, title, description, location, color, start_date, end_date, created_at, updated_at)
     VALUES (?, ?, 'allday', ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, calendarId, event.title, event.description ?? null, event.location ?? null, color, event.startDate, event.endDate, now, now],
  );

  return buildAllDayEvent(id, event);
}

/** Eventos de día completo cuyo rango de fechas solapa [startDate, endDateExclusive), comparando solo fechas (sin hora ni zona). */
export function queryAllDayEventsInRange(
  db: Database,
  startDate: string,
  endDateExclusive: string,
  calendarId: string,
): AllDayEvent[] {
  const rows = execToRecords(
    db,
    `SELECT id, title, description, location, color, start_date, end_date
     FROM events
     WHERE kind = 'allday' AND calendar_id = ? AND start_date < ? AND end_date > ?
     ORDER BY start_date ASC`,
    [calendarId, endDateExclusive, startDate],
  );
  return rows.map(rowToAllDayEvent);
}

export function updateAllDayEventRow(db: Database, id: string, event: AllDayEventInput): AllDayEvent {
  const color = event.color ?? DEFAULT_EVENT_COLOR;
  const now = new Date().toISOString();

  db.run(
    `UPDATE events SET title = ?, description = ?, location = ?, color = ?, start_date = ?, end_date = ?, updated_at = ?
     WHERE id = ? AND kind = 'allday'`,
    [event.title, event.description ?? null, event.location ?? null, color, event.startDate, event.endDate, now, id],
  );

  return buildAllDayEvent(id, event);
}

// --- Envoltorios ligados al singleton del navegador (sql.js + IndexedDB). ---

export async function saveTimedEvent(event: TimedEventInput, calendarId: string): Promise<TimedEvent> {
  const db = await getDb();
  const created = insertTimedEventRow(db, event, calendarId);
  await persist();
  return created;
}

export async function listTimedEventsInRange(startUtc: string, endUtc: string, calendarId: string): Promise<TimedEvent[]> {
  const db = await getDb();
  return queryTimedEventsInRange(db, startUtc, endUtc, calendarId);
}

export async function searchEvents(calendarId: string, query: string): Promise<EventSearchResult[]> {
  const db = await getDb();
  return searchEventsByTitle(db, calendarId, query);
}

export async function updateTimedEvent(id: string, event: TimedEventInput): Promise<TimedEvent> {
  const db = await getDb();
  const updated = updateTimedEventRow(db, id, event);
  await persist();
  return updated;
}

export async function renameEvent(id: string, title: string): Promise<void> {
  const db = await getDb();
  renameEventRow(db, id, title);
  await persist();
}

export async function deleteEvent(id: string): Promise<void> {
  const db = await getDb();
  deleteEventRow(db, id);
  await persist();
}

/** Cancela una única ocurrencia de una serie recurrente, sin afectar a las demás (DESIGN.md §1.2). */
export async function cancelTimedOccurrence(masterEventId: string, originalStartDate: string): Promise<void> {
  const db = await getDb();
  upsertEventException(db, { masterEventId, originalStartDate, status: "cancelled" });
  await persist();
}

/** Mueve una única ocurrencia de una serie recurrente a otra fecha/hora, sin afectar a las demás (DESIGN.md §1.2). */
export async function moveTimedOccurrence(
  masterEventId: string,
  originalStartDate: string,
  newStartDate: string,
  newStartTime: string,
  newEndDate: string,
  newEndTime: string,
): Promise<void> {
  const db = await getDb();
  upsertEventException(db, {
    masterEventId,
    originalStartDate,
    status: "moved",
    newStartDate,
    newStartTime,
    newEndDate,
    newEndTime,
  });
  await persist();
}

/** "Eliminar esta y las siguientes" (DESIGN.md §1.3). */
export async function deleteTimedOccurrenceAndFollowing(masterEventId: string, cutDate: string): Promise<void> {
  const db = await getDb();
  closeTimedSeriesAndDropFollowing(db, masterEventId, cutDate);
  await persist();
}

/** "Editar esta y las siguientes" (DESIGN.md §1.3): parte la serie en dos y devuelve la nueva. */
export async function moveTimedOccurrenceAndFollowing(
  masterEventId: string,
  cutDate: string,
  patch: TimedEventInput,
): Promise<TimedEvent> {
  const db = await getDb();
  const created = splitTimedSeriesAtOccurrence(db, masterEventId, cutDate, patch);
  await persist();
  return created;
}

export async function saveFloatingEvent(event: FloatingEventInput, calendarId: string): Promise<FloatingEvent> {
  const db = await getDb();
  const created = insertFloatingEventRow(db, event, calendarId);
  await persist();
  return created;
}

export async function listFloatingEventsInRange(
  startDate: string,
  endDateExclusive: string,
  calendarId: string,
): Promise<FloatingEvent[]> {
  const db = await getDb();
  return queryFloatingEventsInRange(db, startDate, endDateExclusive, calendarId);
}

export async function updateFloatingEvent(id: string, event: FloatingEventInput): Promise<FloatingEvent> {
  const db = await getDb();
  const updated = updateFloatingEventRow(db, id, event);
  await persist();
  return updated;
}

export async function saveAllDayEvent(event: AllDayEventInput, calendarId: string): Promise<AllDayEvent> {
  const db = await getDb();
  const created = insertAllDayEventRow(db, event, calendarId);
  await persist();
  return created;
}

export async function listAllDayEventsInRange(
  startDate: string,
  endDateExclusive: string,
  calendarId: string,
): Promise<AllDayEvent[]> {
  const db = await getDb();
  return queryAllDayEventsInRange(db, startDate, endDateExclusive, calendarId);
}

export async function updateAllDayEvent(id: string, event: AllDayEventInput): Promise<AllDayEvent> {
  const db = await getDb();
  const updated = updateAllDayEventRow(db, id, event);
  await persist();
  return updated;
}
