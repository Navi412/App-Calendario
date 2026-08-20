import { describe, expect, it } from "vitest";
import {
  closeRuleBefore,
  expandTimedRecurrence,
  parseRecurrenceRule,
  serializeRecurrenceRule,
  type RecurrenceException,
  type RecurrenceRule,
  type RecurringTimedSeries,
} from "./expandRecurrence.js";

function series(overrides: Partial<RecurringTimedSeries> = {}): RecurringTimedSeries {
  return {
    startDate: "2024-06-10",
    startTime: "09:00:00",
    endDate: "2024-06-10",
    endTime: "10:00:00",
    tzId: "America/New_York",
    rrule: { freq: "DAILY" },
    ...overrides,
  };
}

describe("serializeRecurrenceRule / parseRecurrenceRule", () => {
  const cases: RecurrenceRule[] = [
    { freq: "DAILY" },
    { freq: "WEEKLY", interval: 2 },
    { freq: "MONTHLY", byMonthDay: 31 },
    { freq: "DAILY", until: "2024-06-12" },
    { freq: "DAILY", count: 5 },
  ];

  it.each(cases)("hace un round-trip fiel para %o", (rule) => {
    expect(parseRecurrenceRule(serializeRecurrenceRule(rule))).toEqual(rule);
  });

  it("rechaza texto sin FREQ reconocido", () => {
    expect(() => parseRecurrenceRule("INTERVAL=2")).toThrow();
  });
});

describe("expandTimedRecurrence -- caso feliz", () => {
  it("genera una ocurrencia por día dentro del rango pedido", () => {
    const s = series();
    const occurrences = expandTimedRecurrence(s, "2024-06-10T00:00:00.000Z", "2024-06-13T00:00:00.000Z");
    expect(occurrences.map((o) => o.startDate)).toEqual(["2024-06-10", "2024-06-11", "2024-06-12"]);
  });

  it("cada ocurrencia conserva la hora de pared 9:00-10:00", () => {
    const s = series();
    const occurrences = expandTimedRecurrence(s, "2024-06-10T00:00:00.000Z", "2024-06-12T00:00:00.000Z");
    for (const o of occurrences) {
      expect(o.startTime).toBe("09:00:00");
      expect(o.endTime).toBe("10:00:00");
    }
  });

  it("respeta WEEKLY con interval > 1", () => {
    const s = series({ rrule: { freq: "WEEKLY", interval: 2 } });
    const occurrences = expandTimedRecurrence(s, "2024-06-01T00:00:00.000Z", "2024-07-15T00:00:00.000Z");
    expect(occurrences.map((o) => o.startDate)).toEqual(["2024-06-10", "2024-06-24", "2024-07-08"]);
  });

  it("respeta COUNT", () => {
    const s = series({ rrule: { freq: "DAILY", count: 3 } });
    const occurrences = expandTimedRecurrence(s, "2024-06-01T00:00:00.000Z", "2024-07-01T00:00:00.000Z");
    expect(occurrences).toHaveLength(3);
  });

  it("respeta UNTIL (inclusivo)", () => {
    const s = series({ rrule: { freq: "DAILY", until: "2024-06-12" } });
    const occurrences = expandTimedRecurrence(s, "2024-06-01T00:00:00.000Z", "2024-07-01T00:00:00.000Z");
    expect(occurrences.map((o) => o.startDate)).toEqual(["2024-06-10", "2024-06-11", "2024-06-12"]);
  });

  it("no genera ocurrencias antes de que la serie empiece (dtstart)", () => {
    const s = series();
    const occurrences = expandTimedRecurrence(s, "2024-05-01T00:00:00.000Z", "2024-06-01T00:00:00.000Z");
    expect(occurrences).toHaveLength(0);
  });
});

