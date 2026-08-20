import initSqlJs, { type Database } from "sql.js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SCHEMA_SQL } from "./schema.js";
import {
  deleteEventRow,
  insertTimedEventRow,
  queryTimedEventById,
  queryTimedEventsInRange,
  updateTimedEventRow,
  type TimedEventInput,
} from "./events.repository.js";

// Se prueba contra una base sql.js en memoria, sin IndexedDB ni Vite --
// exactamente lo que hace posible haber separado las funciones puras de
// los envoltorios ligados al navegador (ver events.repository.ts).

let db: Database;

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
});

afterAll(() => {
  db.close();
});

describe("insertTimedEventRow", () => {
  it("guarda el evento y lo devuelve con id y color por defecto", () => {
    const created = insertTimedEventRow(db, sampleEvent);
    expect(created.id).toBeTruthy();
    expect(created.color).toBe("blue");
    expect(created.title).toBe("Reunión de equipo");
  });

  it("respeta el color explícito", () => {
    const created = insertTimedEventRow(db, { ...sampleEvent, color: "pink" });
    expect(created.color).toBe("pink");
  });
});

describe("queryTimedEventsInRange", () => {
  it("devuelve el evento cuando el rango lo solapa", () => {
    insertTimedEventRow(db, sampleEvent);
    // 9-10am America/New_York (EDT, UTC-4) = 13:00-14:00 UTC
    const results = queryTimedEventsInRange(db, "2024-06-10T00:00:00.000Z", "2024-06-11T00:00:00.000Z");
    expect(results).toHaveLength(1);
    expect(results[0]?.title).toBe("Reunión de equipo");
  });

  it("no devuelve el evento cuando el rango no lo solapa", () => {
    insertTimedEventRow(db, sampleEvent);
    const results = queryTimedEventsInRange(db, "2024-06-11T00:00:00.000Z", "2024-06-12T00:00:00.000Z");
    expect(results).toHaveLength(0);
  });

  it("ordena los resultados por instante de inicio", () => {
    insertTimedEventRow(db, { ...sampleEvent, title: "Segundo", startTime: "14:00:00", endTime: "15:00:00" });
    insertTimedEventRow(db, { ...sampleEvent, title: "Primero", startTime: "08:00:00", endTime: "09:00:00" });
    const results = queryTimedEventsInRange(db, "2024-06-10T00:00:00.000Z", "2024-06-11T00:00:00.000Z");
    expect(results.map((e) => e.title)).toEqual(["Primero", "Segundo"]);
  });
});

describe("updateTimedEventRow", () => {
  it("actualiza los campos y se refleja en una consulta posterior", () => {
    const created = insertTimedEventRow(db, sampleEvent);
    updateTimedEventRow(db, created.id, { ...sampleEvent, title: "Reunión movida", color: "green" });

    const updated = queryTimedEventById(db, created.id);
    expect(updated?.title).toBe("Reunión movida");
    expect(updated?.color).toBe("green");
  });
});

describe("deleteEventRow", () => {
  it("elimina el evento", () => {
    const created = insertTimedEventRow(db, sampleEvent);
    deleteEventRow(db, created.id);
    expect(queryTimedEventById(db, created.id)).toBeNull();
  });
});
