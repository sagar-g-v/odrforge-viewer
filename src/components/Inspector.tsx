// Right-hand drawer: the clicked road and lane (s, t, width, height, links, OSM source ways).
import type { Network } from "../data/useNetwork";
import type { LaneProbe } from "../xodr/query";

export interface Selection { road: number; laneId: number | null; laneIndex: number | null; x: number; y: number; probe: LaneProbe | null; }

const f = (v: number | null | undefined, d = 2) => (v === null || v === undefined || !Number.isFinite(v) ? "–" : v.toFixed(d));

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return <div className="kv"><span>{k}</span><span>{v}</span></div>;
}

export default function Inspector({ net, sel, onClose, onFlag, onGoRoad }: {
  net: Network; sel: Selection; onClose: () => void; onFlag: () => void; onGoRoad: (id: string) => void;
}) {
  const info = net.roads[sel.road];
  const road = net.od?.roads[sel.road];
  const pr = sel.probe;
  const lane = pr?.lane;
  const junction = road && road.junction !== "-1" ? net.od?.junctions.find((j) => j.id === road.junction) : undefined;
  const link = (l: { type: string; id: string; contact: string } | null) =>
    !l ? "–" : l.type === "road" ? <a onClick={() => onGoRoad(l.id)}>road {l.id}{l.contact ? ` (${l.contact})` : ""}</a> : `junction ${l.id}`;
  const speed = road?.types.find((t) => t.speed !== null);
  return (
    <aside className="inspector">
      <header className="drawer-head">
        <div>
          <div className="eyebrow">{info.junction !== "-1" ? `Connecting road · junction ${info.junction}` : "Road"}</div>
          <h2>Road {info.id}{info.name ? ` · ${info.name}` : ""}</h2>
        </div>
        <button className="icon-btn" aria-label="Close inspector" onClick={onClose}>✕</button>
      </header>
      <section>
        <h3>Position</h3>
        <Row k="s / t" v={`${f(pr?.s)} m / ${f(pr?.t)} m`} />
        <Row k="x / y" v={`${f(sel.x)} / ${f(sel.y)}`} />
        <Row k="surface z" v={`${f(pr?.z)} m`} />
        <Row k="superelevation" v={pr ? `${f((pr.superelevation * 180) / Math.PI, 2)}°` : "–"} />
      </section>
      {(lane || sel.laneId !== null) && (
        <section>
          <h3>Lane {sel.laneId}</h3>
          <Row k="type" v={lane?.type ?? net.render.lanes.meta[sel.laneIndex ?? 0]?.type} />
          {lane && <Row k="direction" v={lane.direction} />}
          <Row k="width" v={`${f(pr?.width)} m`} />
          <Row k="border t inner / outer" v={`${f(pr?.inner)} / ${f(pr?.outer)}`} />
          {lane && <Row k="links" v={`${lane.pred ?? "–"} → ${lane.succ ?? "–"}`} />}
          {lane?.speed && <Row k="speed" v={`${f(lane.speed * 3.6, 0)} km/h`} />}
          {lane?.heights.length ? <Row k="height inner / outer" v={`${lane.heights[0].inner} / ${lane.heights[0].outer} m`} /> : null}
          {lane?.marks.length ? <Row k="road mark" v={lane.marks.map((m) => `${m.type} ${m.color}`).join(", ")} /> : null}
          <Row k="section" v={`#${pr?.section ?? "–"} from s ${f(pr?.sectionStart)}`} />
        </section>
      )}
      <section>
        <h3>Road</h3>
        <Row k="length" v={`${f(info.length)} m`} />
        {road && <Row k="traffic rule" v={road.rule} />}
        {road && <Row k="predecessor" v={link(road.pred)} />}
        {road && <Row k="successor" v={link(road.succ)} />}
        {road && <Row k="lane sections" v={road.sections.length} />}
        {road && <Row k="geometry" v={[...new Set(road.geoms.map((g) => g.kind))].join(", ")} />}
        {speed && <Row k="speed limit" v={`${speed.speed} ${speed.unit}`} />}
        {road?.userData.osmWays && <Row k="OSM ways" v={road.userData.osmWays.split(/[ ,]+/).map((w) => (
          <a key={w} href={`https://www.openstreetmap.org/way/${w.replace(/^-/, "")}`} target="_blank" rel="noreferrer">{w} </a>))} />}
      </section>
      {junction && (
        <section>
          <h3>Junction {junction.id}</h3>
          <Row k="type" v={junction.type} />
          <Row k="connections" v={junction.connections.length} />
          <Row k="arms" v={[...new Set(junction.connections.map((c) => c.incomingRoad))].map((id) => <a key={id} onClick={() => onGoRoad(id)}>{id} </a>)} />
        </section>
      )}
      <footer className="drawer-foot">
        <button className="btn primary" onClick={onFlag}>⚑ Flag something here</button>
      </footer>
    </aside>
  );
}

