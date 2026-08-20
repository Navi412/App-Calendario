import { DateTime } from "luxon";
import { listTimedEventsForDay, saveTimedEvent } from "../db/events.repository.js";
import { wallTimeToUtcIso } from "../core/timezone/convert.js";
import { layoutDay, renderDayGrid, renderNowLine } from "./dayView.js";
import { renderEventForm } from "./eventForm.js";
import { CALENDAR_ICON_SVG } from "./icons.js";

const viewerTzId = Intl.DateTimeFormat().resolvedOptions().timeZone;
let currentDate = DateTime.now().toISODate() as string;

const app = document.getElementById("app");
if (!app) throw new Error("No se encontró #app");

app.innerHTML = `
  <div class="topbar">
    ${CALENDAR_ICON_SVG}
    <h1 class="app-title pixel-heading">App Calendario</h1>
    <div class="day-nav">
      <button id="today-btn" class="pixel-btn">Hoy</button>
      <button id="prev-day" class="pixel-btn">&larr;</button>
      <span id="current-date-label" class="current-date-label"></span>
      <button id="next-day" class="pixel-btn">&rarr;</button>
    </div>
    <span class="viewer-tz">zona del visor: ${viewerTzId}</span>
  </div>
  <div class="layout">
    <div class="sidebar">
      <button id="create-toggle" class="pixel-btn pixel-btn--primary create-btn">+ Crear</button>
      <div id="form-container" class="event-panel" hidden></div>
    </div>
    <div id="grid-container"></div>
  </div>
`;

const label = document.getElementById("current-date-label") as HTMLElement;
const formContainer = document.getElementById("form-container") as HTMLElement;
const gridContainer = document.getElementById("grid-container") as HTMLElement;
const createToggle = document.getElementById("create-toggle") as HTMLButtonElement;

async function refresh(): Promise<void> {
  label.textContent = currentDate;

  const nextDate = DateTime.fromISO(currentDate).plus({ days: 1 }).toISODate() as string;
  const rangeStartUtc = wallTimeToUtcIso(currentDate, "00:00:00", viewerTzId);
  const rangeEndUtc = wallTimeToUtcIso(nextDate, "00:00:00", viewerTzId);

  const events = await listTimedEventsForDay(rangeStartUtc, rangeEndUtc);
  const blocks = layoutDay(events, currentDate, viewerTzId);
  const grid = renderDayGrid(gridContainer, blocks);
  renderNowLine(grid, currentDate, viewerTzId);

  renderEventForm(formContainer, currentDate, viewerTzId, async (newEvent) => {
    await saveTimedEvent(newEvent);
    await refresh();
  });
}

createToggle.addEventListener("click", () => {
  formContainer.hidden = !formContainer.hidden;
});

document.getElementById("today-btn")?.addEventListener("click", () => {
  currentDate = DateTime.now().toISODate() as string;
  void refresh();
});

document.getElementById("prev-day")?.addEventListener("click", () => {
  currentDate = DateTime.fromISO(currentDate).minus({ days: 1 }).toISODate() as string;
  void refresh();
});

document.getElementById("next-day")?.addEventListener("click", () => {
  currentDate = DateTime.fromISO(currentDate).plus({ days: 1 }).toISODate() as string;
  void refresh();
});

// Reposiciona la línea de "ahora" cada minuto sin volver a pedir los eventos.
setInterval(() => {
  const grid = gridContainer.querySelector<HTMLElement>(".day-grid");
  if (grid) renderNowLine(grid, currentDate, viewerTzId);
}, 60_000);

void refresh();
