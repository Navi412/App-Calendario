import type { EventColor, TimedEvent } from "../core/model/event.js";
import type { TimedEventInput } from "../db/events.repository.js";
import { colorSwatchesHtml, timezoneFieldHtml } from "./formFields.js";
import { escapeHtml } from "./util.js";
import { validateInterval } from "./validation.js";

export interface EventEditModalHandlers {
  readonly onSave: (id: string, patch: TimedEventInput) => Promise<void>;
  readonly onDelete: (id: string) => Promise<void>;
}

let activeBackdrop: HTMLElement | null = null;

function onKeydown(e: KeyboardEvent): void {
  if (e.key === "Escape") closeEventEditModal();
}

export function closeEventEditModal(): void {
  activeBackdrop?.remove();
  activeBackdrop = null;
  document.removeEventListener("keydown", onKeydown);
}

/** Modal de edición/borrado de un evento existente. Se abre por encima de cualquier vista (día, semana o mes). */
export function openEventEditModal(event: TimedEvent, handlers: EventEditModalHandlers): void {
  closeEventEditModal();

  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
    <div class="modal-panel event-panel" role="dialog" aria-modal="true" aria-label="Editar evento">
      <button type="button" class="modal-close" aria-label="Cerrar">&times;</button>
      <h2>Editar evento</h2>
      <form novalidate>
        <p class="form-error" hidden></p>
        <label>Título <input name="title" required value="${escapeHtml(event.title)}" /></label>
        <label>Fecha inicio <input name="startDate" type="date" required value="${event.startDate}" /></label>
        <label>Hora inicio <input name="startTime" type="time" required value="${event.startTime.slice(0, 5)}" /></label>
        <label>Fecha fin <input name="endDate" type="date" required value="${event.endDate}" /></label>
        <label>Hora fin <input name="endTime" type="time" required value="${event.endTime.slice(0, 5)}" /></label>
        <label>Zona horaria ${timezoneFieldHtml("tz-options-edit", event.tzId)}</label>
        <label>Color ${colorSwatchesHtml("color", event.color)}</label>
        <div class="form-actions">
          <button type="button" class="pixel-btn" data-action="delete-start">Eliminar</button>
          <button type="submit" class="pixel-btn pixel-btn--primary">Guardar cambios</button>
        </div>
      </form>
      <div class="modal-delete-confirm" hidden>
        <span>¿Eliminar "${escapeHtml(event.title)}"? No se puede deshacer.</span>
        <div class="form-actions">
          <button type="button" class="pixel-btn" data-action="delete-cancel">Cancelar</button>
          <button type="button" class="pixel-btn pixel-btn--danger" data-action="delete-confirm">Sí, eliminar</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(backdrop);
  activeBackdrop = backdrop;
  document.addEventListener("keydown", onKeydown);

  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) closeEventEditModal();
  });
  backdrop.querySelector(".modal-close")?.addEventListener("click", closeEventEditModal);

  const form = backdrop.querySelector<HTMLFormElement>("form");
  const errorEl = backdrop.querySelector<HTMLElement>(".form-error");
  const deleteConfirm = backdrop.querySelector<HTMLElement>(".modal-delete-confirm");

  function showError(message: string): void {
    if (!errorEl) return;
    errorEl.textContent = message;
    errorEl.hidden = false;
  }

  backdrop.querySelector('[data-action="delete-start"]')?.addEventListener("click", () => {
    if (form) form.hidden = true;
    if (deleteConfirm) deleteConfirm.hidden = false;
  });
  backdrop.querySelector('[data-action="delete-cancel"]')?.addEventListener("click", () => {
    if (form) form.hidden = false;
    if (deleteConfirm) deleteConfirm.hidden = true;
  });
  backdrop.querySelector('[data-action="delete-confirm"]')?.addEventListener("click", () => {
    handlers
      .onDelete(event.id)
      .then(closeEventEditModal)
      .catch((err: unknown) => showError(err instanceof Error ? err.message : "No se pudo eliminar el evento."));
  });

  form?.addEventListener("submit", (e) => {
    e.preventDefault();
    const data = new FormData(form);
    const patch: TimedEventInput = {
      title: String(data.get("title") ?? ""),
      startDate: String(data.get("startDate") ?? ""),
      startTime: `${String(data.get("startTime") ?? "")}:00`,
      endDate: String(data.get("endDate") ?? ""),
      endTime: `${String(data.get("endTime") ?? "")}:00`,
      tzId: String(data.get("tzId") ?? event.tzId),
      color: String(data.get("color") ?? event.color) as EventColor,
    };

    if (!patch.title.trim()) {
      showError("El título no puede estar vacío.");
      return;
    }
    const intervalError = validateInterval(patch.startDate, patch.startTime, patch.endDate, patch.endTime);
    if (intervalError) {
      showError(intervalError);
      return;
    }

    handlers
      .onSave(event.id, patch)
      .then(closeEventEditModal)
      .catch((err: unknown) => showError(err instanceof Error ? err.message : "No se pudo guardar el evento."));
  });
}
