import { DateTime } from "luxon";
import type { TimedEvent } from "../core/model/event.js";
import { toViewerInterval } from "./eventPresentation.js";

const MAX_CHIPS_PER_CELL = 3;
const WEEKDAY_LABELS = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"];

/** `monthAnchorDate` es cualquier fecha ISO dentro del mes a mostrar. */
export function renderMonthGrid(
  container: HTMLElement,
  monthAnchorDate: string,
  eventsByDate: ReadonlyMap<string, TimedEvent[]>,
  viewerTzId: string,
  todayDate: string,
): void {
  const monthStart = DateTime.fromISO(monthAnchorDate).startOf("month");
  const gridStart = monthStart.startOf("week");
  const gridEnd = monthStart.endOf("month").endOf("week");

  container.innerHTML = "";

  const weekdayHeader = document.createElement("div");
  weekdayHeader.className = "month-weekday-header";
  for (const label of WEEKDAY_LABELS) {
    const cell = document.createElement("div");
    cell.className = "month-weekday-label";
    cell.textContent = label;
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

    const dayNum = document.createElement("div");
    dayNum.className = "month-daynum";
    dayNum.textContent = String(cursor.day);
    cell.appendChild(dayNum);

    const dayEvents = eventsByDate.get(dateIso) ?? [];
    for (const event of dayEvents.slice(0, MAX_CHIPS_PER_CELL)) {
      const { startTime } = toViewerInterval(event, viewerTzId);
      const chip = document.createElement("div");
      chip.className = "month-chip";
      chip.textContent = `${startTime.slice(0, 5)} ${event.title}`;
      cell.appendChild(chip);
    }
    if (dayEvents.length > MAX_CHIPS_PER_CELL) {
      const more = document.createElement("div");
      more.className = "month-chip-more";
      more.textContent = `+${dayEvents.length - MAX_CHIPS_PER_CELL} más`;
      cell.appendChild(more);
    }

    grid.appendChild(cell);
  }

  container.appendChild(grid);
}
