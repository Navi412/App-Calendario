import { describe, expect, it } from "vitest";
import { utcIsoToWallTime, wallTimeToUtcIso } from "./convert.js";

describe("wallTimeToUtcIso", () => {
  it("convierte una hora de pared normal (sin DST de por medio)", () => {
    // 15 enero 2024, 09:00 en America/New_York = EST = UTC-5
    expect(wallTimeToUtcIso("2024-01-15", "09:00:00", "America/New_York")).toBe(
      "2024-01-15T14:00:00.000Z",
    );
  });

  it("desplaza hacia adelante una hora de pared inexistente por spring-forward", () => {
    // 10 marzo 2024: America/New_York salta de 2:00 a 3:00. 2:30 no existe ese día.
    // Luxon la normaliza a 3:30 (ya en EDT, UTC-4) -> 07:30 UTC.
    expect(wallTimeToUtcIso("2024-03-10", "02:30:00", "America/New_York")).toBe(
      "2024-03-10T07:30:00.000Z",
    );
  });

  it("resuelve una hora de pared ambigua por fall-back a la primera ocurrencia", () => {
    // 3 noviembre 2024: America/New_York retrocede de 2:00 a 1:00. 1:30 ocurre dos veces.
    // Se toma la primera ocurrencia: offset previo a la transición, EDT = UTC-4 -> 05:30 UTC.
    expect(wallTimeToUtcIso("2024-11-03", "01:30:00", "America/New_York")).toBe(
      "2024-11-03T05:30:00.000Z",
    );
  });

  it("lanza un error ante una fecha malformada", () => {
    expect(() => wallTimeToUtcIso("2024-13-99", "09:00:00", "America/New_York")).toThrow();
  });
});

describe("utcIsoToWallTime", () => {
  it("convierte un instante UTC a hora de pared en la zona dada", () => {
    expect(utcIsoToWallTime("2024-01-15T14:00:00.000Z", "America/New_York")).toEqual({
      date: "2024-01-15",
      time: "09:00:00",
    });
  });

  it("hace round-trip con wallTimeToUtcIso para horas sin ambigüedad de DST", () => {
    const utc = wallTimeToUtcIso("2024-06-01", "18:45:30", "Europe/Madrid");
    expect(utcIsoToWallTime(utc, "Europe/Madrid")).toEqual({
      date: "2024-06-01",
      time: "18:45:30",
    });
  });

  it("refleja el cambio de offset al cruzar una transición de DST", () => {
    const beforeDst = wallTimeToUtcIso("2024-03-09", "09:00:00", "America/New_York"); // EST
    const afterDst = wallTimeToUtcIso("2024-03-11", "09:00:00", "America/New_York"); // EDT
    expect(beforeDst).toBe("2024-03-09T14:00:00.000Z");
    expect(afterDst).toBe("2024-03-11T13:00:00.000Z");
  });
});
