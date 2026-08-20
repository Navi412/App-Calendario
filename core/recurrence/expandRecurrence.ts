// Expansión de series recurrentes de hora absoluta a un rango visible.
// Ver DESIGN.md §2 (algoritmo), §3 (DST) y §1.2 (excepciones de instancia).
//
// Solo eventos `timed`: son los únicos donde la recurrencia + DST interactúan
// de forma no trivial (DESIGN.md §3 -- floating/allday son inmunes por
// construcción, así que no hay nada especial que expandir para ellos aquí).

import { DateTime } from "luxon";
import { RRule, type Options as RRuleOptions } from "rrule";
import type { IanaTzId, IsoDate, IsoTime } from "../model/event.js";
import { utcIsoToWallTime, wallTimeToUtcIso, type WallTime } from "../timezone/convert.js";

export type RecurrenceFrequency = "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";

export interface RecurrenceRule {
  readonly freq: RecurrenceFrequency;
  /** Cada cuántas unidades de `freq` (2 = "cada dos semanas"). Por defecto 1. */
  readonly interval?: number;
  /** Fecha de pared del maestro, inclusive, en que deja de repetirse. Sin fin si se omite (junto con `count`). */
  readonly until?: IsoDate;
  /** Número total de ocurrencias, alternativa a `until`. */
  readonly count?: number;
  /**
   * Solo para `freq: "MONTHLY"`. Días sin ese número de mes generan cero
   * ocurrencias ese mes -- comportamiento de rrule/RFC5545, no un bug (ver
   * DESIGN.md §4). No hace clamp al último día ni se corre de mes.
   */
  readonly byMonthDay?: number;
}

export interface RecurringTimedSeries {
  readonly startDate: IsoDate;
  readonly startTime: IsoTime;
  readonly endDate: IsoDate;
  readonly endTime: IsoTime;
  readonly tzId: IanaTzId;
  readonly rrule: RecurrenceRule;
}

export interface TimedOccurrence {
  readonly startDate: IsoDate;
  readonly startTime: IsoTime;
  readonly endDate: IsoDate;
  readonly endTime: IsoTime;
  readonly startUtc: string;
  readonly endUtc: string;
}

export type ExceptionStatus = "cancelled" | "moved";

/**
 * Una fila-sombra de `event_exceptions` (DESIGN.md §1.2) ya cargada, para
 * una sola ocurrencia de una serie. `originalStartDate` es la fecha de
 * pared que esa ocurrencia tendría según la rrule original, sin modificar
 * -- es la clave de coincidencia contra los candidatos que genera rrule
 * (equivalente a RECURRENCE-ID en iCalendar). Como el modelo de reglas de
 * esta app no soporta más de una ocurrencia por día de calendario, la fecha
 * sola basta como clave.
 */
export interface RecurrenceException {
  readonly id: string;
  readonly originalStartDate: IsoDate;
  readonly status: ExceptionStatus;
  /** Presentes solo si `status === "moved"`. */
  readonly newStartDate?: IsoDate;
  readonly newStartTime?: IsoTime;
  readonly newEndDate?: IsoDate;
  readonly newEndTime?: IsoTime;
}

const FREQUENCIES: readonly RecurrenceFrequency[] = ["DAILY", "WEEKLY", "MONTHLY", "YEARLY"];

/** Serializa a texto en el mismo estilo que RFC5545 (DESIGN.md §1.1: `rrule TEXT`), ej. `FREQ=WEEKLY;INTERVAL=2;UNTIL=2024-06-12`. */
export function serializeRecurrenceRule(rule: RecurrenceRule): string {
  const parts = [`FREQ=${rule.freq}`];
  if (rule.interval !== undefined) parts.push(`INTERVAL=${rule.interval}`);
  if (rule.until !== undefined) parts.push(`UNTIL=${rule.until}`);
  if (rule.count !== undefined) parts.push(`COUNT=${rule.count}`);
  if (rule.byMonthDay !== undefined) parts.push(`BYMONTHDAY=${rule.byMonthDay}`);
  return parts.join(";");
}

