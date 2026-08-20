import { DateTime } from "luxon";
import type { IanaTzId, IsoDate, IsoTime } from "../model/event.js";

export interface WallTime {
  readonly date: IsoDate;
  readonly time: IsoTime;
}

function parseDate(date: IsoDate): { year: number; month: number; day: number } {
  const [year, month, day] = date.split("-").map(Number);
  if (year === undefined || month === undefined || day === undefined) {
    throw new Error(`Fecha ISO inválida: ${date}`);
  }
  return { year, month, day };
}

function parseTime(time: IsoTime): { hour: number; minute: number; second: number } {
  const [hour, minute, second] = time.split(":").map(Number);
  if (hour === undefined || minute === undefined || second === undefined) {
    throw new Error(`Hora ISO inválida: ${time}`);
  }
  return { hour, minute, second };
}

/**
 * Convierte una hora de pared (fecha + hora, sin zona) más un tz IANA al
 * instante UTC correspondiente. Si la hora de pared no existe ese día por un
 * salto de horario de verano (spring-forward), Luxon la desplaza hacia
 * adelante a la hora equivalente tras el salto — comportamiento documentado
 * en DESIGN.md §3, no un accidente. Si la hora de pared es ambigua
 * (fall-back), Luxon se queda con la primera ocurrencia (offset previo a la
 * transición), también documentado en DESIGN.md §3.
 */
export function wallTimeToUtcIso(date: IsoDate, time: IsoTime, tzId: IanaTzId): string {
  const dt = DateTime.fromObject(
    { ...parseDate(date), ...parseTime(time) },
    { zone: tzId },
  );
  if (!dt.isValid) {
    throw new Error(
      `No se pudo interpretar ${date}T${time} en zona "${tzId}": ${dt.invalidReason} (${dt.invalidExplanation})`,
    );
  }
  const iso = dt.toUTC().toISO();
  if (iso === null) {
    throw new Error(`No se pudo convertir ${date}T${time} (${tzId}) a UTC`);
  }
  return iso;
}

/** Convierte un instante UTC a hora de pared en la zona IANA dada. */
export function utcIsoToWallTime(utcIso: string, tzId: IanaTzId): WallTime {
  const dt = DateTime.fromISO(utcIso, { zone: "utc" }).setZone(tzId);
  if (!dt.isValid) {
    throw new Error(`Instante UTC inválido: ${utcIso}`);
  }
  return {
    date: dt.toFormat("yyyy-MM-dd"),
    time: dt.toFormat("HH:mm:ss"),
  };
}
