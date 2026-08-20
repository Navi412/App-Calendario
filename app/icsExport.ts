// Exportación a .ics (RFC 5545). Vive en /app (no en /core) porque su único
// consumidor es la descarga de archivo -- y porque necesita wallTimeToUtcIso
// para expresar el UNTIL de una regla de una serie "timed" en UTC, que es
// justo la conversión que CLAUDE.md reserva a la capa de presentación.
//
// Alcance deliberado: exporta el maestro de cada serie recurrente con su
// RRULE, pero NO las excepciones de instancia individual (mover/cancelar
// una ocurrencia) -- eso requeriría VEVENT de recurrencia con
// RECURRENCE-ID, que se deja fuera para no disparar el alcance de esta
// pasada.
import { wallTimeToUtcIso } from "../core/timezone/convert.js";
import type { RecurrenceRule } from "../core/recurrence/expandRecurrence.js";

export interface IcsExportableEvent {
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

const CRLF = "\r\n";

export function escapeIcsText(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

/** Pliegue de línea por octetos UTF-8 (RFC 5545 §3.1): ninguna línea de más de 75 octetos, continuación con CRLF + un espacio. */
export function foldIcsLine(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;

  const segments: string[] = [];
  let current = "";
  for (const char of line) {
    const candidate = current + char;
    if (encoder.encode(candidate).length > 74) {
      segments.push(current);
      current = char;
    } else {
      current = candidate;
    }
  }
  if (current) segments.push(current);
  return segments.join(CRLF + " ");
}

function icsDateTime(date: string, time: string): string {
  return `${date.replace(/-/g, "")}T${time.replace(/:/g, "")}`;
}

function icsDate(date: string): string {
  return date.replace(/-/g, "");
}

function icsUtcStamp(isoUtc: string): string {
  return `${isoUtc.replace(/[-:]/g, "").split(".")[0]}Z`;
}

function icsUtcNow(): string {
  return icsUtcStamp(new Date().toISOString());
}

function rruleToIcs(rule: RecurrenceRule, kind: IcsExportableEvent["kind"], tzId: string | undefined): string {
  const parts = [`FREQ=${rule.freq}`];
  if (rule.interval !== undefined) parts.push(`INTERVAL=${rule.interval}`);
  if (rule.count !== undefined) parts.push(`COUNT=${rule.count}`);
  if (rule.until !== undefined) {
    if (kind === "allday") {
      parts.push(`UNTIL=${icsDate(rule.until)}`);
    } else if (kind === "timed" && tzId) {
      parts.push(`UNTIL=${icsUtcStamp(wallTimeToUtcIso(rule.until, "23:59:59", tzId))}`);
    } else {
      // Flotante: sin zona real que convertir -- se guarda la hora de pared
      // tal cual con Z, aproximación razonable y reversible al importar.
      parts.push(`UNTIL=${icsDateTime(rule.until, "23:59:59")}Z`);
    }
  }
  if (rule.byMonthDay !== undefined) parts.push(`BYMONTHDAY=${rule.byMonthDay}`);
  return parts.join(";");
}

function eventToVevent(event: IcsExportableEvent): string {
  const lines: string[] = ["BEGIN:VEVENT", `UID:${event.id}@app-calendario`, `DTSTAMP:${icsUtcNow()}`];

  if (event.kind === "allday") {
    lines.push(`DTSTART;VALUE=DATE:${icsDate(event.startDate)}`);
    lines.push(`DTEND;VALUE=DATE:${icsDate(event.endDate)}`);
  } else if (event.kind === "timed" && event.tzId) {
    lines.push(`DTSTART;TZID=${event.tzId}:${icsDateTime(event.startDate, event.startTime ?? "00:00:00")}`);
    lines.push(`DTEND;TZID=${event.tzId}:${icsDateTime(event.endDate, event.endTime ?? "00:00:00")}`);
  } else {
    // Flotante: DATE-TIME sin TZID ni Z es "hora local flotante" según RFC 5545 §3.3.5 -- coincide exactamente con nuestro modelo.
    lines.push(`DTSTART:${icsDateTime(event.startDate, event.startTime ?? "00:00:00")}`);
    lines.push(`DTEND:${icsDateTime(event.endDate, event.endTime ?? "00:00:00")}`);
  }

  lines.push(`SUMMARY:${escapeIcsText(event.title)}`);
  if (event.description) lines.push(`DESCRIPTION:${escapeIcsText(event.description)}`);
  if (event.location) lines.push(`LOCATION:${escapeIcsText(event.location)}`);
  if (event.rrule) lines.push(`RRULE:${rruleToIcs(event.rrule, event.kind, event.tzId)}`);

  lines.push("END:VEVENT");
  return lines.map(foldIcsLine).join(CRLF);
}

export function serializeEventsToIcs(events: readonly IcsExportableEvent[], calendarName: string): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//App Calendario//ES",
    "CALSCALE:GREGORIAN",
    foldIcsLine(`X-WR-CALNAME:${escapeIcsText(calendarName)}`),
    ...events.map(eventToVevent),
    "END:VCALENDAR",
  ];
  return lines.join(CRLF) + CRLF;
}
