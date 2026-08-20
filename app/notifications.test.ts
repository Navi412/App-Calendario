import { describe, expect, it } from "vitest";
import { DEFAULT_NOTIFY_LEAD_MINUTES as NOTIFY_LEAD_MINUTES, isWithinNotifyWindow } from "./notifications.js";

describe("isWithinNotifyWindow", () => {
  it("avisa cuando el evento empieza justo ahora", () => {
    expect(isWithinNotifyWindow(0, NOTIFY_LEAD_MINUTES)).toBe(true);
  });

  it("avisa dentro de la ventana de aviso completa", () => {
    expect(isWithinNotifyWindow(NOTIFY_LEAD_MINUTES, NOTIFY_LEAD_MINUTES)).toBe(true);
    expect(isWithinNotifyWindow(NOTIFY_LEAD_MINUTES - 1, NOTIFY_LEAD_MINUTES)).toBe(true);
  });

  it("no avisa todavía si falta más que el margen de aviso", () => {
    expect(isWithinNotifyWindow(NOTIFY_LEAD_MINUTES + 1, NOTIFY_LEAD_MINUTES)).toBe(false);
  });

  it("da un minuto de margen hacia atrás por si el sondeo llega justo tras el inicio", () => {
    expect(isWithinNotifyWindow(-1, NOTIFY_LEAD_MINUTES)).toBe(true);
  });

  it("no avisa de eventos que ya empezaron hace rato", () => {
    expect(isWithinNotifyWindow(-2, NOTIFY_LEAD_MINUTES)).toBe(false);
  });
});
