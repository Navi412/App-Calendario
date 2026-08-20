import initSqlJs, { type Database } from "sql.js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SCHEMA_SQL } from "./schema.js";
import { insertCalendarRow } from "./calendars.repository.js";
import {
  closeTimedSeriesAndDropFollowing,
  deleteEventRow,
  insertAllDayEventRow,
  insertFloatingEventRow,
  insertTimedEventRow,
  queryAllDayEventsInRange,
  queryAllEventsForExport,
  queryFloatingEventsInRange,
  queryTimedEventById,
  queryTimedEventsInRange,
  renameEventRow,
  searchEventsByTitle,
  splitTimedSeriesAtOccurrence,
  updateAllDayEventRow,
  updateFloatingEventRow,
  updateTimedEventRow,
  upsertEventException,
  type AllDayEventInput,
  type FloatingEventInput,
  type TimedEventInput,
} from "./events.repository.js";

// Se prueba contra una base sql.js en memoria, sin IndexedDB ni Vite --
// exactamente lo que hace posible haber separado las funciones puras de
// los envoltorios ligados al navegador (ver events.repository.ts).

let db: Database;
let calendarId: string;

const sampleEvent: TimedEventInput = {
  title: "Reunión de equipo",
  startDate: "2024-06-10",
  startTime: "09:00:00",
  endDate: "2024-06-10",
  endTime: "10:00:00",
  tzId: "America/New_York",
};

beforeAll(async () => {
  const SQL = await initSqlJs();
  db = new SQL.Database();
  db.run(SCHEMA_SQL);
});

beforeEach(() => {
  db.run("DELETE FROM events");
  db.run("DELETE FROM event_exceptions");
  db.run("DELETE FROM calendars");
  calendarId = insertCalendarRow(db, { name: "Calendario de prueba" }).id;
});

afterAll(() => {
  db.close();
});

describe("insertTimedEventRow", () => {
  it("guarda el evento y lo devuelve con id y color por defecto", () => {
    const created = insertTimedEventRow(db, sampleEvent, calendarId);
    expect(created.id).toBeTruthy();
    expect(created.color).toBe("blue");
    expect(created.title).toBe("Reunión de equipo");
  });

  it("respeta el color explícito", () => {
    const created = insertTimedEventRow(db, { ...sampleEvent, color: "pink" }, calendarId);
    expect(created.color).toBe("pink");
  });
});

describe("queryTimedEventsInRange", () => {
  it("devuelve el evento cuando el rango lo solapa", () => {
    insertTimedEventRow(db, sampleEvent, calendarId);
    // 9-10am America/New_York (EDT, UTC-4) = 13:00-14:00 UTC
    const results = queryTimedEventsInRange(db, "2024-06-10T00:00:00.000Z", "2024-06-11T00:00:00.000Z", calendarId);
    expect(results).toHaveLength(1);
    expect(results[0]?.title).toBe("Reunión de equipo");
  });

  it("no devuelve el evento cuando el rango no lo solapa", () => {
    insertTimedEventRow(db, sampleEvent, calendarId);
    const results = queryTimedEventsInRange(db, "2024-06-11T00:00:00.000Z", "2024-06-12T00:00:00.000Z", calendarId);
    expect(results).toHaveLength(0);
  });

  it("ordena los resultados por instante de inicio", () => {
    insertTimedEventRow(db, { ...sampleEvent, title: "Segundo", startTime: "14:00:00", endTime: "15:00:00" }, calendarId);
    insertTimedEventRow(db, { ...sampleEvent, title: "Primero", startTime: "08:00:00", endTime: "09:00:00" }, calendarId);
    const results = queryTimedEventsInRange(db, "2024-06-10T00:00:00.000Z", "2024-06-11T00:00:00.000Z", calendarId);
    expect(results.map((e) => e.title)).toEqual(["Primero", "Segundo"]);
  });

  it("no devuelve eventos de otro calendario", () => {
    insertTimedEventRow(db, sampleEvent, calendarId);
    const otherCalendarId = insertCalendarRow(db, { name: "Otro" }).id;
    const results = queryTimedEventsInRange(db, "2024-06-10T00:00:00.000Z", "2024-06-11T00:00:00.000Z", otherCalendarId);
    expect(results).toHaveLength(0);
  });
});