/** a junction area: type, boundary source, connections and the arms they join */
export function JunctionInspector({ net, index, onClose, onFlag, onGoRoad }: {
  net: Network; index: number; onClose: () => void; onFlag: () => void; onGoRoad: (id: string) => void;
}) {
  const m = net.render.junctions.meta[index];
  const j = net.od?.junctions.find((q) => q.id === m.id);
  const arms = j ? [...new Set(j.connections.map((c) => c.incomingRoad))] : [];
  const connecting = net.roads.filter((r) => r.junction === m.id);
  const turns = j?.connections.reduce((n, c) => n + c.laneLinks.length, 0) ?? 0;
  return (
    <aside className="inspector">
      <header className="drawer-head">
        <div>
          <div className="eyebrow">Junction{j ? ` · ${j.type}` : ""}</div>
          <h2>Junction {m.id}{j?.name ? ` · ${j.name}` : ""}</h2>
        </div>
        <button className="icon-btn" aria-label="Close inspector" onClick={onClose}>✕</button>
      </header>
      <section>
        <h3>Area</h3>
        <Row k="outline" v={m.exact ? "<boundary> (OpenDRIVE 1.8 §12.10)" : "approximate (hull of connecting roads)"} />
        {j && <Row k="boundary segments" v={j.boundary.length ? `${j.boundary.filter((b) => b.type === "lane").length} lane, ${j.boundary.filter((b) => b.type === "joint").length} joint` : "none"} />}
      </section>
      <section>
        <h3>Connections</h3>
        {j && <Row k="connections" v={j.connections.length} />}
        {j && <Row k="lane links" v={turns} />}
        <Row k="connecting roads" v={connecting.length} />
        {arms.length > 0 && <Row k="incoming arms" v={arms.map((id) => <a key={id} onClick={() => onGoRoad(id)}>{id} </a>)} />}
      </section>
      {j && (j.priorities.length > 0 || j.controllers.length > 0 || j.crossPaths.length > 0) && (
        <section>
          <h3>Rules</h3>
          {j.priorities.map((p, i) => <Row key={`p${i}`} k="priority" v={`road ${p.high} over road ${p.low}`} />)}
          {j.controllers.map((c) => {
            const ctl = net.od?.controllers.find((q) => q.id === c.id);
            return <Row key={`c${c.id}`} k="controller" v={`${c.id}${ctl?.name ? ` · ${ctl.name}` : ""}${ctl ? ` (${ctl.controls.length} signals)` : ""}`} />;
          })}
          {j.crossPaths.length > 0 && <Row k="cross paths" v={j.crossPaths.length} />}
        </section>
      )}
      <footer className="drawer-foot">
        <button className="btn primary" onClick={onFlag}>⚑ Flag this junction</button>
      </footer>
    </aside>
  );
}

const yes = (b: boolean) => (b ? "yes" : "no");

