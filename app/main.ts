import { DateTime } from "luxon";
import { listTimedEventsForDay, saveTimedEvent } from "../db/events.repository.js";
import { wallTimeToUtcIso } from "../core/timezone/convert.js";
import { layoutDay, renderDayGrid } from "./dayView.js";
import { renderEventForm } from "./eventForm.js";

const viewerTzId = Intl.DateTimeFormat().resolvedOptions().timeZone;
let currentDate = DateTime.now().toISODate() as string;

const app = document.getElementById("app");
if (!app) throw new Error("No se encontró #app");

app.innerHTML = `
  <h1>App Calendario</h1>
  <div class="day-nav">
    <button id="prev-day">&larr;</button>
    <strong id="current-date-label"></strong>
    <button id="next-day">&rarr;</button>
    <span style="color:#888;font-size:0.8rem;">zona del visor: ${viewerTzId}</span>
  </div>
  <div class="layout">
    <div id="form-container"></div>
    <div id="grid-container"></div>
  </div>
`;

const label = document.getElementById("current-date-label") as HTMLElement;
const formContainer = document.getElementById("form-container") as HTMLElement;
const gridContainer = document.getElementById("grid-container") as HTMLElement;

async function refresh(): Promise<void> {
  label.textContent = currentDate;

  const nextDate = DateTime.fromISO(currentDate).plus({ days: 1 }).toISODate() as string;
  const rangeStartUtc = wallTimeToUtcIso(currentDate, "00:00:00", viewerTzId);
  const rangeEndUtc = wallTimeToUtcIso(nextDate, "00:00:00", viewerTzId);

  const events = await listTimedEventsForDay(rangeStartUtc, rangeEndUtc);
  const blocks = layoutDay(events, currentDate, viewerTzId);
  renderDayGrid(gridContainer, blocks);

  renderEventForm(formContainer, currentDate, viewerTzId, async (newEvent) => {
    await saveTimedEvent(newEvent);
    await refresh();
  });
}

document.getElementById("prev-day")?.addEventListener("click", () => {
  currentDate = DateTime.fromISO(currentDate).minus({ days: 1 }).toISODate() as string;
  void refresh();
});

document.getElementById("next-day")?.addEventListener("click", () => {
  currentDate = DateTime.fromISO(currentDate).plus({ days: 1 }).toISODate() as string;
  void refresh();
});

void refresh();
