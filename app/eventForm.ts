import { DEFAULT_EVENT_COLOR, type EventColor } from "../core/model/event.js";
import type { TimedEventInput } from "../db/events.repository.js";
import { colorSwatchesHtml, timezoneFieldHtml } from "./formFields.js";
import { validateInterval } from "./validation.js";

export function renderEventForm(
  container: HTMLElement,
  defaultDate: string,
  defaultTzId: string,
  onSubmit: (event: TimedEventInput) => Promise<void>,
  onCancel: () => void,
): void {
  container.innerHTML = `
    <h2>Nuevo evento</h2>
    <form novalidate>
      <p class="form-error" hidden></p>
      <label>Título <input name="title" required /></label>
      <label>Fecha inicio <input name="startDate" type="date" value="${defaultDate}" required /></label>
      <label>Hora inicio <input name="startTime" type="time" value="09:00" required /></label>
      <label>Fecha fin <input name="endDate" type="date" value="${defaultDate}" required /></label>
      <label>Hora fin <input name="endTime" type="time" value="10:00" required /></label>
      <label>Zona horaria ${timezoneFieldHtml("tz-options-create", defaultTzId)}</label>
      <label>Color ${colorSwatchesHtml("color", DEFAULT_EVENT_COLOR)}</label>
      <div class="form-actions">
        <button type="button" class="pixel-btn" data-action="cancel">Cancelar</button>
        <button type="submit" class="pixel-btn pixel-btn--primary">Crear evento</button>
      </div>
    </form>
  `;

  const form = container.querySelector("form");
  const errorEl = container.querySelector<HTMLElement>(".form-error");
  if (!form || !errorEl) return;

  function showError(message: string): void {
    if (!errorEl) return;
    errorEl.textContent = message;
    errorEl.hidden = false;
  }

  function clearError(): void {
    if (!errorEl) return;
    errorEl.hidden = true;
  }

  container.querySelector('[data-action="cancel"]')?.addEventListener("click", () => {
    clearError();
    onCancel();
  });

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    clearError();
    const data = new FormData(form);
    const event: TimedEventInput = {
      title: String(data.get("title") ?? ""),
      startDate: String(data.get("startDate") ?? ""),
      startTime: `${String(data.get("startTime") ?? "")}:00`,
      endDate: String(data.get("endDate") ?? ""),
      endTime: `${String(data.get("endTime") ?? "")}:00`,
      tzId: String(data.get("tzId") ?? defaultTzId),
      color: String(data.get("color") ?? DEFAULT_EVENT_COLOR) as EventColor,
    };

    if (!event.title.trim()) {
      showError("El título no puede estar vacío.");
      return;
    }
    const intervalError = validateInterval(event.startDate, event.startTime, event.endDate, event.endTime);
    if (intervalError) {
      showError(intervalError);
      return;
    }

    onSubmit(event)
      .then(() => form.reset())
      .catch((err: unknown) => {
        showError(err instanceof Error ? err.message : "No se pudo guardar el evento.");
      });
  });
}
