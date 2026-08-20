import { DateTime } from "luxon";
import { listAllDayEventsInRange, listFloatingEventsInRange, listTimedEventsInRange } from "../db/events.repository.js";
import { toViewerWallInterval, type ScheduledEvent } from "./eventPresentation.js";
import type { AllDayEvent } from "../core/model/event.js";

/** Opciones que se ofrecen para "avisar X minutos antes"; DEFAULT_NOTIFY_LEAD_MINUTES si el usuario no eligió ninguna. */
export const NOTIFY_LEAD_OPTIONS = [5, 10, 15, 30, 60] as const;
export const DEFAULT_NOTIFY_LEAD_MINUTES = 10;
/** Hora de pared (zona del visor) a la que se avisa de un evento de día completo -- no tienen hora propia que usar. */
const ALLDAY_REMINDER_HOUR = 9;
const POLL_INTERVAL_MS = 30_000;
const ENABLED_STORAGE_KEY = "app-calendario:notifications-enabled";
const LEAD_STORAGE_KEY = "app-calendario:notify-lead-minutes";

/**
 * Pura y testeable a propósito: decide si un evento a `minutesUntilStart`
 * cae dentro de la ventana de aviso. El margen de -1 min es para no
 * perdernos un evento que ya empezó hace un pelín entre dos sondeos (el
 * poll corre cada POLL_INTERVAL_MS, no instantáneamente al segundo exacto).
 */
export function isWithinNotifyWindow(minutesUntilStart: number, leadMinutes: number): boolean {
  return minutesUntilStart >= -1 && minutesUntilStart <= leadMinutes;
}

function eventOccurrenceKey(eventId: string, startDate: string, startTime: string): string {
  return `${eventId}|${startDate}|${startTime}`;
}

export function isNotificationSupported(): boolean {
  return typeof Notification !== "undefined";
}

export function notificationPermission(): NotificationPermission | "unsupported" {
  return isNotificationSupported() ? Notification.permission : "unsupported";
}

export function isNotificationsEnabled(): boolean {
  return isNotificationSupported() && localStorage.getItem(ENABLED_STORAGE_KEY) === "true";
}

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!isNotificationSupported()) return "denied";
  return Notification.requestPermission();
}

export function getNotifyLeadMinutes(): number {
  const stored = Number(localStorage.getItem(LEAD_STORAGE_KEY));
  return (NOTIFY_LEAD_OPTIONS as readonly number[]).includes(stored) ? stored : DEFAULT_NOTIFY_LEAD_MINUTES;
}

export function setNotifyLeadMinutes(minutes: number): void {
  localStorage.setItem(LEAD_STORAGE_KEY, String(minutes));
}

interface PollDeps {
  readonly getActiveCalendarId: () => string;
  readonly getViewerTzId: () => string;
  /** Se llama al hacer click en el aviso del sistema, con la fecha del evento -- para que main.ts navegue ahí. */
  readonly onNotificationClick: (startDate: string) => void;
}

let pollTimer: ReturnType<typeof setInterval> | null = null;
let deps: PollDeps | null = null;
const notifiedKeys = new Set<string>();

function fireNotification(eventId: string, title: string, body: string, startDate: string): void {
  if (!isNotificationSupported() || Notification.permission !== "granted") return;
  // `tag` deduplica a nivel del propio navegador si por lo que sea se
  // dispara dos veces para el mismo evento (además del Set de abajo).
  const notification = new Notification(title, { body, tag: eventId });
  notification.onclick = () => {
    window.focus();
    deps?.onNotificationClick(startDate);
    notification.close();
  };
}

function checkAllDayReminders(events: readonly AllDayEvent[], now: DateTime, leadMinutes: number): void {
  const today = now.toISODate() as string;
  const reminderInstant = now.set({ hour: ALLDAY_REMINDER_HOUR, minute: 0, second: 0, millisecond: 0 });
  const minutesUntilReminder = reminderInstant.diff(now, "minutes").minutes;
  if (!isWithinNotifyWindow(minutesUntilReminder, leadMinutes)) return;

  for (const event of events) {
    if (!(event.startDate <= today && today < event.endDate)) continue;
    const key = eventOccurrenceKey(event.id, today, "allday");
    if (notifiedKeys.has(key)) continue;
    notifiedKeys.add(key);
    fireNotification(event.id, event.title, "Hoy · todo el día", today);
  }
}

async function checkUpcoming(): Promise<void> {
  if (!deps || !isNotificationsEnabled()) return;
  const calendarId = deps.getActiveCalendarId();
  if (!calendarId) return;
  const viewerTzId = deps.getViewerTzId();
  const leadMinutes = getNotifyLeadMinutes();

  const now = DateTime.now().setZone(viewerTzId);
  const windowEnd = now.plus({ minutes: leadMinutes });

  const [timedEvents, floatingEvents, allDayEvents] = await Promise.all([
    listTimedEventsInRange(now.toUTC().toISO() as string, windowEnd.toUTC().toISO() as string, calendarId),
    listFloatingEventsInRange(now.toISODate() as string, windowEnd.plus({ days: 1 }).toISODate() as string, calendarId),
    listAllDayEventsInRange(now.toISODate() as string, now.plus({ days: 1 }).toISODate() as string, calendarId),
  ]);

  for (const event of [...timedEvents, ...floatingEvents] as ScheduledEvent[]) {
    const wall = toViewerWallInterval(event, viewerTzId);
    const startDT = DateTime.fromISO(`${wall.startDate}T${wall.startTime}`, { zone: viewerTzId });
    const minutesUntilStart = startDT.diff(now, "minutes").minutes;
    if (!isWithinNotifyWindow(minutesUntilStart, leadMinutes)) continue;

    const key = eventOccurrenceKey(event.id, wall.startDate, wall.startTime);
    if (notifiedKeys.has(key)) continue;
    notifiedKeys.add(key);
    fireNotification(event.id, event.title, `Empieza a las ${wall.startTime.slice(0, 5)}`, wall.startDate);
  }

  checkAllDayReminders(allDayEvents, now, leadMinutes);
}

/** Idempotente: si ya está sondeando, no hace nada (pero sí actualiza `deps`, por si cambió el calendario activo). */
export function startNotificationPolling(pollDeps: PollDeps): void {
  deps = pollDeps;
  if (pollTimer) return;
  void checkUpcoming();
  pollTimer = setInterval(() => void checkUpcoming(), POLL_INTERVAL_MS);
}

export function stopNotificationPolling(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

export function setNotificationsEnabled(enabled: boolean): void {
  localStorage.setItem(ENABLED_STORAGE_KEY, enabled ? "true" : "false");
}
