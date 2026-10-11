import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, Check, Crown, ExternalLink, Globe, ImagePlus, Megaphone, Pencil, Plus, Power, Search, ShieldCheck, Trash2, UserMinus, UserPlus, Users, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { ago, cn } from "@/lib/format";
import { fileUrls, toPngBase64 } from "@/lib/image";
import { errorText, ipc } from "@/lib/ipc";
import { parseLocation } from "@/lib/location";
import { useWorld } from "@/lib/queries";
import type { GroupInstanceRequest, GroupPatch, VrcFile, VrcGroupDetail, VrcGroupMember, VrcGroupRole, World } from "@/lib/types";
import { useAuth } from "@/stores/auth";
import { actions, UserAvatar } from "./people";
import { Button, Chip, Confirm, Dialog, Empty, IconButton, Img, Input, Segmented, Skeleton, Switch, Tip } from "./ui";
import { LANGUAGES } from "./UserDialog";

// VRChat's own limits (UpdateGroupRequest).
const NAME_MIN = 3;
const NAME_MAX = 64;
const DESCRIPTION_MAX = 250;
const LINKS_MAX = 3;
const LANGUAGES_MAX = 3;

/**
 * What your role in a group lets you do. The owner (a "*" role) can do everything; VRChat still
 * checks each request, so this only decides which tools are shown.
 */
export function useGroupPerms(g: VrcGroupDetail) {
  const meId = useAuth((s) => s.user?.id);
  const isOwner = !!meId && g.ownerId === meId;
  const mine = g.myMember?.permissions ?? [];
  const can = (p: string) => isOwner || mine.includes("*") || mine.includes(p);
  const perms = {
    isOwner,
    can,
    editGroup: can("group-data-manage"),
    posts: can("group-announcement-manage"),
    createInstance: ["group-instance-open-create", "group-instance-plus-create", "group-instance-public-create"].some(can),
    closeInstance: can("group-instance-manage"),
    assignRoles: can("group-roles-assign"),
    kick: can("group-members-remove"),
    ban: can("group-bans-manage"),
    requests: can("group-invites-manage"),
  };
  return {
    ...perms,
    members: perms.assignRoles || perms.kick || perms.ban,
    any: perms.editGroup || perms.posts || perms.createInstance || perms.closeInstance || perms.assignRoles || perms.kick || perms.ban || perms.requests,
  };
}

export type GroupPerms = ReturnType<typeof useGroupPerms>;

/** Pending join requests, for people who can let others in. */
export function useJoinRequests(groupId: string, enabled: boolean) {
  return useQuery({ queryKey: ["group-requests", groupId], queryFn: () => ipc.groupRequests(groupId), enabled, staleTime: 60_000, retry: false });
}

/** All role ids a member holds; management roles come separately as `mRoleIds`. */
export function memberRoleIds(m?: Pick<VrcGroupMember, "roleIds" | "mRoleIds"> | null): string[] {
  return [...new Set([...(m?.roleIds ?? []), ...(m?.mRoleIds ?? [])])];
}

// ---------------------------------------------------------------------------------------------
// Building blocks

/** Header, scrolling body and an action bar, sized for a dialog. */
function Frame({ title, subtitle, children, footer }: { title: string; subtitle?: ReactNode; children: ReactNode; footer: ReactNode }) {
  return (
    <div className="flex max-h-[88vh] flex-col">
      <div className="border-b border-line px-6 py-4 pr-14">
        <h2 className="text-lg font-bold">{title}</h2>
        {subtitle && <p className="text-[13px] text-muted">{subtitle}</p>}
      </div>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-6">{children}</div>
      <div className="flex items-center justify-end gap-2 border-t border-line px-6 py-3">{footer}</div>
    </div>
  );
}

function Field({ label, hint, count, children }: { label: string; hint?: ReactNode; count?: [number, number]; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <span className="text-xs font-semibold text-muted">{label}</span>
        {count && <span className={cn("text-[11px] tabular-nums text-subtle", count[0] > count[1] - 20 && "text-st-ask")}>{count[0]}/{count[1]}</span>}
      </div>
      {children}
      {hint && <p className="mt-1.5 text-xs text-subtle">{hint}</p>}
    </div>
  );
}

const TEXTAREA =
  "w-full resize-y rounded-lg border border-line bg-panel-2 px-3 py-2 text-[13px] leading-relaxed outline-none placeholder:text-subtle focus:border-accent focus:ring-2 focus:ring-accent-soft";

function SwitchRow({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1.5">
      <div>
        <div className="text-[13px] font-medium">{label}</div>
        {hint && <div className="text-xs text-subtle">{hint}</div>}
      </div>
      <Switch checked={checked} onChange={onChange} label={label} />
    </div>
  );
}