/** a signal, object, bridge / tunnel or cross path: every attribute the file gives it */
export function FeatureInspector({ net, sel, onClose, onGoRoad }: {
  net: Network; sel: { kind: string; road: number; index: number }; onClose: () => void; onGoRoad: (id: string) => void;
}) {
  const road = net.od?.roads[sel.road];
  const info = net.roads[sel.road];
  const roadLink = <a onClick={() => onGoRoad(info.id)}>road {info.id}{info.name ? ` · ${info.name}` : ""}</a>;
  let title = "", eyebrow = "", body: React.ReactNode = null;
  if (!road) {
    title = "Feature"; body = <section><p className="muted small">Details need the .xodr file (this network was opened from an OdrForge page).</p></section>;
  } else if (sel.kind === "signal") {
    const g = road.signals[sel.index];
    const controllers = net.od!.controllers.filter((c) => c.controls.some((x) => x.signalId === g.id));
    eyebrow = g.dynamic ? "Signal · dynamic" : "Signal"; title = `${g.name || "Signal"} ${g.id}`;
    body = (
      <>
        <section>
          <h3>Signal</h3>
          <Row k="type / subtype" v={`${g.type} / ${g.subtype}`} />
          <Row k="country" v={g.country || "–"} />
          {g.value !== null && <Row k="value" v={`${g.value} ${g.unit}`} />}
          {g.text && <Row k="text" v={g.text} />}
          <Row k="dynamic" v={yes(g.dynamic)} />
          <Row k="orientation" v={g.orientation} />
        </section>
        <section>
          <h3>Placement</h3>
          <Row k="road" v={roadLink} />
          <Row k="s / t" v={`${f(g.s)} / ${f(g.t)} m`} />
          <Row k="zOffset" v={`${f(g.zOffset)} m`} />
          <Row k="size (w × h)" v={`${f(g.width)} × ${f(g.height)} m`} />
          <Row k="hOffset" v={`${f((g.hOffset * 180) / Math.PI, 1)}°`} />
        </section>
        {(g.validity.length > 0 || g.dependencies.length > 0 || g.references.length > 0 || g.semantics.length > 0 || controllers.length > 0) && (
          <section>
            <h3>Logic</h3>
            {g.validity.map((v, i) => <Row key={`v${i}`} k="valid for lanes" v={`${v.fromLane} … ${v.toLane}`} />)}
            {g.dependencies.map((d, i) => <Row key={`d${i}`} k="depends on" v={`signal ${d.id} (${d.type})`} />)}
            {g.references.map((r, i) => <Row key={`r${i}`} k="references" v={`${r.elementType} ${r.elementId}${r.type ? ` (${r.type})` : ""}`} />)}
            {g.semantics.map((x, i) => <Row key={`s${i}`} k="semantics" v={x} />)}
            {controllers.map((c) => <Row key={c.id} k="controller" v={`${c.id}${c.name ? ` · ${c.name}` : ""}${c.sequence ? ` (sequence ${c.sequence})` : ""}`} />)}
          </section>
        )}
      </>
    );
  } else if (sel.kind === "object") {
    const o = road.objects[sel.index];
    eyebrow = "Object"; title = `${o.name || o.type || "Object"} ${o.id}`;
    body = (
      <>
        <section>
          <h3>Object</h3>
          <Row k="type / subtype" v={`${o.type || "–"} / ${o.subtype || "–"}`} />
          <Row k="road" v={roadLink} />
          <Row k="s / t" v={`${f(o.s)} / ${f(o.t)} m`} />
          <Row k="zOffset" v={`${f(o.zOffset)} m`} />
          {o.radius > 0 && <Row k="radius" v={`${f(o.radius)} m`} />}
          {(o.length > 0 || o.width > 0) && <Row k="length × width" v={`${f(o.length)} × ${f(o.width)} m`} />}
          <Row k="height" v={`${f(o.height)} m`} />
          <Row k="heading" v={`${f((o.hdg * 180) / Math.PI, 1)}°`} />
          {o.outline.length > 0 && <Row k="outline" v={`${o.outline.length} corners`} />}
        </section>
        {o.repeats.length > 0 && (
          <section>
            <h3>Repeat ({o.repeats.length})</h3>
            <Row k="s range" v={`${f(o.repeats[0].s)} … ${f(o.repeats[o.repeats.length - 1].s + o.repeats[o.repeats.length - 1].length)} m`} />
            <Row k="distance" v={o.repeats[0].distance > 0 ? `${f(o.repeats[0].distance)} m` : "continuous"} />
            <Row k="height" v={`${f(o.repeats[0].heightStart)} … ${f(o.repeats[0].heightEnd)} m`} />
            <Row k="width" v={`${f(o.repeats[0].widthStart)} … ${f(o.repeats[0].widthEnd)} m`} />
          </section>
        )}
      </>
    );
  } else if (sel.kind === "structure") {
    const st = road.structures[sel.index];
    eyebrow = st.kind === "tunnel" ? "Tunnel" : "Bridge"; title = `${st.name || eyebrow} ${st.id}`;
    body = (
      <section>
        <h3>{eyebrow}</h3>
        <Row k="type" v={st.type || "–"} />
        <Row k="road" v={roadLink} />
        <Row k="s range" v={`${f(st.s)} … ${f(st.s + st.length)} m`} />
        <Row k="length" v={`${f(st.length)} m`} />
      </section>
    );
  } else if (sel.kind === "crossPath") {
    const j = net.od!.junctions.find((q) => q.crossPaths.some((c) => c.crossingRoad === info.id));
    const cp = j?.crossPaths.find((c) => c.crossingRoad === info.id);
    eyebrow = "Cross path"; title = `Cross path ${cp?.id ?? ""}${j ? ` · junction ${j.id}` : ""}`;
    body = cp && (
      <section>
        <h3>Cross path</h3>
        <Row k="crossing road" v={roadLink} />
        <Row k="from road" v={<a onClick={() => onGoRoad(cp.roadAtStart)}>{cp.roadAtStart}</a>} />
        {cp.startLaneLink && <Row k="start lane link" v={`s ${f(cp.startLaneLink.s)}: lane ${cp.startLaneLink.from} → ${cp.startLaneLink.to}`} />}
        <Row k="to road" v={<a onClick={() => onGoRoad(cp.roadAtEnd)}>{cp.roadAtEnd}</a>} />
        {cp.endLaneLink && <Row k="end lane link" v={`s ${f(cp.endLaneLink.s)}: lane ${cp.endLaneLink.from} → ${cp.endLaneLink.to}`} />}
      </section>
    );
  }
  return (
    <aside className="inspector">
      <header className="drawer-head">
        <div><div className="eyebrow">{eyebrow}</div><h2>{title}</h2></div>
        <button className="icon-btn" aria-label="Close inspector" onClick={onClose}>✕</button>
      </header>
      {body}
    </aside>
  );
}
