import { describe, expect, it } from "vitest";
import { readSummary } from "./vrcStatus";

const ok = { indicator: "none", description: "All Systems Operational" };

describe("readSummary", () => {
  it("reads all clear as Stable", () => {
    const s = readSummary({ status: ok, components: [{ name: "API / Website", status: "operational", group: true }], incidents: [] });
    expect(s).toMatchObject({ level: "ok", label: "Stable", description: "All Systems Operational", affected: [], incidents: [] });
  });

  it("uses the page's indicator", () => {
    expect(readSummary({ status: { indicator: "minor", description: "Minor Service Outage" } })).toMatchObject({ level: "minor", label: "Degraded" });
    expect(readSummary({ status: { indicator: "major", description: "Partial System Outage" } })).toMatchObject({ level: "major", label: "Partial outage" });
    expect(readSummary({ status: { indicator: "critical", description: "Major System Outage" } })).toMatchObject({ level: "critical", label: "Major outage" });
    expect(readSummary({ status: { indicator: "maintenance", description: "Service Under Maintenance" } })).toMatchObject({ level: "maintenance", label: "Maintenance" });
  });

  it("goes by the worst service even if the indicator says all is well", () => {
    const s = readSummary({
      status: ok,
      components: [
        { name: "API / Website", status: "partial_outage", group: true },
        { name: "Authentication / Login", status: "partial_outage" },
        { name: "Europe (Amsterdam)", status: "degraded_performance" },
      ],
    });
    expect(s.level).toBe("major");
    expect(s.description).toBe("Some services aren't working normally");
    expect(s.affected).toEqual(["Authentication / Login · Partial outage", "Europe (Amsterdam) · Degraded"]);
  });

  it("lists open incidents and maintenance in progress", () => {
    const s = readSummary({
      status: ok,
      incidents: [
        { name: "Login issues", status: "investigating" },
        { name: "Old one", status: "resolved" },
      ],
      scheduled_maintenances: [
        { name: "Database upgrade", status: "in_progress" },
        { name: "Later", status: "scheduled" },
      ],
    });
    expect(s.level).toBe("minor");
    expect(s.incidents).toEqual(["Login issues · Investigating"]);
    expect(s.maintenance).toEqual(["Database upgrade"]);
  });

  it("treats an unknown indicator as a problem", () => {
    expect(readSummary({ status: { indicator: "weird", description: "?" } }).level).toBe("minor");
  });
});
