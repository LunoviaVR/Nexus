import { useQuery } from "@tanstack/react-query";
import { Bell, Check, Hand, Mail, MailPlus, UserPlus, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Button, Card, Chip, Empty, Img, PageHeader, Skeleton } from "@/components/ui";
import { ago } from "@/lib/format";
import { errorText, ipc } from "@/lib/ipc";
import type { VrcNotification } from "@/lib/types";
import { useLive } from "@/stores/live";
import { useUi } from "@/stores/ui";

const META: Record<string, { icon: ReactNode; text: (n: VrcNotification) => string }> = {
  invite: { icon: <Mail className="size-4" />, text: (n) => `invited you to ${detail(n, "worldName") ?? "their instance"}` },
  requestInvite: { icon: <MailPlus className="size-4" />, text: () => "is asking for an invite" },
  friendRequest: { icon: <UserPlus className="size-4" />, text: () => "sent you a friend request" },
  boop: { icon: <Hand className="size-4" />, text: () => "booped you" },
};

type Filter = "all" | "invite" | "requestInvite" | "friendRequest" | "boop" | "other";

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "invite", label: "Invites" },
  { value: "requestInvite", label: "Invite requests" },
  { value: "friendRequest", label: "Friend requests" },
  { value: "boop", label: "Boops" },
  { value: "other", label: "Other" },
];

const filterOf = (n: VrcNotification): Filter => (n.type in META ? (n.type as Filter) : "other");

function detail(n: VrcNotification, key: string): string | undefined {
  const d = typeof n.details === "string" ? safeParse(n.details) : n.details;
  const v = d?.[key];
  return typeof v === "string" ? v : undefined;
}

function safeParse(s: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}

export function Notifications() {
  const { notifications, setNotifications, dropNotification, markRead } = useLive();
  const openUser = useUi((s) => s.openUser);
  const [filter, setFilter] = useState<Filter>("all");
  const q = useQuery({ queryKey: ["notifications"], queryFn: ipc.notifications });
  useEffect(() => {
    if (q.data) setNotifications(q.data);
  }, [q.data, setNotifications]);
  useEffect(() => markRead(), [markRead, notifications.length]);

  const act = async (n: VrcNotification, accept: boolean) => {
    try {
      if (accept && n.type === "boop") {
        await ipc.boop(n.senderUserId);
        toast.success(`Booped ${n.senderUsername} back`);
        return;
      }
      if (!accept && n.v2) await ipc.deleteNotificationV2(n.id);
      else if (accept && n.type === "friendRequest") await ipc.acceptNotification(n.id);
      else if (accept && n.type === "invite") {
        const loc = detail(n, "worldId");
        if (loc) await ipc.launch(loc);
      } else if (accept && n.type === "requestInvite") await ipc.invite(n.senderUserId);
      else await ipc.hideNotification(n.id);
      dropNotification(n.id);
      if (accept) toast.success("Done");
    } catch (e) {
      toast.error(errorText(e));
    }
  };

  const counts = notifications.reduce<Record<string, number>>((m, n) => ((m[filterOf(n)] = (m[filterOf(n)] ?? 0) + 1), m), {});
  const shown = filter === "all" ? notifications : notifications.filter((n) => filterOf(n) === filter);

  return (
    <div className="max-w-3xl">
      <PageHeader title="Notifications" subtitle="Invites, friend requests and boops from VRChat." />
      {notifications.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {FILTERS.filter((f) => f.value === "all" || f.value !== "other" || counts.other).map((f) => (
            <Chip key={f.value} active={filter === f.value} onClick={() => setFilter(f.value)}>
              {f.label}
              <span className="tabular-nums text-subtle">{f.value === "all" ? notifications.length : (counts[f.value] ?? 0)}</span>
            </Chip>
          ))}
        </div>
      )}
      {q.isLoading ? (
        <Skeleton className="h-40 rounded-xl" />
      ) : shown.length ? (
        <Card className="overflow-hidden">
          {shown.map((n) => {
            const m = META[n.type] ?? { icon: <Bell className="size-4" />, text: () => n.message || n.type };
            return (
              <div key={n.id} className="flex items-center gap-3 border-b border-line/60 px-4 py-3 last:border-0">
                <div className="flex size-9 items-center justify-center rounded-xl bg-accent-soft text-accent">{m.icon}</div>
                <div className="min-w-0 flex-1 text-[13px]">
                  <button onClick={() => openUser(n.senderUserId)} className="font-semibold hover:text-accent cursor-pointer">
                    {n.senderUsername}
                  </button>{" "}
                  <span className="text-muted">{m.text(n)}</span>
                  {n.type === "boop" && detail(n, "imageUrl") && <Img src={detail(n, "imageUrl")} className="ml-1.5 inline-block size-5 bg-transparent object-contain align-middle" />}
                  <div className="text-xs text-subtle">{ago(n.created_at)}</div>
                </div>
                {["friendRequest", "invite", "requestInvite", "boop"].includes(n.type) && (
                  <Button
                    size="sm"
                    variant="primary"
                    icon={n.type === "boop" ? <Hand className="size-3.5" /> : <Check className="size-3.5" />}
                    onClick={() => act(n, true)}
                  >
                    {n.type === "friendRequest" ? "Accept" : n.type === "invite" ? "Join" : n.type === "boop" ? "Boop back" : "Send invite"}
                  </Button>
                )}
                <Button size="sm" variant="ghost" icon={<X className="size-3.5" />} onClick={() => act(n, false)}>
                  Dismiss
                </Button>
              </div>
            );
          })}
        </Card>
      ) : (
        <Card>
          {notifications.length ? (
            <Empty icon={<Bell />} title={`No ${FILTERS.find((f) => f.value === filter)!.label.toLowerCase()} right now`}>
              <Button size="sm" variant="ghost" onClick={() => setFilter("all")}>
                Show all
              </Button>
            </Empty>
          ) : (
            <Empty icon={<Bell />} title="You're all caught up" />
          )}
        </Card>
      )}
    </div>
  );
}
