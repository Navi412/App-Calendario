import { DateTime } from "luxon";
import type { AllDayEvent, CalendarEvent } from "../core/model/event.js";
import { toViewerWallInterval, type ScheduledEvent } from "./eventPresentation.js";
import { EVENT_COLOR_VAR } from "./formFields.js";

const MAX_CHIPS_PER_CELL = 3;
const WEEKDAY_LABELS = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"];

export interface MonthGridHandlers {
  readonly onEventClick: (event: CalendarEvent) => void;
  readonly onDayClick: (dateIso: string) => void;
  /** Click en hueco vacío de la celda (no en el número de día ni en un chip) -- abre el popup de creación rápida para ese día. */
  readonly onCellClick?: (dateIso: string, clientX: number, clientY: number) => void;
}

/** `monthAnchorDate` es cualquier fecha ISO dentro del mes a mostrar. */
export function renderMonthGrid(
  container: HTMLElement,
  monthAnchorDate: string,
  eventsByDate: ReadonlyMap<string, ScheduledEvent[]>,
  alldayByDate: ReadonlyMap<string, AllDayEvent[]>,
  viewerTzId: string,
  todayDate: string,
  handlers: MonthGridHandlers,
): void {
  const monthStart = DateTime.fromISO(monthAnchorDate).startOf("month");
  const gridStart = monthStart.startOf("week");
  const gridEnd = monthStart.endOf("month").endOf("week");

  container.innerHTML = "";

  const weekdayHeader = document.createElement("div");
  weekdayHeader.className = "month-weekday-header";
  for (const wLabel of WEEKDAY_LABELS) {
    const cell = document.createElement("div");
    cell.className = "month-weekday-label";
    cell.textContent = wLabel;
    weekdayHeader.appendChild(cell);
  }
  container.appendChild(weekdayHeader);

  const grid = document.createElement("div");
  grid.className = "month-grid";

  for (let cursor = gridStart; cursor <= gridEnd; cursor = cursor.plus({ days: 1 })) {
    const dateIso = cursor.toISODate() as string;
    const isCurrentMonth = cursor.month === monthStart.month;
    const isToday = dateIso === todayDate;

    const cell = document.createElement("div");
    cell.className = `month-cell${isCurrentMonth ? "" : " is-outside"}${isToday ? " is-today" : ""}`;
    if (handlers.onCellClick) {
      const onCellClick = handlers.onCellClick;
      cell.addEventListener("click", (e) => {
        if ((e.target as HTMLElement).closest(".month-daynum, .month-chip, .month-chip-more")) return;
        onCellClick(dateIso, e.clientX, e.clientY);
      });
    }

    const dayNumBtn = document.createElement("button");
    dayNumBtn.type = "button";
    dayNumBtn.className = "month-daynum";
    dayNumBtn.textContent = String(cursor.day);
    dayNumBtn.title = "Ver este día";
    dayNumBtn.addEventListener("click", () => handlers.onDayClick(dateIso));
    cell.appendChild(dayNumBtn);

    // Día completo primero (sin hora), como en Google Calendar; luego hora absoluta/flotante ordenados por hora.
    const allDayEvents = alldayByDate.get(dateIso) ?? [];
    const timedEvents = eventsByDate.get(dateIso) ?? [];
    const combined: CalendarEvent[] = [...allDayEvents, ...timedEvents];

    for (const event of combined.slice(0, MAX_CHIPS_PER_CELL)) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "month-chip";
      chip.style.setProperty("--event-color", EVENT_COLOR_VAR[event.color]);
      const recurringMark = event.kind === "timed" && event.isRecurring ? "↻ " : "";
      const label =
        event.kind === "allday"
          ? event.title
          : `${toViewerWallInterval(event, viewerTzId).startTime.slice(0, 5)} ${recurringMark}${event.title}`;
      chip.textContent = label;
      chip.addEventListener("click", () => handlers.onEventClick(event));
      cell.appendChild(chip);
    }
    if (combined.length > MAX_CHIPS_PER_CELL) {
      const more = document.createElement("button");
      more.type = "button";
      more.className = "month-chip-more";
      more.textContent = `+${combined.length - MAX_CHIPS_PER_CELL} más`;
      more.title = "Ver este día";
      more.addEventListener("click", () => handlers.onDayClick(dateIso));
      cell.appendChild(more);
    }

    grid.appendChild(cell);
  }

  container.appendChild(grid);
}
