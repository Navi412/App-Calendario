import { DateTime } from "luxon";
import {
  cancelTimedOccurrence,
  deleteEvent,
  deleteTimedOccurrenceAndFollowing,
  importEvents,
  listAllDayEventsInRange,
  listEventsForExport,
  listFloatingEventsInRange,
  listTimedEventsInRange,
  moveTimedOccurrence,
  moveTimedOccurrenceAndFollowing,
  renameEvent,
  saveAllDayEvent,
  saveFloatingEvent,
  saveTimedEvent,
  searchEvents,
  updateAllDayEvent,
  updateFloatingEvent,
  updateTimedEvent,
  type EventSearchResult,
} from "../db/events.repository.js";
import { createCalendar, deleteCalendar, listCalendars, updateCalendar, type Calendar } from "../db/calendars.repository.js";
import type { CalendarEvent } from "../core/model/event.js";
import { wallTimeToUtcIso } from "../core/timezone/convert.js";
import {
  fromViewerWallTime,
  groupAllDayEventsByDate,
  groupEventsByViewerDate,
  toViewerWallInterval,
  type ScheduledEvent,
} from "./eventPresentation.js";
import { layoutDay, renderDayGrid, renderNowLine } from "./dayView.js";
import { renderWeekGrid } from "./weekView.js";
import { renderMonthGrid } from "./monthView.js";
import { renderAllDayStrip } from "./alldayStrip.js";
import { renderEventForm, type NewEventSubmission } from "./eventForm.js";
import { openEventEditModal } from "./eventEditModal.js";
import { renderCalendarSwitcher } from "./calendarSwitcher.js";
import { serializeEventsToIcs } from "./icsExport.js";
import { parseIcs } from "./icsImport.js";
import { renderSearchBox } from "./searchBox.js";
import {
  getNotifyLeadMinutes,
  isNotificationsEnabled,
  isNotificationSupported,
  NOTIFY_LEAD_OPTIONS,
  requestNotificationPermission,
  setNotificationsEnabled,
  setNotifyLeadMinutes,
  startNotificationPolling,
  stopNotificationPolling,
} from "./notifications.js";
import { BELL_ICON_SVG, CALENDAR_ICON_SVG } from "./icons.js";
import { escapeHtml } from "./util.js";

type ViewMode = "day" | "week" | "month";

const viewerTzId = Intl.DateTimeFormat().resolvedOptions().timeZone;
const todayIso = (): string => DateTime.now().setZone(viewerTzId).toISODate() as string;

const ACTIVE_CALENDAR_STORAGE_KEY = "app-calendario:active-calendar-id";

let currentDate = todayIso();
let currentView: ViewMode = "day";
let calendars: Calendar[] = [];
let activeCalendarId = "";

const app = document.getElementById("app");
if (!app) throw new Error("No se encontró #app");

app.innerHTML = `
  <div class="topbar">
    ${CALENDAR_ICON_SVG}
    <h1 class="app-title pixel-heading">App Calendario</h1>
    <div id="calendar-switcher-container"></div>
    <div class="day-nav">
      <button id="today-btn" class="pixel-btn">Hoy</button>
      <button id="prev-btn" class="pixel-btn" aria-label="Anterior">&larr;</button>
      <span id="current-date-label" class="current-date-label"></span>
      <button id="next-btn" class="pixel-btn" aria-label="Siguiente">&rarr;</button>
    </div>
    <div class="view-switcher">
      <button data-view="day">Día</button>
      <button data-view="week">Semana</button>
      <button data-view="month">Mes</button>
    </div>
    <div class="topbar-trailing">
      <div id="search-box-container"></div>
      <button id="notifications-toggle" class="pixel-btn notifications-toggle" aria-pressed="false" title="Avisos de eventos próximos">
        ${BELL_ICON_SVG}
      </button>
      <select id="notify-lead-select" class="notify-lead-select" aria-label="Avisar con cuánta antelación" title="Avisar con cuánta antelación">
        ${NOTIFY_LEAD_OPTIONS.map((minutes) => `<option value="${minutes}">${minutes} min antes</option>`).join("")}
      </select>
      <span class="viewer-tz">zona del visor: ${viewerTzId}</span>
    </div>
  </div>
  <div class="layout">
    <div class="sidebar">
      <button id="create-toggle" class="pixel-btn pixel-btn--primary create-btn">+ Crear</button>
      <div id="form-container" class="event-panel" hidden></div>
    </div>
    <div class="main-column">
      <div id="allday-container" class="allday-container" hidden></div>
      <div id="grid-container">Cargando calendario…</div>
    </div>
  </div>
`;