function RoleChips({ roles, value, onChange }: { roles: { id: string; name: string; order?: number }[]; value: string[]; onChange: (ids: string[]) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {[...roles]
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
        .map((r) => {
          const on = value.includes(r.id);
          return (
            <Chip key={r.id} active={on} onClick={() => onChange(on ? value.filter((x) => x !== r.id) : [...value, r.id])}>
              {on && <Check className="size-3" />}
              {r.name}
            </Chip>
          );
        })}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Icon & banner: picked from your own VRC+ icons and gallery, like on vrchat.com

const fileIdOf = (url?: string | null) => url?.match(/file_[0-9a-f-]+/)?.[0];

const GROUP_IMAGES = {
  icon: { tag: "icon", noun: "icon", square: true, max: 1024, hint: "One of your VRC+ icons. Uploads are cropped to a square." },
  banner: {
    tag: "gallery",
    noun: "banner",
    square: false,
    max: 2048,
    hint: "One of your VRC+ gallery images. VRChat crops it differently in-game, on the website and on nameplates, so keep the important part in the middle.",
  },
} as const;

function GroupImagePicker({
  kind,
  currentUrl,
  value,
  onChange,
}: {
  kind: keyof typeof GROUP_IMAGES;
  /** What the group shows now. */
  currentUrl?: string | null;
  /** The chosen file id. */
  value?: string;
  onChange: (fileId: string) => void;
}) {
  const info = GROUP_IMAGES[kind];
  const qc = useQueryClient();
  const files = useQuery({ queryKey: ["files", info.tag], queryFn: () => ipc.files(info.tag), staleTime: 5 * 60_000 });
  const [uploading, setUploading] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const list = [...(files.data ?? [])].reverse();
  const currentId = fileIdOf(currentUrl);
  // The group's picture may have been set by someone else, so it isn't always in your library.
  const foreignCurrent = currentUrl && currentId && !list.some((f) => f.id === currentId);
  const shape = kind === "icon" ? "aspect-square rounded-xl" : "aspect-video rounded-lg";

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const res = (await ipc.uploadImage(info.tag, await toPngBase64(file, { square: info.square, max: info.max }))) as VrcFile | null;
      await qc.invalidateQueries({ queryKey: ["files", info.tag] });
      if (kind === "icon") void qc.invalidateQueries({ queryKey: ["icons"] });
      if (res?.id) onChange(res.id);
      toast.success(`Uploaded — save to use it as the ${info.noun}`);
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setUploading(false);
    }
  };

  const tile = (active: boolean) =>
    cn(
      "relative overflow-hidden border transition-colors cursor-pointer",
      shape,
      active ? "border-accent ring-2 ring-accent/50" : "border-line hover:border-accent/40",
    );
  const check = (
    <span className="absolute right-1.5 top-1.5 flex size-5 items-center justify-center rounded-full bg-accent text-accent-fg">
      <Check className="size-3" />
    </span>
  );

  return (
    <div>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void upload(f);
        }}
      />
      <div
        className={cn(
          "grid max-h-60 gap-2 overflow-y-auto p-0.5",
          kind === "icon" ? "[grid-template-columns:repeat(auto-fill,minmax(76px,1fr))]" : "[grid-template-columns:repeat(auto-fill,minmax(150px,1fr))]",
        )}
      >
        <button
          onClick={() => input.current?.click()}
          disabled={uploading}
          className={cn(
            "flex flex-col items-center justify-center gap-1 border border-dashed border-line text-xs text-muted transition-colors hover:border-accent/50 hover:text-fg cursor-pointer disabled:opacity-60",
            shape,
          )}
        >
          {uploading ? <span className="inline-block size-4 animate-spin rounded-full border-2 border-current border-t-transparent" /> : <ImagePlus className="size-4" />}
          Upload
        </button>
        {foreignCurrent && (
          <button onClick={() => onChange(currentId)} className={tile(value === currentId || !value)} title="Current">
            <Img src={currentUrl} className="size-full" />
            {(value === currentId || !value) && check}
          </button>
        )}
        {files.isLoading
          ? Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className={shape} />)
          : list.map((f) => {
              const active = (value ?? currentId) === f.id;
              return (
                <button key={f.id} onClick={() => onChange(f.id)} className={tile(active)}>
                  <Img src={fileUrls(f).thumb} className="size-full" />
                  {active && check}
                </button>
              );
            })}
      </div>
      {files.error && <p className="mt-1.5 text-xs text-subtle">{errorText(files.error)}</p>}
      <p className="mt-1.5 text-xs text-subtle">{info.hint} Needs VRC+.</p>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Edit group

export function EditGroupDialog({ g, open, onClose }: { g: VrcGroupDetail; open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} title="Edit group" className="w-[min(720px,calc(100vw-32px))]">
      {open && <EditGroup g={g} onDone={onClose} />}
    </Dialog>
  );
}

const JOIN_STATES: { value: NonNullable<GroupPatch["joinState"]>; label: string; hint: string }[] = [
  { value: "open", label: "Open", hint: "Anyone can join right away." },
  { value: "request", label: "Request", hint: "People ask to join and a moderator approves them." },
  { value: "invite", label: "Invite only", hint: "Only people you invite can join." },
  { value: "closed", label: "Closed", hint: "Nobody new can join." },
];

