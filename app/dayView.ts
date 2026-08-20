import { DateTime } from "luxon";
import { layoutOverlaps } from "../core/layout/overlapLayout.js";
import { toViewerWallInterval, type ScheduledEvent } from "./eventPresentation.js";
import { EVENT_COLOR_VAR } from "./formFields.js";
import { HOUR_HEIGHT_PX } from "./gridConstants.js";
import { escapeHtml } from "./util.js";

export interface RenderableBlock {
  readonly event: ScheduledEvent;
  readonly topPx: number;
  readonly heightPx: number;
  readonly startLabel: string;
  readonly endLabel: string;
  /** Fracción [0,1) del ancho disponible en la que empieza este bloque, según su columna de solape (ver core/layout/overlapLayout). */
  readonly columnLeftFrac: number;
  /** Fracción (0,1] del ancho disponible que ocupa este bloque. */
  readonly columnWidthFrac: number;
}

export type EventClickHandler = (event: ScheduledEvent) => void;
/**
 * `deltaMinutes` es cuánto se movió el bloque verticalmente, ya redondeado
 * a bloques de 15 min. `newDate` solo viene informado si `resolveDateAtPoint`
 * (ver más abajo) determinó que se soltó sobre un día distinto al suyo --
 * el llamador decide cómo traducir ambos a hora de pared real (ver main.ts,
 * que pasa por fromViewerWallTime).
 */
export type EventDragHandler = (event: ScheduledEvent, deltaMinutes: number, newDate?: string) => void;
export type EventResizeHandler = (event: ScheduledEvent, deltaMinutes: number) => void;
/** Dado un punto de la pantalla, en qué fecha (columna) cae -- solo lo necesita la vista de semana; la de día no tiene columnas entre las que cambiar. */
export type ResolveDateAtPoint = (clientX: number, clientY: number) => string | null;

