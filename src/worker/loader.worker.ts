// Parses a network off the main thread and returns render buffers (typed arrays transferred, not copied).
import { buildRender } from "../xodr/build";
import { makeProjector } from "../xodr/geo";
import { buildFromExport, extractExport } from "../xodr/odrforgeExport";
import { parseOpenDrive } from "../xodr/parse";

export type LoadRequest = { id: number; name: string; text: string };

self.onmessage = (e: MessageEvent<LoadRequest>) => {
  const { id, name, text } = e.data;
  const t0 = performance.now();
  try {
    const isXodr = /\.xodr$/i.test(name) || text.trimStart().startsWith("<?xml") || text.includes("<OpenDRIVE");
    if (isXodr) {
      const od = parseOpenDrive(text);
      const proj = makeProjector(od.header.geoReference);
      const render = buildRender(od, proj.forward);
      post(id, { kind: "xodr", od, render, georeferenced: proj.georeferenced, ms: performance.now() - t0 }, render);
    } else {
      const data = extractExport(text);
      const proj = makeProjector(String((data as { geo?: string }).geo ?? ""));
      const { render, info } = buildFromExport(data, proj);
      post(id, { kind: "export", info: { ...info, raw: undefined }, render, georeferenced: proj.georeferenced, ms: performance.now() - t0 }, render);
    }
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};

function post(id: number, result: Record<string, unknown>, r: { lanes: { positions: Float64Array; starts: Uint32Array }; marks: { positions: Float64Array; starts: Uint32Array }; refs: { positions: Float64Array; starts: Uint32Array }; objects: { positions: Float64Array; starts: Uint32Array }; junctions: { positions: Float64Array; starts: Uint32Array }; points: { positions: Float64Array } }) {
  const transfer = [r.lanes, r.marks, r.refs, r.objects, r.junctions].flatMap((b) => [b.positions.buffer, b.starts.buffer]).concat([r.points.positions.buffer]);
  (self as unknown as Worker).postMessage({ id, result }, transfer as Transferable[]);
}
