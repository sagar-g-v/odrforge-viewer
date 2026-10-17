// Build provenance (data/provenance.ts): a <page>.metrics.json is shown only when it provably describes the loaded bytes.
// Another build's numbers are never shown. That happened on 2026-10-17: a test-area folder held one page from an earlier
// run next to a grid from a later one.
import { describe, expect, it } from "vitest";
import { matchProvenance, metres, sha256Hex, type PageSource } from "../src/data/provenance";

const PAGE: PageSource = {
  file: "stelvio_standard.xodr", sha256: "a".repeat(64), bytes: 1361243, lastModified: "Sat, 17 Oct 2026 02:32:10 GMT",
};
const SNAP = {
  schema: 1, label: "gate stelvio", time: "2026-10-17T05:13:27", commit: "c684b7f+dirty", osm2xodr_built: "2026-10-17T04:46:14",
  folder: "C:\\mywork\\osm2carla\\build\\testareas", file: "stelvio_standard.xodr", sha256: "A".repeat(64), bytes: 1361243,
  mtime: "2026-10-17T02:32:10Z",
  metrics: { "terrain:centre_p95": 0.161, "terrain:conformed_p95": 0.132, "terrain:conformed_p99": 0.29, "terrain:decks_within_0.5m": null, roads: 46 },
};

describe("matchProvenance", () => {
  it("no file next to the page: no metrics for this build", () => {
    expect(matchProvenance(null, PAGE)).toEqual({ status: "none" });
  });
  it("the same bytes (sha256, case-insensitive): commit, dirty, run time and the fit numbers", () => {
    const p = matchProvenance(SNAP, PAGE);
    expect(p.status).toBe("match");
    if (p.status !== "match") return;
    expect(p.facts).toMatchObject({ commit: "c684b7f", dirty: true, runTime: "2026-10-17T05:13:27", binaryBuilt: "2026-10-17T04:46:14",
      by: "sha256", centreP95: 0.161, conformedP95: 0.132, conformedP99: 0.29, decksWithin05: null });
    const clean = matchProvenance({ ...SNAP, commit: "37e345e" }, PAGE);
    expect(clean.status === "match" && clean.facts).toMatchObject({ commit: "37e345e", dirty: false });
  });
  it("a snapshot from another folder's run (other bytes, same name) is a mismatch: its numbers are not shown", () => {
    const other = { ...SNAP, folder: "C:\\mywork\\osm2carla\\build\\tmp\\gate_out", sha256: "b".repeat(64), time: "2026-10-17T04:31:00" };
    const p = matchProvenance(other, PAGE);
    expect(p).toEqual({ status: "mismatch", reasons: ["the file's content differs (sha256)"], snapshotTime: "2026-10-17T04:31:00" });
    expect(JSON.stringify(p)).not.toMatch(/0\.132|c684b7f/); // nothing of the other build leaks out
  });
  it("a snapshot of another page is a mismatch, even with the same content", () => {
    const p = matchProvenance({ ...SNAP, file: "stelvio.xodr" }, PAGE);
    expect(p.status).toBe("mismatch");
    expect(p.status === "mismatch" && p.reasons[0]).toMatch(/stelvio\.xodr/);
  });
  it("without a hash: same size and modification time (within 2 s) ties it; anything else does not", () => {
    const { sha256: _, ...noHash } = SNAP;
    const ok = matchProvenance(noHash, PAGE);
    expect(ok.status === "match" && ok.facts.by).toBe("size+mtime");
    expect(matchProvenance({ ...noHash, mtime: "2026-10-17T02:32:11Z" }, PAGE).status).toBe("match");
    expect(matchProvenance({ ...noHash, mtime: "2026-10-17T03:32:10Z" }, PAGE).status).toBe("mismatch"); // rewritten an hour later
    expect(matchProvenance({ ...noHash, bytes: 1361244 }, PAGE).status).toBe("mismatch");
  });
  it("nothing to tie it with (no hash, no size and time): unverified, not shown", () => {
    const { sha256: _, mtime: __, ...bare } = SNAP;
    expect(matchProvenance(bare, PAGE).status).toBe("unverified");
    const { sha256: ___, ...noHash } = SNAP;
    expect(matchProvenance(noHash, { ...PAGE, lastModified: null }).status).toBe("unverified");
  });
  it("an unknown schema or missing fields: invalid", () => {
    expect(matchProvenance({ ...SNAP, schema: 2 }, PAGE).status).toBe("invalid");
    expect(matchProvenance({ ...SNAP, metrics: undefined }, PAGE).status).toBe("invalid");
    expect(matchProvenance("x", PAGE).status).toBe("invalid");
  });
});

describe("sha256Hex", () => {
  it("hashes the bytes (FIPS 180-2 test vector \"abc\")", async () => {
    expect(await sha256Hex(new TextEncoder().encode("abc").buffer as ArrayBuffer)).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("metres", () => {
  it("shows a millimetre fit as such, not as 0.00 m (Munich conformed p95 0.0021 m)", () => {
    expect(metres(0.0021)).toBe("0.002 m");
    expect(metres(0.132)).toBe("0.13 m");
    expect(metres(3.1706)).toBe("3.17 m");
    expect(metres(null)).toBe("–");
  });
});
