// Importación desde .ics (RFC 5545). Alcance deliberado, simétrico al de
// icsExport.ts: lee SUMMARY/DESCRIPTION/LOCATION/DTSTART/DTEND/RRULE de
// cada VEVENT; ignora VALARM, VTIMEZONE, EXDATE y RECURRENCE-ID (overrides
// de instancia) -- un archivo con esas piezas se importa igual, solo pierde
// esa parte de fidelidad. Un VEVENT que no se puede interpretar se cuenta
// en `skipped` en vez de abortar la importación entera.
import { DateTime } from "luxon";
import { utcIsoToWallTime } from "../core/timezone/convert.js";
import type { RecurrenceFrequency, RecurrenceRule } from "../core/recurrence/expandRecurrence.js";

export interface ParsedIcsEvent {
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

export interface ParseIcsResult {
  readonly events: readonly ParsedIcsEvent[];
  readonly skipped: number;
}

const FREQUENCIES: readonly RecurrenceFrequency[] = ["DAILY", "WEEKLY", "MONTHLY", "YEARLY"];

function unfoldLines(text: string): string[] {
  const rawLines = text.split(/\r\n|\n|\r/);
  const lines: string[] = [];
  for (const line of rawLines) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && lines.length > 0) {
      lines[lines.length - 1] += line.slice(1);
    } else {
      lines.push(line);
    }
  }
  return lines;
}

