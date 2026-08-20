import { DateTime } from "luxon";
import type { AllDayEvent } from "../core/model/event.js";
import { layoutOverlaps } from "../core/layout/overlapLayout.js";
import { EVENT_COLOR_VAR } from "./formFields.js";

export type AllDayClickHandler = (event: AllDayEvent) => void;

function dayIndex(date: string, gridStart: string): number {
  return Math.round(DateTime.fromISO(date).diff(DateTime.fromISO(gridStart), "days").days);
}

/**
 * Franja de eventos de día completo, separada de la rejilla horaria (ver
 * DESIGN.md §5): apilado en filas, no en columnas de minutos. Reutiliza
 * `layoutOverlaps` de /core interpretando "columna" como "fila" y el eje de
 * tiempo en minutos como días de calendario -- es el mismo problema de
 * empaquetado de intervalos, solo que el eje horizontal aquí SÍ es la
 * posición real a dibujar (no se reinterpreta como fracción de ancho).
 */
export function renderAllDayStrip(
  container: HTMLElement,
  gridDates: readonly string[],
  events: readonly AllDayEvent[],
  onEventClick: AllDayClickHandler,
): void {
  container.innerHTML = "";
  if (gridDates.length === 0) {
    container.hidden = true;
    return;
  }

  const gridStart = gridDates[0] as string;
  const gridEndExclusive = DateTime.fromISO(gridDates[gridDates.length - 1] as string)
    .plus({ days: 1 })
    .toISODate() as string;

  const clipped = events
    .map((event) => ({
      event,
      clampedStart: event.startDate < gridStart ? gridStart : event.startDate,
      clampedEnd: event.endDate > gridEndExclusive ? gridEndExclusive : event.endDate,
    }))
    .filter((e) => e.clampedStart < e.clampedEnd);

  if (clipped.length === 0) {
    container.hidden = true;
    return;
  }
  container.hidden = false;

  const laidOut = layoutOverlaps(
    clipped.map((e) => ({
      item: e,
      startMinutes: dayIndex(e.clampedStart, gridStart),
      endMinutes: dayIndex(e.clampedEnd, gridStart),
    })),
  );

  const totalRows = laidOut.reduce((max, l) => Math.max(max, l.column + 1), 0);

  const grid = document.createElement("div");
  grid.className = "allday-strip";
  grid.style.setProperty("--allday-cols", String(gridDates.length));
  grid.style.setProperty("--allday-rows", String(totalRows));

  for (const placed of laidOut) {
    const { event } = placed.item;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "allday-chip";
    btn.style.setProperty("--event-color", EVENT_COLOR_VAR[event.color]);
    btn.style.gridColumn = `${placed.startMinutes + 1} / ${placed.endMinutes + 1}`;
    btn.style.gridRow = String(placed.column + 1);
    btn.textContent = event.title;
    btn.title = event.title;
    btn.addEventListener("click", () => onEventClick(event));
    grid.appendChild(btn);
  }

  container.appendChild(grid);
}
