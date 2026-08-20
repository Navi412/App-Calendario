import { DEFAULT_EVENT_COLOR, type EventColor } from "../core/model/event.js";
import type { Calendar } from "../db/calendars.repository.js";
import { colorSwatchesHtml, EVENT_COLOR_VAR } from "./formFields.js";
import { escapeHtml } from "./util.js";

export interface CalendarSwitcherHandlers {
  readonly onSwitch: (calendarId: string) => void;
  readonly onCreate: (name: string, color: EventColor) => Promise<void>;
  readonly onEdit: (calendarId: string, name: string, color: EventColor) => Promise<void>;
  readonly onDelete: (calendarId: string) => Promise<void>;
  readonly onExport: () => Promise<void>;
  readonly onImport: (file: File) => Promise<void>;
}

let onDocumentClick: ((e: MouseEvent) => void) | null = null;

function closePanel(container: HTMLElement): void {
  const panel = container.querySelector<HTMLElement>(".calendar-switcher-panel");
  if (panel) panel.hidden = true;
  if (onDocumentClick) {
    document.removeEventListener("click", onDocumentClick);
    onDocumentClick = null;
  }
}

/**
 * Selector de calendario en la topbar: el botón siempre muestra el nombre
 * del calendario activo (para que "arriba" se vea en cuál estás), y abre un
 * panel para cambiar de calendario, crear uno nuevo, renombrar/recolorear
 * uno existente o borrar los que sobren.
 */
