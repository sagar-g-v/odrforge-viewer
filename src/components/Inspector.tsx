// Right-hand drawer: the clicked road and lane (s, t, width, height, links, material, speed, access, OSM source ways).
import type { Network } from "../data/useNetwork";
import { JUNCTION } from "../design/scene";
import { isVirtual } from "../map/junctionStyle";
import type { UserData } from "../xodr/model";
import { Icon } from "./Icon";
import type { LaneProbe } from "../xodr/query";

/** a lane, or with whole = true its road (all lanes highlighted) */
// layer "temporary": a lane of the road's temporary lane layer (1.9.0 §11.2); laneIndex then indexes render.temporary.lanes
export interface Selection { road: number; laneId: number | null; laneIndex: number | null; x: number; y: number; probe: LaneProbe | null; whole?: boolean; layer?: "temporary"; }

const f = (v: number | null | undefined, d = 2) => {
  if (v === null || v === undefined || !Number.isFinite(v)) return "–";
  const t = v.toFixed(d);
  return /^-0\.?0*$/.test(t) ? t.slice(1) : t; // -0.001 -> "0.00", not "-0.00"
};

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return <div className="kv"><span>{k}</span><span>{v}</span></div>;
}

/** the record in force at ds: the last whose s <= ds (records sorted by s), and how many the element has */
function recAt<T extends { s: number }>(xs: T[], ds: number | undefined): T | undefined {
  if (!xs.length) return undefined;
  if (ds === undefined) return xs[0];
  let r = xs[0];
  for (const x of xs) if (x.s <= ds + 1e-9) r = x;
  return r;
}
const of = (n: number) => (n > 1 ? ` (record ${n})` : "");
const osmLink = (w: string) => (
  <a key={w} href={`https://www.openstreetmap.org/way/${w.replace(/^-/, "")}`} target="_blank" rel="noreferrer">{w} </a>);

/** every <userData> entry; OdrForge's osmWays link to the OSM ways a road was built from */
function UserDataRows({ data }: { data: UserData[] }) {
  if (!data.length) return null;
  const ways = data.filter((u) => u.code === "osmWays").flatMap((u) => u.value.split(/[ ,]+/).filter(Boolean));
  return (
    <>
      {ways.length > 0 && <Row k="OSM ways" v={ways.map(osmLink)} />}
      {data.filter((u) => u.code !== "osmWays").map((u, i) => <Row key={`u${i}`} k={`userData ${u.code}`} v={u.value || "–"} />)}
    </>
  );
}

