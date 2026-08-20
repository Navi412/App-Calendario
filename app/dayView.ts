import { DateTime } from "luxon";
import type { TimedEvent } from "../core/model/event.js";
import { toViewerInterval } from "./eventPresentation.js";
import { EVENT_COLOR_VAR } from "./formFields.js";
import { HOUR_HEIGHT_PX } from "./gridConstants.js";
import { escapeHtml } from "./util.js";

export interface RenderableBlock {
  readonly event: TimedEvent;
  readonly topPx: number;
  readonly heightPx: number;
  readonly startLabel: string;
  readonly endLabel: string;
}

export type EventClickHandler = (event: TimedEvent) => void;

function minutesSinceMidnight(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** Traduce eventos a posiciones en la rejilla de un único día, en la zona del visor. */
export function layoutDay(
  events: readonly TimedEvent[],
  viewerDate: string,
  viewerTzId: string,
): RenderableBlock[] {
  return events.map((event) => {
    const startWall = toViewerInterval(event, viewerTzId);
    const endWall = { date: startWall.endDate, time: startWall.endTime };

    const dayStartMinutes = startWall.startDate === viewerDate ? minutesSinceMidnight(startWall.startTime) : 0;
    const dayEndMinutes = endWall.date === viewerDate ? minutesSinceMidnight(endWall.time) : 24 * 60;

    const topPx = (dayStartMinutes / 60) * HOUR_HEIGHT_PX;
    const heightPx = Math.max(((dayEndMinutes - dayStartMinutes) / 60) * HOUR_HEIGHT_PX, 18);

    return {
      event,
      topPx,
      heightPx,
      startLabel: startWall.startTime.slice(0, 5),
      endLabel: endWall.time.slice(0, 5),
    };
  });
}

/** Botón-bloque de evento, compartido entre la vista de día y las columnas de la vista de semana. */
export function createEventBlockButton(
  block: RenderableBlock,
  extraClass: string,
  onEventClick: EventClickHandler,
): HTMLButtonElement {
  const el = document.createElement("button");
  el.type = "button";
  el.className = `event-block ${extraClass}`.trim();
  el.style.top = `${block.topPx}px`;
  el.style.height = `${block.heightPx}px`;
  el.style.setProperty("--event-color", EVENT_COLOR_VAR[block.event.color]);
  el.innerHTML = `<div>${escapeHtml(block.event.title)}</div><div class="event-time">${block.startLabel}–${block.endLabel}</div>`;
  el.addEventListener("click", () => onEventClick(block.event));
  return el;
}

export function renderDayGrid(
  container: HTMLElement,
  blocks: readonly RenderableBlock[],
  onEventClick: EventClickHandler,
): HTMLElement {
  container.innerHTML = "";
  const grid = document.createElement("div");
  grid.className = "day-grid";

  for (let hour = 0; hour < 24; hour++) {
    const row = document.createElement("div");
    row.className = "hour-row";

    const label = document.createElement("div");
    label.className = "hour-label";
    label.textContent = `${hour.toString().padStart(2, "0")}:00`;
    row.appendChild(label);

    const track = document.createElement("div");
    track.className = "hour-track";
    row.appendChild(track);

    grid.appendChild(row);
  }
  container.appendChild(grid);

  for (const block of blocks) {
    grid.appendChild(createEventBlockButton(block, "", onEventClick));
  }

  return grid;
}

/**
 * Dibuja (o mueve) la línea roja de "ahora" sobre una rejilla de horas, como
 * en Google Calendar. Solo se muestra cuando `viewerDate` es hoy en la zona
 * del visor. Sirve tanto para la vista de día como para una columna de la
 * vista de semana -- solo necesita el contenedor y la fecha de esa columna.
 */
export function renderNowLine(grid: HTMLElement, viewerDate: string, viewerTzId: string): void {
  grid.querySelector(".now-line")?.remove();

  const now = DateTime.now().setZone(viewerTzId);
  if (now.toISODate() !== viewerDate) return;

  const minutes = now.hour * 60 + now.minute;
  const el = document.createElement("div");
  el.className = "now-line";
  el.style.top = `${(minutes / 60) * HOUR_HEIGHT_PX}px`;
  grid.appendChild(el);
}