describe("expandTimedRecurrence -- horario de verano (DST)", () => {
  // America/New_York: spring-forward el 2024-03-10 (2:00 -> 3:00).
  it("hora de pared inexistente en spring-forward: se desplaza hacia adelante, no se omite", () => {
    const s = series({
      startDate: "2024-03-08",
      startTime: "02:30:00",
      endDate: "2024-03-08",
      endTime: "03:00:00",
      rrule: { freq: "DAILY" },
    });
    const occurrences = expandTimedRecurrence(s, "2024-03-08T00:00:00.000Z", "2024-03-12T00:00:00.000Z");
    // Sigue habiendo una ocurrencia el día del salto -- no se omite.
    expect(occurrences.map((o) => o.startDate)).toEqual(["2024-03-08", "2024-03-09", "2024-03-10", "2024-03-11"]);
    // El 10 de marzo la 2:30 no existe: Luxon la desplaza a las 3:30 (ver core/timezone/convert.ts).
    const jump = occurrences.find((o) => o.startDate === "2024-03-10");
    expect(jump?.startUtc).toBe("2024-03-10T07:30:00.000Z"); // 3:30 EDT (UTC-4)
  });

  it("el salto de horario NO desplaza las demás ocurrencias de la serie (cada una se recalcula por separado)", () => {
    const s = series({
      startDate: "2024-03-08",
      startTime: "09:00:00",
      endDate: "2024-03-08",
      endTime: "10:00:00",
      rrule: { freq: "DAILY" },
    });
    const occurrences = expandTimedRecurrence(s, "2024-03-08T00:00:00.000Z", "2024-03-12T00:00:00.000Z");
    // Antes del salto: 9am EST = 14:00 UTC. Después: 9am EDT = 13:00 UTC.
    expect(occurrences.find((o) => o.startDate === "2024-03-09")?.startUtc).toBe("2024-03-09T14:00:00.000Z");
    expect(occurrences.find((o) => o.startDate === "2024-03-10")?.startUtc).toBe("2024-03-10T13:00:00.000Z");
    expect(occurrences.find((o) => o.startDate === "2024-03-11")?.startUtc).toBe("2024-03-11T13:00:00.000Z");
    // El salto entre el 9 y el 10 en UTC real es de 23h, no 24h -- consecuencia
    // esperada de DESIGN.md §3, no un bug.
    const day9 = Date.parse(occurrences.find((o) => o.startDate === "2024-03-09")!.startUtc);
    const day10 = Date.parse(occurrences.find((o) => o.startDate === "2024-03-10")!.startUtc);
    expect((day10 - day9) / (60 * 60 * 1000)).toBe(23);
  });

  // America/New_York: fall-back el 2024-11-03 (2:00 -> 1:00, la 1:30 ocurre dos veces).
  it("hora de pared ambigua en fall-back: se queda con la primera ocurrencia (offset previo)", () => {
    const s = series({
      startDate: "2024-11-01",
      startTime: "01:30:00",
      endDate: "2024-11-01",
      endTime: "02:00:00",
      rrule: { freq: "DAILY" },
    });
    const occurrences = expandTimedRecurrence(s, "2024-11-01T00:00:00.000Z", "2024-11-05T00:00:00.000Z");
    const ambiguous = occurrences.find((o) => o.startDate === "2024-11-03");
    // 1:30 EDT (offset previo, UTC-4) y no 1:30 EST (UTC-5).
    expect(ambiguous?.startUtc).toBe("2024-11-03T05:30:00.000Z");
  });

  it("el salto de vuelta hace que el hueco UTC entre dos ocurrencias sea de 25h, no 24h", () => {
    const s = series({
      startDate: "2024-11-01",
      startTime: "09:00:00",
      endDate: "2024-11-01",
      endTime: "10:00:00",
      rrule: { freq: "DAILY" },
    });
    const occurrences = expandTimedRecurrence(s, "2024-11-01T00:00:00.000Z", "2024-11-05T00:00:00.000Z");
    const day2 = Date.parse(occurrences.find((o) => o.startDate === "2024-11-02")!.startUtc);
    const day3 = Date.parse(occurrences.find((o) => o.startDate === "2024-11-03")!.startUtc);
    expect((day3 - day2) / (60 * 60 * 1000)).toBe(25);
  });
});

describe("expandTimedRecurrence -- BYMONTHDAY=31", () => {
  it("no genera ninguna ocurrencia en meses de 30 días", () => {
    const s = series({
      startDate: "2024-01-31",
      startTime: "09:00:00",
      endDate: "2024-01-31",
      endTime: "10:00:00",
      rrule: { freq: "MONTHLY", byMonthDay: 31 },
    });
    // Abril tiene 30 días: no debe aparecer el 31 de abril.
    const occurrences = expandTimedRecurrence(s, "2024-04-01T00:00:00.000Z", "2024-05-01T00:00:00.000Z");
    expect(occurrences).toHaveLength(0);
  });

  it("no genera ninguna ocurrencia en febrero (28/29 días)", () => {
    const s = series({
      startDate: "2024-01-31",
      startTime: "09:00:00",
      endDate: "2024-01-31",
      endTime: "10:00:00",
      rrule: { freq: "MONTHLY", byMonthDay: 31 },
    });
    const occurrences = expandTimedRecurrence(s, "2024-02-01T00:00:00.000Z", "2024-03-01T00:00:00.000Z");
    expect(occurrences).toHaveLength(0);
  });

  it("sí genera ocurrencia en los meses que tienen día 31", () => {
    const s = series({
      startDate: "2024-01-31",
      startTime: "09:00:00",
      endDate: "2024-01-31",
      endTime: "10:00:00",
      rrule: { freq: "MONTHLY", byMonthDay: 31 },
    });
    const occurrences = expandTimedRecurrence(s, "2024-01-01T00:00:00.000Z", "2024-08-01T00:00:00.000Z");
    // Enero, marzo, mayo, julio tienen 31 días; feb/abr/jun no aparecen.
    expect(occurrences.map((o) => o.startDate)).toEqual(["2024-01-31", "2024-03-31", "2024-05-31", "2024-07-31"]);
  });
});