/**
 * "Esta y las siguientes" (DESIGN.md §1.3): cierra una regla para que su
 * última ocurrencia sea el día anterior a `cutDate` -- la serie original
 * pasa a representar solo "antes del corte". Quien llama crea aparte una
 * serie nueva que arranca en `cutDate` con la misma regla (y los campos
 * editados) para representar "desde el corte en adelante"; no hay tabla
 * propia para este mecanismo, es la partición de una serie en dos series
 * normales (mismo truco que usa Google Calendar internamente).
 *
 * Si la regla original tenía `count` (número fijo de ocurrencias), se
 * descarta a favor de `until`: tras partir la serie, ya no hay forma de
 * saber cuántas de esas ocurrencias caían antes del corte sin volver a
 * expandir toda la serie, y `until` expresa exactamente lo que queremos
 * decir ("hasta aquí, no importa cuántas fueron").
 */
export function closeRuleBefore(rule: RecurrenceRule, cutDate: IsoDate): RecurrenceRule {
  const dayBefore = DateTime.fromISO(cutDate).minus({ days: 1 }).toFormat("yyyy-MM-dd");
  const { count: _count, ...rest } = rule;
  return { ...rest, until: dayBefore };
}

export function parseRecurrenceRule(text: string): RecurrenceRule {
  const fields = new Map(
    text.split(";").map((part) => {
      const [key, value] = part.split("=");
      return [key ?? "", value ?? ""] as const;
    }),
  );

  const freq = fields.get("FREQ");
  if (!freq || !FREQUENCIES.includes(freq as RecurrenceFrequency)) {
    throw new Error(`Regla de recurrencia inválida, falta FREQ reconocido: "${text}"`);
  }

  const interval = fields.get("INTERVAL");
  const until = fields.get("UNTIL");
  const count = fields.get("COUNT");
  const byMonthDay = fields.get("BYMONTHDAY");

  return {
    freq: freq as RecurrenceFrequency,
    ...(interval !== undefined ? { interval: Number(interval) } : {}),
    ...(until !== undefined ? { until } : {}),
    ...(count !== undefined ? { count: Number(count) } : {}),
    ...(byMonthDay !== undefined ? { byMonthDay: Number(byMonthDay) } : {}),
  };
}

const RRULE_FREQ: Record<RecurrenceFrequency, number> = {
  DAILY: RRule.DAILY,
  WEEKLY: RRule.WEEKLY,
  MONTHLY: RRule.MONTHLY,
  YEARLY: RRule.YEARLY,
};

/**
 * "Trico UTC ingenua" (DESIGN.md §2 paso 2): se toman los componentes de
 * hora de pared tal cual y se etiquetan como UTC para que rrule (que no
 * entiende zonas IANA) haga aritmética de calendario pura sobre ellos, sin
 * que el "zone" real de la serie ni el del entorno de ejecución interfieran.
 */
function wallToNaiveUtcDate(date: IsoDate, time: IsoTime): Date {
  const [y, mo, d] = date.split("-").map(Number) as [number, number, number];
  const [h, mi, s] = time.split(":").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, mo - 1, d, h, mi, s));
}

function naiveUtcDateToWall(d: Date): WallTime {
  const dt = DateTime.fromJSDate(d, { zone: "utc" });
  return { date: dt.toFormat("yyyy-MM-dd"), time: dt.toFormat("HH:mm:ss") };
}

/** Ocurrencia normal más su excepción aplicada, o null si está cancelada. Función pura, sin acceso a BD (ver DESIGN.md §2). */
function applyException(
  startWall: WallTime,
  endWall: WallTime,
  exception: RecurrenceException | undefined,
): { startWall: WallTime; endWall: WallTime } | null {
  if (!exception) return { startWall, endWall };
  if (exception.status === "cancelled") return null;
  // status === "moved": todos los campos new* están presentes por invariante de quien construye la excepción.
  return {
    startWall: { date: exception.newStartDate as string, time: exception.newStartTime as string },
    endWall: { date: exception.newEndDate as string, time: exception.newEndTime as string },
  };
}

/**
 * Ocurrencias de una serie de hora absoluta visibles en [rangeStartUtc, rangeEndUtc).
 * Cada ocurrencia recalcula su instante UTC de forma independiente a partir
 * de su propia fecha de pared (DESIGN.md §3): el salto de horario de verano
 * de una semana concreta no desplaza a las demás ocurrencias de la serie.
 *
 * `exceptions` ya viene cargada por quien llama (DESIGN.md §2: esta función
 * no toca la base de datos). Las canceladas se omiten; las movidas emiten
 * su versión sobreescrita -- incluyendo las que se movieron DESDE fuera del
 * rango pedido pero cuyo nuevo horario cae dentro (DESIGN.md §2 paso 6).
 */