export function renderCalendarSwitcher(
  container: HTMLElement,
  calendars: readonly Calendar[],
  activeCalendarId: string,
  handlers: CalendarSwitcherHandlers,
): void {
  const activeOrUndefined = calendars.find((c) => c.id === activeCalendarId) ?? calendars[0];
  if (!activeOrUndefined) {
    container.innerHTML = "";
    return;
  }
  const active: Calendar = activeOrUndefined;

  // Estado puramente local a esta llamada: qué fila está en modo edición.
  // No pasa por main.ts -- abrir/cerrar edición no debe disparar un refresh
  // completo del calendario, solo re-pintar el panel.
  let editingId: string | null = null;

  function rowHtml(cal: Calendar): string {
    if (cal.id === editingId) {
      return `
        <li class="calendar-list-item calendar-list-item--editing">
          <form class="calendar-edit-form" novalidate data-id="${cal.id}">
            <input name="name" value="${escapeHtml(cal.name)}" required autocomplete="off" />
            ${colorSwatchesHtml(`editCalendarColor-${cal.id}`, cal.color)}
            <div class="calendar-edit-actions">
              <button type="button" class="pixel-btn" data-action="edit-cancel">Cancelar</button>
              <button type="submit" class="pixel-btn pixel-btn--primary">Guardar</button>
            </div>
          </form>
        </li>
      `;
    }
    return `
      <li class="calendar-list-item${cal.id === active.id ? " is-active" : ""}">
        <button type="button" class="calendar-list-select" data-id="${cal.id}">
          <span class="calendar-dot" style="--cal-color:${EVENT_COLOR_VAR[cal.color]}"></span>
          ${escapeHtml(cal.name)}
        </button>
        <button type="button" class="calendar-list-edit" data-id="${cal.id}" aria-label="Editar ${escapeHtml(cal.name)}">&#9998;</button>
        ${
          calendars.length > 1
            ? `<button type="button" class="calendar-list-delete" data-id="${cal.id}" aria-label="Eliminar ${escapeHtml(cal.name)}">&times;</button>`
            : ""
        }
      </li>
    `;
  }

  function renderPanel(): void {
    const panel = container.querySelector<HTMLElement>(".calendar-switcher-panel");
    if (!panel) return;
    const wasHidden = panel.hidden;

    panel.innerHTML = `
      <ul class="calendar-list">${calendars.map(rowHtml).join("")}</ul>
      <form class="calendar-create-form" novalidate>
        <input name="name" placeholder="Nombre del calendario" required autocomplete="off" />
        ${colorSwatchesHtml("newCalendarColor", DEFAULT_EVENT_COLOR)}
        <button type="submit" class="pixel-btn pixel-btn--primary">+ Añadir calendario</button>
      </form>
      <div class="calendar-ics-actions">
        <button type="button" class="pixel-btn" data-action="ics-export">&#8615; Exportar .ics</button>
        <button type="button" class="pixel-btn" data-action="ics-import">&#8613; Importar .ics</button>
        <input type="file" accept=".ics,text/calendar" class="calendar-ics-file-input" hidden />
      </div>
    `;
    panel.hidden = wasHidden;

    for (const btn of panel.querySelectorAll<HTMLButtonElement>(".calendar-list-select")) {
      btn.addEventListener("click", () => {
        const id = btn.dataset["id"];
        if (id) handlers.onSwitch(id);
        closePanel(container);
      });
    }

    for (const btn of panel.querySelectorAll<HTMLButtonElement>(".calendar-list-edit")) {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        editingId = btn.dataset["id"] ?? null;
        renderPanel();
      });
    }

    for (const btn of panel.querySelectorAll<HTMLButtonElement>(".calendar-list-delete")) {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const id = btn.dataset["id"];
        const name = calendars.find((c) => c.id === id)?.name ?? "";
        if (!id) return;
        if (!window.confirm(`¿Eliminar el calendario "${name}" y todos sus eventos? No se puede deshacer.`)) return;
        void handlers.onDelete(id);
      });
    }

    const editForm = panel.querySelector<HTMLFormElement>(".calendar-edit-form");
    editForm?.querySelector('[data-action="edit-cancel"]')?.addEventListener("click", (e) => {
      e.stopPropagation();
      editingId = null;
      renderPanel();
    });
    editForm?.addEventListener("submit", (e) => {
      e.preventDefault();
      const id = editForm.dataset["id"];
      if (!id) return;
      const data = new FormData(editForm);
      const name = String(data.get("name") ?? "").trim();
      const color = String(data.get(`editCalendarColor-${id}`) ?? DEFAULT_EVENT_COLOR) as EventColor;
      if (!name) return;
      void handlers.onEdit(id, name, color);
    });

    const createForm = panel.querySelector<HTMLFormElement>(".calendar-create-form");
    createForm?.addEventListener("submit", (e) => {
      e.preventDefault();
      const data = new FormData(createForm);
      const name = String(data.get("name") ?? "").trim();
      const color = String(data.get("newCalendarColor") ?? DEFAULT_EVENT_COLOR) as EventColor;
      if (!name) return;
      void handlers.onCreate(name, color);
    });

    const fileInput = panel.querySelector<HTMLInputElement>(".calendar-ics-file-input");
    panel.querySelector('[data-action="ics-export"]')?.addEventListener("click", (e) => {
      e.stopPropagation();
      void handlers.onExport();
    });
    panel.querySelector('[data-action="ics-import"]')?.addEventListener("click", (e) => {
      e.stopPropagation();
      fileInput?.click();
    });
    fileInput?.addEventListener("click", (e) => e.stopPropagation());
    fileInput?.addEventListener("change", () => {
      const file = fileInput.files?.[0];
      fileInput.value = "";
      if (file) void handlers.onImport(file);
    });
  }

  container.innerHTML = `
    <div class="calendar-switcher">
      <button type="button" class="calendar-switcher-toggle pixel-btn">
        <span class="calendar-dot" style="--cal-color:${EVENT_COLOR_VAR[active.color]}"></span>
        <span class="calendar-switcher-name">${escapeHtml(active.name)}</span>
        <span class="calendar-switcher-caret">&#9662;</span>
      </button>
      <div class="calendar-switcher-panel" hidden></div>
    </div>
  `;

  renderPanel();

  const toggle = container.querySelector<HTMLButtonElement>(".calendar-switcher-toggle");
  const panel = container.querySelector<HTMLElement>(".calendar-switcher-panel");

  toggle?.addEventListener("click", (e) => {
    e.stopPropagation();
    if (!panel) return;
    if (panel.hidden) {
      panel.hidden = false;
      onDocumentClick = (evt) => {
        if (!container.contains(evt.target as Node)) closePanel(container);
      };
      document.addEventListener("click", onDocumentClick);
    } else {
      closePanel(container);
    }
  });
}