const label = document.getElementById("current-date-label") as HTMLElement;
const formContainer = document.getElementById("form-container") as HTMLElement;
const alldayContainer = document.getElementById("allday-container") as HTMLElement;
const gridContainer = document.getElementById("grid-container") as HTMLElement;
const createToggle = document.getElementById("create-toggle") as HTMLButtonElement;
const calendarSwitcherContainer = document.getElementById("calendar-switcher-container") as HTMLElement;
const searchBoxContainer = document.getElementById("search-box-container") as HTMLElement;
const notificationsToggle = document.getElementById("notifications-toggle") as HTMLButtonElement;
const notifyLeadSelect = document.getElementById("notify-lead-select") as HTMLSelectElement;
const viewButtons = Array.from(document.querySelectorAll<HTMLButtonElement>(".view-switcher button"));

function capitalize(text: string): string {
  return text.length === 0 ? text : text[0]!.toUpperCase() + text.slice(1);
}

function openCreatePanel(): void {
  formContainer.hidden = false;
}

function closeCreatePanel(): void {
  formContainer.hidden = true;
}

function renderSwitcher(): void {
  renderCalendarSwitcher(calendarSwitcherContainer, calendars, activeCalendarId, {
    onSwitch: (id) => {
      activeCalendarId = id;
      localStorage.setItem(ACTIVE_CALENDAR_STORAGE_KEY, id);
      renderSwitcher();
      void refresh();
    },
    onCreate: async (name, color) => {
      const created = await createCalendar({ name, color });
      calendars = await listCalendars();
      activeCalendarId = created.id;
      localStorage.setItem(ACTIVE_CALENDAR_STORAGE_KEY, created.id);
      renderSwitcher();
      await refresh();
    },
    onEdit: async (id, name, color) => {
      await updateCalendar(id, { name, color });
      calendars = await listCalendars();
      renderSwitcher();
      await refresh();
    },
    onDelete: async (id) => {
      await deleteCalendar(id);
      calendars = await listCalendars();
      if (activeCalendarId === id) {
        activeCalendarId = calendars[0]?.id ?? "";
        localStorage.setItem(ACTIVE_CALENDAR_STORAGE_KEY, activeCalendarId);
      }
      renderSwitcher();
      await refresh();
    },
    onExport: async () => {
      const activeCalendar = calendars.find((c) => c.id === activeCalendarId);
      const events = await listEventsForExport(activeCalendarId);
      const ics = serializeEventsToIcs(events, activeCalendar?.name ?? "Calendario");
      const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${(activeCalendar?.name ?? "calendario").replace(/[^\w\-]+/g, "_")}.ics`;
      link.click();
      URL.revokeObjectURL(url);
    },
    onImport: async (file) => {
      const text = await file.text();
      const { events, skipped } = parseIcs(text, viewerTzId);
      const imported = await importEvents(events, activeCalendarId);
      await refresh();
      window.alert(
        skipped > 0
          ? `Importados ${imported} eventos (${skipped} omitidos por formato no reconocido).`
          : `Importados ${imported} eventos.`,
      );
    },
  });
}

/** Carga los calendarios y decide cuál queda activo (el recordado en localStorage si aún existe, si no el primero). getDb() ya garantiza que siempre hay al menos uno. */
async function loadCalendars(): Promise<void> {
  calendars = await listCalendars();
  const stored = localStorage.getItem(ACTIVE_CALENDAR_STORAGE_KEY);
  const storedStillExists = stored !== null && calendars.some((c) => c.id === stored);
  activeCalendarId = storedStillExists ? (stored as string) : ((calendars[0]?.id as string) ?? "");
  renderSwitcher();
}

function handleEventClick(event: CalendarEvent): void {
  openEventEditModal(event, {
    onSave: async (id, patch) => {
      if (patch.kind === "timed") await updateTimedEvent(id, patch.input);
      else if (patch.kind === "floating") await updateFloatingEvent(id, patch.input);
      else await updateAllDayEvent(id, patch.input);
      await refresh();
    },
    onDelete: async (id) => {
      await deleteEvent(id);
      await refresh();
    },
    onMoveInstance: async (masterId, originalStartDate, patch) => {
      await moveTimedOccurrence(masterId, originalStartDate, patch.startDate, patch.startTime, patch.endDate, patch.endTime);
      await refresh();
    },
    onCancelInstance: async (masterId, originalStartDate) => {
      await cancelTimedOccurrence(masterId, originalStartDate);
      await refresh();
    },
    onMoveFollowing: async (masterId, cutDate, patch) => {
      await moveTimedOccurrenceAndFollowing(masterId, cutDate, patch);
      await refresh();
    },
    onDeleteFollowing: async (masterId, cutDate) => {
      await deleteTimedOccurrenceAndFollowing(masterId, cutDate);
      await refresh();
    },
    onRenameSeries: async (masterId, title) => {
      await renameEvent(masterId, title);
      await refresh();
    },
  });
}

/**
 * Aplica un nuevo horario (ya en hora de pared de la zona del visor) a un
 * evento arrastrado o redimensionado. Convierte a la zona propia del
 * evento solo en el último paso, antes de guardar -- toda la aritmética de
 * arriba se hace en la del visor, que es en la que se ve/arrastra el
 * bloque. Compartido por "mover" y "redimensionar": la única diferencia
 * entre ambos es cómo llegan a su startDate/startTime/endDate/endTime
 * nuevos, no qué se hace con ellos.
 */
async function applyViewerWallTime(
  event: ScheduledEvent,
  newStartDate: string,
  newStartTime: string,
  newEndDate: string,
  newEndTime: string,
): Promise<void> {
  if (event.kind === "floating") {
    await updateFloatingEvent(event.id, {
      title: event.title,
      color: event.color,
      ...(event.description !== undefined ? { description: event.description } : {}),
      ...(event.location !== undefined ? { location: event.location } : {}),
      startDate: newStartDate,
      startTime: newStartTime,
      endDate: newEndDate,
      endTime: newEndTime,
    });
  } else {
    const ownStart = fromViewerWallTime(newStartDate, newStartTime, viewerTzId, event.tzId);
    const ownEnd = fromViewerWallTime(newEndDate, newEndTime, viewerTzId, event.tzId);
    if (event.isRecurring) {
      // Arrastrar/redimensionar una ocurrencia recurrente mueve SOLO esa
      // instancia (misma semántica que "mover esta instancia" en el modal).
      await moveTimedOccurrence(event.id, event.startDate, ownStart.date, ownStart.time, ownEnd.date, ownEnd.time);
    } else {
      await updateTimedEvent(event.id, {
        title: event.title,
        color: event.color,
        ...(event.description !== undefined ? { description: event.description } : {}),
        ...(event.location !== undefined ? { location: event.location } : {}),
        startDate: ownStart.date,
        startTime: ownStart.time,
        endDate: ownEnd.date,
        endTime: ownEnd.time,
        tzId: event.tzId,
      });
    }
  }
  await refresh();
}

/**
 * Arrastrar un bloque en la rejilla de hora (día o semana) cambia su hora
 * (y, si se soltó sobre otra columna en la vista de semana, también el
 * día) manteniendo la duración -- ver dayView.ts.
 */
async function handleEventDrag(event: ScheduledEvent, deltaMinutes: number, newDate?: string): Promise<void> {
  const viewerInterval = toViewerWallInterval(event, viewerTzId);
  const durationMinutes = DateTime.fromISO(`${viewerInterval.endDate}T${viewerInterval.endTime}`).diff(
    DateTime.fromISO(`${viewerInterval.startDate}T${viewerInterval.startTime}`),
    "minutes",
  ).minutes;

  const newStart = DateTime.fromISO(`${newDate ?? viewerInterval.startDate}T${viewerInterval.startTime}`).plus({
    minutes: deltaMinutes,
  });
  const newEnd = newStart.plus({ minutes: durationMinutes });

  await applyViewerWallTime(
    event,
    newStart.toISODate() as string,
    newStart.toFormat("HH:mm:ss"),
    newEnd.toISODate() as string,
    newEnd.toFormat("HH:mm:ss"),
  );
}

/** Estirar/encoger el borde inferior de un bloque cambia su duración sin mover el inicio. */
async function handleEventResize(event: ScheduledEvent, deltaMinutes: number): Promise<void> {
  const viewerInterval = toViewerWallInterval(event, viewerTzId);
  const newEnd = DateTime.fromISO(`${viewerInterval.endDate}T${viewerInterval.endTime}`).plus({ minutes: deltaMinutes });

  await applyViewerWallTime(
    event,
    viewerInterval.startDate,
    viewerInterval.startTime,
    newEnd.toISODate() as string,
    newEnd.toFormat("HH:mm:ss"),
  );
}

function goToDay(dateIso: string): void {
  currentDate = dateIso;
  currentView = "day";
  void refresh();
}

/** Fechas ISO consecutivas en [startDate, endDateExclusive). */
function buildDateRange(startDate: string, endDateExclusive: string): string[] {
  const dates: string[] = [];
  let cursor = DateTime.fromISO(startDate);
  const end = DateTime.fromISO(endDateExclusive);
  while (cursor < end) {
    dates.push(cursor.toISODate() as string);
    cursor = cursor.plus({ days: 1 });
  }
  return dates;
}

interface VisibleRange {
  readonly startUtc: string;
  readonly endUtc: string;
  readonly startDate: string;
  readonly endDateExclusive: string;
  readonly dates: readonly string[];
  readonly labelText: string;
}

/** Rango [inicio, fin) visible, en UTC (para eventos de hora absoluta) y en fecha de pared pura (para flotantes y de día completo), según el modo de vista. */
function computeVisibleRange(): VisibleRange {
  const anchor = DateTime.fromISO(currentDate).setLocale("es");

  let startDate: string;
  let endDateExclusive: string;
  let labelText: string;

  if (currentView === "day") {
    startDate = currentDate;
    endDateExclusive = anchor.plus({ days: 1 }).toISODate() as string;
    labelText = capitalize(anchor.toFormat("d LLL yyyy"));
  } else if (currentView === "week") {
    const weekStart = anchor.startOf("week");
    startDate = weekStart.toISODate() as string;
    endDateExclusive = weekStart.plus({ days: 7 }).toISODate() as string;
    labelText = `${weekStart.toFormat("d LLL")} – ${weekStart.plus({ days: 6 }).toFormat("d LLL yyyy")}`;
  } else {
    const monthStart = anchor.startOf("month");
    const gridStart = monthStart.startOf("week");
    const gridEndExclusive = monthStart.endOf("month").endOf("week").plus({ days: 1 });
    startDate = gridStart.toISODate() as string;
    endDateExclusive = gridEndExclusive.toISODate() as string;
    labelText = capitalize(monthStart.toFormat("LLLL yyyy"));
  }

  return {
    startUtc: wallTimeToUtcIso(startDate, "00:00:00", viewerTzId),
    endUtc: wallTimeToUtcIso(endDateExclusive, "00:00:00", viewerTzId),
    startDate,
    endDateExclusive,
    dates: buildDateRange(startDate, endDateExclusive),
    labelText,
  };
}

async function renderCurrentView(): Promise<void> {
  for (const btn of viewButtons) {
    btn.classList.toggle("is-active", btn.dataset["view"] === currentView);
  }

  const { startUtc, endUtc, startDate, endDateExclusive, dates, labelText } = computeVisibleRange();
  label.textContent = labelText;

  const [timedEvents, floatingEvents, allDayEvents] = await Promise.all([
    listTimedEventsInRange(startUtc, endUtc, activeCalendarId),
    listFloatingEventsInRange(startDate, endDateExclusive, activeCalendarId),
    listAllDayEventsInRange(startDate, endDateExclusive, activeCalendarId),
  ]);
  const scheduledEvents: ScheduledEvent[] = [...timedEvents, ...floatingEvents];

  if (currentView === "day") {
    gridContainer.className = "";
    alldayContainer.className = "allday-container";
    renderAllDayStrip(alldayContainer, dates, allDayEvents, handleEventClick);
    const blocks = layoutDay(scheduledEvents, currentDate, viewerTzId);
    const grid = renderDayGrid(
      gridContainer,
      blocks,
      currentDate,
      handleEventClick,
      (event, delta, newDate) => void handleEventDrag(event, delta, newDate),
      (event, delta) => void handleEventResize(event, delta),
    );
    renderNowLine(grid, currentDate, viewerTzId);
  } else if (currentView === "week") {
    gridContainer.className = "week-view";
    alldayContainer.className = "allday-container";
    renderAllDayStrip(alldayContainer, dates, allDayEvents, handleEventClick);
    renderWeekGrid(
      gridContainer,
      dates,
      groupEventsByViewerDate(scheduledEvents, viewerTzId),
      viewerTzId,
      todayIso(),
      handleEventClick,
      (event, delta, newDate) => void handleEventDrag(event, delta, newDate),
      (event, delta) => void handleEventResize(event, delta),
    );
  } else {
    gridContainer.className = "month-view";
    alldayContainer.hidden = true;
    renderMonthGrid(
      gridContainer,
      currentDate,
      groupEventsByViewerDate(scheduledEvents, viewerTzId),
      groupAllDayEventsByDate(allDayEvents, dates),
      viewerTzId,
      todayIso(),
      { onEventClick: handleEventClick, onDayClick: goToDay },
    );
  }

  renderEventForm(
    formContainer,
    currentDate,
    viewerTzId,
    async (submission: NewEventSubmission) => {
      if (submission.kind === "timed") await saveTimedEvent(submission.input, activeCalendarId);
      else if (submission.kind === "floating") await saveFloatingEvent(submission.input, activeCalendarId);
      else await saveAllDayEvent(submission.input, activeCalendarId);
      closeCreatePanel();
      await refresh();
    },
    closeCreatePanel,
  );
}

async function refresh(): Promise<void> {
  try {
    await renderCurrentView();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    gridContainer.className = "";
    gridContainer.innerHTML = `
      <div class="boot-error">
        <p>No se pudo cargar el calendario.</p>
        <p class="boot-error-detail">${escapeHtml(message)}</p>
        <button type="button" class="pixel-btn" id="retry-btn">Reintentar</button>
      </div>
    `;
    document.getElementById("retry-btn")?.addEventListener("click", () => void refresh());
  }
}

createToggle.addEventListener("click", () => {
  if (formContainer.hidden) openCreatePanel();
  else closeCreatePanel();
});

for (const btn of viewButtons) {
  btn.addEventListener("click", () => {
    currentView = btn.dataset["view"] as ViewMode;
    void refresh();
  });
}

document.getElementById("today-btn")?.addEventListener("click", () => {
  currentDate = todayIso();
  void refresh();
});

document.getElementById("prev-btn")?.addEventListener("click", () => {
  const dt = DateTime.fromISO(currentDate);
  const step = currentView === "day" ? { days: -1 } : currentView === "week" ? { days: -7 } : { months: -1 };
  currentDate = dt.plus(step).toISODate() as string;
  void refresh();
});

document.getElementById("next-btn")?.addEventListener("click", () => {
  const dt = DateTime.fromISO(currentDate);
  const step = currentView === "day" ? { days: 1 } : currentView === "week" ? { days: 7 } : { months: 1 };
  currentDate = dt.plus(step).toISODate() as string;
  void refresh();
});

// Reposiciona la línea de "ahora" cada minuto sin volver a pedir los eventos (solo aplica en día/semana).
setInterval(() => {
  if (currentView === "day") {
    const grid = gridContainer.querySelector<HTMLElement>(".day-grid");
    if (grid) renderNowLine(grid, currentDate, viewerTzId);
  } else if (currentView === "week") {
    for (const column of gridContainer.querySelectorAll<HTMLElement>(".week-day-column")) {
      const date = column.dataset["date"];
      if (date) renderNowLine(column, date, viewerTzId);
    }
  }
}, 60_000);

renderSearchBox(searchBoxContainer, {
  onQuery: (query) => searchEvents(activeCalendarId, query),
  onResultClick: (result: EventSearchResult) => goToDay(result.startDate),
});

function startPolling(): void {
  startNotificationPolling({
    getActiveCalendarId: () => activeCalendarId,
    getViewerTzId: () => viewerTzId,
    onNotificationClick: (startDate) => goToDay(startDate),
  });
}

function syncNotificationsToggleUI(): void {
  const enabled = isNotificationsEnabled();
  notificationsToggle.classList.toggle("is-active", enabled);
  notificationsToggle.setAttribute("aria-pressed", String(enabled));
  notificationsToggle.title = !isNotificationSupported()
    ? "Este navegador no admite avisos"
    : enabled
      ? "Avisos activados -- clic para desactivar"
      : `Clic para avisar ${getNotifyLeadMinutes()} min antes de cada evento`;
}

notificationsToggle.addEventListener("click", () => {
  void (async () => {
    if (!isNotificationSupported()) return;

    if (isNotificationsEnabled()) {
      setNotificationsEnabled(false);
      stopNotificationPolling();
      syncNotificationsToggleUI();
      return;
    }

    const permission =
      Notification.permission === "granted" ? "granted" : await requestNotificationPermission();
    if (permission !== "granted") {
      syncNotificationsToggleUI();
      return;
    }

    setNotificationsEnabled(true);
    startPolling();
    syncNotificationsToggleUI();
  })();
});

notifyLeadSelect.value = String(getNotifyLeadMinutes());
notifyLeadSelect.addEventListener("change", () => {
  setNotifyLeadMinutes(Number(notifyLeadSelect.value));
  syncNotificationsToggleUI();
});

syncNotificationsToggleUI();

async function bootstrap(): Promise<void> {
  await loadCalendars();
  await refresh();
  if (isNotificationsEnabled() && isNotificationSupported() && Notification.permission === "granted") {
    startPolling();
  }
}

void bootstrap();