describe("updateTimedEventRow", () => {
  it("actualiza los campos y se refleja en una consulta posterior", () => {
    const created = insertTimedEventRow(db, sampleEvent, calendarId);
    updateTimedEventRow(db, created.id, { ...sampleEvent, title: "Reunión movida", color: "green" });

    const updated = queryTimedEventById(db, created.id);
    expect(updated?.title).toBe("Reunión movida");
    expect(updated?.color).toBe("green");
  });
});

describe("deleteEventRow", () => {
  it("elimina el evento", () => {
    const created = insertTimedEventRow(db, sampleEvent, calendarId);
    deleteEventRow(db, created.id);
    expect(queryTimedEventById(db, created.id)).toBeNull();
  });
});

describe("renameEventRow", () => {
  it("cambia el título sin tocar el resto de campos", () => {
    const created = insertTimedEventRow(db, sampleEvent, calendarId);
    renameEventRow(db, created.id, "Nuevo título");
    const updated = queryTimedEventById(db, created.id);
    expect(updated?.title).toBe("Nuevo título");
    expect(updated?.startTime).toBe(sampleEvent.startTime);
    expect(updated?.tzId).toBe(sampleEvent.tzId);
  });

  it("renombra una serie recurrente sin tocar su rrule", () => {
    const recurringEvent: TimedEventInput = { ...sampleEvent, title: "Standup", rrule: { freq: "DAILY" } };
    const created = insertTimedEventRow(db, recurringEvent, calendarId);
    renameEventRow(db, created.id, "Standup renombrado");
    const results = queryTimedEventsInRange(db, "2024-06-10T00:00:00.000Z", "2024-06-13T00:00:00.000Z", calendarId);
    expect(results).toHaveLength(3);
    expect(results.every((e) => e.title === "Standup renombrado" && e.isRecurring)).toBe(true);
  });
});

describe("queryTimedEventsInRange -- series recurrentes", () => {
  const recurringEvent: TimedEventInput = {
    ...sampleEvent,
    title: "Daily standup",
    rrule: { freq: "DAILY" },
  };

  it("expande el maestro en varias ocurrencias dentro del rango, todas con el id del maestro", () => {
    const created = insertTimedEventRow(db, recurringEvent, calendarId);
    const results = queryTimedEventsInRange(db, "2024-06-10T00:00:00.000Z", "2024-06-13T00:00:00.000Z", calendarId);
    expect(results).toHaveLength(3);
    expect(results.every((e) => e.id === created.id)).toBe(true);
    expect(results.every((e) => e.isRecurring)).toBe(true);
    expect(results.map((e) => e.startDate)).toEqual(["2024-06-10", "2024-06-11", "2024-06-12"]);
  });

  it("no expande ocurrencias antes de que la serie empiece", () => {
    insertTimedEventRow(db, recurringEvent, calendarId);
    const results = queryTimedEventsInRange(db, "2024-05-01T00:00:00.000Z", "2024-06-01T00:00:00.000Z", calendarId);
    expect(results).toHaveLength(0);
  });

  it("mezcla eventos sueltos y ocurrencias recurrentes, ordenados por instante real", () => {
    insertTimedEventRow(db, recurringEvent, calendarId); // 9-10am todos los días
    insertTimedEventRow(db, { ...sampleEvent, title: "Suelto", startTime: "08:00:00", endTime: "08:30:00" }, calendarId);
    const results = queryTimedEventsInRange(db, "2024-06-10T00:00:00.000Z", "2024-06-11T00:00:00.000Z", calendarId);
    expect(results.map((e) => e.title)).toEqual(["Suelto", "Daily standup"]);
  });

  it("no marca isRecurring en un evento suelto normal", () => {
    insertTimedEventRow(db, sampleEvent, calendarId);
    const results = queryTimedEventsInRange(db, "2024-06-10T00:00:00.000Z", "2024-06-11T00:00:00.000Z", calendarId);
    expect(results[0]?.isRecurring).toBeUndefined();
  });

  it("actualizar el maestro (updateTimedEventRow) cambia todas las ocurrencias futuras", () => {
    const created = insertTimedEventRow(db, recurringEvent, calendarId);
    updateTimedEventRow(db, created.id, { ...recurringEvent, title: "Standup renombrado" });
    const results = queryTimedEventsInRange(db, "2024-06-10T00:00:00.000Z", "2024-06-12T00:00:00.000Z", calendarId);
    expect(results.every((e) => e.title === "Standup renombrado")).toBe(true);
  });

  it("borrar el maestro elimina toda la serie", () => {
    const created = insertTimedEventRow(db, recurringEvent, calendarId);
    deleteEventRow(db, created.id);
    const results = queryTimedEventsInRange(db, "2024-06-10T00:00:00.000Z", "2024-06-13T00:00:00.000Z", calendarId);
    expect(results).toHaveLength(0);
  });
});