export function expandTimedRecurrence(
  series: RecurringTimedSeries,
  rangeStartUtc: string,
  rangeEndUtc: string,
  exceptions: readonly RecurrenceException[] = [],
): TimedOccurrence[] {
  const dtstart = wallToNaiveUtcDate(series.startDate, series.startTime);
  const naiveDurationMs = wallToNaiveUtcDate(series.endDate, series.endTime).getTime() - dtstart.getTime();

  const options: Partial<RRuleOptions> = {
    freq: RRULE_FREQ[series.rrule.freq],
    interval: series.rrule.interval ?? 1,
    dtstart,
  };
  if (series.rrule.until !== undefined) {
    // UNTIL es inclusivo hasta el final del día de pared indicado.
    options.until = wallToNaiveUtcDate(series.rrule.until, "23:59:59");
  }
  if (series.rrule.count !== undefined) {
    options.count = series.rrule.count;
  }
  if (series.rrule.byMonthDay !== undefined) {
    options.bymonthday = series.rrule.byMonthDay;
  }
  const rule = new RRule(options);

  // Margen de 1 día de pared (en la zona de la serie) a cada lado del rango
  // real, para no perder ocurrencias que empiezan cerca del borde antes de
  // filtrar por instante UTC real (DESIGN.md §2 paso 3).
  const rangeStartWall = utcIsoToWallTime(rangeStartUtc, series.tzId);
  const rangeEndWall = utcIsoToWallTime(rangeEndUtc, series.tzId);
  const paddedStart = DateTime.fromJSDate(wallToNaiveUtcDate(rangeStartWall.date, "00:00:00"), { zone: "utc" })
    .minus({ days: 1 })
    .toJSDate();
  const paddedEnd = DateTime.fromJSDate(wallToNaiveUtcDate(rangeEndWall.date, "00:00:00"), { zone: "utc" })
    .plus({ days: 1 })
    .toJSDate();

  const candidates = rule.between(paddedStart, paddedEnd, true);
  const exceptionsByDate = new Map(exceptions.map((e) => [e.originalStartDate, e]));

  const occurrences: TimedOccurrence[] = [];
  const emittedExceptionIds = new Set<string>();

  for (const candidate of candidates) {
    const naiveStartWall = naiveUtcDateToWall(candidate);
    const naiveEndWall = naiveUtcDateToWall(new Date(candidate.getTime() + naiveDurationMs));
    const exception = exceptionsByDate.get(naiveStartWall.date);

    const applied = applyException(naiveStartWall, naiveEndWall, exception);
    if (applied === null) continue; // cancelada

    // Paso 4: se reconecta el tz_id real y se recalcula el UTC por separado
    // para cada ocurrencia -- aquí es donde el DST vigente en ESA fecha
    // concreta se aplica, no un offset global de la serie.
    const startUtc = wallTimeToUtcIso(applied.startWall.date, applied.startWall.time, series.tzId);
    const endUtc = wallTimeToUtcIso(applied.endWall.date, applied.endWall.time, series.tzId);
    if (startUtc < rangeEndUtc && endUtc > rangeStartUtc) {
      if (exception) emittedExceptionIds.add(exception.id);
      occurrences.push({
        startDate: applied.startWall.date,
        startTime: applied.startWall.time,
        endDate: applied.endWall.date,
        endTime: applied.endWall.time,
        startUtc,
        endUtc,
      });
    }
  }

  // Paso 6: instancias movidas cuya fecha ORIGINAL cae fuera de la ventana
  // rrule.between() de arriba (por eso rule nunca generó ese candidato) pero
  // cuyo nuevo horario sí es visible. Deduplicado por id de excepción con lo
  // ya emitido arriba, para el caso (más común) en que origen y destino caen
  // ambos dentro del mismo rango.
  for (const exception of exceptions) {
    if (exception.status !== "moved" || emittedExceptionIds.has(exception.id)) continue;
    const startUtc = wallTimeToUtcIso(exception.newStartDate as string, exception.newStartTime as string, series.tzId);
    const endUtc = wallTimeToUtcIso(exception.newEndDate as string, exception.newEndTime as string, series.tzId);
    if (startUtc < rangeEndUtc && endUtc > rangeStartUtc) {
      occurrences.push({
        startDate: exception.newStartDate as string,
        startTime: exception.newStartTime as string,
        endDate: exception.newEndDate as string,
        endTime: exception.newEndTime as string,
        startUtc,
        endUtc,
      });
    }
  }

  return occurrences;
}
