import initSqlJs, { type Database } from "sql.js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SCHEMA_SQL } from "./schema.js";
import {
  deleteCalendarRow,
  insertCalendarRow,
  queryAllCalendars,
  updateCalendarRow,
} from "./calendars.repository.js";
import { insertTimedEventRow, queryTimedEventById, type TimedEventInput } from "./events.repository.js";

let db: Database;

beforeAll(async () => {
  const SQL = await initSqlJs();
  db = new SQL.Database();
  db.run(SCHEMA_SQL);
});

beforeEach(() => {
  db.run("DELETE FROM event_exceptions");
  db.run("DELETE FROM events");
  db.run("DELETE FROM calendars");
});

afterAll(() => {
  db.close();
});

describe("insertCalendarRow", () => {
  it("crea un calendario con color por defecto", () => {
    const created = insertCalendarRow(db, { name: "Trabajo" });
    expect(created.name).toBe("Trabajo");
    expect(created.color).toBe("blue");
  });

  it("respeta el color explícito", () => {
    const created = insertCalendarRow(db, { name: "Personal", color: "green" });
    expect(created.color).toBe("green");
  });
});

describe("queryAllCalendars", () => {
  it("devuelve los calendarios en el orden en que se crearon", () => {
    insertCalendarRow(db, { name: "Uno" });
    insertCalendarRow(db, { name: "Dos" });
    const all = queryAllCalendars(db);
    expect(all.map((c) => c.name)).toEqual(["Uno", "Dos"]);
  });
});

describe("updateCalendarRow", () => {
  it("renombra y recolorea un calendario existente", () => {
    const created = insertCalendarRow(db, { name: "Original", color: "blue" });
    updateCalendarRow(db, created.id, { name: "Renombrado", color: "pink" });
    const all = queryAllCalendars(db);
    expect(all).toEqual([{ id: created.id, name: "Renombrado", color: "pink" }]);
  });
});

describe("deleteCalendarRow", () => {
  const sampleEvent: TimedEventInput = {
    title: "Reunión",
    startDate: "2024-06-10",
    startTime: "09:00:00",
    endDate: "2024-06-10",
    endTime: "10:00:00",
    tzId: "America/New_York",
  };

  it("elimina el calendario y sus eventos", () => {
    const a = insertCalendarRow(db, { name: "A" });
    insertCalendarRow(db, { name: "B" });
    const event = insertTimedEventRow(db, sampleEvent, a.id);

    deleteCalendarRow(db, a.id);

    expect(queryAllCalendars(db).map((c) => c.name)).toEqual(["B"]);
    expect(queryTimedEventById(db, event.id)).toBeNull();
  });

  it("rechaza borrar el único calendario que queda", () => {
    const only = insertCalendarRow(db, { name: "Único" });
    expect(() => deleteCalendarRow(db, only.id)).toThrow();
    expect(queryAllCalendars(db)).toHaveLength(1);
  });
});
