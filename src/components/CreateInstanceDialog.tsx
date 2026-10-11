import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Crown, Plus, Users } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/format";
import { errorText, ipc } from "@/lib/ipc";
import { createdLocation } from "@/lib/location";
import type { GroupInstanceRequest, VrcGroupDetail, World } from "@/lib/types";
import { useAuth } from "@/stores/auth";
import { useUi, type InstancePrefs } from "@/stores/ui";
import { Field, Frame, GROUP_ACCESS, groupPerms, REGIONS, regionNear, RoleChips, SwitchRow } from "./GroupManage";
import { actions } from "./people";
import { Button, Dialog, Img, Segmented, Skeleton } from "./ui";

const TYPES: { value: InstancePrefs["type"]; label: string; hint: string }[] = [
  { value: "public", label: "Public", hint: "Anyone can join." },
  { value: "friends+", label: "Friends+", hint: "Your friends, and friends of anyone inside." },
  { value: "friends", label: "Friends", hint: "Only your friends can join." },
  { value: "invite+", label: "Invite+", hint: "Invite only, and anyone inside can invite others." },
  { value: "invite", label: "Invite", hint: "Only people you invite can join." },
  { value: "group", label: "Group", hint: "Owned by one of your groups, with the group's access rules." },
];

/** Open a new instance of a world: a public one, one of your own, or one owned by your group. */
export function CreateInstanceDialog({
  world,
  open,
  onClose,
  onCreated,
}: {
  world: World;
  open: boolean;
  onClose: () => void;
  onCreated: (location: string) => void;
}) {
  return (
    <Dialog open={open} onClose={onClose} title="New instance" className="w-[min(640px,calc(100vw-32px))]">
      {open && <CreateInstance world={world} onDone={onClose} onCreated={onCreated} />}
    </Dialog>
  );
}

function CreateInstance({ world, onDone, onCreated }: { world: World; onDone: () => void; onCreated: (location: string) => void }) {
  const qc = useQueryClient();
  const me = useAuth((s) => s.user);
  const prefs = useUi((s) => s.instancePrefs);
  const setPrefs = useUi((s) => s.setInstancePrefs);
  const [type, setType] = useState(prefs.type);
  const [region, setRegion] = useState(() => regionNear(me?.$location));
  const [groupId, setGroupId] = useState(prefs.groupId);
  const [access, setAccess] = useState<GroupInstanceRequest["access"] | null>(null);
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [queue, setQueue] = useState(true);
  const [ageGate, setAgeGate] = useState(false);
  const [busy, setBusy] = useState(false);

  const groups = useInstanceGroups(type === "group");
  const group = groups.usable.find((g) => g.id === groupId) ?? (groups.usable.length === 1 ? groups.usable[0] : undefined);
  const perms = group && groupPerms(group, me?.id);
  const allowed = perms ? GROUP_ACCESS.filter((a) => perms.can(a.perm)) : [];
  const groupAccess = allowed.find((a) => a.value === access)?.value ?? allowed[0]?.value;
  const canRestrict = !!perms?.can("group-instance-restricted-create") && !!group?.roles?.length;
  const canAgeGate = !!perms?.can("group-instance-age-gated-create");

  const pickGroup = (g: VrcGroupDetail) => {
    setGroupId(g.id);
    setAccess(null);
    setRoleIds([]);
  };

  const create = async () => {
    setBusy(true);
    try {
      let res;
      if (type === "group") {
        if (!group || !groupAccess) return;
        res = await ipc.createGroupInstance(group.id, {
          worldId: world.id,
          access: groupAccess,
          region,
          roleIds: groupAccess === "members" && canRestrict ? roleIds : [],
          queue,
          ageGate: canAgeGate && ageGate,
        });
        await Promise.all([qc.invalidateQueries({ queryKey: ["group-instances", group.id] }), qc.invalidateQueries({ queryKey: ["my-group-instances"] })]);
      } else {
        res = await ipc.createInstance(world.id, type, region);
      }
      setPrefs({ type, groupId: group?.id ?? prefs.groupId });
      const location = createdLocation(res);
      toast.success(`Opened ${world.name}`, location ? { action: { label: "Join", onClick: () => actions.join(location) } } : undefined);
      if (location) onCreated(location);
      onDone();
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Frame
      title="New instance"
      subtitle={`Opens a new instance of ${world.name}.`}
      footer={
        <>
          <Button variant="ghost" onClick={onDone}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} disabled={type === "group" && !groupAccess} onClick={create} icon={<Plus className="size-4" />}>
            Create instance
          </Button>
        </>
      }
    >
      <Field label="Type" hint={TYPES.find((t) => t.value === type)?.hint}>
        <Segmented value={type} onChange={setType} options={TYPES.map(({ value, label }) => ({ value, label }))} />
      </Field>
      {type === "group" && (
        <>
          <Field label="Group">
            <GroupPicker groups={groups} value={group} onChange={pickGroup} />
          </Field>
          {group && groupAccess && (
            <>
              <Field label="Access" hint={GROUP_ACCESS.find((a) => a.value === groupAccess)?.hint}>
                <Segmented value={groupAccess} onChange={setAccess} options={allowed.map(({ value, label }) => ({ value, label }))} />
              </Field>
              {groupAccess === "members" && canRestrict && (
                <Field label="Only these roles" hint={roleIds.length ? "Members without one of these roles can't join." : "Leave empty for every member."}>
                  <RoleChips roles={group.roles ?? []} value={roleIds} onChange={setRoleIds} />
                </Field>
              )}
            </>
          )}
        </>
      )}
      <Field label="Region">
        <Segmented value={region} onChange={setRegion} options={REGIONS} />
      </Field>
      {type === "group" && group && (
        <div className="divide-y divide-line/60">
          <SwitchRow label="Queue" hint="When it's full, people wait in line instead of being turned away." checked={queue} onChange={setQueue} />
          {canAgeGate && <SwitchRow label="18+ only" hint="Only age-verified adults can join." checked={ageGate} onChange={setAgeGate} />}
        </div>
      )}
    </Frame>
  );
}

