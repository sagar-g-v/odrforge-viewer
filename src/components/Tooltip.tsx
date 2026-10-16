// The design system's tooltip (docs/design-system.md §5): inverted (--text background, --surface text), 12px, radius sm,
// padding 4/8, 6px from its element, 400ms delay, no arrow; a trailing shortcut such as "(F)" or "(Ctrl+Enter)" shows as
// a kbd. One instance serves every element with a `title`: the title moves to data-tip while the pointer (or keyboard
// focus) is on it, so the browser's own tooltip does not show as well.
import { useEffect, useRef, useState } from "react";

import { placeTip, splitShortcut } from "./tooltipPlace";

const DELAY = 400; // ms

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
