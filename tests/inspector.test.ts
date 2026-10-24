// The inspector's number text: values the file writes with many digits are shown rounded.
import { describe, expect, it } from "vitest";
import { speedText } from "../src/components/Inspector";

describe("speedText", () => {
  it("rounds a speed to 0.01 without trailing zeros, and adds km/h for m/s", () => {
    expect(speedText(13.8888888889, "m/s")).toBe("13.89 m/s (50.0 km/h)");
    expect(speedText(50, "km/h")).toBe("50 km/h");
    expect(speedText(30.5, "mph")).toBe("30.5 mph");
  });
});
