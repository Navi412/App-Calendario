import { describe, expect, it } from "vitest";
import { parseIcs } from "./icsImport.js";
import { serializeEventsToIcs, type IcsExportableEvent } from "./icsExport.js";

const VIEWER_TZ = "Europe/Madrid";

function ics(...veventLines: string[]): string {
  return ["BEGIN:VCALENDAR", "VERSION:2.0", ...veventLines, "END:VCALENDAR"].join("\r\n");
}

describe("parseIcs", () => {
  it("interpreta un evento de hora absoluta con TZID", () => {
    const text = ics(
      "BEGIN:VEVENT",
      "UID:1@test",
      "DTSTART;TZID=America/New_York:20240610T090000",
      "DTEND;TZID=America/New_York:20240610T100000",
      "SUMMARY:Reunión",
      "END:VEVENT",
    );
    const { events, skipped } = parseIcs(text, VIEWER_TZ);
    expect(skipped).toBe(0);
    expect(events).toEqual([
      {
        kind: "timed",
        title: "Reunión",
        startDate: "2024-06-10",
        startTime: "09:00:00",
        endDate: "2024-06-10",
        endTime: "10:00:00",
        tzId: "America/New_York",
      },
    ]);
  });

  it("interpreta un evento de día completo (VALUE=DATE)", () => {
    const text = ics(
      "BEGIN:VEVENT",
      "DTSTART;VALUE=DATE:20240610",
      "DTEND;VALUE=DATE:20240613",
      "SUMMARY:Vacaciones",
      "END:VEVENT",
    );
    const { events } = parseIcs(text, VIEWER_TZ);
    expect(events).toEqual([{ kind: "allday", title: "Vacaciones", startDate: "2024-06-10", endDate: "2024-06-13" }]);
  });

  it("un DTSTART de día completo sin DTEND se convierte en un solo día (fin exclusivo al siguiente)", () => {
    const text = ics("BEGIN:VEVENT", "DTSTART;VALUE=DATE:20240610", "SUMMARY:Cumpleaños", "END:VEVENT");
    const { events } = parseIcs(text, VIEWER_TZ);
    expect(events[0]).toMatchObject({ kind: "allday", startDate: "2024-06-10", endDate: "2024-06-11" });
  });

  it("interpreta un evento flotante (DATE-TIME sin TZID ni Z)", () => {
    const text = ics(
      "BEGIN:VEVENT",
      "DTSTART:20240610T080000",
      "DTEND:20240610T081500",
      "SUMMARY:Recordatorio",
      "END:VEVENT",
    );
    const { events } = parseIcs(text, VIEWER_TZ);
    expect(events).toEqual([
      { kind: "floating", title: "Recordatorio", startDate: "2024-06-10", startTime: "08:00:00", endDate: "2024-06-10", endTime: "08:15:00" },
    ]);
  });

  it("un DATE-TIME con Z (instante UTC) se reinterpreta en la zona del visor como timed", () => {
    // 2024-06-10T12:00:00Z = 14:00 en Europe/Madrid (CEST, UTC+2)
    const text = ics("BEGIN:VEVENT", "DTSTART:20240610T120000Z", "SUMMARY:Llamada", "END:VEVENT");
    const { events } = parseIcs(text, VIEWER_TZ);
    expect(events[0]).toMatchObject({ kind: "timed", startDate: "2024-06-10", startTime: "14:00:00", tzId: "Europe/Madrid" });
  });

  it("interpreta RRULE", () => {
    const text = ics(
      "BEGIN:VEVENT",
      "DTSTART;TZID=America/New_York:20240610T090000",
      "DTEND;TZID=America/New_York:20240610T100000",
      "SUMMARY:Standup",
      "RRULE:FREQ=DAILY;INTERVAL=2;UNTIL=20240701T235959Z",
      "END:VEVENT",
    );
    const { events } = parseIcs(text, VIEWER_TZ);
    expect(events[0]?.rrule).toEqual({ freq: "DAILY", interval: 2, until: "2024-07-01" });
  });

  it("desdobla líneas plegadas (folding) antes de leer los campos", () => {
    // El espacio inicial de la línea de continuación es el propio marcador
    // de pliegue de la RFC y se descarta al desdoblar -- por eso el punto de
    // corte no cae sobre un espacio ya existente del texto, si no la
    // reconstrucción perdería ese espacio.
    const text = ics(
      "BEGIN:VEVENT",
      "DTSTART;TZID=America/New_York:20240610T090000",
      "SUMMARY:Un título muy largo que en un .ics real ven\r\n dría partido en dos líneas por el pliegue de la RFC",
      "END:VEVENT",
    );
    const { events } = parseIcs(text, VIEWER_TZ);
    expect(events[0]?.title).toBe(
      "Un título muy largo que en un .ics real vendría partido en dos líneas por el pliegue de la RFC",
    );
  });

  it("desescapa comas, punto y coma y saltos de línea en SUMMARY/DESCRIPTION", () => {
    const text = ics(
      "BEGIN:VEVENT",
      "DTSTART;VALUE=DATE:20240610",
      "SUMMARY:Reunión\\, seguimiento\\; revisión",
      "DESCRIPTION:Línea uno\\nLínea dos",
      "END:VEVENT",
    );
    const { events } = parseIcs(text, VIEWER_TZ);
    expect(events[0]?.title).toBe("Reunión, seguimiento; revisión");
    expect(events[0]?.description).toBe("Línea uno\nLínea dos");
  });

  it("un VEVENT sin DTSTART se cuenta como saltado, sin abortar los demás", () => {
    const text = ics(
      "BEGIN:VEVENT",
      "SUMMARY:Sin fecha",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "DTSTART;VALUE=DATE:20240610",
      "SUMMARY:Con fecha",
      "END:VEVENT",
    );
    const { events, skipped } = parseIcs(text, VIEWER_TZ);
    expect(skipped).toBe(1);
    expect(events).toHaveLength(1);
    expect(events[0]?.title).toBe("Con fecha");
  });

  it("varios VEVENT en el mismo archivo se interpretan todos", () => {
    const text = ics(
      "BEGIN:VEVENT",
      "DTSTART;VALUE=DATE:20240610",
      "SUMMARY:Uno",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "DTSTART;VALUE=DATE:20240611",
      "SUMMARY:Dos",
      "END:VEVENT",
    );
    const { events } = parseIcs(text, VIEWER_TZ);
    expect(events.map((e) => e.title)).toEqual(["Uno", "Dos"]);
  });
});

