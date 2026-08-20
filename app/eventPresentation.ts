import type { TimedEvent } from "../core/model/event.js";
import { utcIsoToWallTime, wallTimeToUtcIso } from "../core/timezone/convert.js";

export interface ViewerInterval {
  readonly startDate: string;
  readonly startTime: string;
  readonly endDate: string;
  readonly endTime: string;
}

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

/** Agrupa eventos por su fecha de inicio en la zona del visor, ordenados por hora dentro de cada día. */
export function groupEventsByViewerDate(
  events: readonly TimedEvent[],
  viewerTzId: string,
): Map<string, TimedEvent[]> {
  const byDate = new Map<string, TimedEvent[]>();
  for (const event of events) {
    const { startDate } = toViewerInterval(event, viewerTzId);
    const bucket = byDate.get(startDate);
    if (bucket) {
      bucket.push(event);
    } else {
      byDate.set(startDate, [event]);
    }
  }
  for (const bucket of byDate.values()) {
    bucket.sort((a, b) =>
      toViewerInterval(a, viewerTzId).startTime.localeCompare(toViewerInterval(b, viewerTzId).startTime),
    );
  }
  return byDate;
}
