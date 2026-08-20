import { describe, expect, it } from "vitest";
import { escapeIcsText, foldIcsLine, serializeEventsToIcs, type IcsExportableEvent } from "./icsExport.js";

describe("escapeIcsText", () => {
  it("escapa comas, punto y coma, barra invertida y saltos de línea", () => {
    expect(escapeIcsText("a,b;c\\d\ne")).toBe("a\\,b\\;c\\\\d\\ne");
  });

  it("no toca texto sin caracteres especiales", () => {
    expect(escapeIcsText("Reunión de equipo")).toBe("Reunión de equipo");
  });
});

describe("foldIcsLine", () => {
  it("no pliega líneas cortas", () => {
    const short = "SUMMARY:Reunión";
    expect(foldIcsLine(short)).toBe(short);
  });

  it("pliega líneas de más de 75 octetos con CRLF + espacio", () => {
    const long = `SUMMARY:${"x".repeat(100)}`;
    const folded = foldIcsLine(long);
    expect(folded).toContain("\r\n ");
    expect(folded.replace(/\r\n /g, "")).toBe(long);
  });
});

describe("serializeEventsToIcs", () => {
  const timedEvent: IcsExportableEvent = {
    id: "evt-1",
    kind: "timed",
    title: "Reunión",
    startDate: "2024-06-10",
    startTime: "09:00:00",
    endDate: "2024-06-10",
    endTime: "10:00:00",
    tzId: "America/New_York",
  };

  it("envuelve en BEGIN/END:VCALENDAR con VERSION 2.0", () => {
    const ics = serializeEventsToIcs([timedEvent], "Mi calendario");
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("VERSION:2.0");
    expect(ics).toContain("END:VCALENDAR");
  });

  it("un evento de hora absoluta lleva DTSTART/DTEND con TZID", () => {
    const ics = serializeEventsToIcs([timedEvent], "Mi calendario");
    expect(ics).toContain("DTSTART;TZID=America/New_York:20240610T090000");
    expect(ics).toContain("DTEND;TZID=America/New_York:20240610T100000");
  });

  it("un evento de día completo usa VALUE=DATE sin hora", () => {
    const allday: IcsExportableEvent = { id: "evt-2", kind: "allday", title: "Vacaciones", startDate: "2024-06-10", endDate: "2024-06-13" };
    const ics = serializeEventsToIcs([allday], "Mi calendario");
    expect(ics).toContain("DTSTART;VALUE=DATE:20240610");
    expect(ics).toContain("DTEND;VALUE=DATE:20240613");
  });

  it("un evento flotante no lleva TZID ni Z", () => {
    const floating: IcsExportableEvent = {
      id: "evt-3",
      kind: "floating",
      title: "Recordatorio",
      startDate: "2024-06-10",
      startTime: "08:00:00",
      endDate: "2024-06-10",
      endTime: "08:15:00",
    };
    const ics = serializeEventsToIcs([floating], "Mi calendario");
    expect(ics).toContain("DTSTART:20240610T080000\r\n");
    expect(ics).not.toContain("DTSTART:20240610T080000Z");
  });

  it("una serie recurrente incluye RRULE", () => {
    const recurring: IcsExportableEvent = { ...timedEvent, id: "evt-4", rrule: { freq: "WEEKLY", interval: 2 } };
    const ics = serializeEventsToIcs([recurring], "Mi calendario");
    expect(ics).toContain("RRULE:FREQ=WEEKLY;INTERVAL=2");
  });
});
