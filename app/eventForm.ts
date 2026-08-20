import type { NewTimedEvent } from "../db/events.repository.js";

function timezoneOptions(defaultTzId: string): string {
  let zones: string[];
  try {
    zones = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.(
      "timeZone",
    ) ?? [defaultTzId];
  } catch {
    zones = [defaultTzId];
  }
  return zones
    .map((tz) => `<option value="${tz}" ${tz === defaultTzId ? "selected" : ""}>${tz}</option>`)
    .join("");
}

export function renderEventForm(
  container: HTMLElement,
  defaultDate: string,
  defaultTzId: string,
  onSubmit: (event: NewTimedEvent) => void,
): void {
  container.innerHTML = `
    <form>
      <h2 style="margin:0 0 0.25rem;font-size:1rem;">Nuevo evento (hora absoluta)</h2>
      <label>Título <input name="title" required /></label>
      <label>Fecha inicio <input name="startDate" type="date" value="${defaultDate}" required /></label>
      <label>Hora inicio <input name="startTime" type="time" value="09:00" required /></label>
      <label>Fecha fin <input name="endDate" type="date" value="${defaultDate}" required /></label>
      <label>Hora fin <input name="endTime" type="time" value="10:00" required /></label>
      <label>Zona horaria
        <select name="tzId">${timezoneOptions(defaultTzId)}</select>
      </label>
      <button type="submit">Crear evento</button>
    </form>
  `;

  const form = container.querySelector("form");
  if (!form) return;

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const data = new FormData(form);
    onSubmit({
      title: String(data.get("title") ?? ""),
      startDate: String(data.get("startDate") ?? ""),
      startTime: `${String(data.get("startTime") ?? "")}:00`,
      endDate: String(data.get("endDate") ?? ""),
      endTime: `${String(data.get("endTime") ?? "")}:00`,
      tzId: String(data.get("tzId") ?? defaultTzId),
    });
    form.reset();
  });
}
