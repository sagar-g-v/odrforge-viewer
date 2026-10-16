// The tooltip's text and placement (components/Tooltip.tsx; docs/design-system.md §5 Tooltip): pure, tested.
const OFFSET = 6, EDGE = 8; // px

const SHORTCUT = /\s*\(((?:(?:Ctrl|Shift|Alt|Cmd)\+)*(?:[A-Z0-9/?]|Enter|Esc|Space|Tab))\)$/;

/** "Flag mode (F)" -> { text: "Flag mode", kbd: "F" }; text without a trailing key shortcut is kept whole */
export function splitShortcut(tip: string): { text: string; kbd: string | null } {
  const m = SHORTCUT.exec(tip);
  return m ? { text: tip.slice(0, m.index), kbd: m[1] } : { text: tip, kbd: null };
}

/** below the element, centred; above it when there is no room below; kept inside the viewport */
export function placeTip(el: { left: number; top: number; width: number; height: number }, tip: { width: number; height: number },
  view: { width: number; height: number }): { left: number; top: number } {
  const below = el.top + el.height + OFFSET;
  const top = below + tip.height <= view.height - EDGE ? below : Math.max(EDGE, el.top - OFFSET - tip.height);
  const left = Math.min(Math.max(EDGE, el.left + el.width / 2 - tip.width / 2), view.width - EDGE - tip.width);
  return { left, top };
}