describe("queryTimedEventsInRange -- excepciones de instancia", () => {
  const recurringEvent: TimedEventInput = {
    ...sampleEvent,
    title: "Daily standup",
    rrule: { freq: "DAILY" },
  };

  it("cancelar una instancia la quita del rango sin afectar a las demás", () => {
    const created = insertTimedEventRow(db, recurringEvent, calendarId);
    upsertEventException(db, { masterEventId: created.id, originalStartDate: "2024-06-11", status: "cancelled" });
    const results = queryTimedEventsInRange(db, "2024-06-10T00:00:00.000Z", "2024-06-13T00:00:00.000Z", calendarId);
    expect(results.map((e) => e.startDate)).toEqual(["2024-06-10", "2024-06-12"]);
  });

  it("mover una instancia la muestra en su nuevo horario", () => {
    const created = insertTimedEventRow(db, recurringEvent, calendarId);
    upsertEventException(db, {
      masterEventId: created.id,
      originalStartDate: "2024-06-11",
      status: "moved",
      newStartDate: "2024-06-11",
      newStartTime: "16:00:00",
      newEndDate: "2024-06-11",
      newEndTime: "17:00:00",
    });
    const results = queryTimedEventsInRange(db, "2024-06-10T00:00:00.000Z", "2024-06-13T00:00:00.000Z", calendarId);
    expect(results).toHaveLength(3);
    const moved = results.find((e) => e.startDate === "2024-06-11");
    expect(moved?.startTime).toBe("16:00:00");
  });

  it("mover una instancia a otro día la muestra al pedir ese día, aunque el original quede fuera del rango", () => {
    // WEEKLY (no DAILY) para que el día destino no tenga ya su propia
    // ocurrencia normal con la que la movida colisione.
    const weeklyEvent: TimedEventInput = { ...recurringEvent, rrule: { freq: "WEEKLY" } };
    const created = insertTimedEventRow(db, weeklyEvent, calendarId);
    upsertEventException(db, {
      masterEventId: created.id,
      originalStartDate: "2024-06-11",
      status: "moved",
      newStartDate: "2024-07-02",
      newStartTime: "09:00:00",
      newEndDate: "2024-07-02",
      newEndTime: "10:00:00",
    });
    const results = queryTimedEventsInRange(db, "2024-07-02T00:00:00.000Z", "2024-07-03T00:00:00.000Z", calendarId);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ id: created.id, startDate: "2024-07-02" });
  });

  it("upsertEventException reemplaza (no duplica) la excepción existente para la misma ocurrencia", () => {
    const created = insertTimedEventRow(db, recurringEvent, calendarId);
    upsertEventException(db, { masterEventId: created.id, originalStartDate: "2024-06-11", status: "cancelled" });
    upsertEventException(db, {
      masterEventId: created.id,
      originalStartDate: "2024-06-11",
      status: "moved",
      newStartDate: "2024-06-11",
      newStartTime: "20:00:00",
      newEndDate: "2024-06-11",
      newEndTime: "21:00:00",
    });
    const results = queryTimedEventsInRange(db, "2024-06-10T00:00:00.000Z", "2024-06-13T00:00:00.000Z", calendarId);
    // No debería estar cancelada Y movida a la vez -- la última excepción gana.
    expect(results).toHaveLength(3);
    expect(results.find((e) => e.startDate === "2024-06-11")?.startTime).toBe("20:00:00");
  });

  it("borrar el maestro también elimina sus excepciones", () => {
    const created = insertTimedEventRow(db, recurringEvent, calendarId);
    upsertEventException(db, { masterEventId: created.id, originalStartDate: "2024-06-11", status: "cancelled" });
    deleteEventRow(db, created.id);
    const orphaned = db.exec("SELECT * FROM event_exceptions WHERE master_event_id = ?", [created.id]);
    expect(orphaned).toEqual([]);
  });
});

