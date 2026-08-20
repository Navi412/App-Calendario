import { DateTime } from "luxon";
import {
  createEventBlockButton,
  layoutDay,
  renderNowLine,
  type EventClickHandler,
  type EventDragHandler,
  type EventResizeHandler,
} from "./dayView.js";
import type { ScheduledEvent } from "./eventPresentation.js";
import { HOUR_HEIGHT_PX } from "./gridConstants.js";

/** Bajo qué columna (fecha) cae un punto de la pantalla -- para saber a qué día se arrastró un bloque al soltarlo. */
function resolveDateAtPoint(clientX: number, clientY: number): string | null {
  const el = document.elementFromPoint(clientX, clientY);
  const column = el?.closest<HTMLElement>(".week-day-column[data-date]");
  return column?.dataset["date"] ?? null;
}

export function renderWeekGrid(
  container: HTMLElement,
  weekDates: readonly string[],
  eventsByDate: ReadonlyMap<string, ScheduledEvent[]>,
  viewerTzId: string,
  todayDate: string,
  onEventClick: EventClickHandler,
  onEventDrag: EventDragHandler,
  onEventResize: EventResizeHandler,
): void {
  container.innerHTML = "";

  const header = document.createElement("div");
  header.className = "week-header";
  header.appendChild(document.createElement("div")).className = "week-header-gutter";

  const body = document.createElement("div");
  body.className = "week-body";

  const hourGutter = document.createElement("div");
  hourGutter.className = "hour-gutter";
  for (let hour = 0; hour < 24; hour++) {
    const label = document.createElement("div");
    label.className = "hour-gutter-label";
    label.textContent = `${hour.toString().padStart(2, "0")}:00`;
    hourGutter.appendChild(label);
  }
  body.appendChild(hourGutter);

  const columns = document.createElement("div");
  columns.className = "week-columns";

  for (const date of weekDates) {
    const isToday = date === todayDate;

    const headerCell = document.createElement("div");
    headerCell.className = `week-header-day${isToday ? " is-today" : ""}`;
    const dt = DateTime.fromISO(date).setLocale("es");
    headerCell.innerHTML = `
      <div class="week-header-weekday">${dt.toFormat("ccc")}</div>
      <div class="week-header-daynum">${dt.toFormat("d")}</div>
    `;
    header.appendChild(headerCell);

    const column = document.createElement("div");
    column.className = "week-day-column";
    column.dataset["date"] = date;
    column.style.height = `${24 * HOUR_HEIGHT_PX}px`;

    const blocks = layoutDay(eventsByDate.get(date) ?? [], date, viewerTzId);
    for (const block of blocks) {
      column.appendChild(
        createEventBlockButton(
          block,
          "week-event-block",
          date,
          onEventClick,
          onEventDrag,
          onEventResize,
          resolveDateAtPoint,
        ),
      );
    }

    renderNowLine(column, date, viewerTzId);
    columns.appendChild(column);
  }

  body.appendChild(columns);
  container.appendChild(header);
  container.appendChild(body);
}
