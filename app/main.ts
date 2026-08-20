import { DateTime } from "luxon";
import { listTimedEventsInRange, saveTimedEvent } from "../db/events.repository.js";
import { wallTimeToUtcIso } from "../core/timezone/convert.js";
import { groupEventsByViewerDate } from "./eventPresentation.js";
import { layoutDay, renderDayGrid, renderNowLine } from "./dayView.js";
import { renderWeekGrid } from "./weekView.js";
import { renderMonthGrid } from "./monthView.js";
import { renderEventForm } from "./eventForm.js";
import { CALENDAR_ICON_SVG } from "./icons.js";

type ViewMode = "day" | "week" | "month";

const viewerTzId = Intl.DateTimeFormat().resolvedOptions().timeZone;
const todayIso = (): string => DateTime.now().setZone(viewerTzId).toISODate() as string;

let currentDate = todayIso();
let currentView: ViewMode = "day";

const app = document.getElementById("app");
if (!app) throw new Error("No se encontró #app");

app.innerHTML = `
  <div class="topbar">
    ${CALENDAR_ICON_SVG}
    <h1 class="app-title pixel-heading">App Calendario</h1>
    <div class="day-nav">
      <button id="today-btn" class="pixel-btn">Hoy</button>
      <button id="prev-btn" class="pixel-btn">&larr;</button>
      <span id="current-date-label" class="current-date-label"></span>
      <button id="next-btn" class="pixel-btn">&rarr;</button>
    </div>
    <div class="view-switcher">
      <button data-view="day">Día</button>
      <button data-view="week">Semana</button>
      <button data-view="month">Mes</button>
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
const viewButtons = Array.from(document.querySelectorAll<HTMLButtonElement>(".view-switcher button"));

function capitalize(text: string): string {
  return text.length === 0 ? text : text[0]!.toUpperCase() + text.slice(1);
}

/** Rango [inicio, fin) visible en UTC, y la etiqueta a mostrar, según el modo de vista. */
function computeVisibleRange(): { startUtc: string; endUtc: string; labelText: string } {
  const anchor = DateTime.fromISO(currentDate).setLocale("es");

  if (currentView === "day") {
    const next = anchor.plus({ days: 1 });
    return {
      startUtc: wallTimeToUtcIso(currentDate, "00:00:00", viewerTzId),
      endUtc: wallTimeToUtcIso(next.toISODate() as string, "00:00:00", viewerTzId),
      labelText: capitalize(anchor.toFormat("d LLL yyyy")),
    };
  }

  if (currentView === "week") {
    const weekStart = anchor.startOf("week");
    const weekEndExclusive = weekStart.plus({ days: 7 });
    return {
      startUtc: wallTimeToUtcIso(weekStart.toISODate() as string, "00:00:00", viewerTzId),
      endUtc: wallTimeToUtcIso(weekEndExclusive.toISODate() as string, "00:00:00", viewerTzId),
      labelText: `${weekStart.toFormat("d LLL")} – ${weekStart.plus({ days: 6 }).toFormat("d LLL yyyy")}`,
    };
  }

  const monthStart = anchor.startOf("month");
  const gridStart = monthStart.startOf("week");
  const gridEndExclusive = monthStart.endOf("month").endOf("week").plus({ days: 1 });
  return {
    startUtc: wallTimeToUtcIso(gridStart.toISODate() as string, "00:00:00", viewerTzId),
    endUtc: wallTimeToUtcIso(gridEndExclusive.toISODate() as string, "00:00:00", viewerTzId),
    labelText: capitalize(monthStart.toFormat("LLLL yyyy")),
  };
}

async function refresh(): Promise<void> {
  for (const btn of viewButtons) {
    btn.classList.toggle("is-active", btn.dataset["view"] === currentView);
  }

  const { startUtc, endUtc, labelText } = computeVisibleRange();
  label.textContent = labelText;

  const events = await listTimedEventsInRange(startUtc, endUtc);

  if (currentView === "day") {
    gridContainer.className = "";
    const blocks = layoutDay(events, currentDate, viewerTzId);
    const grid = renderDayGrid(gridContainer, blocks);
    renderNowLine(grid, currentDate, viewerTzId);
  } else if (currentView === "week") {
    gridContainer.className = "week-view";
    const weekStart = DateTime.fromISO(currentDate).startOf("week");
    const weekDates = Array.from({ length: 7 }, (_, i) => weekStart.plus({ days: i }).toISODate() as string);
    renderWeekGrid(gridContainer, weekDates, groupEventsByViewerDate(events, viewerTzId), viewerTzId, todayIso());
  } else {
    gridContainer.className = "month-view";
    renderMonthGrid(gridContainer, currentDate, groupEventsByViewerDate(events, viewerTzId), viewerTzId, todayIso());
  }

  renderEventForm(formContainer, currentDate, viewerTzId, async (newEvent) => {
    await saveTimedEvent(newEvent);
    await refresh();
  });
}

createToggle.addEventListener("click", () => {
  formContainer.hidden = !formContainer.hidden;
});

for (const btn of viewButtons) {
  btn.addEventListener("click", () => {
    currentView = btn.dataset["view"] as ViewMode;
    void refresh();
  });
}

document.getElementById("today-btn")?.addEventListener("click", () => {
  currentDate = todayIso();
  void refresh();
});

document.getElementById("prev-btn")?.addEventListener("click", () => {
  const dt = DateTime.fromISO(currentDate);
  const step = currentView === "day" ? { days: -1 } : currentView === "week" ? { days: -7 } : { months: -1 };
  currentDate = dt.plus(step).toISODate() as string;
  void refresh();
});

document.getElementById("next-btn")?.addEventListener("click", () => {
  const dt = DateTime.fromISO(currentDate);
  const step = currentView === "day" ? { days: 1 } : currentView === "week" ? { days: 7 } : { months: 1 };
  currentDate = dt.plus(step).toISODate() as string;
  void refresh();
});

// Reposiciona la línea de "ahora" cada minuto sin volver a pedir los eventos (solo aplica en día/semana).
setInterval(() => {
  if (currentView === "day") {
    const grid = gridContainer.querySelector<HTMLElement>(".day-grid");
    if (grid) renderNowLine(grid, currentDate, viewerTzId);
  } else if (currentView === "week") {
    for (const column of gridContainer.querySelectorAll<HTMLElement>(".week-day-column")) {
      const date = column.dataset["date"];
      if (date) renderNowLine(column, date, viewerTzId);
    }
  }
}, 60_000);

void refresh();
