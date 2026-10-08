import { useQueryClient } from "@tanstack/react-query";
import { LogIn, LogOut, UserPlus, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { errorText, ipc } from "@/lib/ipc";
import type { VrcGroupDetail } from "@/lib/types";
import { useAuth } from "@/stores/auth";
import { Button, Confirm } from "./ui";

type Action = "join" | "leave" | "cancel";

/**
 * Join / request / leave / cancel-request for a group, always behind a confirmation since these
 * change your VRChat account. VRChat decides what "join" means from the group's settings.
 */
export function MembershipButton({
  group,
  size = "sm",
  onChanged,
}: {
  group: Pick<VrcGroupDetail, "id" | "name" | "membershipStatus" | "joinState">;
  size?: "sm" | "md";
  onChanged?: (status: string) => void;
}) {
  const qc = useQueryClient();
  const meId = useAuth((s) => s.user?.id);
  const [confirm, setConfirm] = useState<Action | null>(null);
  const [status, setStatus] = useState(group.membershipStatus ?? "");

  const invalidate = () =>
    Promise.all(
      [["group", group.id], ["groups", meId], ["my-group-instances"], ["group-search"], ["profile", meId]].map((queryKey) =>
        qc.invalidateQueries({ queryKey }),
      ),
    );

  const run = async (action: Action) => {
    try {
      if (action === "join") {
        const res = await ipc.joinGroup(group.id);
        const next = res?.membershipStatus ?? "member";
        setStatus(next);
        onChanged?.(next);
        toast.success(next === "requested" ? `Request sent to ${group.name}` : `Joined ${group.name}`);
      } else if (action === "leave") {
        await ipc.leaveGroup(group.id);
        setStatus("inactive");
        onChanged?.("inactive");
        toast.success(`Left ${group.name}`);
      } else {
        await ipc.cancelGroupRequest(group.id);
        setStatus("inactive");
        onChanged?.("inactive");
        toast.success("Join request cancelled");
      }
      setConfirm(null);
      await invalidate();
    } catch (e) {
      toast.error(errorText(e));
    }
  };

  const joinState = group.joinState;
  let button;
  if (status === "member") {
    button = (
      <Button size={size} variant="ghost" icon={<LogOut className="size-3.5" />} onClick={() => setConfirm("leave")}>
        Leave
      </Button>
    );
  } else if (status === "requested") {
    button = (
      <Button size={size} icon={<X className="size-3.5" />} onClick={() => setConfirm("cancel")}>
        Cancel request
      </Button>
    );
  } else if (status !== "invited" && (joinState === "invite" || joinState === "closed")) {
    button = (
      <Button size={size} disabled>
        {joinState === "closed" ? "Closed" : "Invite only"}
      </Button>
    );
  } else {
    const label = status === "invited" ? "Accept invite" : joinState === "request" ? "Request to join" : "Join";
    button = (
      <Button
        size={size}
        variant="primary"
        icon={joinState === "request" ? <UserPlus className="size-3.5" /> : <LogIn className="size-3.5" />}
        onClick={() => setConfirm("join")}
      >
        {label}
      </Button>
    );
  }

  const texts: Record<Action, { title: string; body: string; label: string; danger?: boolean }> = {
    join: {
      title: joinState === "request" ? `Request to join ${group.name}?` : `Join ${group.name}?`,
      body:
        joinState === "request"
          ? "The group's moderators will review your request."
          : "You'll become a member right away if the group is open to everyone; otherwise VRChat sends a join request.",
      label: joinState === "request" ? "Send request" : "Join",
    },
    leave: {
      title: `Leave ${group.name}?`,
      body: "You'll lose your roles in this group, and rejoining may need approval or an invite.",
      label: "Leave group",
      danger: true,
    },
    cancel: { title: "Cancel your join request?", body: `Your request to join ${group.name} will be withdrawn.`, label: "Cancel request" },
  };

  return (
    <>
      {button}
      {confirm && (
        <Confirm
          open
          danger={texts[confirm].danger}
          title={texts[confirm].title}
          body={texts[confirm].body}
          confirmLabel={texts[confirm].label}
          onClose={() => setConfirm(null)}
          onConfirm={() => run(confirm)}
        />
      )}
    </>
  );
}
