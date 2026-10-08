import { useQuery } from "@tanstack/react-query";
import { ChartColumn } from "lucide-react";
import { useState } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, Empty, PageHeader, SectionTitle, Segmented, Skeleton } from "@/components/ui";
import { cn, duration, hours } from "@/lib/format";
import { ipc } from "@/lib/ipc";
import { useFriends } from "@/stores/friends";
import { useUi } from "@/stores/ui";

const RANGES = [
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "365", label: "Year" },
  // 0 asks for everything back to your oldest record.
  { value: "0", label: "All time" },
] as const;
type Range = (typeof RANGES)[number]["value"];

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <Card className="p-4">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-1 text-[28px] font-bold leading-none tracking-tight tabular-nums">{value}</div>
      {hint && <div className="mt-1.5 text-xs text-subtle">{hint}</div>}
    </Card>
  );
}

function Bars({ rows }: { rows: { key: string; label: string; ms: number; sub: string; onClick?: () => void; highlight?: boolean }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.ms));
  return (
    <div className="space-y-1">
      {rows.map((r) => (
        <button
          key={r.key}
          onClick={r.onClick}
          title={`${r.label}: ${duration(r.ms)} · ${r.sub}`}
          className="group relative flex h-9 w-full items-center gap-3 rounded-lg px-2 text-left text-[13px] hover:bg-hover cursor-pointer"
        >
          <div
            className="absolute inset-y-1.5 left-0 rounded-r-[4px] bg-accent-soft transition-colors group-hover:bg-accent/25"
            style={{ width: `${(r.ms / max) * 100}%` }}
          />
          <span className={cn("relative min-w-0 flex-1 truncate font-medium", r.highlight && "text-accent")}>{r.label}</span>
          <span className="relative text-xs text-subtle">{r.sub}</span>
          <span className="relative w-16 text-right text-xs font-semibold tabular-nums">{duration(r.ms)}</span>
        </button>
      ))}
    </div>
  );
}

function Heatmap({ data }: { data: number[][] }) {
  const max = Math.max(1, ...data.flat());
  return (
    <div className="overflow-x-auto">
      <div className="inline-grid min-w-full gap-[3px]" style={{ gridTemplateColumns: "36px repeat(24, minmax(14px, 1fr))" }}>
        <span />
        {Array.from({ length: 24 }, (_, h) => (
          <span key={h} className="text-center text-[10px] text-subtle">
            {h % 3 === 0 ? h : ""}
          </span>
        ))}
        {data.map((row, d) => (
          <div key={d} className="contents">
            <span className="pr-1 text-right text-[11px] leading-[18px] text-subtle">{DAYS[d]}</span>
            {row.map((m, h) => {
              const t = m / max;
              return (
                <span
                  key={h}
                  title={`${DAYS[d]} ${h}:00–${h + 1}:00 · ${duration(m * 60_000)} played`}
                  className="h-[18px] rounded-[3px] ring-accent hover:ring-2"
                  style={{
                    background: m === 0 ? "var(--panel-2)" : `color-mix(in oklch, var(--accent) ${Math.round(18 + t * 82)}%, var(--panel-2))`,
                  }}
                />
              );
            })}
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center justify-end gap-1.5 text-[11px] text-subtle">
        Less
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <span
            key={t}
            className="size-3 rounded-[3px]"
            style={{ background: t === 0 ? "var(--panel-2)" : `color-mix(in oklch, var(--accent) ${Math.round(18 + t * 82)}%, var(--panel-2))` }}
          />
        ))}
        More
      </div>
    </div>
  );
}

