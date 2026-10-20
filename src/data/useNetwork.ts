// Loading a network: from the review server (file list + fetch) or a local file, parsed in a Web Worker.
import { useCallback, useEffect, useRef, useState } from "react";
import type { RenderData } from "../xodr/build";
import type { OpenDrive } from "../xodr/model";
import type { ExportRoad } from "../xodr/odrforgeExport";
import { makeProjector, type Projector } from "../xodr/geo";
import { sha256Hex, type PageSource } from "./provenance";

export interface Network {
  name: string; // file name
  page: string; // review page name (file stem): flags live in <page>.flags.json next to it
  kind: "xodr" | "export";
  od: OpenDrive | null; // full model (xodr input)
  roads: ExportRoad[]; // id / name / junction / length of every road, either input
  render: RenderData;
  proj: Projector;
  ms: number;
  fromServer: boolean;
  source: PageSource | null; // the exact bytes fetched from the review server (identity for build provenance); null for a local file
}

type WorkerResult = { kind: "xodr"; od: OpenDrive; render: RenderData; georeferenced: boolean; ms: number }
  | { kind: "export"; info: { title: string; geo: string; roads: ExportRoad[] }; render: RenderData; georeferenced: boolean; ms: number };

const stem = (name: string) => name.replace(/^.*[\\/]/, "").replace(/\.(xodr|html|json)$/i, "");

export async function listServerFiles(server: string): Promise<string[]> {
  const r = await fetch(server.replace(/\/$/, "") + "/", { cache: "no-store" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const html = await r.text();
  const files = new Set<string>();
  for (const m of html.matchAll(/href="([^"?#]+\.xodr)"/gi)) files.add(decodeURIComponent(m[1]));
  return [...files].sort();
}

export function useNetwork() {
  const worker = useRef<Worker | null>(null);
  const seq = useRef(0);
  const [network, setNetwork] = useState<Network | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    worker.current = new Worker(new URL("../worker/loader.worker.ts", import.meta.url), { type: "module" });
    return () => worker.current?.terminate();
  }, []);

  // every open takes a sequence number before any await; a result, error or spinner change of an older one is dropped
  const parse = useCallback((id: number, name: string, text: string, fromServer: boolean, source: PageSource | null = null) => {
    if (id !== seq.current) return;
    setLoading(`Building ${name}…`);
    setError(null);
    const w = worker.current!;
    // the worker itself failed (out of memory, a crash outside the try): never leave the spinner running
    const onFail = (e: Event) => {
      done();
      if (id !== seq.current) return;
      setLoading(null);
      setError(`Could not read ${name}: the loader stopped (${e instanceof ErrorEvent && e.message ? e.message : "the file may be too large for this browser"})`);
    };
    const done = () => { w.removeEventListener("message", onMsg); w.removeEventListener("error", onFail); w.removeEventListener("messageerror", onFail); };
    const onMsg = (e: MessageEvent) => {
      if (e.data.id !== id) return;
      done();
      if (id !== seq.current) return; // a newer file was opened (or B removed) meanwhile
      setLoading(null);
      if (e.data.error) { setError(e.data.error); return; }
      const res = e.data.result as WorkerResult;
      const geo = res.kind === "xodr" ? res.od.header.geoReference : res.info.geo;
      const roads = res.kind === "xodr" ? res.od.roads.map((r) => ({ id: r.id, name: r.name, junction: r.junction, length: r.length })) : res.info.roads;
      setNetwork({
        name, page: stem(name), kind: res.kind, od: res.kind === "xodr" ? res.od : null, roads, render: res.render,
        proj: makeProjector(geo), ms: res.ms, fromServer, source,
      });
    };
    w.addEventListener("message", onMsg);
    w.addEventListener("error", onFail);
    w.addEventListener("messageerror", onFail);
    w.postMessage({ id, name, text });
  }, []);

  const openServerFile = useCallback(async (server: string, file: string) => {
    const id = ++seq.current;
    setLoading(`Downloading ${file}…`);
    setError(null);
    try {
      const r = await fetch(`${server.replace(/\/$/, "")}/${encodeURIComponent(file)}`, { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status} for ${file}`);
      // the bytes as served: hashed so the page's build record can be tied to exactly this file (data/provenance.ts)
      const buf = await r.arrayBuffer();
      const source: PageSource = { file, sha256: await sha256Hex(buf), bytes: buf.byteLength, lastModified: r.headers.get("Last-Modified") };
      parse(id, file, new TextDecoder().decode(buf), true, source);
    } catch (e) {
      if (id !== seq.current) return;
      setLoading(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [parse]);

  const openLocalFile = useCallback(async (f: File) => { const id = ++seq.current; parse(id, f.name, await f.text(), false); }, [parse]);

  const clear = useCallback(() => { seq.current++; setNetwork(null); setLoading(null); setError(null); }, []);
  return { network, loading, error, openServerFile, openLocalFile, clearError: () => setError(null), clear };
}
