// The design's typefaces are actually loaded (docs/design-system.md §4 Type): without the stylesheet the page silently
// fell back to Segoe UI / Consolas, so the UI did not use Inter or JetBrains Mono at all.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("typefaces", () => {
  const html = readFileSync("index.html", "utf8"), tokens = readFileSync("src/design/tokens.css", "utf8");
  it("index.html loads Inter and JetBrains Mono", () => {
    expect(html).toMatch(/fonts\.googleapis\.com\/css2\?family=Inter:wght@400\.\.700&family=JetBrains\+Mono/);
  });
  it("the tokens name them first", () => {
    expect(tokens).toMatch(/--font: "Inter",/);
    expect(tokens).toMatch(/--mono: "JetBrains Mono",/);
  });
});
