// The design system's tooltip (docs/design-system.md §5): inverted (--text background, --surface text), 12px, radius sm,
// padding 4/8, 6px from its element, 400ms delay, no arrow; a trailing shortcut such as "(F)" or "(Ctrl+Enter)" shows as
// a kbd. One instance serves every element with a `title`: the title moves to data-tip while the pointer (or keyboard
// focus) is on it, so the browser's own tooltip does not show as well.
import { useEffect, useRef, useState } from "react";

const DELAY = 400, OFFSET = 6, EDGE = 8; // ms, px, px

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

interface Shown { tip: string; anchor: HTMLElement; }

export default function Tooltip() {
  const [shown, setShown] = useState<Shown | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let timer = 0, current: HTMLElement | null = null;
    const restore = () => {
      clearTimeout(timer);
      if (current?.dataset.tip !== undefined) { current.setAttribute("title", current.dataset.tip); delete current.dataset.tip; }
      current = null;
      setShown(null); setPos(null);
    };
    const enter = (target: EventTarget | null) => {
      const el = target instanceof Element ? target.closest<HTMLElement>("[title], [data-tip]") : null;
      if (el === current) return;
      restore();
      const tip = el?.getAttribute("title") ?? el?.dataset.tip;
      if (!el || !tip) return;
      current = el;
      el.dataset.tip = tip; el.removeAttribute("title"); // no native tooltip on top of ours
      timer = window.setTimeout(() => { if (current === el && el.isConnected) setShown({ tip, anchor: el }); }, DELAY);
    };
    const over = (e: PointerEvent) => { if (e.pointerType !== "touch") enter(e.target); };
    const out = (e: PointerEvent) => { if (current && !current.contains(e.relatedTarget as Node | null)) restore(); };
    const focus = (e: FocusEvent) => { if ((e.target as Element | null)?.matches?.(":focus-visible")) enter(e.target); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") restore(); };
    document.addEventListener("pointerover", over);
    document.addEventListener("pointerout", out);
    document.addEventListener("pointerdown", restore, true);
    document.addEventListener("focusin", focus);
    document.addEventListener("focusout", restore);
    document.addEventListener("keydown", key);
    window.addEventListener("scroll", restore, true);
    window.addEventListener("blur", restore);
    return () => {
      restore();
      document.removeEventListener("pointerover", over);
      document.removeEventListener("pointerout", out);
      document.removeEventListener("pointerdown", restore, true);
      document.removeEventListener("focusin", focus);
      document.removeEventListener("focusout", restore);
      document.removeEventListener("keydown", key);
      window.removeEventListener("scroll", restore, true);
      window.removeEventListener("blur", restore);
    };
  }, []);

  // measured after it renders (hidden), then placed
  useEffect(() => {
    if (!shown || !box.current) return;
    const r = shown.anchor.getBoundingClientRect(), t = box.current.getBoundingClientRect();
    setPos(placeTip(r, t, { width: window.innerWidth, height: window.innerHeight }));
  }, [shown]);

  if (!shown) return null;
  const { text, kbd } = splitShortcut(shown.tip);
  return (
    <div ref={box} className="tooltip" role="tooltip"
      style={pos ? { left: pos.left, top: pos.top } : { left: 0, top: 0, visibility: "hidden" }}>
      {text}{kbd && <kbd>{kbd}</kbd>}
    </div>
  );
}
