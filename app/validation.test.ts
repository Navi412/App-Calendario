import { describe, expect, it } from "vitest";
import { validateInterval } from "./validation.js";

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