describe("closeTimedSeriesAndDropFollowing -- \"eliminar esta y las siguientes\"", () => {
  const recurringEvent: TimedEventInput = { ...sampleEvent, title: "Daily standup", rrule: { freq: "DAILY" } };

  it("conserva las ocurrencias antes del corte y descarta las de ahí en adelante", () => {
    const created = insertTimedEventRow(db, recurringEvent, calendarId);
    closeTimedSeriesAndDropFollowing(db, created.id, "2024-06-12");
    const results = queryTimedEventsInRange(db, "2024-06-10T00:00:00.000Z", "2024-06-15T00:00:00.000Z", calendarId);
    expect(results.map((e) => e.startDate)).toEqual(["2024-06-10", "2024-06-11"]);
  });

  it("descarta también las excepciones de ocurrencias que ya no existen", () => {
    const created = insertTimedEventRow(db, recurringEvent, calendarId);
    upsertEventException(db, { masterEventId: created.id, originalStartDate: "2024-06-11", status: "cancelled" });
    upsertEventException(db, {
      masterEventId: created.id,
      originalStartDate: "2024-06-13",
      status: "moved",
      newStartDate: "2024-06-13",
      newStartTime: "18:00:00",
      newEndDate: "2024-06-13",
      newEndTime: "19:00:00",
    });
    closeTimedSeriesAndDropFollowing(db, created.id, "2024-06-12");
    const remaining = db.exec("SELECT original_start_date FROM event_exceptions WHERE master_event_id = ?", [created.id]);
    // La excepción del 11 (antes del corte) sobrevive; la del 13 (después) no.
    expect(remaining[0]?.values).toEqual([["2024-06-11"]]);
  });
});

