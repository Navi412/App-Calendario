import type { AllDayEvent, FloatingEvent, TimedEvent } from "../core/model/event.js";
import { utcIsoToWallTime, wallTimeToUtcIso } from "../core/timezone/convert.js";

export interface ViewerInterval {
  readonly startDate: string;
  readonly startTime: string;
  readonly endDate: string;
  readonly endTime: string;
}

export type ScheduledEvent = TimedEvent | FloatingEvent;

/**
 * Reinterpreta un evento (guardado en hora de pared + su propia tz) en la
 * zona del visor. Es la única conversión de zona horaria de toda la app --
 * vive en /app, nunca en /core ni /db (ver CLAUDE.md, "la regla de oro").
 * Todas las vistas (día, semana, mes) pasan por aquí.
 */
export function toViewerInterval(event: TimedEvent, viewerTzId: string): ViewerInterval {
  const startUtc = wallTimeToUtcIso(event.startDate, event.startTime, event.tzId);
  const endUtc = wallTimeToUtcIso(event.endDate, event.endTime, event.tzId);
  const startWall = utcIsoToWallTime(startUtc, viewerTzId);
  const endWall = utcIsoToWallTime(endUtc, viewerTzId);
  return {
    startDate: startWall.date,
    startTime: startWall.time,
    endDate: endWall.date,
    endTime: endWall.time,
  };
}

/**
 * Igual que `toViewerInterval`, pero también acepta eventos flotantes: por
 * definición no tienen zona propia, así que su hora de pared guardada ES la
 * hora a mostrar sea cual sea el visor -- no hay conversión que hacer.
 */
export function toViewerWallInterval(event: ScheduledEvent, viewerTzId: string): ViewerInterval {
  if (event.kind === "floating") {
    return { startDate: event.startDate, startTime: event.startTime, endDate: event.endDate, endTime: event.endTime };
  }
  return toViewerInterval(event, viewerTzId);
}

/**
 * Inversa de `toViewerInterval`: dada una hora de pared ya en la zona del
 * visor (p.ej. el resultado de arrastrar un bloque en la rejilla), calcula
 * la hora de pared equivalente en la zona propia del evento, que es lo que
 * hay que guardar. Sigue siendo /app -- pasa por UTC pero nunca se guarda.
 */
export function fromViewerWallTime(
  date: string,
  time: string,
  viewerTzId: string,
  eventTzId: string,
): { readonly date: string; readonly time: string } {
  const utcIso = wallTimeToUtcIso(date, time, viewerTzId);
  return utcIsoToWallTime(utcIso, eventTzId);
}

/** Agrupa eventos (timed o floating) por su fecha de inicio en la zona del visor, ordenados por hora dentro de cada día. */
export function groupEventsByViewerDate(
  events: readonly ScheduledEvent[],
  viewerTzId: string,
): Map<string, ScheduledEvent[]> {
  const byDate = new Map<string, ScheduledEvent[]>();
  for (const event of events) {
    const { startDate } = toViewerWallInterval(event, viewerTzId);
    const bucket = byDate.get(startDate);
    if (bucket) {
      bucket.push(event);
    } else {
      byDate.set(startDate, [event]);
    }
  }
  for (const bucket of byDate.values()) {
    bucket.sort((a, b) =>
      toViewerWallInterval(a, viewerTzId).startTime.localeCompare(toViewerWallInterval(b, viewerTzId).startTime),
    );
  }
  return byDate;
}

/**
 * A diferencia de timed/floating, un evento de día completo puede cubrir
 * varias fechas de `gridDates` a la vez -- se añade a la casilla de cada una
 * (no solo a su `startDate`). Sin conversión de zona: los eventos de día
 * completo son zona-agnósticos por construcción (ver CLAUDE.md).
 */
export function groupAllDayEventsByDate(
  events: readonly AllDayEvent[],
  gridDates: readonly string[],
): Map<string, AllDayEvent[]> {
  const byDate = new Map<string, AllDayEvent[]>();
  for (const date of gridDates) {
    const covering = events.filter((event) => event.startDate <= date && date < event.endDate);
    if (covering.length > 0) byDate.set(date, covering);
  }
  return byDate;
}
