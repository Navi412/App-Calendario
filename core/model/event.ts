// Tipos base. Ver CLAUDE.md: son tres modelos con reglas distintas,
// no un único `Event` con campos opcionales ambiguos.

export type IsoDate = string; // 'YYYY-MM-DD'
export type IsoTime = string; // 'HH:mm:ss'
export type IanaTzId = string; // p.ej. 'America/New_York'

/** Paleta cerrada de colores de evento (claves, no hex -- el mapeo a un valor visual concreto vive en /app). */
export const EVENT_COLORS = ["blue", "green", "yellow", "pink", "red"] as const;
export type EventColor = (typeof EVENT_COLORS)[number];
export const DEFAULT_EVENT_COLOR: EventColor = "blue";

interface EventBase {
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  readonly location?: string;
  readonly color: EventColor;
}

/** Hora absoluta: ligado a un instante real del mundo (una reunión). */
export interface TimedEvent extends EventBase {
  readonly kind: "timed";
  readonly startDate: IsoDate;
  readonly startTime: IsoTime;
  readonly endDate: IsoDate;
  readonly endTime: IsoTime;
  readonly tzId: IanaTzId;
  /**
   * true si este objeto es una ocurrencia generada de una serie recurrente
   * (ver core/recurrence/expandRecurrence.ts), no un evento suelto. `id`
   * identifica a la serie completa, no a esta ocurrencia individual --
   * todavía no hay excepciones de instancia (rebanada 6 de DESIGN.md §6),
   * así que editar o borrar afecta a toda la serie.
   */
  readonly isRecurring?: boolean;
}

/** Hora local flotante: sin zona, se reinterpreta contra la zona del visor (un recordatorio diario). */
export interface FloatingEvent extends EventBase {
  readonly kind: "floating";
  readonly startDate: IsoDate;
  readonly startTime: IsoTime;
  readonly endDate: IsoDate;
  readonly endTime: IsoTime;
}

/** Día completo: sin hora ni zona. endDate es EXCLUSIVO (convención iCalendar). */
export interface AllDayEvent extends EventBase {
  readonly kind: "allday";
  readonly startDate: IsoDate;
  readonly endDate: IsoDate;
}

export type CalendarEvent = TimedEvent | FloatingEvent | AllDayEvent;
