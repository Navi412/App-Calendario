import { DateTime } from "luxon";
import type { TimedEvent } from "../core/model/event.js";
import { toViewerInterval } from "./eventPresentation.js";
import { EVENT_COLOR_VAR } from "./formFields.js";
import type { EventClickHandler } from "./dayView.js";

const MAX_CHIPS_PER_CELL = 3;
const WEEKDAY_LABELS = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"];

export interface MonthGridHandlers {
  readonly onEventClick: EventClickHandler;
  readonly onDayClick: (dateIso: string) => void;
}

/** `monthAnchorDate` es cualquier fecha ISO dentro del mes a mostrar. */
export function renderMonthGrid(
  container: HTMLElement,
  monthAnchorDate: string,
  eventsByDate: ReadonlyMap<string, TimedEvent[]>,
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

    const dayNumBtn = document.createElement("button");
    dayNumBtn.type = "button";
    dayNumBtn.className = "month-daynum";
    dayNumBtn.textContent = String(cursor.day);
    dayNumBtn.title = "Ver este día";
    dayNumBtn.addEventListener("click", () => handlers.onDayClick(dateIso));
    cell.appendChild(dayNumBtn);

    const dayEvents = eventsByDate.get(dateIso) ?? [];
    for (const event of dayEvents.slice(0, MAX_CHIPS_PER_CELL)) {
      const { startTime } = toViewerInterval(event, viewerTzId);
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "month-chip";
      chip.style.setProperty("--event-color", EVENT_COLOR_VAR[event.color]);
      chip.textContent = `${startTime.slice(0, 5)} ${event.title}`;
      chip.addEventListener("click", () => handlers.onEventClick(event));
      cell.appendChild(chip);
    }
    if (dayEvents.length > MAX_CHIPS_PER_CELL) {
      const more = document.createElement("button");
      more.type = "button";
      more.className = "month-chip-more";
      more.textContent = `+${dayEvents.length - MAX_CHIPS_PER_CELL} más`;
      more.title = "Ver este día";
      more.addEventListener("click", () => handlers.onDayClick(dateIso));
      cell.appendChild(more);
    }

    grid.appendChild(cell);
  }

  container.appendChild(grid);
}