function unescapeIcsText(text: string): string {
  return text.replace(/\\n/gi, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\");
}

interface IcsField {
  readonly params: Readonly<Record<string, string>>;
  readonly value: string;
}

/** Separa "NOMBRE;PARAM=X;PARAM2=Y:valor" en {name, params, value}. Sin ":" no es una línea de propiedad válida. */
function parseIcsLine(line: string): { name: string; field: IcsField } | null {
  const colonIndex = line.indexOf(":");
  if (colonIndex === -1) return null;
  const head = line.slice(0, colonIndex);
  const value = line.slice(colonIndex + 1);
  const [name, ...paramParts] = head.split(";");
  const params: Record<string, string> = {};
  for (const part of paramParts) {
    const [key, val] = part.split("=");
    if (key && val !== undefined) params[key.toUpperCase()] = val;
  }
  return { name: (name ?? "").toUpperCase(), field: { params, value } };
}

interface ParsedIcsDate {
  readonly kind: "timed" | "floating" | "allday";
  readonly date: string;
  readonly time?: string;
  readonly tzId?: string;
}

function parseIcsDateValue(field: IcsField, viewerTzId: string): ParsedIcsDate {
  const { value, params } = field;
  if (params["VALUE"] === "DATE" || /^\d{8}$/.test(value)) {
    return { kind: "allday", date: `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}` };
  }

  const date = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  const timePart = value.slice(9, 15);
  const time = `${timePart.slice(0, 2)}:${timePart.slice(2, 4)}:${timePart.slice(4, 6)}`;

  if (value.endsWith("Z")) {
    // Instante UTC real: se reinterpreta en la zona del visor para tener una tz IANA concreta que guardar (los eventos "timed" siempre necesitan una).
    const wall = utcIsoToWallTime(`${date}T${time}.000Z`, viewerTzId);
    return { kind: "timed", date: wall.date, time: wall.time, tzId: viewerTzId };
  }
  if (params["TZID"]) {
    return { kind: "timed", date, time, tzId: params["TZID"] };
  }
  return { kind: "floating", date, time };
}

/**
 * UNTIL puede venir como instante UTC real ("...Z", el caso normal para una
 * serie "timed") o como fecha/hora de pared suelta (series flotantes o de
 * día completo, que nunca pasan por UTC). Solo en el primer caso hay que
 * reconvertir a la zona propia del evento antes de quedarnos con la fecha
 * -- si no, un UNTIL a las 23:59:59 hora local que cruzó medianoche al
 * pasar por UTC en la exportación se leería un día tarde al importar.
 */
function parseIcsUntilToWallDate(value: string, kind: "timed" | "floating" | "allday", tzId: string | undefined): string {
  if (value.endsWith("Z") && kind === "timed" && tzId) {
    const datePart = value.slice(0, 8);
    const timePart = value.slice(9, 15);
    const isoUtc = `${datePart.slice(0, 4)}-${datePart.slice(4, 6)}-${datePart.slice(6, 8)}T${timePart.slice(0, 2)}:${timePart.slice(2, 4)}:${timePart.slice(4, 6)}.000Z`;
    return utcIsoToWallTime(isoUtc, tzId).date;
  }
  const date = value.slice(0, 8);
  return `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
}

function parseRruleValue(
  value: string,
  kind: "timed" | "floating" | "allday",
  tzId: string | undefined,
): RecurrenceRule | undefined {
  const fields = new Map(
    value.split(";").map((part) => {
      const [key, val] = part.split("=");
      return [(key ?? "").toUpperCase(), val ?? ""] as const;
    }),
  );
  const freq = fields.get("FREQ");
  if (!freq || !FREQUENCIES.includes(freq as RecurrenceFrequency)) return undefined;

  const interval = fields.get("INTERVAL");
  const count = fields.get("COUNT");
  const until = fields.get("UNTIL");
  const byMonthDay = fields.get("BYMONTHDAY");

  return {
    freq: freq as RecurrenceFrequency,
    ...(interval ? { interval: Number(interval) } : {}),
    ...(count ? { count: Number(count) } : {}),
    ...(until ? { until: parseIcsUntilToWallDate(until, kind, tzId) } : {}),
    // Si viene BYMONTHDAY=15,31 (varios días) solo nos quedamos con el
    // primero -- nuestro modelo de reglas no soporta una lista.
    ...(byMonthDay ? { byMonthDay: Number(byMonthDay.split(",")[0]) } : {}),
  };
}

function buildEventFromFields(fields: ReadonlyMap<string, IcsField>, viewerTzId: string): ParsedIcsEvent | null {
  const dtstartField = fields.get("DTSTART");
  if (!dtstartField) return null;
  const start = parseIcsDateValue(dtstartField, viewerTzId);

  const dtendField = fields.get("DTEND");
  const end = dtendField ? parseIcsDateValue(dtendField, viewerTzId) : null;

  const title = fields.get("SUMMARY") ? unescapeIcsText(fields.get("SUMMARY")!.value) : "(Sin título)";
  const descriptionField = fields.get("DESCRIPTION");
  const locationField = fields.get("LOCATION");
  const rruleField = fields.get("RRULE");

  const description = descriptionField ? unescapeIcsText(descriptionField.value) : undefined;
  const location = locationField ? unescapeIcsText(locationField.value) : undefined;
  const rrule = rruleField ? parseRruleValue(rruleField.value, start.kind, start.tzId) : undefined;

  if (start.kind === "allday") {
    // DTEND de un VEVENT de día completo ya es exclusivo en la propia RFC 5545 -- coincide con nuestra convención, sin conversión.
    const endDate = end?.date ?? (DateTime.fromISO(start.date).plus({ days: 1 }).toISODate() as string);
    return {
      kind: "allday",
      title,
      ...(description !== undefined ? { description } : {}),
      ...(location !== undefined ? { location } : {}),
      startDate: start.date,
      endDate,
      ...(rrule ? { rrule } : {}),
    };
  }

  const endDate = end?.date ?? start.date;
  const endTime = end?.time ?? start.time ?? "00:00:00";
  const startTime = start.time ?? "00:00:00";

  const base = {
    title,
    ...(description !== undefined ? { description } : {}),
    ...(location !== undefined ? { location } : {}),
    startDate: start.date,
    startTime,
    endDate,
    endTime,
    ...(rrule ? { rrule } : {}),
  };

  if (start.kind === "timed") {
    return { kind: "timed", ...base, tzId: start.tzId as string };
  }
  return { kind: "floating", ...base };
}

/** Puro: sin acceso a archivos ni a la base de datos, para poder probarlo con texto .ics fijo. */
export function parseIcs(text: string, viewerTzId: string): ParseIcsResult {
  const lines = unfoldLines(text);
  const events: ParsedIcsEvent[] = [];
  let skipped = 0;
  let current: Map<string, IcsField> | null = null;

  for (const rawLine of lines) {
    const parsed = parseIcsLine(rawLine);
    if (!parsed) continue;

    if (parsed.name === "BEGIN" && parsed.field.value === "VEVENT") {
      current = new Map();
      continue;
    }
    if (parsed.name === "END" && parsed.field.value === "VEVENT") {
      if (current) {
        try {
          const event = buildEventFromFields(current, viewerTzId);
          if (event) events.push(event);
          else skipped++;
        } catch {
          skipped++;
        }
      }
      current = null;
      continue;
    }
    current?.set(parsed.name, parsed.field);
  }

  return { events, skipped };
}