function EditGroup({ g, onDone }: { g: VrcGroupDetail; onDone: () => void }) {
  const qc = useQueryClient();
  const meId = useAuth((s) => s.user?.id);
  const [name, setName] = useState(g.name);
  const [description, setDescription] = useState(g.description ?? "");
  const [rules, setRules] = useState(g.rules ?? "");
  const [links, setLinks] = useState<string[]>(g.links ?? []);
  const [languages, setLanguages] = useState<string[]>(g.languages ?? []);
  const initialJoin = JOIN_STATES.find((j) => j.value === g.joinState)?.value ?? "open";
  const [joinState, setJoinState] = useState<NonNullable<GroupPatch["joinState"]>>(initialJoin);
  const [iconId, setIconId] = useState<string>();
  const [bannerId, setBannerId] = useState<string>();
  const [saving, setSaving] = useState(false);

  const nameOk = name.trim().length >= NAME_MIN && name.trim().length <= NAME_MAX;

  const save = async () => {
    const cleanLinks = links.map((l) => l.trim()).filter(Boolean);
    const patch: GroupPatch = {};
    if (name.trim() !== g.name) patch.name = name.trim();
    if (description !== (g.description ?? "")) patch.description = description;
    if (rules !== (g.rules ?? "")) patch.rules = rules;
    if (JSON.stringify(cleanLinks) !== JSON.stringify(g.links ?? [])) patch.links = cleanLinks;
    if (JSON.stringify(languages) !== JSON.stringify(g.languages ?? [])) patch.languages = languages;
    if (joinState !== initialJoin) patch.joinState = joinState;
    if (iconId && iconId !== (g.iconId ?? fileIdOf(g.iconUrl))) patch.iconId = iconId;
    if (bannerId && bannerId !== (g.bannerId ?? fileIdOf(g.bannerUrl))) patch.bannerId = bannerId;
    if (!Object.keys(patch).length) {
      toast("Nothing to save");
      onDone();
      return;
    }
    setSaving(true);
    try {
      await ipc.updateGroup(g.id, patch);
      await Promise.all(
        [["group", g.id], ["groups", meId], ["group-search"], ["profile", meId]].map((queryKey) => qc.invalidateQueries({ queryKey })),
      );
      toast.success("Group updated");
      onDone();
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Frame
      title={`Edit ${g.name}`}
      subtitle="Changes are saved to VRChat and show up for everyone."
      footer={
        <>
          <Button
            variant="ghost"
            className="mr-auto"
            icon={<ExternalLink className="size-3.5" />}
            onClick={() => ipc.openExternal(`https://vrchat.com/home/group/${g.id}`)}
          >
            More on vrchat.com
          </Button>
          <Button variant="ghost" onClick={onDone}>
            Cancel
          </Button>
          <Button variant="primary" loading={saving} disabled={!nameOk} onClick={save} icon={<Check className="size-4" />}>
            Save changes
          </Button>
        </>
      }
    >
      <Field label="Icon">
        <GroupImagePicker kind="icon" currentUrl={g.iconUrl} value={iconId} onChange={setIconId} />
      </Field>
      <Field label="Banner">
        <GroupImagePicker kind="banner" currentUrl={g.bannerUrl} value={bannerId} onChange={setBannerId} />
      </Field>
      <Field label="Name" hint={!nameOk ? `Between ${NAME_MIN} and ${NAME_MAX} characters.` : undefined} count={[name.length, NAME_MAX]}>
        <Input value={name} maxLength={NAME_MAX} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Description" count={[description.length, DESCRIPTION_MAX]}>
        <textarea value={description} maxLength={DESCRIPTION_MAX} onChange={(e) => setDescription(e.target.value)} rows={4} className={TEXTAREA} />
      </Field>
      <Field label="Rules">
        <textarea value={rules} onChange={(e) => setRules(e.target.value)} rows={7} className={TEXTAREA} placeholder="One rule per line" />
      </Field>
      <Field label="Who can join" hint={JOIN_STATES.find((j) => j.value === joinState)?.hint}>
        <Segmented value={joinState} onChange={setJoinState} options={JOIN_STATES.map(({ value, label }) => ({ value, label }))} />
      </Field>
      <Field label={`Links · up to ${LINKS_MAX}`}>
        <div className="space-y-2">
          {links.map((l, i) => (
            <div key={i} className="flex gap-2">
              <Input value={l} onChange={(e) => setLinks(links.map((x, j) => (j === i ? e.target.value : x)))} placeholder="https://" className="flex-1" />
              <Button variant="ghost" aria-label="Remove link" icon={<Trash2 className="size-3.5" />} onClick={() => setLinks(links.filter((_, j) => j !== i))} />
            </div>
          ))}
          {links.length < LINKS_MAX && (
            <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => setLinks([...links, ""])}>
              Add link
            </Button>
          )}
        </div>
      </Field>
      <Field label={`Languages · up to ${LANGUAGES_MAX}`}>
        <div className="flex flex-wrap items-center gap-1.5">
          {languages.map((l) => (
            <span key={l} className="inline-flex h-7 items-center gap-1 rounded-full bg-accent-soft px-2.5 text-xs font-medium">
              {LANGUAGES[l] ?? l.toUpperCase()}
              <button aria-label={`Remove ${LANGUAGES[l] ?? l}`} onClick={() => setLanguages(languages.filter((x) => x !== l))} className="text-muted hover:text-fg cursor-pointer">
                <X className="size-3" />
              </button>
            </span>
          ))}
          {languages.length < LANGUAGES_MAX && (
            <select
              value=""
              onChange={(e) => e.target.value && setLanguages([...languages, e.target.value])}
              className="h-7 rounded-full border border-line bg-panel-2 px-2 text-xs text-muted outline-none focus:border-accent"
            >
              <option value="">+ Add language</option>
              {Object.entries(LANGUAGES)
                .filter(([code]) => !languages.includes(code))
                .sort((a, b) => a[1].localeCompare(b[1]))
                .map(([code, label]) => (
                  <option key={code} value={code}>
                    {label}
                  </option>
                ))}
            </select>
          )}
        </div>
      </Field>
    </Frame>
  );
}

// ---------------------------------------------------------------------------------------------
// Posts

export function NewPostDialog({ g, open, onClose }: { g: VrcGroupDetail; open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} title="New post" className="w-[min(620px,calc(100vw-32px))]">
      {open && <NewPost g={g} onDone={onClose} />}
    </Dialog>
  );
}

function NewPost({ g, onDone }: { g: VrcGroupDetail; onDone: () => void }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [visibility, setVisibility] = useState<"group" | "public">("group");
  const [notify, setNotify] = useState(true);
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const roles = g.roles ?? [];

  const post = async () => {
    setBusy(true);
    try {
      await ipc.createGroupPost(g.id, {
        title: title.trim(),
        text: text.trim(),
        visibility,
        sendNotification: notify,
        roleIds: visibility === "group" ? roleIds : [],
      });
      await qc.invalidateQueries({ queryKey: ["group-posts", g.id] });
      toast.success("Post published");
      onDone();
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Frame
      title="New post"
      subtitle={`Posts show on ${g.name}'s page and in-game.`}
      footer={
        <>
          <Button variant="ghost" onClick={onDone}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} disabled={!title.trim() || !text.trim()} onClick={post} icon={<Megaphone className="size-4" />}>
            Publish
          </Button>
        </>
      }
    >
      <Field label="Title">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Movie night Friday!" data-autofocus />
      </Field>
      <Field label="Text">
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={6} className={TEXTAREA} />
      </Field>
      <Field label="Who can see it" hint={visibility === "public" ? "Anyone who opens the group, members or not." : "Only members of the group."}>
        <Segmented
          value={visibility}
          onChange={setVisibility}
          options={[
            { value: "group", label: "Members" },
            { value: "public", label: "Everyone" },
          ]}
        />
      </Field>
      {visibility === "group" && roles.length > 0 && (
        <Field label="Only these roles" hint={roleIds.length ? "Members without one of these roles won't see it." : "Leave empty for every member."}>
          <RoleChips roles={roles} value={roleIds} onChange={setRoleIds} />
        </Field>
      )}
      <SwitchRow label="Notify members" hint="Sends a notification to members who follow the group's announcements." checked={notify} onChange={setNotify} />
    </Frame>
  );
}

