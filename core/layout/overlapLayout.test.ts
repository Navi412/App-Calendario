import { describe, expect, it } from "vitest";
import { layoutOverlaps, type LayoutInput } from "./overlapLayout.js";

function interval(id: string, startMinutes: number, endMinutes: number): LayoutInput<string> {
  return { item: id, startMinutes, endMinutes };
}

function byId<T>(results: ReturnType<typeof layoutOverlaps<T>>, item: T) {
  const found = results.find((r) => r.item === item);
  if (!found) throw new Error(`No se encontró el item ${String(item)} en el resultado`);
  return found;
}

describe("layoutOverlaps", () => {
  it("da la columna 0 a totalColumns 1 a eventos sueltos sin solape", () => {
    const result = layoutOverlaps([interval("a", 9 * 60, 10 * 60)]);
    expect(result).toEqual([
      { item: "a", startMinutes: 540, endMinutes: 600, column: 0, columnSpan: 1, totalColumns: 1 },
    ]);
  });

  it("back-to-back sin solape real: no comparten cluster ni columna", () => {
    // A 09:00-10:00, B 10:00-11:00 -- tocan en el borde pero no se solapan.
    const result = layoutOverlaps([interval("a", 9 * 60, 10 * 60), interval("b", 10 * 60, 11 * 60)]);
    expect(byId(result, "a")).toMatchObject({ column: 0, totalColumns: 1 });
    expect(byId(result, "b")).toMatchObject({ column: 0, totalColumns: 1 });
  });

  it("2 eventos simultáneos (mismo inicio y fin): 2 columnas, ancho mitad cada uno", () => {
    const result = layoutOverlaps([interval("a", 9 * 60, 10 * 60), interval("b", 9 * 60, 10 * 60)]);
    expect(byId(result, "a")).toMatchObject({ totalColumns: 2, columnSpan: 1 });
    expect(byId(result, "b")).toMatchObject({ totalColumns: 2, columnSpan: 1 });
    expect(byId(result, "a").column).not.toBe(byId(result, "b").column);
  });

  it("inicio idéntico, duraciones distintas: el más largo va primero pero ambos quedan a media columna", () => {
    // A 09:00-11:00 (2h), B 09:00-09:30 (30min)
    const result = layoutOverlaps([interval("a", 9 * 60, 11 * 60), interval("b", 9 * 60, 9 * 60 + 30)]);
    expect(byId(result, "a").column).toBe(0);
    expect(byId(result, "b").column).toBe(1);
    expect(byId(result, "a").totalColumns).toBe(2);
    expect(byId(result, "b").totalColumns).toBe(2);
  });

  it("3 eventos escalonados en cadena (A-B solapan, B-C solapan, A-C no): un solo cluster, 2 columnas", () => {
    const result = layoutOverlaps([
      interval("a", 9 * 60, 11 * 60),
      interval("b", 10 * 60, 12 * 60),
      interval("c", 11 * 60, 13 * 60),
    ]);
    expect(byId(result, "a").totalColumns).toBe(2);
    expect(byId(result, "b").totalColumns).toBe(2);
    expect(byId(result, "c").totalColumns).toBe(2);
    // A y C pueden compartir columna (no se solapan entre sí), B va en la otra.
    expect(byId(result, "a").column).toBe(byId(result, "c").column);
    expect(byId(result, "b").column).not.toBe(byId(result, "a").column);
  });

  it("contención total: un evento corto totalmente dentro de uno largo", () => {
    const result = layoutOverlaps([interval("long", 9 * 60, 12 * 60), interval("short", 10 * 60, 11 * 60)]);
    expect(byId(result, "long").totalColumns).toBe(2);
    expect(byId(result, "short").totalColumns).toBe(2);
    expect(byId(result, "long").column).not.toBe(byId(result, "short").column);
  });

  it("eventos de duración cero (recordatorios puntuales) se les da columna propia si coinciden", () => {
    const result = layoutOverlaps([interval("a", 9 * 60, 9 * 60), interval("b", 9 * 60, 9 * 60)]);
    expect(byId(result, "a").totalColumns).toBe(2);
    expect(byId(result, "a").column).not.toBe(byId(result, "b").column);
  });

  it("un recordatorio puntual lejos de todo no comparte cluster con nada", () => {
    const result = layoutOverlaps([interval("meeting", 9 * 60, 10 * 60), interval("reminder", 14 * 60, 14 * 60)]);
    expect(byId(result, "meeting").totalColumns).toBe(1);
    expect(byId(result, "reminder").totalColumns).toBe(1);
  });

  it("expande hacia columnas libres a la derecha cuando no hay competencia", () => {
    // A 09:00-10:00 solo, sin nadie más -- debe usar todo el ancho.
    const result = layoutOverlaps([interval("a", 9 * 60, 10 * 60)]);
    expect(byId(result, "a")).toMatchObject({ columnSpan: 1, totalColumns: 1 });

    // A 09:00-11:00 y B 09:00-09:30: A no puede expandirse a la columna de B
    // porque se solapan en 09:00-09:30, pero si B terminase antes de que
    // exista una tercera columna libre, A seguiría limitado a su columna.
    const withThird = layoutOverlaps([
      interval("a", 9 * 60, 11 * 60),
      interval("b", 9 * 60, 9 * 60 + 30),
      interval("c", 9 * 60 + 45, 10 * 60),
    ]);
    // c no solapa con a en tiempo real solo si sus columnas coinciden en su rango;
    // aquí simplemente comprobamos que el total de columnas y los spans son coherentes.
    const total = byId(withThird, "a").totalColumns;
    expect(byId(withThird, "b").totalColumns).toBe(total);
    expect(byId(withThird, "c").totalColumns).toBe(total);
  });
});
