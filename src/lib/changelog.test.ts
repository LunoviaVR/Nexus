import { describe, expect, it } from "vitest";
import { compareVersions, RELEASES, releaseFromMarkdown, releasesUpTo, whatsNew } from "./changelog";

const rel = (version: string) => ({ version, blocks: [] });
const ALL = ["1.0.11", "1.0.10", "1.0.9", "1.0.8"].map(rel);
const versions = (rs: { version: string }[]) => rs.map((r) => r.version);

describe("compareVersions", () => {
  it("compares numerically, not as text", () => {
    expect(compareVersions("1.0.10", "1.0.9")).toBe(1);
    expect(compareVersions("1.0.9", "1.0.10")).toBe(-1);
    expect(compareVersions("v1.2.0", "1.2")).toBe(0);
    expect(compareVersions("2.0.0-beta", "2.0.0")).toBe(0);
  });
});

describe("whatsNew", () => {
  it("shows nothing on a fresh install", () => {
    expect(whatsNew(null, "1.0.10", false, ALL)).toEqual([]);
  });

  it("shows nothing when the version hasn't changed, or went back", () => {
    expect(whatsNew("1.0.10", "1.0.10", true, ALL)).toEqual([]);
    expect(whatsNew("1.0.11", "1.0.10", true, ALL)).toEqual([]);
  });

  it("shows the new version when updating from before this feature", () => {
    expect(versions(whatsNew(null, "1.0.10", true, ALL))).toEqual(["1.0.10"]);
  });

  it("counts 1.1.0 as newer than 1.0.10", () => {
    expect(compareVersions("1.1.0", "1.0.10")).toBe(1);
    const all = ["1.1.0", "1.0.10", "1.0.9"].map(rel);
    expect(versions(whatsNew("1.0.10", "1.1.0", true, all))).toEqual(["1.1.0"]);
    expect(versions(whatsNew("1.0.9", "1.1.0", true, all))).toEqual(["1.1.0", "1.0.10"]);
  });

  it("counts 1.1.1 as newer than 1.1.0", () => {
    expect(compareVersions("1.1.1", "1.1.0")).toBe(1);
    const all = ["1.1.1", "1.1.0", "1.0.10"].map(rel);
    expect(versions(whatsNew("1.1.0", "1.1.1", true, all))).toEqual(["1.1.1"]);
  });

  it("shows every version since the last one run", () => {
    expect(versions(whatsNew("1.0.8", "1.0.11", true, ALL))).toEqual(["1.0.11", "1.0.10", "1.0.9"]);
    expect(versions(whatsNew("1.0.9", "1.0.10", true, ALL))).toEqual(["1.0.10"]);
  });
});

describe("releases", () => {
  it("hides notes for versions newer than the one running", () => {
    expect(versions(releasesUpTo("1.0.9", ALL))).toEqual(["1.0.9", "1.0.8"]);
  });

  it("drops the title and the install instructions", () => {
    const r = releaseFromMarkdown("1.0.4", "# Nexus 1.0.4\n\n## ✨ Improved\n\n- A\n\n## ⬆️ Updating\n\nClick install.\n\n---\n");
    expect(r.blocks.map((b) => b.t)).toEqual(["h", "ul"]);
  });

  it("bundles docs/releases, newest first", () => {
    expect(RELEASES.length).toBeGreaterThan(0);
    const vs = versions(RELEASES);
    expect([...vs].sort((a, b) => compareVersions(b, a))).toEqual(vs);
    expect(vs).toContain("1.0.0");
  });
});