describe("exportar y volver a importar (round-trip)", () => {
  it("un evento de hora absoluta con serie recurrente sobrevive el viaje de ida y vuelta", () => {
    const original: IcsExportableEvent = {
      id: "evt-1",
      kind: "timed",
      title: "Standup",
      description: "Diario, salvo festivos",
      startDate: "2024-06-10",
      startTime: "09:00:00",
      endDate: "2024-06-10",
      endTime: "09:15:00",
      tzId: "America/New_York",
      rrule: { freq: "DAILY", until: "2024-07-01" },
    };
    const ics = serializeEventsToIcs([original], "Mi calendario");
    const { events, skipped } = parseIcs(ics, VIEWER_TZ);
    expect(skipped).toBe(0);
    expect(events[0]).toEqual({
      kind: "timed",
      title: "Standup",
      description: "Diario, salvo festivos",
      startDate: "2024-06-10",
      startTime: "09:00:00",
      endDate: "2024-06-10",
      endTime: "09:15:00",
      tzId: "America/New_York",
      rrule: { freq: "DAILY", until: "2024-07-01" },
    });
  });

  it("un evento de día completo sobrevive el viaje de ida y vuelta", () => {
    const original: IcsExportableEvent = { id: "evt-2", kind: "allday", title: "Vacaciones", startDate: "2024-06-10", endDate: "2024-06-13" };
    const ics = serializeEventsToIcs([original], "Mi calendario");
    const { events } = parseIcs(ics, VIEWER_TZ);
    expect(events[0]).toEqual({ kind: "allday", title: "Vacaciones", startDate: "2024-06-10", endDate: "2024-06-13" });
  });
});
