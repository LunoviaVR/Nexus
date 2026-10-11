import * as Menu from "@radix-ui/react-dropdown-menu";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, Check, EyeOff, MessageSquareOff, MicOff, MoreHorizontal, UserMinus } from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/format";
import { errorText, ipc } from "@/lib/ipc";
import type { ModerationKind, PlayerModeration, VrcUser } from "@/lib/types";
import { Confirm, Spinner } from "./ui";

/** What each moderation is called, and what you see once it's on. */
export const MODERATIONS: Record<ModerationKind, { label: string; active: string; icon: ReactNode }> = {
  mute: { label: "Mute voice", active: "Voice muted", icon: <MicOff className="size-3.5" /> },
  muteChat: { label: "Mute chatbox", active: "Chatbox muted", icon: <MessageSquareOff className="size-3.5" /> },
  hideAvatar: { label: "Hide avatar", active: "Avatar hidden", icon: <EyeOff className="size-3.5" /> },
  block: { label: "Block", active: "Blocked", icon: <Ban className="size-3.5" /> },
};

/** Each moderation's opposite, which VRChat replaces when you set it ("show" vs "hide" an avatar). */
const OPPOSITE: Partial<Record<ModerationKind, string>> = { mute: "unmute", muteChat: "unmuteChat", hideAvatar: "showAvatar" };

/** Your own moderations of someone. One small background request per profile. */
export function useModerations(userId: string, enabled: boolean) {
  const q = useQuery({ queryKey: ["moderations", userId], queryFn: () => ipc.moderationsOf(userId), enabled, staleTime: 5 * 60_000, retry: false });
  const types = new Set((q.data ?? []).map((m) => m.type));
  return { q, has: (k: ModerationKind) => types.has(k) };
}

/**
 * Mute, hide, block and unfriend, from someone's profile. These change your VRChat account and
 * apply in-game; blocking and unfriending ask first.
 */
export function SafetyMenu({ user, isFriend }: { user: Pick<VrcUser, "id" | "displayName">; isFriend: boolean }) {
  const qc = useQueryClient();
  const { q, has } = useModerations(user.id, true);
  const [busy, setBusy] = useState<ModerationKind | "unfriend" | null>(null);
  const [confirm, setConfirm] = useState<"block" | "unfriend" | null>(null);
  const name = user.displayName;

  const set = async (kind: ModerationKind, on: boolean) => {
    setBusy(kind);
    try {
      const { vrchatRunning } = await ipc.setModeration(user.id, kind, on);
      qc.setQueryData<PlayerModeration[]>(["moderations", user.id], (prev = []) => {
        const rest = prev.filter((m) => m.type !== kind && m.type !== OPPOSITE[kind]);
        return on ? [...rest, { id: `local_${kind}`, type: kind, targetUserId: user.id }] : rest;
      });
      // Read it back, so the badges show what VRChat actually kept.
      void qc.invalidateQueries({ queryKey: ["moderations", user.id] });
      const done: Record<ModerationKind, [string, string]> = {
        mute: [`Muted ${name}'s voice`, `Unmuted ${name}`],
        muteChat: [`Muted ${name}'s chatbox`, `${name}'s chatbox is back`],
        hideAvatar: [`Hid ${name}'s avatar`, `${name}'s avatar follows your safety settings again`],
        block: [`Blocked ${name}`, `Unblocked ${name}`],
      };
      toast.success(done[kind][on ? 0 : 1], {
        description: vrchatRunning ? "VRChat applies this when it starts, so restart VRChat to see it in-game." : undefined,
        duration: vrchatRunning ? 8000 : undefined,
      });
      setConfirm(null);
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  const unfriend = async () => {
    setBusy("unfriend");
    try {
      await ipc.unfriend(user.id);
      toast.success(`Unfriended ${name}`);
      setConfirm(null);
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  const blocked = has("block");
  const item =
    "flex h-8 cursor-pointer select-none items-center gap-2.5 rounded-lg px-2 text-[13px] outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-hover";

  return (
    <>
      {/* Not modal, so the confirm dialogs opened from it get focus normally. */}
      <Menu.Root modal={false}>
        <Menu.Trigger asChild>
          <button
            className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-line bg-panel-2 px-3.5 text-[13px] font-medium text-fg transition-colors hover:bg-hover cursor-pointer data-[state=open]:bg-hover"
            aria-label={`More options for ${name}`}
          >
            <MoreHorizontal className="size-4" />
            More
          </button>
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Content align="start" sideOffset={6} className="z-[60] w-60 rounded-xl border border-line bg-panel p-1 shadow-pop outline-none">
            <Menu.Label className="px-2 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wider text-subtle">In VRChat</Menu.Label>
            {(["mute", "muteChat", "hideAvatar"] as const).map((kind) => {
              const on = has(kind);
              return (
                <Menu.CheckboxItem
                  key={kind}
                  checked={on}
                  disabled={busy !== null || q.isLoading}
                  // Stay open so the tick visibly flips.
                  onSelect={(e) => e.preventDefault()}
                  onCheckedChange={(v) => set(kind, v)}
                  className={item}
                >
                  <span className="text-muted">{MODERATIONS[kind].icon}</span>
                  <span className="flex-1">{MODERATIONS[kind].label}</span>
                  {busy === kind ? (
                    <Spinner className="size-3.5 text-muted" />
                  ) : (
                    <span className={cn("flex size-4 items-center justify-center rounded border", on ? "border-accent bg-accent text-accent-fg" : "border-line")}>
                      {on && <Check className="size-3" />}
                    </span>
                  )}
                </Menu.CheckboxItem>
              );
            })}
            <Menu.Separator className="my-1 h-px bg-line" />
            <Menu.Item
              disabled={busy !== null || q.isLoading}
              onSelect={() => (blocked ? set("block", false) : setConfirm("block"))}
              className={cn(item, !blocked && "text-red-400")}
            >
              <Ban className="size-3.5" />
              <span className="flex-1">{blocked ? "Unblock" : "Block"}</span>
              {busy === "block" && <Spinner className="size-3.5" />}
            </Menu.Item>
            {isFriend && (
              <Menu.Item disabled={busy !== null} onSelect={() => setConfirm("unfriend")} className={cn(item, "text-red-400")}>
                <UserMinus className="size-3.5" />
                <span className="flex-1">Unfriend</span>
              </Menu.Item>
            )}
            {q.error && <p className="px-2 py-1.5 text-[11px] text-subtle">Couldn't check what you've already set: {errorText(q.error)}</p>}
            <p className="border-t border-line/70 px-2 pb-1 pt-2 text-[11px] leading-snug text-subtle">
              VRChat loads these when it starts. If it's open, restart it to see changes in-game.
            </p>
          </Menu.Content>
        </Menu.Portal>
      </Menu.Root>

      {confirm === "block" && (
        <Confirm
          open
          danger
          title={`Block ${name}?`}
          body={
            <>
              You won't see or hear each other in VRChat, and they can't contact you.
              {isFriend && " This also removes them from your friends."} You can unblock them later from here.
            </>
          }
          confirmLabel="Block"
          onClose={() => setConfirm(null)}
          onConfirm={() => set("block", true)}
        />
      )}
      {confirm === "unfriend" && (
        <Confirm
          open
          danger
          title={`Unfriend ${name}?`}
          body={`${name} is removed from your friends list. To be friends again, one of you has to send a new friend request.`}
          confirmLabel="Unfriend"
          onClose={() => setConfirm(null)}
          onConfirm={unfriend}
        />
      )}
    </>
  );
}
