import { EVENT_COLORS, type EventColor } from "../core/model/event.js";

/** Mapeo de la clave de color (dato del evento) al token visual de la paleta pixel (detalle de presentación). */
export const EVENT_COLOR_VAR: Record<EventColor, string> = {
  blue: "var(--accent-blue)",
  green: "var(--accent-green)",
  yellow: "var(--accent-yellow)",
  pink: "var(--accent-pink)",
  red: "var(--accent-red)",
};

const EVENT_COLOR_LABEL: Record<EventColor, string> = {
  blue: "Azul",
  green: "Verde",
  yellow: "Amarillo",
  pink: "Rosa",
  red: "Rojo",
};

let cachedTimezones: string[] | null = null;

function allTimezones(defaultTzId: string): string[] {
  if (cachedTimezones) return cachedTimezones;
  try {
    cachedTimezones =
      (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.("timeZone") ?? null;
  } catch {
    cachedTimezones = null;
  }
  if (!cachedTimezones) cachedTimezones = [defaultTzId];
  return cachedTimezones;
}

/**
 * Campo de zona horaria como texto libre con autocompletado nativo
 * (<input list>), en vez de un <select> con cientos de opciones sin
 * buscador. Degrada con gracia si el navegador no soporta
 * Intl.supportedValuesOf: solo ofrece la zona por defecto en la lista,
 * pero el campo sigue aceptando cualquier texto.
 */
export function timezoneFieldHtml(fieldId: string, defaultTzId: string): string {
  const options = allTimezones(defaultTzId)
    .map((tz) => `<option value="${tz}"></option>`)
    .join("");
  return `
    <input name="tzId" list="${fieldId}" value="${defaultTzId}" required autocomplete="off" />
    <datalist id="${fieldId}">${options}</datalist>
  `;
}

export function colorSwatchesHtml(groupName: string, selected: EventColor): string {
  return `
    <div class="color-swatches" role="radiogroup" aria-label="Color del evento">
      ${EVENT_COLORS.map(
        (color) => `
        <label class="color-swatch" style="--swatch-color:${EVENT_COLOR_VAR[color]}">
          <input type="radio" name="${groupName}" value="${color}" ${color === selected ? "checked" : ""} />
          <span class="sr-only">${EVENT_COLOR_LABEL[color]}</span>
        </label>
      `,
      ).join("")}
    </div>
  `;
}