describe("splitTimedSeriesAtOccurrence -- \"editar esta y las siguientes\"", () => {
  const recurringEvent: TimedEventInput = { ...sampleEvent, title: "Daily standup", rrule: { freq: "DAILY" } };

  it("las ocurrencias antes del corte siguen perteneciendo a la serie original, con sus datos originales", () => {
    const created = insertTimedEventRow(db, recurringEvent, calendarId);
    splitTimedSeriesAtOccurrence(db, created.id, "2024-06-12", {
      ...recurringEvent,
      title: "Standup renombrado",
      startDate: "2024-06-12",
      endDate: "2024-06-12",
    });
    const results = queryTimedEventsInRange(db, "2024-06-10T00:00:00.000Z", "2024-06-12T00:00:00.000Z", calendarId);
    expect(results.map((e) => e.title)).toEqual(["Daily standup", "Daily standup"]);
    expect(results.every((e) => e.id === created.id)).toBe(true);
  });

  it("las ocurrencias desde el corte pertenecen a la serie nueva, con los datos editados", () => {
    const created = insertTimedEventRow(db, recurringEvent, calendarId);
    const newSeries = splitTimedSeriesAtOccurrence(db, created.id, "2024-06-12", {
      ...recurringEvent,
      title: "Standup renombrado",
      startDate: "2024-06-12",
      endDate: "2024-06-12",
    });
    const results = queryTimedEventsInRange(db, "2024-06-12T00:00:00.000Z", "2024-06-14T00:00:00.000Z", calendarId);
    expect(results.map((e) => e.title)).toEqual(["Standup renombrado", "Standup renombrado"]);
    expect(results.every((e) => e.id === newSeries.id)).toBe(true);
    expect(newSeries.id).not.toBe(created.id);
  });

  it("reparenta a la serie nueva las excepciones de ocurrencias en o después del corte", () => {
    const created = insertTimedEventRow(db, recurringEvent, calendarId);
    upsertEventException(db, { masterEventId: created.id, originalStartDate: "2024-06-13", status: "cancelled" });
    const newSeries = splitTimedSeriesAtOccurrence(db, created.id, "2024-06-12", {
      ...recurringEvent,
      title: "Standup renombrado",
      startDate: "2024-06-12",
      endDate: "2024-06-12",
    });
    const results = queryTimedEventsInRange(db, "2024-06-12T00:00:00.000Z", "2024-06-14T00:00:00.000Z", calendarId);
    // El 13 sigue cancelado (la excepción se movió con la ocurrencia), no reaparece.
    expect(results.map((e) => e.startDate)).toEqual(["2024-06-12"]);
    const reparented = db.exec("SELECT master_event_id FROM event_exceptions WHERE original_start_date = '2024-06-13'");
    expect(reparented[0]?.values).toEqual([[newSeries.id]]);
  });

  it("hereda el calendario del maestro original", () => {
    const created = insertTimedEventRow(db, recurringEvent, calendarId);
    const newSeries = splitTimedSeriesAtOccurrence(db, created.id, "2024-06-12", {
      ...recurringEvent,
      startDate: "2024-06-12",
      endDate: "2024-06-12",
    });
    const results = queryTimedEventsInRange(db, "2024-06-12T00:00:00.000Z", "2024-06-13T00:00:00.000Z", calendarId);
    expect(results.some((e) => e.id === newSeries.id)).toBe(true);
  });
});

const sampleFloatingEvent: FloatingEventInput = {
  title: "Recordatorio diario",
  startDate: "2024-06-10",
  startTime: "08:00:00",
  endDate: "2024-06-10",
  endTime: "08:15:00",
};

describe("insertFloatingEventRow", () => {
  it("guarda el evento flotante sin tz_id ni start_utc/end_utc", () => {
    const created = insertFloatingEventRow(db, sampleFloatingEvent, calendarId);
    expect(created.kind).toBe("floating");
    expect(created.startTime).toBe("08:00:00");
  });
});

describe("queryFloatingEventsInRange", () => {
  it("devuelve el evento cuando su fecha cae dentro del rango, comparando solo fechas", () => {
    insertFloatingEventRow(db, sampleFloatingEvent, calendarId);
    const results = queryFloatingEventsInRange(db, "2024-06-10", "2024-06-11", calendarId);
    expect(results).toHaveLength(1);
    expect(results[0]?.title).toBe("Recordatorio diario");
  });

  it("no devuelve el evento cuando el rango no lo solapa", () => {
    insertFloatingEventRow(db, sampleFloatingEvent, calendarId);
    const results = queryFloatingEventsInRange(db, "2024-06-11", "2024-06-12", calendarId);
    expect(results).toHaveLength(0);
  });
});

describe("updateFloatingEventRow", () => {
  it("actualiza el evento flotante", () => {
    const created = insertFloatingEventRow(db, sampleFloatingEvent, calendarId);
    updateFloatingEventRow(db, created.id, { ...sampleFloatingEvent, title: "Movido" });
    const results = queryFloatingEventsInRange(db, "2024-06-10", "2024-06-11", calendarId);
    expect(results[0]?.title).toBe("Movido");
  });
});

const sampleAllDayEvent: AllDayEventInput = {
  title: "Vacaciones",
  startDate: "2024-06-10",
  endDate: "2024-06-13", // exclusivo: cubre 10, 11 y 12
};