/**
 * Your groups whose role lets you open instances, owned ones first. The group list carries no
 * permissions, so each group's details load in the background lane once you choose "Group".
 */
function useInstanceGroups(enabled: boolean) {
  const meId = useAuth((s) => s.user?.id);
  const list = useQuery({ queryKey: ["groups", meId], queryFn: () => ipc.userGroups(meId!), enabled: enabled && !!meId, staleTime: 10 * 60_000 });
  const ids = (list.data ?? []).map((g) => g.groupId ?? g.id ?? "").filter(Boolean);
  const details = useQueries({
    queries: ids.map((id) => ({ queryKey: ["group", id], queryFn: () => ipc.group(id, true), staleTime: 10 * 60_000, enabled })),
  });
  const usable = details
    .flatMap((d) => (d.data && groupPerms(d.data, meId).createInstance ? [d.data] : []))
    .sort((a, b) => Number(b.ownerId === meId) - Number(a.ownerId === meId) || a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  return {
    usable,
    error: list.error,
    loading: list.isLoading || details.some((d) => d.isLoading),
    checked: details.filter((d) => !d.isLoading).length,
    total: ids.length,
  };
}

function GroupPicker({
  groups,
  value,
  onChange,
}: {
  groups: ReturnType<typeof useInstanceGroups>;
  value?: VrcGroupDetail;
  onChange: (g: VrcGroupDetail) => void;
}) {
  const meId = useAuth((s) => s.user?.id);
  if (groups.error) return <p className="text-[13px] text-subtle">{errorText(groups.error)}</p>;
  if (!groups.usable.length) {
    return groups.loading ? (
      <div className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(180px,1fr))]">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-[50px] rounded-lg" />
        ))}
      </div>
    ) : (
      <p className="text-[13px] text-subtle">None of your groups let you open instances.</p>
    );
  }
  return (
    <div className="space-y-2">
      <div className="grid max-h-56 gap-2 overflow-y-auto [grid-template-columns:repeat(auto-fill,minmax(180px,1fr))]">
        {groups.usable.map((g) => {
          const on = value?.id === g.id;
          return (
            <button
              key={g.id}
              onClick={() => onChange(g)}
              aria-pressed={on}
              className={cn(
                "flex items-center gap-2.5 rounded-lg border p-2 text-left transition-colors cursor-pointer",
                on ? "border-accent bg-accent-soft/40 ring-2 ring-accent/40" : "border-line hover:border-accent/40",
              )}
            >
              <Img src={g.iconUrl} className="size-8 shrink-0 rounded-lg" fallback={<Users className="size-4 text-subtle" />} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium">{g.name}</div>
                <div className="flex items-center gap-1 text-xs text-subtle">
                  {g.ownerId === meId ? (
                    <>
                      <Crown className="size-3 text-amber-400" /> Owner
                    </>
                  ) : (
                    `${(g.memberCount ?? 0).toLocaleString()} members`
                  )}
                </div>
              </div>
              {on && <Check className="size-4 shrink-0 text-accent" />}
            </button>
          );
        })}
      </div>
      {groups.loading && (
        <p className="text-xs text-subtle">
          Checking your groups… {groups.checked}/{groups.total}
        </p>
      )}
    </div>
  );
}