describe("expandTimedRecurrence -- excepciones de instancia", () => {
  it("una instancia borrada (cancelled) desaparece pero las demás de la serie siguen intactas", () => {
    const s = series();
    const exceptions: RecurrenceException[] = [{ id: "exc-1", originalStartDate: "2024-06-11", status: "cancelled" }];
    const occurrences = expandTimedRecurrence(s, "2024-06-10T00:00:00.000Z", "2024-06-13T00:00:00.000Z", exceptions);
    expect(occurrences.map((o) => o.startDate)).toEqual(["2024-06-10", "2024-06-12"]);
  });

  it("una instancia movida dentro del mismo rango aparece en su nuevo horario, no en el original", () => {
    const s = series();
    const exceptions: RecurrenceException[] = [
      {
        id: "exc-1",
        originalStartDate: "2024-06-11",
        status: "moved",
        newStartDate: "2024-06-11",
        newStartTime: "14:00:00",
        newEndDate: "2024-06-11",
        newEndTime: "15:00:00",
      },
    ];
    const occurrences = expandTimedRecurrence(s, "2024-06-10T00:00:00.000Z", "2024-06-13T00:00:00.000Z", exceptions);
    expect(occurrences).toHaveLength(3);
    const moved = occurrences.find((o) => o.startDate === "2024-06-11");
    expect(moved?.startTime).toBe("14:00:00");
    expect(moved?.endTime).toBe("15:00:00");
  });

  it("una instancia movida a una fecha FUERA del rango original ya no aparece en su slot viejo", () => {
    const s = series();
    const exceptions: RecurrenceException[] = [
      {
        id: "exc-1",
        originalStartDate: "2024-06-11",
        status: "moved",
        newStartDate: "2024-08-20",
        newStartTime: "09:00:00",
        newEndDate: "2024-08-20",
        newEndTime: "10:00:00",
      },
    ];
    const occurrences = expandTimedRecurrence(s, "2024-06-10T00:00:00.000Z", "2024-06-13T00:00:00.000Z", exceptions);
    expect(occurrences.map((o) => o.startDate)).toEqual(["2024-06-10", "2024-06-12"]);
  });

  it("esa misma instancia SÍ aparece al pedir el rango de su nueva fecha, aunque la original quede fuera (DESIGN.md §2 paso 6)", () => {
    // WEEKLY (no DAILY) para que el 20 de agosto -- jueves, no lunes -- no
    // tenga ya una ocurrencia normal propia con la que la movida colisione.
    const s = series({ rrule: { freq: "WEEKLY" } });
    const exceptions: RecurrenceException[] = [
      {
        id: "exc-1",
        originalStartDate: "2024-06-11",
        status: "moved",
        newStartDate: "2024-08-20",
        newStartTime: "09:00:00",
        newEndDate: "2024-08-20",
        newEndTime: "10:00:00",
      },
    ];
    const occurrences = expandTimedRecurrence(s, "2024-08-20T00:00:00.000Z", "2024-08-21T00:00:00.000Z", exceptions);
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0]).toMatchObject({ startDate: "2024-08-20", startTime: "09:00:00" });
  });

  it("no duplica una instancia cuando origen y destino de la mudanza caen en el mismo rango pedido", () => {
    const s = series();
    const exceptions: RecurrenceException[] = [
      {
        id: "exc-1",
        originalStartDate: "2024-06-11",
        status: "moved",
        newStartDate: "2024-06-12",
        newStartTime: "09:00:00",
        newEndDate: "2024-06-12",
        newEndTime: "10:00:00",
      },
    ];
    const occurrences = expandTimedRecurrence(s, "2024-06-10T00:00:00.000Z", "2024-06-13T00:00:00.000Z", exceptions);
    // 10 (normal), 11->movida al 12, 12 (normal) -- pero el 12 ahora tiene DOS candidatos con la misma fecha
    // (el normal del 12 y la instancia movida del 11): deben verse como dos ocurrencias distintas ese día, no una.
    expect(occurrences).toHaveLength(3);
    expect(occurrences.filter((o) => o.startDate === "2024-06-12")).toHaveLength(2);
  });
});

describe("closeRuleBefore -- \"esta y las siguientes\"", () => {
  it("pone UNTIL en el día anterior al corte", () => {
    const closed = closeRuleBefore({ freq: "DAILY" }, "2024-06-15");
    expect(closed).toEqual({ freq: "DAILY", until: "2024-06-14" });
  });

  it("conserva interval y byMonthDay", () => {
    const closed = closeRuleBefore({ freq: "MONTHLY", interval: 2, byMonthDay: 15 }, "2024-08-15");
    expect(closed).toEqual({ freq: "MONTHLY", interval: 2, byMonthDay: 15, until: "2024-08-14" });
  });

  it("descarta count a favor de until", () => {
    const closed = closeRuleBefore({ freq: "DAILY", count: 30 }, "2024-06-15");
    expect(closed).toEqual({ freq: "DAILY", until: "2024-06-14" });
  });

  it("la serie cerrada deja de generar ocurrencias a partir del corte", () => {
    const closed = closeRuleBefore({ freq: "DAILY" }, "2024-06-12");
    const s = series({ rrule: closed });
    const occurrences = expandTimedRecurrence(s, "2024-06-10T00:00:00.000Z", "2024-06-15T00:00:00.000Z");
    expect(occurrences.map((o) => o.startDate)).toEqual(["2024-06-10", "2024-06-11"]);
  });
});