describe("insertAllDayEventRow", () => {
  it("guarda el evento de día completo sin hora, tz_id ni start_utc/end_utc", () => {
    const created = insertAllDayEventRow(db, sampleAllDayEvent, calendarId);
    expect(created.kind).toBe("allday");
    expect(created.startDate).toBe("2024-06-10");
    expect(created.endDate).toBe("2024-06-13");
  });
});

describe("queryAllDayEventsInRange", () => {
  it("devuelve el evento cuando el rango solapa cualquier día cubierto (endDate exclusivo)", () => {
    insertAllDayEventRow(db, sampleAllDayEvent, calendarId);
    const results = queryAllDayEventsInRange(db, "2024-06-12", "2024-06-14", calendarId);
    expect(results).toHaveLength(1);
  });

  it("no devuelve el evento el día siguiente a su fin (endDate exclusivo)", () => {
    insertAllDayEventRow(db, sampleAllDayEvent, calendarId);
    const results = queryAllDayEventsInRange(db, "2024-06-13", "2024-06-14", calendarId);
    expect(results).toHaveLength(0);
  });
});

describe("updateAllDayEventRow", () => {
  it("actualiza el evento de día completo", () => {
    const created = insertAllDayEventRow(db, sampleAllDayEvent, calendarId);
    updateAllDayEventRow(db, created.id, { ...sampleAllDayEvent, title: "Vacaciones movidas" });
    const results = queryAllDayEventsInRange(db, "2024-06-10", "2024-06-13", calendarId);
    expect(results[0]?.title).toBe("Vacaciones movidas");
  });
});

describe("searchEventsByTitle", () => {
  it("encuentra eventos cuyo título contiene el texto buscado, sin distinguir mayúsculas", () => {
    insertTimedEventRow(db, { ...sampleEvent, title: "Revision de presupuesto" }, calendarId);
    insertFloatingEventRow(db, { ...sampleFloatingEvent, title: "Tomar vitaminas" }, calendarId);
    const results = searchEventsByTitle(db, calendarId, "REVISION");
    expect(results.map((r) => r.title)).toEqual(["Revision de presupuesto"]);
  });

  it("no devuelve nada para una búsqueda vacía", () => {
    insertTimedEventRow(db, sampleEvent, calendarId);
    expect(searchEventsByTitle(db, calendarId, "   ")).toEqual([]);
  });

  it("no cruza resultados de otro calendario", () => {
    insertTimedEventRow(db, sampleEvent, calendarId);
    const otherId = insertCalendarRow(db, { name: "Otro" }).id;
    expect(searchEventsByTitle(db, otherId, "Reunión")).toEqual([]);
  });

  it("encuentra el maestro de una serie recurrente sin expandirla", () => {
    insertTimedEventRow(db, { ...sampleEvent, title: "Standup", rrule: { freq: "DAILY" } }, calendarId);
    const results = searchEventsByTitle(db, calendarId, "standup");
    expect(results).toHaveLength(1);
    expect(results[0]?.startDate).toBe("2024-06-10");
  });
});

describe("queryAllEventsForExport", () => {
  it("devuelve los tres tipos de evento de un calendario, sin expandir recurrencia", () => {
    insertTimedEventRow(db, { ...sampleEvent, title: "Standup", rrule: { freq: "DAILY" } }, calendarId);
    insertFloatingEventRow(db, { title: "Recordatorio", startDate: "2024-06-10", startTime: "08:00:00", endDate: "2024-06-10", endTime: "08:15:00" }, calendarId);
    insertAllDayEventRow(db, { title: "Vacaciones", startDate: "2024-06-10", endDate: "2024-06-13" }, calendarId);

    const all = queryAllEventsForExport(db, calendarId);
    expect(all).toHaveLength(3);
    const standup = all.find((e) => e.title === "Standup");
    expect(standup?.rrule).toEqual({ freq: "DAILY" });
  });

  it("no mezcla eventos de otro calendario", () => {
    insertTimedEventRow(db, sampleEvent, calendarId);
    const otherId = insertCalendarRow(db, { name: "Otro" }).id;
    expect(queryAllEventsForExport(db, otherId)).toEqual([]);
  });
});
