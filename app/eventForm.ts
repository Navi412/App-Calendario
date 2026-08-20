import { DateTime } from "luxon";
import { DEFAULT_EVENT_COLOR, type EventColor } from "../core/model/event.js";
import type { RecurrenceFrequency } from "../core/recurrence/expandRecurrence.js";
import type { AllDayEventInput, FloatingEventInput, TimedEventInput } from "../db/events.repository.js";
import { colorSwatchesHtml, timezoneFieldHtml } from "./formFields.js";
import { validateAllDayInterval, validateInterval } from "./validation.js";

const REPEAT_OPTIONS: readonly { readonly value: "" | RecurrenceFrequency; readonly label: string }[] = [
  { value: "", label: "No se repite" },
  { value: "DAILY", label: "Diariamente" },
  { value: "WEEKLY", label: "Semanalmente" },
  { value: "MONTHLY", label: "Mensualmente" },
  { value: "YEARLY", label: "Anualmente" },
];

export type NewEventSubmission =
  | { readonly kind: "timed"; readonly input: TimedEventInput }
  | { readonly kind: "floating"; readonly input: FloatingEventInput }
  | { readonly kind: "allday"; readonly input: AllDayEventInput };

type FormKind = NewEventSubmission["kind"];
// Solo se ofrecen estos dos tipos al crear -- "flotante" existe en el modelo
// y sigue siendo editable si ya hay eventos así guardados, pero se quitó del
// selector para simplificar (a petición del usuario: menos opciones, más
// legible).
const FORM_KINDS: readonly FormKind[] = ["timed", "allday"];
const FORM_KIND_LABEL: Record<FormKind, string> = {
  timed: "Hora específica",
  floating: "Hora flotante",
  allday: "Día completo",
};

export function renderEventForm(
  container: HTMLElement,
  defaultDate: string,
  defaultTzId: string,
  onSubmit: (submission: NewEventSubmission) => Promise<void>,
  onCancel: () => void,
): void {
  container.innerHTML = `
    <h2>Nuevo evento</h2>
    <form novalidate>
      <p class="form-error" hidden></p>
      <div class="kind-switcher" role="radiogroup" aria-label="Tipo de evento">
        ${FORM_KINDS.map(
          (kind, i) => `
          <label class="kind-option">
            <input type="radio" name="kind" value="${kind}" ${i === 0 ? "checked" : ""} />
            ${FORM_KIND_LABEL[kind]}
          </label>
        `,
        ).join("")}
      </div>
      <label>Título <input name="title" required /></label>

      <div data-kind-fields="timed">
        <label>Fecha inicio <input name="startDate" type="date" value="${defaultDate}" required /></label>
        <label>Hora inicio <input name="startTime" type="time" value="09:00" required /></label>
        <label>Fecha fin <input name="endDate" type="date" value="${defaultDate}" required /></label>
        <label>Hora fin <input name="endTime" type="time" value="10:00" required /></label>
      </div>
      <div data-kind-fields="timed">
        <label>Zona horaria ${timezoneFieldHtml("tz-options-create", defaultTzId)}</label>
        <label>Repetir
          <select name="repeatFreq">
            ${REPEAT_OPTIONS.map((opt) => `<option value="${opt.value}">${opt.label}</option>`).join("")}
          </select>
        </label>
        <label data-repeat-until hidden>Hasta (opcional) <input name="repeatUntil" type="date" /></label>
      </div>

      <div data-kind-fields="allday" hidden>
        <label>Fecha inicio <input name="alldayStartDate" type="date" value="${defaultDate}" /></label>
        <label>Fecha fin <input name="alldayEndDate" type="date" value="${defaultDate}" /></label>
      </div>

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

  function currentKind(): FormKind {
    const checked = container.querySelector<HTMLInputElement>('input[name="kind"]:checked');
    return (checked?.value as FormKind | undefined) ?? "timed";
  }

  function syncKindFields(): void {
    const kind = currentKind();
    for (const group of container.querySelectorAll<HTMLElement>("[data-kind-fields]")) {
      const kinds = (group.dataset["kindFields"] ?? "").split(",");
      group.hidden = !kinds.includes(kind);
    }
  }

  for (const radio of container.querySelectorAll<HTMLInputElement>('input[name="kind"]')) {
    radio.addEventListener("change", syncKindFields);
  }
  syncKindFields();

  const repeatFreqSelect = container.querySelector<HTMLSelectElement>('select[name="repeatFreq"]');
  const repeatUntilGroup = container.querySelector<HTMLElement>("[data-repeat-until]");
  repeatFreqSelect?.addEventListener("change", () => {
    if (repeatUntilGroup) repeatUntilGroup.hidden = repeatFreqSelect.value === "";
  });

  container.querySelector('[data-action="cancel"]')?.addEventListener("click", () => {
    clearError();
    onCancel();
  });

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    clearError();
    const data = new FormData(form);
    const title = String(data.get("title") ?? "");
    const color = String(data.get("color") ?? DEFAULT_EVENT_COLOR) as EventColor;
    const kind = currentKind();

    if (!title.trim()) {
      showError("El título no puede estar vacío.");
      return;
    }

    let submission: NewEventSubmission;

    if (kind === "allday") {
      const startDate = String(data.get("alldayStartDate") ?? "");
      const endDateInclusive = String(data.get("alldayEndDate") ?? "");
      const intervalError = validateAllDayInterval(startDate, endDateInclusive);
      if (intervalError) {
        showError(intervalError);
        return;
      }
      const endDate = DateTime.fromISO(endDateInclusive).plus({ days: 1 }).toISODate() as string;
      submission = { kind: "allday", input: { title, color, startDate, endDate } };
    } else {
      const startDate = String(data.get("startDate") ?? "");
      const startTime = `${String(data.get("startTime") ?? "")}:00`;
      const endDate = String(data.get("endDate") ?? "");
      const endTime = `${String(data.get("endTime") ?? "")}:00`;
      const intervalError = validateInterval(startDate, startTime, endDate, endTime);
      if (intervalError) {
        showError(intervalError);
        return;
      }
      if (kind === "timed") {
        const tzId = String(data.get("tzId") ?? defaultTzId);
        const repeatFreq = String(data.get("repeatFreq") ?? "") as "" | RecurrenceFrequency;
        const repeatUntil = String(data.get("repeatUntil") ?? "");
        const rrule = repeatFreq
          ? { freq: repeatFreq, ...(repeatUntil ? { until: repeatUntil } : {}) }
          : undefined;
        submission = {
          kind: "timed",
          input: { title, color, startDate, startTime, endDate, endTime, tzId, ...(rrule ? { rrule } : {}) },
        };
      } else {
        submission = { kind: "floating", input: { title, color, startDate, startTime, endDate, endTime } };
      }
    }

    onSubmit(submission)
      .then(() => form.reset())
      .catch((err: unknown) => {
        showError(err instanceof Error ? err.message : "No se pudo guardar el evento.");
      });
  });
}