export function DeletePostButton({ groupId, postId, title }: { groupId: string; postId: string; title?: string }) {
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  return (
    <>
      <IconButton label="Delete post" onClick={() => setConfirm(true)} className="hover:text-red-400">
        <Trash2 className="size-4" />
      </IconButton>
      {confirm && (
        <Confirm
          open
          danger
          title="Delete this post?"
          body={<>“{title || "Untitled"}” is removed for everyone. This can't be undone.</>}
          confirmLabel="Delete post"
          onClose={() => setConfirm(false)}
          onConfirm={async () => {
            try {
              await ipc.deleteGroupPost(groupId, postId);
              await qc.invalidateQueries({ queryKey: ["group-posts", groupId] });
              toast.success("Post deleted");
              setConfirm(false);
            } catch (e) {
              toast.error(errorText(e));
            }
          }}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Instances

const ACCESS: { value: GroupInstanceRequest["access"]; label: string; hint: string; perm: string }[] = [
  { value: "members", label: "Members only", hint: "Only group members can join.", perm: "group-instance-open-create" },
  { value: "plus", label: "Group+", hint: "Members, plus friends of anyone inside.", perm: "group-instance-plus-create" },
  { value: "public", label: "Group Public", hint: "Anyone can join; it's listed on the group.", perm: "group-instance-public-create" },
];

const REGIONS: { value: GroupInstanceRequest["region"]; label: string }[] = [
  { value: "us", label: "US West" },
  { value: "use", label: "US East" },
  { value: "eu", label: "Europe" },
  { value: "jp", label: "Japan" },
];

export function NewInstanceDialog({ g, perms, open, onClose }: { g: VrcGroupDetail; perms: GroupPerms; open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} title="New group instance" className="w-[min(760px,calc(100vw-32px))]">
      {open && <NewInstance g={g} perms={perms} onDone={onClose} />}
    </Dialog>
  );
}

function NewInstance({ g, perms, onDone }: { g: VrcGroupDetail; perms: GroupPerms; onDone: () => void }) {
  const qc = useQueryClient();
  const myLocation = useAuth((s) => s.user?.$location);
  const allowed = ACCESS.filter((a) => perms.can(a.perm));
  const [world, setWorld] = useState<World | null>(null);
  const [access, setAccess] = useState<GroupInstanceRequest["access"]>(allowed[0]?.value ?? "members");
  const [region, setRegion] = useState<GroupInstanceRequest["region"]>(() => {
    const r = parseLocation(myLocation).region;
    return REGIONS.find((x) => x.value === r)?.value ?? "us";
  });
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [queue, setQueue] = useState(true);
  const [ageGate, setAgeGate] = useState(false);
  const [busy, setBusy] = useState(false);
  const canRestrict = perms.can("group-instance-restricted-create") && !!g.roles?.length;
  const canAgeGate = perms.can("group-instance-age-gated-create");

  const create = async () => {
    if (!world) return;
    setBusy(true);
    try {
      const res = await ipc.createGroupInstance(g.id, {
        worldId: world.id,
        access,
        region,
        roleIds: access === "members" && canRestrict ? roleIds : [],
        queue,
        ageGate: canAgeGate && ageGate,
      });
      const location = res.location ?? (res.worldId && res.instanceId ? `${res.worldId}:${res.instanceId}` : res.id);
      await Promise.all([qc.invalidateQueries({ queryKey: ["group-instances", g.id] }), qc.invalidateQueries({ queryKey: ["my-group-instances"] })]);
      toast.success(`Opened ${world.name}`, location?.startsWith("wrld_") ? { action: { label: "Join", onClick: () => actions.join(location) } } : undefined);
      onDone();
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Frame
      title="New group instance"
      subtitle={`Opens an instance owned by ${g.name}.`}
      footer={
        <>
          <Button variant="ghost" onClick={onDone}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} disabled={!world || !allowed.length} onClick={create} icon={<Globe className="size-4" />}>
            Open instance
          </Button>
        </>
      }
    >
      <Field label="World">
        <WorldPicker value={world} onChange={setWorld} />
      </Field>
      <Field label="Access" hint={ACCESS.find((a) => a.value === access)?.hint}>
        {allowed.length ? (
          <Segmented value={access} onChange={setAccess} options={allowed.map(({ value, label }) => ({ value, label }))} />
        ) : (
          <p className="text-[13px] text-subtle">Your role can't open group instances.</p>
        )}
      </Field>
      {access === "members" && canRestrict && (
        <Field label="Only these roles" hint={roleIds.length ? "Members without one of these roles can't join." : "Leave empty for every member."}>
          <RoleChips roles={g.roles ?? []} value={roleIds} onChange={setRoleIds} />
        </Field>
      )}
      <Field label="Region">
        <Segmented value={region} onChange={setRegion} options={REGIONS} />
      </Field>
      <div className="divide-y divide-line/60">
        <SwitchRow label="Queue" hint="When it's full, people wait in line instead of being turned away." checked={queue} onChange={setQueue} />
        {canAgeGate && <SwitchRow label="18+ only" hint="Only age-verified adults can join." checked={ageGate} onChange={setAgeGate} />}
      </div>
    </Frame>
  );
}

type WorldSource = "recent" | "favorites" | "mine";

/** Pick a world from your recent, favorite or own worlds, a search, or a pasted world link/id. */
function WorldPicker({ value, onChange }: { value: World | null; onChange: (w: World | null) => void }) {
  const [source, setSource] = useState<WorldSource>("recent");
  const [q, setQ] = useState("");
  const term = q.trim();
  const pasted = term.match(/wrld_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0];
  const [searchTerm, setSearchTerm] = useState(term);
  useEffect(() => {
    const t = setTimeout(() => setSearchTerm(term), 400);
    return () => clearTimeout(t);
  }, [term]);
  const searching = !pasted && searchTerm.length >= 2;

  const listed = useQuery({ queryKey: ["worlds", source], queryFn: () => ipc.worlds(source), staleTime: 5 * 60_000, enabled: !searching && !pasted });
  const found = useQuery({ queryKey: ["worlds", `search:${searchTerm}`], queryFn: () => ipc.searchWorlds(searchTerm), staleTime: 5 * 60_000, enabled: searching });
  const byId = useWorld(pasted);

  const q2 = pasted ? byId : searching ? found : listed;
  const worlds: World[] = pasted ? (byId.data ? [byId.data] : []) : ((q2.data as World[] | undefined) ?? []);

  return (
    <div className="rounded-xl border border-line bg-panel-2/40">
      <div className="flex flex-wrap items-center gap-2 border-b border-line/70 p-2.5">
        <Input icon={<Search className="size-4" />} placeholder="Search worlds, or paste a world link" value={q} onChange={(e) => setQ(e.target.value)} className="min-w-52 flex-1" />
        {!pasted && term.length < 2 && (
          <Segmented<WorldSource>
            value={source}
            onChange={setSource}
            options={[
              { value: "recent", label: "Recent" },
              { value: "favorites", label: "Favorites" },
              { value: "mine", label: "Mine" },
            ]}
          />
        )}
      </div>
      {value && (
        <div className="flex items-center gap-3 border-b border-line/70 bg-accent-soft/40 p-2.5">
          <Img src={value.thumbnailImageUrl || value.imageUrl} className="h-12 w-[72px] shrink-0 rounded-md" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-semibold">{value.name}</div>
            <div className="truncate text-xs text-muted">
              {value.authorName && `by ${value.authorName}`}
              {value.capacity != null && ` · ${value.capacity} players`}
            </div>
          </div>
          <Button size="sm" variant="ghost" icon={<X className="size-3.5" />} onClick={() => onChange(null)}>
            Change
          </Button>
        </div>
      )}
      <div className="max-h-64 overflow-y-auto p-2.5">
        {q2.isLoading || (term !== searchTerm && !pasted) ? (
          <div className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(150px,1fr))]">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="aspect-[16/10] rounded-lg" />
            ))}
          </div>
        ) : q2.error ? (
          <p className="py-6 text-center text-[13px] text-subtle">{errorText(q2.error)}</p>
        ) : worlds.length ? (
          <div className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(150px,1fr))]">
            {worlds.map((w) => {
              const on = value?.id === w.id;
              return (
                <button
                  key={w.id}
                  onClick={() => onChange(w)}
                  className={cn(
                    "relative overflow-hidden rounded-lg border text-left transition-colors cursor-pointer",
                    on ? "border-accent ring-2 ring-accent/40" : "border-line hover:border-accent/40",
                  )}
                >
                  <Img src={w.thumbnailImageUrl || w.imageUrl} className="aspect-[16/10] w-full" />
                  <div className="truncate px-2 py-1.5 text-xs font-medium">{w.name}</div>
                  {on && (
                    <span className="absolute right-1.5 top-1.5 flex size-5 items-center justify-center rounded-full bg-accent text-accent-fg">
                      <Check className="size-3" />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ) : (
          <p className="py-6 text-center text-[13px] text-subtle">{term ? "No worlds found." : "Nothing here yet."}</p>
        )}
      </div>
    </div>
  );
}

export function CloseInstanceButton({ groupId, location, worldName }: { groupId: string; location: string; worldName?: string }) {
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const [hard, setHard] = useState(false);
  return (
    <>
      <Button size="sm" variant="ghost" className="hover:text-red-400" icon={<Power className="size-3.5" />} onClick={() => setConfirm(true)}>
        Close
      </Button>
      {confirm && (
        <Confirm
          open
          danger
          title={`Close ${worldName ?? "this instance"}?`}
          body={
            <div className="space-y-3">
              <p>Nobody new can join. {hard ? "Everyone inside is sent home right away." : "People already inside can stay until they leave."}</p>
              <SwitchRow label="Send everyone home now" checked={hard} onChange={setHard} />
            </div>
          }
          confirmLabel="Close instance"
          onClose={() => setConfirm(false)}
          onConfirm={async () => {
            try {
              await ipc.closeInstance(location, hard);
              await Promise.all([qc.invalidateQueries({ queryKey: ["group-instances", groupId] }), qc.invalidateQueries({ queryKey: ["my-group-instances"] })]);
              toast.success("Instance closed");
              setConfirm(false);
            } catch (e) {
              toast.error(errorText(e));
            }
          }}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Members: roles, permissions, kick and ban

/** "group-instance-plus-create" → "Instance plus create", for permissions VRChat didn't describe. */
function permLabel(key: string) {
  const s = key.replace(/^group-/, "").replace(/-/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function invalidateMembers(qc: ReturnType<typeof useQueryClient>, groupId: string) {
  return Promise.all(
    [["group-members", groupId], ["group-members-search", groupId], ["group-bans", groupId], ["group", groupId]].map((queryKey) =>
      qc.invalidateQueries({ queryKey }),
    ),
  );
}

export function MemberDialog({
  g,
  member,
  onClose,
  onOpenProfile,
}: {
  g: VrcGroupDetail;
  member: VrcGroupMember | null;
  onClose: () => void;
  onOpenProfile: (userId: string) => void;
}) {
  return (
    <Dialog open={!!member} onClose={onClose} title="Manage member" className="w-[min(680px,calc(100vw-32px))]">
      {member && <MemberManage key={member.user.id} g={g} member={member} onDone={onClose} onOpenProfile={onOpenProfile} />}
    </Dialog>
  );
}

function MemberManage({ g, member, onDone, onOpenProfile }: { g: VrcGroupDetail; member: VrcGroupMember; onDone: () => void; onOpenProfile: (userId: string) => void }) {
  const qc = useQueryClient();
  const perms = useGroupPerms(g);
  const meId = useAuth((s) => s.user?.id);
  const userId = member.user.id;
  const name = member.user.displayName;
  const detail = useQuery({ queryKey: ["group-member", g.id, userId], queryFn: () => ipc.groupMember(g.id, userId), staleTime: 30_000, retry: false });
  const roles = useQuery({ queryKey: ["group-roles", g.id], queryFn: () => ipc.groupRoles(g.id), staleTime: 5 * 60_000 });
  const catalog = useQuery({ queryKey: ["group-permissions", g.id], queryFn: () => ipc.groupPermissions(g.id), staleTime: 30 * 60_000, retry: false });
  const [busyRole, setBusyRole] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"kick" | "ban" | null>(null);

  const isOwner = userId === g.ownerId;
  const isMe = userId === meId;
  const m = detail.data ?? member;
  const held = new Set(memberRoleIds(m));
  const allRoles = [...(roles.data ?? [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const heldRoles = allRoles.filter((r) => held.has(r.id));
  const effective = new Set(heldRoles.flatMap((r) => r.permissions ?? []));
  const everything = isOwner || effective.has("*");
  const described = new Map((catalog.data ?? []).map((p) => [p.name, p]));
  const permList = [...effective].filter((p) => p !== "*").sort((a, b) => (described.get(a)?.displayName ?? a).localeCompare(described.get(b)?.displayName ?? b));

  const toggleRole = async (role: VrcGroupRole, on: boolean) => {
    setBusyRole(role.id);
    try {
      await ipc.setGroupMemberRole(g.id, userId, role.id, on);
      qc.setQueryData<VrcGroupMember>(["group-member", g.id, userId], (prev) => {
        const base = prev ?? member;
        const ids = memberRoleIds(base).filter((id) => id !== role.id);
        return { ...base, roleIds: on ? [...ids, role.id] : ids, mRoleIds: [] };
      });
      toast.success(on ? `${name} is now ${role.name}` : `Took ${role.name} from ${name}`);
      void invalidateMembers(qc, g.id);
    } catch (e) {
      toast.error(errorText(e));
      void detail.refetch();
    } finally {
      setBusyRole(null);
    }
  };

  const moderate = async (what: "kick" | "ban") => {
    try {
      if (what === "kick") await ipc.kickGroupMember(g.id, userId);
      else await ipc.banGroupMember(g.id, userId);
      await invalidateMembers(qc, g.id);
      toast.success(what === "kick" ? `Removed ${name} from ${g.name}` : `Banned ${name} from ${g.name}`);
      setConfirm(null);
      onDone();
    } catch (e) {
      toast.error(errorText(e));
    }
  };

  const canModerate = !isOwner && !isMe;

  return (
    <div className="flex max-h-[88vh] flex-col">
      <div className="flex items-center gap-3 border-b border-line px-6 py-4 pr-14">
        <UserAvatar user={{ ...member.user, iconUrl: member.user.iconUrl ?? member.user.thumbnailUrl }} size={44} dot={false} />
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-1.5 truncate text-lg font-bold">
            {isOwner && <Crown className="size-4 shrink-0 text-amber-400" />}
            <span className="truncate">{name}</span>
          </h2>
          <p className="text-[13px] text-muted">
            {isOwner ? "Group owner" : m.joinedAt ? `Joined ${new Date(m.joinedAt).toLocaleDateString()}` : "Member"}
            {isMe && " · you"}
          </p>
        </div>
        <Button size="sm" icon={<ExternalLink className="size-3.5" />} onClick={() => onOpenProfile(userId)}>
          Profile
        </Button>
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-6">
        <section>
          <div className="mb-2 flex items-baseline justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-subtle">Roles</h3>
            {!perms.assignRoles && <span className="text-[11px] text-subtle">Your role can't assign roles</span>}
          </div>
          {roles.isLoading || detail.isLoading ? (
            <Skeleton className="h-32 rounded-xl" />
          ) : roles.error ? (
            <p className="text-[13px] text-subtle">{errorText(roles.error)}</p>
          ) : (
            <div className="divide-y divide-line/60 rounded-xl border border-line bg-panel-2/40">
              {allRoles.map((r) => {
                const on = held.has(r.id);
                const ownerRole = !!r.permissions?.includes("*");
                const locked = !perms.assignRoles || ownerRole || busyRole !== null;
                return (
                  <div key={r.id} className="flex items-center gap-3 px-3.5 py-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 text-[13px] font-medium">
                        {ownerRole && <Crown className="size-3 text-amber-400" />}
                        {r.name}
                        {r.isManagementRole && <span className="rounded bg-accent-soft px-1.5 text-[10px] font-semibold text-accent">Management</span>}
                      </div>
                      <div className="truncate text-xs text-subtle">
                        {ownerRole ? "Every permission" : `${r.permissions?.length ?? 0} permissions`}
                        {r.description && ` · ${r.description}`}
                      </div>
                    </div>
                    {busyRole === r.id ? (
                      <span className="inline-block size-4 animate-spin rounded-full border-2 border-accent border-t-transparent" />
                    ) : (
                      <span className={cn(locked && "pointer-events-none opacity-50")}>
                        {/* Guarded here too: the switch still takes keyboard input when the pointer is blocked. */}
                        <Switch checked={on} onChange={(v) => !locked && toggleRole(r, v)} label={`${r.name} role`} />
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-subtle">Permissions</h3>
          {everything ? (
            <p className="inline-flex items-center gap-1.5 rounded-lg bg-amber-400/10 px-3 py-2 text-[13px] text-amber-300">
              <Crown className="size-3.5" /> Every permission — this is the group owner.
            </p>
          ) : roles.isLoading ? (
            <Skeleton className="h-16 rounded-xl" />
          ) : permList.length ? (
            <div className="flex flex-wrap gap-1.5">
              {permList.map((p) => {
                const d = described.get(p);
                const chip = (
                  <span
                    className={cn(
                      "inline-flex h-6 items-center rounded-md px-2 text-[11px] font-medium",
                      d?.isManagementPermission ? "bg-accent-soft text-accent" : "bg-panel-2 text-muted",
                    )}
                  >
                    {d?.displayName ?? permLabel(p)}
                  </span>
                );
                return d?.help ? (
                  <Tip key={p} label={<span className="block max-w-64">{d.help}</span>}>
                    {chip}
                  </Tip>
                ) : (
                  <span key={p}>{chip}</span>
                );
              })}
            </div>
          ) : (
            <p className="text-[13px] text-subtle">No extra permissions — only what every member gets.</p>
          )}
        </section>

        {(perms.kick || perms.ban) && (
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-subtle">Moderation</h3>
            {canModerate ? (
              <div className="flex flex-wrap gap-2">
                {perms.kick && (
                  <Button variant="danger" icon={<UserMinus className="size-4" />} onClick={() => setConfirm("kick")}>
                    Kick from group
                  </Button>
                )}
                {perms.ban && (
                  <Button variant="danger" icon={<Ban className="size-4" />} onClick={() => setConfirm("ban")}>
                    Ban from group
                  </Button>
                )}
              </div>
            ) : (
              <p className="text-[13px] text-subtle">{isOwner ? "The group owner can't be kicked or banned." : "You can't kick or ban yourself."}</p>
            )}
          </section>
        )}
      </div>

      {confirm && (
        <Confirm
          open
          danger
          title={confirm === "kick" ? `Kick ${name}?` : `Ban ${name}?`}
          body={
            confirm === "kick"
              ? `${name} is removed from ${g.name} and loses their roles. They can rejoin if the group lets them.`
              : `${name} is removed from ${g.name} and can't rejoin until they're unbanned.`
          }
          confirmLabel={confirm === "kick" ? "Kick" : "Ban"}
          onClose={() => setConfirm(null)}
          onConfirm={() => moderate(confirm)}
        />
      )}
    </div>
  );
}

/** People asking to join, with accept / decline / block. */
export function RequestsList({ g, toolbar, onOpenProfile }: { g: VrcGroupDetail; toolbar?: ReactNode; onOpenProfile: (userId: string) => void }) {
  const qc = useQueryClient();
  const q = useJoinRequests(g.id, true);
  const [busy, setBusy] = useState<string | null>(null);
  const [blocking, setBlocking] = useState<VrcGroupMember | null>(null);
  const [filter, setFilter] = useState("");
  const all = q.data ?? [];

  const respond = async (m: VrcGroupMember, accept: boolean, block = false) => {
    setBusy(m.user.id);
    try {
      await ipc.respondGroupRequest(g.id, m.user.id, accept, block);
      qc.setQueryData<VrcGroupMember[]>(["group-requests", g.id], (prev) => prev?.filter((x) => x.user.id !== m.user.id));
      if (accept) void invalidateMembers(qc, g.id);
      toast.success(accept ? `${m.user.displayName} joined ${g.name}` : block ? `Declined and blocked ${m.user.displayName}` : `Declined ${m.user.displayName}`);
      setBlocking(null);
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  const placeholder = q.isLoading ? (
    <Skeleton className="h-40 rounded-xl" />
  ) : q.error ? (
    <Empty icon={<UserPlus />} title="Couldn't load join requests" hint={errorText(q.error)} />
  ) : !all.length ? (
    <Empty
      icon={<UserPlus />}
      title="No join requests"
      hint={g.joinState === "request" ? "New requests show up here." : "People can only ask to join while the group is set to Request (Edit group → Who can join)."}
    />
  ) : null;
  if (placeholder) {
    return (
      <div>
        {toolbar && <div className="mb-3">{toolbar}</div>}
        {placeholder}
      </div>
    );
  }

  const s = filter.trim().toLowerCase();
  const requests = all.filter((r) => !s || r.user.displayName.toLowerCase().includes(s));
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {toolbar}
        <Input icon={<Search className="size-4" />} placeholder={`Search ${all.length} requests`} value={filter} onChange={(e) => setFilter(e.target.value)} className="w-56" />
        {all.length >= 100 && <span className="text-xs text-subtle">Showing the first 100</span>}
      </div>
      <div className="space-y-2">
        {requests.map((r) => (
          <div key={r.id ?? r.user.id} className="flex items-center gap-3 rounded-xl border border-line bg-panel p-2.5">
            <button onClick={() => onOpenProfile(r.user.id)} className="flex min-w-0 flex-1 items-center gap-3 text-left cursor-pointer">
              <UserAvatar user={{ ...r.user, iconUrl: r.user.iconUrl ?? r.user.thumbnailUrl }} size={34} dot={false} />
              <div className="min-w-0">
                <div className="truncate text-[13px] font-medium hover:text-accent">{r.user.displayName}</div>
                <div className="truncate text-[11px] text-subtle">{r.createdAt ? `Asked ${ago(r.createdAt)}` : "Wants to join"}</div>
              </div>
            </button>
            <IconButton label="Decline and block" disabled={busy !== null} onClick={() => setBlocking(r)} className="hover:text-red-400">
              <Ban className="size-4" />
            </IconButton>
            <Button size="sm" variant="ghost" icon={<X className="size-3.5" />} disabled={busy !== null && busy !== r.user.id} onClick={() => respond(r, false)}>
              Decline
            </Button>
            <Button size="sm" variant="primary" icon={<Check className="size-3.5" />} loading={busy === r.user.id} disabled={busy !== null && busy !== r.user.id} onClick={() => respond(r, true)}>
              Accept
            </Button>
          </div>
        ))}
      </div>
      {!requests.length && <Empty icon={<Search />} title="Nobody matches" />}
      {blocking && (
        <Confirm
          open
          danger
          title={`Decline and block ${blocking.user.displayName}?`}
          body="Their request is declined and they can't ask to join again. Blocks can be lifted on vrchat.com."
          confirmLabel="Decline and block"
          onClose={() => setBlocking(null)}
          onConfirm={() => respond(blocking, false, true)}
        />
      )}
    </div>
  );
}

/** People banned from the group, with unban. */
export function BansList({ g, toolbar, onOpenProfile }: { g: VrcGroupDetail; toolbar?: ReactNode; onOpenProfile: (userId: string) => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["group-bans", g.id], queryFn: () => ipc.groupBans(g.id), staleTime: 30_000, retry: false });
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  const all = q.data ?? [];
  const placeholder = q.isLoading ? (
    <Skeleton className="h-40 rounded-xl" />
  ) : q.error ? (
    <Empty icon={<Ban />} title="Couldn't load bans" hint={errorText(q.error)} />
  ) : !all.length ? (
    <Empty icon={<ShieldCheck />} title="Nobody is banned" hint="People you ban from the group are listed here." />
  ) : null;
  if (placeholder) {
    return (
      <div>
        {toolbar && <div className="mb-3">{toolbar}</div>}
        {placeholder}
      </div>
    );
  }
  const s = filter.trim().toLowerCase();
  const bans = all.filter((b) => !s || b.user.displayName.toLowerCase().includes(s));

  const unban = async (b: VrcGroupMember) => {
    setBusy(b.user.id);
    try {
      await ipc.unbanGroupMember(g.id, b.user.id);
      await qc.invalidateQueries({ queryKey: ["group-bans", g.id] });
      toast.success(`Unbanned ${b.user.displayName}`);
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {toolbar}
        <Input icon={<Search className="size-4" />} placeholder={`Search ${all.length} banned`} value={filter} onChange={(e) => setFilter(e.target.value)} className="w-56" />
        {all.length >= 100 && <span className="text-xs text-subtle">Showing the first 100</span>}
      </div>
      <div className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(260px,1fr))]">
        {bans.map((b) => (
          <div key={b.id ?? b.user.id} className="flex items-center gap-3 rounded-xl border border-line bg-panel p-2.5">
            <button onClick={() => onOpenProfile(b.user.id)} className="flex min-w-0 flex-1 items-center gap-3 text-left cursor-pointer">
              <UserAvatar user={{ ...b.user, iconUrl: b.user.iconUrl ?? b.user.thumbnailUrl }} size={34} dot={false} />
              <div className="min-w-0">
                <div className="truncate text-[13px] font-medium hover:text-accent">{b.user.displayName}</div>
                <div className="truncate text-[11px] text-subtle">{b.bannedAt ? `Banned ${ago(b.bannedAt)}` : "Banned"}</div>
              </div>
            </button>
            <Button size="sm" loading={busy === b.user.id} disabled={busy !== null && busy !== b.user.id} onClick={() => unban(b)}>
              Unban
            </Button>
          </div>
        ))}
      </div>
      {!bans.length && <Empty icon={<Search />} title="Nobody matches" />}
    </div>
  );
}

/** Quick links to the owner/moderator tools, for the group's side panel. */
export type ManageTool = "edit" | "post" | "instance" | "requests" | "bans";

export function ManagePanel({ perms, requests, onTool }: { perms: GroupPerms; requests?: number; onTool: (tool: ManageTool) => void }) {
  const tools = [
    perms.editGroup && { id: "edit" as const, label: "Edit group", icon: <Pencil className="size-3.5" /> },
    perms.posts && { id: "post" as const, label: "New post", icon: <Megaphone className="size-3.5" /> },
    perms.createInstance && { id: "instance" as const, label: "New instance", icon: <Globe className="size-3.5" /> },
    perms.requests && {
      id: "requests" as const,
      label: requests ? `Requests · ${requests}` : "Requests",
      icon: <UserPlus className="size-3.5" />,
      highlight: !!requests,
    },
    perms.ban && { id: "bans" as const, label: "Bans", icon: <Ban className="size-3.5" /> },
  ].filter(Boolean) as { id: ManageTool; label: string; icon: ReactNode; highlight?: boolean }[];
  if (!tools.length && !perms.members) return null;
  return (
    <div className="rounded-xl border border-amber-400/25 bg-amber-400/[0.04]">
      <div className="flex h-9 items-center gap-1.5 border-b border-amber-400/15 px-3.5">
        {perms.isOwner ? <Crown className="size-3 text-amber-400" /> : <ShieldCheck className="size-3 text-amber-400" />}
        <span className="text-[11px] font-semibold uppercase tracking-wider text-amber-400/90">{perms.isOwner ? "Owner tools" : "Moderator tools"}</span>
      </div>
      <div className="grid grid-cols-2 gap-1.5 p-2.5 [&>*]:w-full">
        {tools.map((t) => (
          <Button key={t.id} size="sm" variant={t.highlight ? "primary" : "secondary"} icon={t.icon} onClick={() => onTool(t.id)}>
            {t.label}
          </Button>
        ))}
      </div>
      {perms.members && (
        <p className="flex items-center gap-1.5 px-3.5 pb-3 text-[11px] text-subtle">
          <Users className="size-3 shrink-0" /> Manage roles, kicks and bans from a member's card in Members.
        </p>
      )}
    </div>
  );
}
