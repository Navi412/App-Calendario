import { DateTime } from "luxon";
import type { CalendarEvent, EventColor } from "../core/model/event.js";
import type { AllDayEventInput, FloatingEventInput, TimedEventInput } from "../db/events.repository.js";
import { colorSwatchesHtml, timezoneFieldHtml } from "./formFields.js";
import { escapeHtml } from "./util.js";
import { validateAllDayInterval, validateInterval } from "./validation.js";

export type EventPatch =
  | { readonly kind: "timed"; readonly input: TimedEventInput }
  | { readonly kind: "floating"; readonly input: FloatingEventInput }
  | { readonly kind: "allday"; readonly input: AllDayEventInput };

export interface EventEditModalHandlers {
  readonly onSave: (id: string, patch: EventPatch) => Promise<void>;
  readonly onDelete: (id: string) => Promise<void>;
  /** Mueve solo esta ocurrencia de la serie (DESIGN.md §1.2). `originalStartDate` identifica la ocurrencia a mover, no su nuevo horario. */
  readonly onMoveInstance: (masterId: string, originalStartDate: string, patch: TimedEventInput) => Promise<void>;
  /** Cancela solo esta ocurrencia de la serie, sin afectar a las demás. */
  readonly onCancelInstance: (masterId: string, originalStartDate: string) => Promise<void>;
  /** "Editar esta y las siguientes" (DESIGN.md §1.3): parte la serie en dos. `cutDate` es la ocurrencia donde arranca el cambio. */
  readonly onMoveFollowing: (masterId: string, cutDate: string, patch: TimedEventInput) => Promise<void>;
  /** "Eliminar esta y las siguientes" (DESIGN.md §1.3): cierra la serie antes de `cutDate`, sin abrir una nueva. */
  readonly onDeleteFollowing: (masterId: string, cutDate: string) => Promise<void>;
  /** Renombra la serie completa (todas sus ocurrencias) sin tocar fecha/hora/rrule. */
  readonly onRenameSeries: (masterId: string, title: string) => Promise<void>;
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

function fieldsHtml(event: CalendarEvent): string {
  if (event.kind === "allday") {
    // endDate se guarda exclusivo; se muestra el último día inclusivo.
    const lastDayInclusive = DateTime.fromISO(event.endDate).minus({ days: 1 }).toISODate() as string;
    return `
      <label>Fecha inicio <input name="startDate" type="date" required value="${event.startDate}" /></label>
      <label>Fecha fin <input name="endDate" type="date" required value="${lastDayInclusive}" /></label>
    `;
  }

  const tzField =
    event.kind === "timed" ? `<label>Zona horaria ${timezoneFieldHtml("tz-options-edit", event.tzId)}</label>` : "";

  return `
    <label>Fecha inicio <input name="startDate" type="date" required value="${event.startDate}" /></label>
    <label>Hora inicio <input name="startTime" type="time" required value="${event.startTime.slice(0, 5)}" /></label>
    <label>Fecha fin <input name="endDate" type="date" required value="${event.endDate}" /></label>
    <label>Hora fin <input name="endTime" type="time" required value="${event.endTime.slice(0, 5)}" /></label>
    ${tzField}
  `;
}

/**
 * Instancias de una serie recurrente: no hay UI para editar título/color/tz
 * de la serie completa desde aquí (eso reescribiría el maestro sin querer),
 * pero sí se puede mover o cancelar SOLO esta ocurrencia via
 * `event_exceptions` (DESIGN.md §1.2), o eliminar la serie entera.
 */
function isRecurringInstance(
  event: CalendarEvent,
): event is Extract<CalendarEvent, { kind: "timed" }> & { isRecurring: true } {
  return event.kind === "timed" && event.isRecurring === true;
}

type DeleteTarget = "series" | "instance" | "following";

/** Modal de edición/borrado de un evento existente, de cualquiera de los tres tipos. El tipo (kind) no se puede cambiar tras crearlo. */
export function openEventEditModal(event: CalendarEvent, handlers: EventEditModalHandlers): void {
  closeEventEditModal();

  const recurring = isRecurringInstance(event);
  let pendingDeleteTarget: DeleteTarget = "series";

  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
    <div class="modal-panel event-panel" role="dialog" aria-modal="true" aria-label="Editar evento">
      <button type="button" class="modal-close" aria-label="Cerrar">&times;</button>
      <h2>Editar evento</h2>
      ${
        recurring
          ? `
        <p class="recurring-note">"${escapeHtml(event.title)}" pertenece a una serie recurrente. Puedes mover o eliminar solo esta ocurrencia, esta y las siguientes, o toda la serie.</p>
        <div class="series-title-row">
          <span class="series-title-display">${escapeHtml(event.title)}</span>
          <button type="button" class="pixel-btn" data-action="rename-series-start">&#9998; Renombrar serie</button>
        </div>
        <form class="rename-series-form" novalidate hidden>
          <input name="seriesTitle" value="${escapeHtml(event.title)}" required autocomplete="off" />
          <div class="form-actions">
            <button type="button" class="pixel-btn" data-action="rename-series-cancel">Cancelar</button>
            <button type="submit" class="pixel-btn pixel-btn--primary">Guardar título</button>
          </div>
        </form>
        <form novalidate data-instance-form>
          <p class="form-error" hidden></p>
          <label>Fecha <input name="startDate" type="date" required value="${event.startDate}" /></label>
          <label>Hora inicio <input name="startTime" type="time" required value="${event.startTime.slice(0, 5)}" /></label>
          <label>Fecha fin <input name="endDate" type="date" required value="${event.endDate}" /></label>
          <label>Hora fin <input name="endTime" type="time" required value="${event.endTime.slice(0, 5)}" /></label>
          <label class="kind-option"><input type="checkbox" name="applyToFollowing" /> Aplicar a esta y las siguientes</label>
          <div class="form-actions">
            <button type="button" class="pixel-btn" data-action="delete-instance-start">Eliminar</button>
            <button type="submit" class="pixel-btn pixel-btn--primary" data-instance-submit>Mover esta instancia</button>
          </div>
        </form>
        <div class="form-actions series-delete-actions">
          <button type="button" class="pixel-btn pixel-btn--danger" data-action="delete-series-start">Eliminar toda la serie</button>
        </div>
      `
          : `
        <form novalidate>
          <p class="form-error" hidden></p>
          <label>Título <input name="title" required value="${escapeHtml(event.title)}" /></label>
          ${fieldsHtml(event)}
          <label>Color ${colorSwatchesHtml("color", event.color)}</label>
          <div class="form-actions">
            <button type="button" class="pixel-btn" data-action="delete-series-start">Eliminar</button>
            <button type="submit" class="pixel-btn pixel-btn--primary">Guardar cambios</button>
          </div>
        </form>
      `
      }
      <div class="modal-delete-confirm" hidden>
        <span data-delete-confirm-text></span>
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

  const form = backdrop.querySelector<HTMLFormElement>("form:not(.rename-series-form)");
  const recurringNote = backdrop.querySelector<HTMLElement>(".recurring-note");
  const seriesDeleteActions = backdrop.querySelector<HTMLElement>(".series-delete-actions");
  const errorEl = backdrop.querySelector<HTMLElement>(".form-error");
  const deleteConfirm = backdrop.querySelector<HTMLElement>(".modal-delete-confirm");
  const deleteConfirmText = backdrop.querySelector<HTMLElement>("[data-delete-confirm-text]");

  function showError(message: string): void {
    if (!errorEl) return;
    errorEl.textContent = message;
    errorEl.hidden = false;
  }

  const applyToFollowingCheckbox = backdrop.querySelector<HTMLInputElement>('input[name="applyToFollowing"]');
  const instanceSubmitBtn = backdrop.querySelector<HTMLElement>("[data-instance-submit]");
  applyToFollowingCheckbox?.addEventListener("change", () => {
    if (instanceSubmitBtn) {
      instanceSubmitBtn.textContent = applyToFollowingCheckbox.checked ? "Mover esta y las siguientes" : "Mover esta instancia";
    }
  });

  const seriesTitleRow = backdrop.querySelector<HTMLElement>(".series-title-row");
  const renameSeriesForm = backdrop.querySelector<HTMLFormElement>(".rename-series-form");

  function startDelete(target: DeleteTarget): void {
    pendingDeleteTarget = target;
    if (form) form.hidden = true;
    if (recurringNote) recurringNote.hidden = true;
    if (seriesDeleteActions) seriesDeleteActions.hidden = true;
    if (seriesTitleRow) seriesTitleRow.hidden = true;
    if (renameSeriesForm) renameSeriesForm.hidden = true;
    if (deleteConfirmText) {
      deleteConfirmText.textContent =
        target === "instance"
          ? `¿Eliminar esta instancia de "${event.title}"? No se puede deshacer.`
          : target === "following"
            ? `¿Eliminar esta y las siguientes instancias de "${event.title}"? No se puede deshacer.`
            : `¿Eliminar "${event.title}"? No se puede deshacer.`;
    }
    if (deleteConfirm) deleteConfirm.hidden = false;
  }

  backdrop.querySelector('[data-action="delete-series-start"]')?.addEventListener("click", () => startDelete("series"));
  backdrop.querySelector('[data-action="delete-instance-start"]')?.addEventListener("click", () => {
    startDelete(applyToFollowingCheckbox?.checked ? "following" : "instance");
  });
  backdrop.querySelector('[data-action="delete-cancel"]')?.addEventListener("click", () => {
    if (form) form.hidden = false;
    if (recurringNote) recurringNote.hidden = false;
    if (seriesDeleteActions) seriesDeleteActions.hidden = false;
    if (seriesTitleRow) seriesTitleRow.hidden = false;
    if (deleteConfirm) deleteConfirm.hidden = true;
  });

  backdrop.querySelector('[data-action="rename-series-start"]')?.addEventListener("click", () => {
    if (seriesTitleRow) seriesTitleRow.hidden = true;
    if (renameSeriesForm) renameSeriesForm.hidden = false;
  });
  backdrop.querySelector('[data-action="rename-series-cancel"]')?.addEventListener("click", () => {
    if (renameSeriesForm) renameSeriesForm.hidden = true;
    if (seriesTitleRow) seriesTitleRow.hidden = false;
  });
  renameSeriesForm?.addEventListener("submit", (e) => {
    e.preventDefault();
    const data = new FormData(renameSeriesForm);
    const title = String(data.get("seriesTitle") ?? "").trim();
    if (!title) {
      showError("El título no puede estar vacío.");
      return;
    }
    handlers
      .onRenameSeries(event.id, title)
      .then(closeEventEditModal)
      .catch((err: unknown) => showError(err instanceof Error ? err.message : "No se pudo renombrar la serie."));
  });
  backdrop.querySelector('[data-action="delete-confirm"]')?.addEventListener("click", () => {
    const action =
      pendingDeleteTarget === "instance"
        ? handlers.onCancelInstance(event.id, event.startDate)
        : pendingDeleteTarget === "following"
          ? handlers.onDeleteFollowing(event.id, event.startDate)
          : handlers.onDelete(event.id);
    action
      .then(closeEventEditModal)
      .catch((err: unknown) => showError(err instanceof Error ? err.message : "No se pudo eliminar el evento."));
  });

  form?.addEventListener("submit", (e) => {
    e.preventDefault();
    const data = new FormData(form);

    if (recurring) {
      const startDate = String(data.get("startDate") ?? "");
      const startTime = `${String(data.get("startTime") ?? "")}:00`;
      const endDate = String(data.get("endDate") ?? "");
      const endTime = `${String(data.get("endTime") ?? "")}:00`;
      const intervalError = validateInterval(startDate, startTime, endDate, endTime);
      if (intervalError) {
        showError(intervalError);
        return;
      }
      const patch: TimedEventInput = {
        title: event.title,
        color: event.color,
        startDate,
        startTime,
        endDate,
        endTime,
        tzId: event.tzId,
      };
      const action = applyToFollowingCheckbox?.checked
        ? handlers.onMoveFollowing(event.id, event.startDate, patch)
        : handlers.onMoveInstance(event.id, event.startDate, patch);
      action
        .then(closeEventEditModal)
        .catch((err: unknown) => showError(err instanceof Error ? err.message : "No se pudo mover esta instancia."));
      return;
    }

    const title = String(data.get("title") ?? "");
    const color = String(data.get("color") ?? event.color) as EventColor;

    if (!title.trim()) {
      showError("El título no puede estar vacío.");
      return;
    }

    let patch: EventPatch;

    if (event.kind === "allday") {
      const startDate = String(data.get("startDate") ?? "");
      const endDateInclusive = String(data.get("endDate") ?? "");
      const intervalError = validateAllDayInterval(startDate, endDateInclusive);
      if (intervalError) {
        showError(intervalError);
        return;
      }
      const endDate = DateTime.fromISO(endDateInclusive).plus({ days: 1 }).toISODate() as string;
      patch = { kind: "allday", input: { title, color, startDate, endDate } };
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
      if (event.kind === "timed") {
        const tzId = String(data.get("tzId") ?? event.tzId);
        patch = { kind: "timed", input: { title, color, startDate, startTime, endDate, endTime, tzId } };
      } else {
        patch = { kind: "floating", input: { title, color, startDate, startTime, endDate, endTime } };
      }
    }

    handlers
      .onSave(event.id, patch)
      .then(closeEventEditModal)
      .catch((err: unknown) => showError(err instanceof Error ? err.message : "No se pudo guardar el evento."));
  });
}
