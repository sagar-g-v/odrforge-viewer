// The design system's tooltip (docs/design-system.md §5): shortcut as kbd, placement 6px from its element inside the viewport.
import { describe, expect, it } from "vitest";
import { placeTip, splitShortcut } from "../src/components/tooltipPlace";

describe("splitShortcut", () => {
  it("a trailing key shortcut becomes the kbd", () => {
    expect(splitShortcut("Flag mode (F)")).toEqual({ text: "Flag mode", kbd: "F" });
    expect(splitShortcut("Save (Ctrl+Enter)")).toEqual({ text: "Save", kbd: "Ctrl+Enter" });
  });
  it("prose in parentheses stays text", () => {
    const t = "The whole road: all its lanes (Shift+click a lane)";
    expect(splitShortcut(t)).toEqual({ text: t, kbd: null });
    expect(splitShortcut("Fit network")).toEqual({ text: "Fit network", kbd: null });
  });
});

describe("placeTip", () => {
  const view = { width: 1000, height: 800 }, tip = { width: 100, height: 24 };
  it("centred 6px below its element", () => {
    expect(placeTip({ left: 200, top: 100, width: 32, height: 32 }, tip, view)).toEqual({ left: 166, top: 138 });
  });
  it("above when there is no room below, and inside the viewport at the edges", () => {
    expect(placeTip({ left: 980, top: 770, width: 20, height: 20 }, tip, view)).toEqual({ left: 892, top: 740 });
    expect(placeTip({ left: 0, top: 0, width: 20, height: 20 }, tip, view).left).toBe(8);
  });
});
