import { DateTime } from "luxon";
import type { TimedEvent } from "../core/model/event.js";
import { utcIsoToWallTime, wallTimeToUtcIso } from "../core/timezone/convert.js";

const HOUR_HEIGHT_PX = 48;

export interface RenderableBlock {
  readonly event: TimedEvent;
  readonly topPx: number;
  readonly heightPx: number;
  readonly startLabel: string;
  readonly endLabel: string;
}

function minutesSinceMidnight(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/**
 * Traduce eventos (guardados en hora de pared + tz propia) a posiciones en
 * una rejilla de un día, en la zona del visor. Esta reinterpretación es la
 * única conversión de zona que existe en toda la app — vive aquí, en
 * presentación, nunca en /core ni en /db (ver CLAUDE.md, "la regla de oro").
 */
export function layoutDay(
  events: readonly TimedEvent[],
  viewerDate: string,
  viewerTzId: string,
): RenderableBlock[] {
  return events.map((event) => {
    const startUtc = wallTimeToUtcIso(event.startDate, event.startTime, event.tzId);
    const endUtc = wallTimeToUtcIso(event.endDate, event.endTime, event.tzId);
    const startWall = utcIsoToWallTime(startUtc, viewerTzId);
    const endWall = utcIsoToWallTime(endUtc, viewerTzId);

    const dayStartMinutes = startWall.date === viewerDate ? minutesSinceMidnight(startWall.time) : 0;
    const dayEndMinutes = endWall.date === viewerDate ? minutesSinceMidnight(endWall.time) : 24 * 60;

    const topPx = (dayStartMinutes / 60) * HOUR_HEIGHT_PX;
    const heightPx = Math.max(((dayEndMinutes - dayStartMinutes) / 60) * HOUR_HEIGHT_PX, 18);

    return {
      event,
      topPx,
      heightPx,
      startLabel: startWall.time.slice(0, 5),
      endLabel: endWall.time.slice(0, 5),
    };
  });
}

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

export function renderDayGrid(container: HTMLElement, blocks: readonly RenderableBlock[]): HTMLElement {
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
    const el = document.createElement("div");
    el.className = "event-block";
    el.style.top = `${block.topPx}px`;
    el.style.height = `${block.heightPx}px`;
    el.innerHTML = `<div>${escapeHtml(block.event.title)}</div><div class="event-time">${block.startLabel}–${block.endLabel}</div>`;
    grid.appendChild(el);
  }

  return grid;
}

/**
 * Dibuja (o mueve) la línea roja de "ahora" sobre la rejilla, como en Google
 * Calendar. Solo se muestra cuando el día visible es hoy en la zona del
 * visor. Se puede llamar en un intervalo para reposicionarla sin volver a
 * pedir los eventos.
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
