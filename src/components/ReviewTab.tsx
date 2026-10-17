// The Review tab: the LLM review of the open page (<page>.review.json, src/review/llmReview.ts), read-only and kept apart
// from the hand-made flags. Filters by severity and perspective; legitimate items are hidden unless asked for. When the
// review was made on another build of the file, a banner says so and each item names its roads in this build by OSM way.
import { useMemo } from "react";
import { PERSPECTIVES, roadsByOsm, SEVERITIES, type ReviewFilter, type ReviewItem, type ReviewLoad, type Severity } from "../review/llmReview";
import { shortTime } from "../data/provenance";
import type { Road } from "../xodr/model";

const SEVERITY_TONE: Record<Severity | "legitimate", string> = { critical: "err", major: "err", minor: "warn", info: "info", legitimate: "ok" };
const RANK: Record<Severity, number> = { critical: 0, major: 1, minor: 2, info: 3 };

export default function ReviewTab({ load, filter, setFilter, shown, selected, onItem, roads }: {
  load: ReviewLoad | null; filter: ReviewFilter; setFilter: (f: ReviewFilter) => void; shown: ReviewItem[];
  selected: string | null; onItem: (i: ReviewItem) => void; roads: Road[];
}) {
  const all = useMemo(() => (load?.status === "ok" ? load.review.items : []), [load]);
  const nSev = useMemo(() => Object.fromEntries(SEVERITIES.map((s) => [s, all.filter((i) => i.verdict !== "legitimate" && i.severity === s).length])), [all]);
  const nLegit = all.filter((i) => i.verdict === "legitimate").length;
  const sorted = useMemo(() => [...shown].sort((a, b) => (a.verdict === "legitimate" ? 1 : 0) - (b.verdict === "legitimate" ? 1 : 0)
    || RANK[a.severity] - RANK[b.severity] || a.id - b.id), [shown]);
  if (!load) return <p className="muted small">Looking for an LLM review of this page…</p>;
  if (load.status === "none") return <p className="muted small">No LLM review for this page (<code>&lt;page&gt;.review.json</code> on the review server, written by OdrForge <code>llm_review.py merge</code>).</p>;
  if (load.status === "invalid") return <div className="banner error"><span>LLM review not read: {load.reason}</span></div>;
  const R = load.review;
  const toggle = <T,>(set: Set<T>, v: T) => { const n = new Set(set); if (n.has(v)) n.delete(v); else n.add(v); return n; };
  return (
    <>
      <p className="muted small">
        {`Reviewed ${shortTime(R.reviewed)} · ${R.chunksReviewed}/${R.chunksTotal} parts · prompt ${R.promptVersion || "–"} · OdrForge ${R.odrforgeVersion || "–"}. `}
        Read-only: the reviewer's findings, not your flags.
      </p>
      {!load.sameBuild && (
        <div className="banner info small" role="status">
          This review was made on another build of the file (its sha256 differs from the page loaded). Positions are still close;
          road ids may have changed, so each item also names its roads in this build by OSM way.
        </div>
      )}
      <div className="chips" role="group" aria-label="Severity">
        {SEVERITIES.map((s) => (
          <button key={s} className={`chip ${filter.severities.has(s) ? SEVERITY_TONE[s] : ""}`} aria-pressed={filter.severities.has(s)}
            onClick={() => setFilter({ ...filter, severities: toggle(filter.severities, s) })}>{s} {nSev[s]}</button>
        ))}
      </div>
      <div className="chips" role="group" aria-label="Perspective">
        {PERSPECTIVES.map((v) => (
          <button key={v} className={`chip ${filter.perspectives.has(v) ? "accent" : ""}`} aria-pressed={filter.perspectives.has(v)}
            onClick={() => setFilter({ ...filter, perspectives: toggle(filter.perspectives, v as string) })}>{v}</button>
        ))}
      </div>
      <label className="toggle">
        <input type="checkbox" checked={filter.legitimate} onChange={(e) => setFilter({ ...filter, legitimate: e.target.checked })} />
        Show what it judged legitimate ({nLegit})
      </label>
      <div className="list">
        {sorted.map((i) => {
          const tone = i.verdict === "legitimate" ? "legitimate" : i.severity;
          const now = !load.sameBuild ? roadsByOsm(i.osmWays, roads) : [];
          const open = selected === i.key;
          return (
            <div key={i.key} className={`item ${open ? "sel" : ""}`} role="button" tabIndex={0} aria-expanded={open}
              onClick={() => onItem(i)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onItem(i); } }}>
              <div className="item-head">
                <span className={`chip ${SEVERITY_TONE[tone]}`}>{tone}</span>
                {i.verdict === "uncertain" && <span className="chip">uncertain</span>}
                <b>#{i.id}</b><span className="muted small grow">{i.kind || i.category}</span>
              </div>
              <div>{i.note}</div>
              <div className="muted small">
                {[i.road && `road ${i.road}`, i.lane !== null && `lane ${i.lane}`, i.junction && `junction ${i.junction}`].filter(Boolean).join(" · ") || `x ${i.x.toFixed(1)}, y ${i.y.toFixed(1)}`}
                {!load.sameBuild && (now.length ? ` · now road ${now.slice(0, 4).join(", ")}${now.length > 4 ? "…" : ""}` : i.osmWays.length ? " · OSM way not in this build" : "")}
              </div>
              {open && (
                <div className="review-detail">
                  {i.evidence.length > 0 && <><h4>Evidence</h4><ul>{i.evidence.map((e, k) => <li key={k}><code className="wrap">{e}</code></li>)}</ul></>}
                  {i.reasoning && <><h4>Reasoning</h4><p>{i.reasoning}</p></>}
                  <div className="kv"><span>rule</span><span>{i.spec || "–"}</span></div>
                  <div className="kv"><span>confidence</span><span>{i.confidence !== null ? `${Math.round(i.confidence * 100)} %` : "–"}</span></div>
                  <div className="kv"><span>perspective</span><span>{i.perspective.join(", ") || "–"}</span></div>
                  <div className="kv"><span>OSM ways</span><span className="mono">{i.osmWays.join(", ") || "–"}</span></div>
                </div>
              )}
            </div>
          );
        })}
        {!sorted.length && <p className="muted small">Nothing matches the filters.</p>}
      </div>
    </>
  );
}