export function Insights() {
  const [range, setRange] = useState<Range>("30");
  const byId = useFriends((s) => s.byId);
  const openUser = useUi((s) => s.openUser);
  const openWorld = useUi((s) => s.openWorld);
  const { data, isLoading } = useQuery({ queryKey: ["insights", range], queryFn: () => ipc.insights(Number(range)), staleTime: 60_000 });

  const daily = (data?.daily ?? []).map((d) => ({ ...d, h: +(d.ms / 3_600_000).toFixed(2), label: new Date(d.date + "T00:00").toLocaleDateString([], { month: "short", day: "numeric" }) }));
  const people = (data?.topPeople ?? []).filter((p) => byId[p.userId]).slice(0, 10);
  const avg = daily.length ? (data!.totalPlayMs / daily.length) : 0;

  return (
    <div>
      <PageHeader title="Insights" subtitle="Built from your local game log and feed history.">
        <Segmented<Range> value={range} onChange={setRange} options={RANGES.map((r) => ({ value: r.value, label: r.label }))} />
      </PageHeader>
      {isLoading || !data ? (
        <div className="grid gap-4 md:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
      ) : data.sessions === 0 && !data.feedCounts.length ? (
        <Card>
          <Empty icon={<ChartColumn />} title="Not enough data yet" hint="Play some VRChat with Nexus running and come back — insights fill in from your game log." />
        </Card>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Stat label="Time in VRChat" value={hours(data.totalPlayMs)} hint={`about ${duration(avg)} a day`} />
            <Stat label="World visits" value={data.sessions} hint={`${data.uniqueWorlds} different worlds`} />
            <Stat label="People met" value={data.uniquePlayers.toLocaleString()} hint="unique players in your instances" />
            <Stat
              label="Friend activity"
              value={data.feedCounts.reduce((n, c) => n + c.count, 0).toLocaleString()}
              hint={`${data.friendsAdded.reduce((n, c) => n + c.count, 0)} new friends`}
            />
          </div>

          <Card className="p-4">
            <SectionTitle>Hours played per day</SectionTitle>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={daily} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
                  <defs>
                    <linearGradient id="fillHours" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke="var(--line)" strokeDasharray="0" />
                  <XAxis dataKey="label" tick={{ fill: "var(--subtle)", fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={24} />
                  <YAxis tick={{ fill: "var(--subtle)", fontSize: 11 }} tickLine={false} axisLine={false} unit="h" allowDecimals={false} />
                  <Tooltip
                    cursor={{ stroke: "var(--muted)", strokeWidth: 1 }}
                    contentStyle={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 10, fontSize: 12 }}
                    labelStyle={{ color: "var(--muted)" }}
                    itemStyle={{ color: "var(--fg)" }}
                    formatter={(_v, _n, item) => [duration((item.payload as { ms: number }).ms), "Played"]}
                  />
                  <Area type="monotone" dataKey="h" stroke="var(--accent)" strokeWidth={2} fill="url(#fillHours)" activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--panel)" }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card className="p-4">
            <SectionTitle>When you play</SectionTitle>
            <Heatmap data={data.heatmap} />
          </Card>

          <div className="grid gap-4 xl:grid-cols-2">
            <Card className="p-4">
              <SectionTitle>Top worlds</SectionTitle>
              {data.topWorlds.length ? (
                <Bars
                  rows={data.topWorlds.map((w) => ({
                    key: w.worldId,
                    label: w.worldName ?? w.worldId,
                    ms: w.ms,
                    sub: `${w.visits} visit${w.visits === 1 ? "" : "s"}`,
                    onClick: () => openWorld(w.worldId),
                  }))}
                />
              ) : (
                <p className="text-[13px] text-subtle">No visits recorded in this range.</p>
              )}
            </Card>
            <Card className="p-4">
              <SectionTitle>Friends you spend the most time with</SectionTitle>
              {people.length ? (
                <Bars
                  rows={people.map((p) => ({
                    key: p.userId,
                    label: byId[p.userId]?.displayName ?? p.displayName,
                    ms: p.ms,
                    sub: `${p.encounters}×`,
                    onClick: () => openUser(p.userId),
                  }))}
                />
              ) : (
                <p className="text-[13px] text-subtle">You haven't shared an instance with a friend in this range.</p>
              )}
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