export default function Inspector({ net, sel, onClose, onFlag, onGoRoad, onWhole }: {
  net: Network; sel: Selection; onClose: () => void; onFlag: () => void; onGoRoad: (id: string) => void; onWhole: (whole: boolean) => void;
}) {
  const info = net.roads[sel.road];
  if (!info) return null;
  const road = net.od?.roads[sel.road];
  const pr = sel.probe;
  const lane = pr?.lane;
  const junction = road && road.junction !== "-1" ? net.od?.junctions.find((j) => j.id === road.junction) : undefined;
  const link = (l: { type: string; id: string; contact: string } | null) =>
    !l ? "–" : l.type === "road" ? <button type="button" className="link" onClick={() => onGoRoad(l.id)}>road {l.id}{l.contact ? ` (${l.contact})` : ""}</button> : `junction ${l.id}`;
  const speed = recAt(road?.types ?? [], pr?.s);
  const ds = pr ? pr.s - pr.sectionStart : undefined; // lane records are offset from the lane section's start
  const lSpeed = lane ? recAt(lane.speeds, ds) : undefined, mat = lane ? recAt(lane.materials, ds) : undefined;
  const acc = lane?.access.filter((a) => a.s === recAt(lane.access, ds)?.s) ?? []; // all <access> records at that sOffset
  const rule = lane ? recAt(lane.rules, ds) : undefined, height = lane ? recAt(lane.heights, ds) : undefined;
  return (
    <aside className="inspector">
      <header className="drawer-head">
        <div>
          <div className="eyebrow">{info.junction !== "-1" ? `Connecting road · junction ${info.junction}` : "Road"}</div>
          <h2>Road {info.id}{info.name ? ` · ${info.name}` : ""}</h2>
        </div>
        <button className="icon-btn" aria-label="Close inspector" onClick={onClose}><Icon name="x" /></button>
      </header>
      {sel.laneId !== null && (
        <div className="drawer-tools">
          <div className="seg" role="group" aria-label="Select">
            <button className={sel.whole ? "" : "on"} onClick={() => onWhole(false)} title="This lane">Lane</button>
            <button className={sel.whole ? "on" : ""} onClick={() => onWhole(true)} title="The whole road: all its lanes (Shift+click a lane)">Road</button>
          </div>
        </div>
      )}
      <section>
        <h3>Position</h3>
        <Row k="s / t" v={`${f(pr?.s)} m / ${f(pr?.t)} m`} />
        <Row k="x / y" v={`${f(sel.x)} / ${f(sel.y)}`} />
        <Row k="surface z" v={`${f(pr?.z)} m`} />
        <Row k="superelevation" v={pr ? `${f((pr.superelevation * 180) / Math.PI, 2)}°` : "–"} />
      </section>
      {!sel.whole && (lane || sel.laneId !== null) && (
        <section>
          <h3>Lane {sel.laneId}{sel.layer === "temporary" ? " · temporary layer" : ""}</h3>
          {sel.layer === "temporary" && <Row k="layer" v="temporary (OpenDRIVE 1.9 §11.2, e.g. roadworks): drawn over the permanent lanes, takes precedence for driving" />}
          <Row k="type" v={lane?.type ?? (sel.layer === "temporary" ? net.render.temporary?.lanes.meta[sel.laneIndex ?? 0]?.type : net.render.lanes.meta[sel.laneIndex ?? 0]?.type)} />
          {lane?.roadworks && <Row k="roadworks" v="access restricted by roadworks (@roadworks, 1.9 §11.2)" />}
          {lane && <Row k="direction" v={lane.direction} />}
          <Row k="width" v={`${f(pr?.width)} m`} />
          <Row k="border t inner / outer" v={`${f(pr?.inner)} / ${f(pr?.outer)}`} />
          {lane && <Row k="links" v={`${lane.pred ?? "–"} → ${lane.succ ?? "–"}`} />}
          {lSpeed && <Row k={`speed${of(lane!.speeds.length)}`} v={`max ${lSpeed.max} ${lSpeed.unit}${lSpeed.unit === "m/s" ? ` (${f(lSpeed.max * 3.6, 1)} km/h)` : ""}`} />}
          {height && <Row k={`height inner / outer${of(lane!.heights.length)}`} v={`${height.inner} / ${height.outer} m`} />}
          {mat && <Row k={`material${of(lane!.materials.length)}`}
            v={`${mat.surface || "–"} · friction ${f(mat.friction)} · roughness ${f(mat.roughness)}`} />}
          {acc.map((a, i) => <Row key={`a${i}`} k="access" v={`${a.rule} ${a.restriction}`} />)}
          {rule && <Row k="rule" v={rule.value} />}
          {lane && <UserDataRows data={lane.userData} />}
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
        {speed && <Row k={`type${of(road!.types.length)}`} v={`${speed.type || "–"}${speed.speed !== null ? ` · speed ${speed.speed} ${speed.unit}` : ""}`} />}
        {road && <UserDataRows data={road.userData} />}
      </section>
      {junction && (
        <section>
          <h3>Junction {junction.id}</h3>
          <Row k="type" v={junction.type} />
          <Row k="connections" v={junction.connections.length} />
          <Row k="arms" v={[...new Set(junction.connections.map((c) => c.incomingRoad))].map((id) => <button type="button" className="link" key={id} onClick={() => onGoRoad(id)}>{id} </button>)} />
        </section>
      )}
      <footer className="drawer-foot">
        <button className="btn block" onClick={onFlag}><Icon name="flag" />{sel.whole ? "Flag this road" : sel.laneId !== null ? "Flag this lane" : "Flag something here"}</button>
      </footer>
    </aside>
  );
}

/** a junction area: type, boundary source, connections and the arms they join */
export function JunctionInspector({ net, index, onClose, onFlag, onGoRoad }: {
  net: Network; index: number; onClose: () => void; onFlag: () => void; onGoRoad: (id: string) => void;
}) {
  const m = net.render.junctions.meta[index];
  if (!m) return null;
  const j = net.od?.junctions.find((q) => q.id === m.id);
  const arms = j ? [...new Set(j.connections.map((c) => c.incomingRoad))] : [];
  const connecting = net.roads.filter((r) => r.junction === m.id);
  const turns = j?.connections.reduce((n, c) => n + c.laneLinks.length, 0) ?? 0;
  const g = j?.elevationGrid ?? null;
  const groups = net.od?.junctionGroups.filter((gr) => gr.junctions.includes(m.id)) ?? [];
  const gridZ = g ? g.rows.flatMap((r) => [...r.center, ...r.left, ...r.right]) : [], gridPts = gridZ.length;
  const lineEnd = j ? j.refLine.reduce((a, q) => Math.max(a, q.s + q.length), 0) : 0;
  const beyond = g ? g.rows.filter((_, k) => g.sStart + k * g.gridSpacing > lineEnd + 1e-6).length : 0;
  return (
    <aside className="inspector">
      <header className="drawer-head">
        <div>
          <div className="eyebrow">Junction{j ? ` · ${j.type}` : ""}</div>
          <h2>Junction {m.id}{j?.name ? ` · ${j.name}` : ""}</h2>
          {isVirtual(m) && <span className="chip virtual">{JUNCTION.label.virtual}</span>}
        </div>
        <button className="icon-btn" aria-label="Close inspector" onClick={onClose}><Icon name="x" /></button>
      </header>
      <section>
        <h3>Area</h3>
        <Row k="outline" v={m.outline === "boundary" ? "<boundary> (OpenDRIVE 1.8 §12.10)"
          : m.outline === "span" ? `main road ${j?.mainRoad}, s ${f(j?.sStart ?? NaN)} – ${f(j?.sEnd ?? NaN)} m (§12.5)` : "approximate (hull of connecting roads)"} />
        {j && <Row k="boundary segments" v={j.boundary.length ? `${j.boundary.filter((b) => b.type === "lane").length} lane, ${j.boundary.filter((b) => b.type === "joint").length} joint` : "none"} />}
        {j && j.refLine.length > 0 && <Row k="reference line (§12.9)"
          v={`${j.refLine.map((g) => g.kind).join(", ")} · ${f(j.refLine.reduce((a, g) => a + g.length, 0))} m · hdg ${f((j.refLine[0].hdg * 180) / Math.PI, 1)}°`} />}
      </section>
      {g && (
        <section>
          <h3>Elevation grid (§12.11)</h3>
          <Row k="grid spacing / sStart" v={`${f(g.gridSpacing)} m / ${f(g.sStart)} m`} />
          <Row k="rows × points" v={`${g.rows.length} rows, ${gridPts} points (left up to ${Math.max(0, ...g.rows.map((r) => r.left.length))}, right up to ${Math.max(0, ...g.rows.map((r) => r.right.length))})`} />
          <Row k="z range" v={gridPts ? `${f(Math.min(...gridZ))} … ${f(Math.max(...gridZ))} m` : "–"} />
          {beyond > 0 && <Row k="rows past the line end" v={`${beyond} (the line is extended straight)`} />}
        </section>
      )}
      {groups.length > 0 && (
        <section>
          <h3>Junction group (§12.13)</h3>
          {groups.map((gr) => <Row key={gr.id} k={`${gr.type || "group"} ${gr.id}${gr.name ? ` · ${gr.name}` : ""}`}
            v={gr.junctions.map((id) => <button type="button" className="link" key={id} onClick={() => onGoRoad(`j ${id}`)}>{id} </button>)} />)}
        </section>
      )}
      {j && j.userData.length > 0 && <section><h3>User data</h3><UserDataRows data={j.userData} /></section>}
      <section>
        <h3>Connections</h3>
        {j && <Row k="connections" v={j.connections.length} />}
        {j && <Row k="lane links" v={turns} />}
        <Row k="connecting roads" v={connecting.length} />
        {arms.length > 0 && <Row k="incoming arms" v={arms.map((id) => <button type="button" className="link" key={id} onClick={() => onGoRoad(id)}>{id} </button>)} />}
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
        <button className="btn block" onClick={onFlag}><Icon name="flag" />Flag this junction</button>
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
  if (!info) return null;
  const roadLink = <button type="button" className="link" onClick={() => onGoRoad(info.id)}>road {info.id}{info.name ? ` · ${info.name}` : ""}</button>;
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
          <Row k="size (w × h)" v={g.width > 0 && g.height > 0 ? `${f(g.width)} × ${f(g.height)} m`
            : `${g.width > 0 ? `${f(g.width)} m` : "not in the file"} × ${g.height > 0 ? `${f(g.height)} m` : "not in the file"} (drawn at a typical size)`} />
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
          {o.outlines.map((ol, i) => (
            <Row key={`o${i}`} k={`outline${ol.id ? ` ${ol.id}` : ""}`} v={`${ol.closed ? "area" : "line"} · ${ol.corners.length} ${ol.corners[0]?.kind === "road" ? "cornerRoad" : "cornerLocal"}`
              + `${ol.fillType ? ` · fill ${ol.fillType}` : ""}${ol.laneType ? ` · lane type ${ol.laneType}` : ""}${ol.outer !== null ? ` · ${ol.outer ? "outer" : "inner"}` : ""}`
              + ` · height ${f(Math.min(...ol.corners.map((c) => c.height)))} … ${f(Math.max(...ol.corners.map((c) => c.height)))} m`} />
          ))}
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
        <Row k="from road" v={<button type="button" className="link" onClick={() => onGoRoad(cp.roadAtStart)}>{cp.roadAtStart}</button>} />
        {cp.startLaneLink && <Row k="start lane link" v={`s ${f(cp.startLaneLink.s)}: lane ${cp.startLaneLink.from} → ${cp.startLaneLink.to}`} />}
        <Row k="to road" v={<button type="button" className="link" onClick={() => onGoRoad(cp.roadAtEnd)}>{cp.roadAtEnd}</button>} />
        {cp.endLaneLink && <Row k="end lane link" v={`s ${f(cp.endLaneLink.s)}: lane ${cp.endLaneLink.from} → ${cp.endLaneLink.to}`} />}
      </section>
    );
  }
  return (
    <aside className="inspector">
      <header className="drawer-head">
        <div><div className="eyebrow">{eyebrow}</div><h2>{title}</h2></div>
        <button className="icon-btn" aria-label="Close inspector" onClick={onClose}><Icon name="x" /></button>
      </header>
      {body}
    </aside>
  );
}
