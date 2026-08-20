import { describe, expect, it } from "vitest";
import { validateAllDayInterval, validateInterval } from "./validation.js";

describe("validateInterval", () => {
  it("acepta un intervalo donde el fin es posterior al inicio", () => {
    expect(validateInterval("2024-06-10", "09:00:00", "2024-06-10", "10:00:00")).toBeNull();
  });

  it("acepta un intervalo que cruza la medianoche", () => {
    expect(validateInterval("2024-06-10", "23:00:00", "2024-06-11", "01:00:00")).toBeNull();
  });

  it("rechaza un fin anterior al inicio", () => {
    expect(validateInterval("2024-06-10", "10:00:00", "2024-06-10", "09:00:00")).not.toBeNull();
  });

  it("rechaza un fin igual al inicio (duración cero)", () => {
    expect(validateInterval("2024-06-10", "09:00:00", "2024-06-10", "09:00:00")).not.toBeNull();
  });

  it("rechaza campos vacíos", () => {
    expect(validateInterval("", "09:00:00", "2024-06-10", "10:00:00")).not.toBeNull();
  });
});

describe("validateAllDayInterval", () => {
  it("acepta un único día (inicio == fin inclusivo)", () => {
    expect(validateAllDayInterval("2024-06-10", "2024-06-10")).toBeNull();
  });

  it("acepta un rango de varios días", () => {
    expect(validateAllDayInterval("2024-06-10", "2024-06-12")).toBeNull();
  });

  it("rechaza un fin anterior al inicio", () => {
    expect(validateAllDayInterval("2024-06-10", "2024-06-09")).not.toBeNull();
  });

  it("rechaza campos vacíos", () => {
    expect(validateAllDayInterval("", "2024-06-10")).not.toBeNull();
  });
});