function minutesSinceMidnight(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** Traduce eventos (de hora absoluta o flotantes) a posiciones en la rejilla de un único día, en la zona del visor, con disposición de columnas para los solapados (DESIGN.md §5). */
export function layoutDay(
  events: readonly ScheduledEvent[],
  viewerDate: string,
  viewerTzId: string,
): RenderableBlock[] {
  const withWallTimes = events.map((event) => {
    const startWall = toViewerWallInterval(event, viewerTzId);
    const endWall = { date: startWall.endDate, time: startWall.endTime };
    const dayStartMinutes = startWall.startDate === viewerDate ? minutesSinceMidnight(startWall.startTime) : 0;
    const dayEndMinutes = endWall.date === viewerDate ? minutesSinceMidnight(endWall.time) : 24 * 60;
    return { event, startWall, endWall, dayStartMinutes, dayEndMinutes };
  });

  const laidOut = layoutOverlaps(
    withWallTimes.map((w) => ({ item: w, startMinutes: w.dayStartMinutes, endMinutes: w.dayEndMinutes })),
  );

  return laidOut.map((placed) => {
    const w = placed.item;
    const topPx = (placed.startMinutes / 60) * HOUR_HEIGHT_PX;
    const heightPx = Math.max(((placed.endMinutes - placed.startMinutes) / 60) * HOUR_HEIGHT_PX, 18);

    return {
      event: w.event,
      topPx,
      heightPx,
      startLabel: w.startWall.startTime.slice(0, 5),
      endLabel: w.endWall.time.slice(0, 5),
      columnLeftFrac: placed.column / placed.totalColumns,
      columnWidthFrac: placed.columnSpan / placed.totalColumns,
    };
  });
}

const SNAP_MINUTES = 15;
const SNAP_PX = (HOUR_HEIGHT_PX * SNAP_MINUTES) / 60;
const DRAG_THRESHOLD_PX = 5;
const MAX_TOP_PX = ((24 * 60 - SNAP_MINUTES) / 60) * HOUR_HEIGHT_PX;

function roundToSnap(px: number): number {
  return Math.round(px / SNAP_PX) * SNAP_PX;
}

function snapTopPx(px: number): number {
  return Math.min(Math.max(roundToSnap(px), 0), MAX_TOP_PX);
}

function snapHeightPx(px: number): number {
  return Math.max(SNAP_PX, roundToSnap(px));
}

function withPointerCapture(el: HTMLElement, pointerId: number, action: () => void): void {
  try {
    el.setPointerCapture(pointerId);
  } catch {
    // Si el navegador no reconoce este puntero como "activo" (no debería
    // pasar con interacción real de ratón/táctil, pero sí con eventos
    // sintéticos de pruebas), seguimos sin captura -- el arrastre igual
    // funciona, solo pierde la garantía de que el puntero sigue
    // "perteneciendo" a este elemento si sale de su área.
  }
  action();
}

/**
 * Arrastrar verticalmente cambia la hora (redondeada a bloques de 15 min).
 * Si se pasa `resolveDateAtPoint` (vista de semana), soltar sobre la columna
 * de otro día también cambia la fecha -- el bloque no "viaja" visualmente
 * entre columnas mientras se arrastra, solo verticalmente; el cambio de
 * columna se decide al soltar, mirando bajo qué columna quedó el puntero.
 * Un movimiento por debajo de DRAG_THRESHOLD_PX se trata como click, no
 * como arrastre, para no romper la apertura del modal de edición.
 */
function attachDragHandlers(
  el: HTMLButtonElement,
  block: RenderableBlock,
  viewerDate: string,
  onEventClick: EventClickHandler,
  onEventDrag: EventDragHandler,
  resolveDateAtPoint?: ResolveDateAtPoint,
): void {
  el.addEventListener("pointerdown", (downEvent: PointerEvent) => {
    if (downEvent.button !== 0) return;
    if ((downEvent.target as HTMLElement).closest(".event-block-resize-handle")) return;

    const startClientY = downEvent.clientY;
    let dragging = false;
    let lastClientX = downEvent.clientX;
    let lastClientY = downEvent.clientY;

    withPointerCapture(el, downEvent.pointerId, () => {
      function onMove(moveEvent: PointerEvent): void {
        lastClientX = moveEvent.clientX;
        lastClientY = moveEvent.clientY;
        const deltaY = moveEvent.clientY - startClientY;
        if (!dragging && Math.abs(deltaY) > DRAG_THRESHOLD_PX) {
          dragging = true;
          el.classList.add("event-block--dragging");
        }
        if (!dragging) return;
        el.style.top = `${snapTopPx(block.topPx + deltaY)}px`;
      }

      function onUp(): void {
        try {
          el.releasePointerCapture(downEvent.pointerId);
        } catch {
          // no había captura que soltar.
        }
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
        el.classList.remove("event-block--dragging");

        if (!dragging) {
          onEventClick(block.event);
          return;
        }

        const finalTopPx = snapTopPx(parseFloat(el.style.top));
        const deltaMinutes = Math.round(((finalTopPx - block.topPx) / HOUR_HEIGHT_PX) * 60);
        const droppedDate = resolveDateAtPoint?.(lastClientX, lastClientY) ?? null;
        const newDate = droppedDate && droppedDate !== viewerDate ? droppedDate : undefined;

        if (deltaMinutes === 0 && newDate === undefined) {
          el.style.top = `${block.topPx}px`; // sin cambio real: vuelve a su sitio, no hay nada que persistir
          return;
        }
        onEventDrag(block.event, deltaMinutes, newDate);
      }

      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
    });
  });
}

/** Asa inferior para estirar/encoger la duración arrastrando, sin mover la hora de inicio. */
function attachResizeHandle(
  handle: HTMLElement,
  block: RenderableBlock,
  el: HTMLButtonElement,
  onEventResize: EventResizeHandler,
): void {
  handle.addEventListener("pointerdown", (downEvent: PointerEvent) => {
    if (downEvent.button !== 0) return;
    downEvent.stopPropagation(); // que este arrastre no dispare también el de "mover"
    const startClientY = downEvent.clientY;

    withPointerCapture(handle, downEvent.pointerId, () => {
      function onMove(moveEvent: PointerEvent): void {
        const deltaY = moveEvent.clientY - startClientY;
        el.style.height = `${snapHeightPx(block.heightPx + deltaY)}px`;
        el.classList.add("event-block--dragging");
      }

      function onUp(): void {
        try {
          handle.releasePointerCapture(downEvent.pointerId);
        } catch {
          // no había captura que soltar.
        }
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
        el.classList.remove("event-block--dragging");

        const finalHeightPx = snapHeightPx(parseFloat(el.style.height));
        const deltaMinutes = Math.round(((finalHeightPx - block.heightPx) / HOUR_HEIGHT_PX) * 60);
        if (deltaMinutes === 0) {
          el.style.height = `${block.heightPx}px`;
          return;
        }
        onEventResize(block.event, deltaMinutes);
      }

      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
    });
  });
}

/** Botón-bloque de evento, compartido entre la vista de día y las columnas de la vista de semana. */
export function createEventBlockButton(
  block: RenderableBlock,
  extraClass: string,
  viewerDate: string,
  onEventClick: EventClickHandler,
  onEventDrag: EventDragHandler,
  onEventResize: EventResizeHandler,
  resolveDateAtPoint?: ResolveDateAtPoint,
): HTMLButtonElement {
  const el = document.createElement("button");
  el.type = "button";
  el.className = `event-block ${extraClass}`.trim();
  el.style.top = `${block.topPx}px`;
  el.style.height = `${block.heightPx}px`;
  el.style.setProperty("--event-color", EVENT_COLOR_VAR[block.event.color]);
  el.style.setProperty("--col-left", block.columnLeftFrac.toString());
  el.style.setProperty("--col-width", block.columnWidthFrac.toString());
  const recurringMark = block.event.kind === "timed" && block.event.isRecurring ? "&#8635; " : "";
  el.innerHTML = `<div>${recurringMark}${escapeHtml(block.event.title)}</div><div class="event-time">${block.startLabel}–${block.endLabel}</div><span class="event-block-resize-handle" aria-hidden="true"></span>`;
  attachDragHandlers(el, block, viewerDate, onEventClick, onEventDrag, resolveDateAtPoint);
  const handle = el.querySelector<HTMLElement>(".event-block-resize-handle");
  if (handle) attachResizeHandle(handle, block, el, onEventResize);
  return el;
}

export function renderDayGrid(
  container: HTMLElement,
  blocks: readonly RenderableBlock[],
  viewerDate: string,
  onEventClick: EventClickHandler,
  onEventDrag: EventDragHandler,
  onEventResize: EventResizeHandler,
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
    grid.appendChild(createEventBlockButton(block, "", viewerDate, onEventClick, onEventDrag, onEventResize));
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
