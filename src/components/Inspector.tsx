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
