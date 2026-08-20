import { describe, expect, it } from "vitest";
import type { TimedEvent } from "../core/model/event.js";
import { groupEventsByViewerDate, toViewerInterval } from "./eventPresentation.js";

function makeEvent(overrides: Partial<TimedEvent> & { id: string }): TimedEvent {
  return {
    kind: "timed",
    title: overrides.title ?? "Evento",
    color: "blue",
    startDate: "2024-06-10",
    startTime: "09:00:00",
    endDate: "2024-06-10",
    endTime: "10:00:00",
    tzId: "America/New_York",
    ...overrides,
  };
}

describe("toViewerInterval", () => {
  it("reinterpreta un evento en la zona del visor", () => {
    const event = makeEvent({ id: "1" });
    // 9-10am America/New_York (EDT, UTC-4) = 15:00-16:00 en Europe/Madrid (CEST, UTC+2)
    expect(toViewerInterval(event, "Europe/Madrid")).toEqual({
      startDate: "2024-06-10",
      startTime: "15:00:00",
      endDate: "2024-06-10",
      endTime: "16:00:00",
    });
  });

  it("puede cambiar la fecha si el visor está muy adelantado", () => {
    // 23:30 en Los Angeles (PDT, UTC-7) del 10 de junio es ya 06:30 UTC+... en Tokio (UTC+9) del día 11
    const event = makeEvent({ id: "1", startTime: "23:30:00", endTime: "23:45:00", tzId: "America/Los_Angeles" });
    expect(toViewerInterval(event, "Asia/Tokyo").startDate).toBe("2024-06-11");
  });
});

describe("groupEventsByViewerDate", () => {
  it("agrupa por la fecha de inicio en la zona del visor, no en la zona propia del evento", () => {
    // 23:30 America/Los_Angeles del día 10 cae en el día 11 en Asia/Tokyo
    const event = makeEvent({ id: "1", startTime: "23:30:00", endTime: "23:45:00", tzId: "America/Los_Angeles" });
    const grouped = groupEventsByViewerDate([event], "Asia/Tokyo");
    expect(grouped.has("2024-06-11")).toBe(true);
    expect(grouped.has("2024-06-10")).toBe(false);
  });

  it("ordena los eventos de cada día por hora de inicio", () => {
    const late = makeEvent({ id: "1", title: "Tarde", startTime: "18:00:00", endTime: "19:00:00" });
    const early = makeEvent({ id: "2", title: "Temprano", startTime: "07:00:00", endTime: "08:00:00" });
    const grouped = groupEventsByViewerDate([late, early], "America/New_York");
    expect(grouped.get("2024-06-10")?.map((e) => e.title)).toEqual(["Temprano", "Tarde"]);
  });
});
