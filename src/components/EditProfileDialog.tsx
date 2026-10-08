import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ExternalLink, ImagePlus, Plus, Star, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/format";
import { fileUrls, toPngBase64 } from "@/lib/image";
import { errorText, ipc } from "@/lib/ipc";
import type { InventoryItem, ProfilePatch, VrcFile, VrcGroup } from "@/lib/types";
import { useAuth } from "@/stores/auth";
import { useUi } from "@/stores/ui";
import { Button, Dialog, Img, Input, Segmented, Skeleton, Tip } from "./ui";
import { LANGUAGES } from "./UserDialog";

// VRChat's own limits.
const BIO_MAX = 512;
const LINKS_MAX = 3;
const LANGUAGES_MAX = 3;
const SHOWCASE_MAX = 3;
const PRONOUNS_MAX = 32;

const fileId = (url?: string | null) => url?.match(/file_[0-9a-f-]+/)?.[0];

function latestVersion(f: VrcFile) {
  return fileUrls(f).version;
}

function Section({ title, hint, children, right }: { title: string; hint?: ReactNode; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-panel-2/40">
      <div className="flex items-center justify-between gap-3 border-b border-line/70 px-4 py-2.5">
        <div>
          <div className="text-[13px] font-semibold">{title}</div>
          {hint && <div className="text-xs text-muted">{hint}</div>}
        </div>
        {right}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

type CosmeticSlot = "iconFrame" | "nameplateEffect" | "profileEffect";

/** Owned, usable cosmetics for a profile slot (not archived, not expired, equippable there). */
function usableCosmetics(items: InventoryItem[] | undefined, slot: CosmeticSlot): InventoryItem[] {
  return (items ?? []).filter(
    (i) =>
      i.itemType === slot &&
      !i.isArchived &&
      !(i.expiryDate && Date.parse(i.expiryDate) <= Date.now()) &&
      !!i.flags?.includes("equippable") &&
      !!i.equipSlots?.includes(slot) &&
      !!i.templateId,
  );
}

function CosmeticPicker({
  items,
  value,
  onChange,
  noneLabel,
}: {
  items: InventoryItem[];
  /** Selected template id, or "" for none. */
  value: string;
  onChange: (templateId: string) => void;
  noneLabel: string;
}) {
  const tile = (active: boolean) =>
    cn(
      "relative flex flex-col items-center gap-1.5 rounded-xl border p-2 text-center transition-colors cursor-pointer",
      active ? "border-accent bg-accent-soft" : "border-line bg-panel hover:border-accent/40",
    );
  return (
    <div className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(112px,1fr))]">
      <button onClick={() => onChange("")} className={tile(!value)}>
        <span className="flex size-16 items-center justify-center rounded-lg bg-panel-2 text-subtle">
          <X className="size-5" />
        </span>
        <span className="text-xs font-medium">{noneLabel}</span>
      </button>
      {items.map((i) => {
        const active = value === i.templateId;
        return (
          <button key={i.id} onClick={() => onChange(i.templateId!)} className={tile(active)} title={i.description || i.name}>
            <Img src={i.imageUrl} className="size-16 rounded-lg bg-transparent object-contain" />
            <span className="line-clamp-2 text-xs font-medium leading-tight">{i.name}</span>
            {active && (
              <span className="absolute right-1.5 top-1.5 flex size-5 items-center justify-center rounded-full bg-accent text-accent-fg">
                <Check className="size-3" />
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function EditProfileDialog() {
  const open = useUi((s) => s.editingProfile);
  const setOpen = useUi((s) => s.setEditingProfile);
  return (
    <Dialog open={open} onClose={() => setOpen(false)} title="Edit profile" className="w-[min(860px,calc(100vw-32px))]">
      {open && <Editor onDone={() => setOpen(false)} />}
    </Dialog>
  );
}

function Editor({ onDone }: { onDone: () => void }) {
  const me = useAuth((s) => s.user)!;
  const updateUser = useAuth((s) => s.updateUser);
  const qc = useQueryClient();
  const profile = useQuery({ queryKey: ["profile", me.id], queryFn: () => ipc.profile(me.id, true) });
  const groups = useQuery({ queryKey: ["groups", me.id], queryFn: () => ipc.userGroups(me.id) });
  const icons = useQuery({ queryKey: ["icons"], queryFn: ipc.icons });
  const inventory = useQuery({ queryKey: ["inventory-all"], queryFn: ipc.inventoryAll, staleTime: 5 * 60_000 });
  const frames = useMemo(() => usableCosmetics(inventory.data, "iconFrame"), [inventory.data]);
  const nameplates = useMemo(() => usableCosmetics(inventory.data, "nameplateEffect"), [inventory.data]);
  const profileEffects = useMemo(() => usableCosmetics(inventory.data, "profileEffect"), [inventory.data]);

  const [bio, setBio] = useState("");
  const [links, setLinks] = useState<string[]>([]);
  const [languages, setLanguages] = useState<string[]>([]);
  const [pronouns, setPronouns] = useState("");
  const [icon, setIcon] = useState<string | undefined>();
  const [bannerType, setBannerType] = useState("customImage");
  const [bannerColor, setBannerColor] = useState("4178e5");
  const [showcased, setShowcased] = useState<Set<string>>(new Set());
  const [represented, setRepresented] = useState<string>("");
  const [iconFrame, setIconFrame] = useState("");
  const [nameplate, setNameplate] = useState("");
  const [profileEffect, setProfileEffect] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const p = profile.data;
  const initialRep = useMemo(() => groups.data?.find((g) => g.isRepresenting)?.groupId ?? "", [groups.data]);

  // Seed the form once the current values arrive.
  useEffect(() => {
    if (!p) return;
    setBio(p.bio ?? "");
    setLinks(p.bioLinks ?? []);
    setLanguages(p.languages ?? []);
    setBannerType(p.bannerType ?? "customImage");
    setBannerColor((p.bannerColor || "4178e5").toLowerCase());
    setShowcased(new Set((p.badges ?? []).filter((b) => b.showcased).map((b) => b.badgeId)));
    setIconFrame(p.iconFrame ?? "");
    setNameplate(p.nameplateEffect ?? "");
    setProfileEffect(p.profileEffect ?? "");
  }, [p]);
  useEffect(() => setPronouns(me.pronouns ?? p?.pronouns ?? ""), [me.pronouns, p?.pronouns]);
  useEffect(() => setRepresented(initialRep), [initialRep]);

  const currentIconId = fileId(p?.userIcon || p?.iconUrl || me.iconUrl);
  const selectedIconId = icon ? fileId(icon) : currentIconId;

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const f = await ipc.uploadIcon(await toPngBase64(file, { square: true, max: 1024 }));
      await qc.invalidateQueries({ queryKey: ["icons"] });
      setIcon(`https://api.vrchat.cloud/api/1/file/${f.id}/${latestVersion(f)}`);
      toast.success("Icon uploaded — save to use it");
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setUploading(false);
    }
  };

  const save = async () => {
    if (!p) return;
    setSaving(true);
    const done: string[] = [];
    try {
      const cleanLinks = links.map((l) => l.trim()).filter(Boolean);
      const patch: ProfilePatch = {};
      if (bio !== (p.bio ?? "")) patch.bio = bio;
      if (JSON.stringify(cleanLinks) !== JSON.stringify(p.bioLinks ?? [])) patch.bioLinks = cleanLinks;
      if (JSON.stringify(languages) !== JSON.stringify(p.languages ?? [])) patch.languages = languages;
      if (icon) patch.userIcon = icon;
      if (bannerType !== (p.bannerType ?? "customImage")) patch.bannerType = bannerType;
      if (bannerType === "color" && bannerColor !== (p.bannerColor ?? "").toLowerCase()) patch.bannerColor = bannerColor;
      if (Object.keys(patch).length) {
        await ipc.updateProfile(patch);
        done.push("profile");
        // Show the new picture right away (the session copy of you only refreshes on the next sync).
        const id = fileId(icon);
        if (id) updateUser({ ...me, iconUrl: `https://api.vrchat.cloud/api/1/image/${id}/${icon!.split("/").pop()}/256` });
      }

      if (pronouns !== (me.pronouns ?? p.pronouns ?? "")) {
        updateUser(await ipc.updateMe(pronouns));
        done.push("pronouns");
      }

      for (const b of p.badges ?? []) {
        const want = showcased.has(b.badgeId);
        if (want !== !!b.showcased) {
          await ipc.setBadge(b.badgeId, want);
          if (!done.includes("badges")) done.push("badges");
        }
      }

      for (const [slot, want, had] of [
        ["iconFrame", iconFrame, p.iconFrame ?? ""],
        ["nameplateEffect", nameplate, p.nameplateEffect ?? ""],
        ["profileEffect", profileEffect, p.profileEffect ?? ""],
      ] as const) {
        if (want === had) continue;
        if (want) await ipc.updateProfile({ [slot]: want });
        else await ipc.unequip(slot);
        done.push(slot);
      }

      if (represented !== initialRep) {
        if (represented) await ipc.representGroup(represented, true);
        else if (initialRep) await ipc.representGroup(initialRep, false);
        done.push("group");
      }

      await Promise.all([
        qc.invalidateQueries({ queryKey: ["profile", me.id] }),
        qc.invalidateQueries({ queryKey: ["inventory-all"] }),
        qc.invalidateQueries({ queryKey: ["groups", me.id] }),
        qc.invalidateQueries({ queryKey: ["user", me.id] }),
      ]);
      // Re-read with force so the cached profile reflects badge/group changes made via other endpoints.
      await ipc.profile(me.id, true).then((fresh) => qc.setQueryData(["profile", me.id], fresh));
      toast.success(done.length ? "Profile updated" : "Nothing to save");
      onDone();
    } catch (e) {
      toast.error(`${done.length ? "Partly saved. " : ""}${errorText(e)}`);
    } finally {
      setSaving(false);
    }
  };

  if (profile.isLoading || !p) {
    return (
      <div className="space-y-3 p-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const badges = p.badges ?? [];
  const iconFiles = icons.data ?? [];

  return (
    <div className="flex max-h-[88vh] flex-col">
      <div className="border-b border-line px-6 py-4 pr-14">
        <h2 className="text-lg font-bold">Edit profile</h2>
        <p className="text-[13px] text-muted">Changes are saved to VRChat and show up in-game.</p>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-6">
        <Section
          title="Profile picture"
          hint="Pick one of your icons, or upload a new one (VRC+). Images are cropped to a square."
          right={
            <>
              <input
                ref={fileInput}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) upload(f);
                }}
              />
              <Button size="sm" icon={<ImagePlus className="size-3.5" />} loading={uploading} onClick={() => fileInput.current?.click()}>
                Upload
              </Button>
            </>
          }
        >
          {icons.isLoading ? (
            <Skeleton className="h-20 w-full" />
          ) : iconFiles.length ? (
            <div className="flex flex-wrap gap-2">
              {iconFiles.map((f) => {
                const v = latestVersion(f);
                const active = selectedIconId === f.id;
                return (
                  <button
                    key={f.id}
                    onClick={() => setIcon(`https://api.vrchat.cloud/api/1/file/${f.id}/${v}`)}
                    className={cn(
                      "relative rounded-full p-0.5 transition cursor-pointer",
                      active ? "ring-2 ring-accent" : "ring-1 ring-line hover:ring-accent/50",
                    )}
                  >
                    <Img src={`https://api.vrchat.cloud/api/1/image/${f.id}/${v}/256`} className="size-16 rounded-full" />
                    {active && (
                      <span className="absolute -right-0.5 -top-0.5 flex size-5 items-center justify-center rounded-full bg-accent text-accent-fg">
                        <Check className="size-3" />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="text-[13px] text-subtle">No uploaded icons yet.</p>
          )}
        </Section>

        <Section title="Banner" hint="Custom banner images are managed on vrchat.com.">
          <div className="flex flex-wrap items-center gap-3">
            <Segmented
              value={bannerType}
              onChange={setBannerType}
              options={[
                { value: "customImage", label: "Custom image" },
                { value: "avatarBanner", label: "Avatar" },
                { value: "color", label: "Color" },
              ]}
            />
            {bannerType === "color" && (
              <label className="flex items-center gap-2 text-[13px] text-muted">
                <input
                  type="color"
                  value={`#${bannerColor}`}
                  onChange={(e) => setBannerColor(e.target.value.slice(1).toLowerCase())}
                  className="h-8 w-12 cursor-pointer rounded border border-line bg-transparent"
                />
                <span className="font-mono">#{bannerColor}</span>
              </label>
            )}
            {bannerType === "customImage" && (
              <Button size="sm" variant="ghost" icon={<ExternalLink className="size-3.5" />} onClick={() => ipc.openExternal(`https://vrchat.com/home/user/${me.id}`)}>
                Change image on vrchat.com
              </Button>
            )}
          </div>
        </Section>

        <Section title="Icon frame" hint="Decorates your profile picture in-game and on your profile.">
          {inventory.isLoading ? (
            <Skeleton className="h-28 w-full" />
          ) : frames.length ? (
            <CosmeticPicker items={frames} value={iconFrame} onChange={setIconFrame} noneLabel="No frame" />
          ) : (
            <p className="text-[13px] text-subtle">You don't own any icon frames.</p>
          )}
        </Section>

        <Section title="Nameplate effect" hint="The animated effect on your in-game nameplate.">
          {inventory.isLoading ? (
            <Skeleton className="h-28 w-full" />
          ) : nameplates.length ? (
            <CosmeticPicker items={nameplates} value={nameplate} onChange={setNameplate} noneLabel="No effect" />
          ) : (
            <p className="text-[13px] text-subtle">You don't own any nameplate effects.</p>
          )}
        </Section>

        <Section title="Profile effect" hint="The animated background effect on your profile.">
          {inventory.isLoading ? (
            <Skeleton className="h-28 w-full" />
          ) : profileEffects.length ? (
            <CosmeticPicker items={profileEffects} value={profileEffect} onChange={setProfileEffect} noneLabel="No effect" />
          ) : (
            <p className="text-[13px] text-subtle">You don't own any profile effects.</p>
          )}
        </Section>

        <Section title="About you">
          <div className="space-y-3">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-muted">Pronouns</span>
              <Input value={pronouns} maxLength={PRONOUNS_MAX} onChange={(e) => setPronouns(e.target.value)} placeholder="e.g. she/her" className="max-w-xs" />
            </label>
            <label className="block">
              <span className="mb-1 flex justify-between text-xs font-medium text-muted">
                Bio
                <span className={cn("tabular-nums", bio.length > BIO_MAX - 20 && "text-st-ask")}>
                  {bio.length}/{BIO_MAX}
                </span>
              </span>
              <textarea
                value={bio}
                maxLength={BIO_MAX}
                onChange={(e) => setBio(e.target.value)}
                rows={6}
                className="w-full resize-y rounded-lg border border-line bg-panel-2 px-3 py-2 text-[13px] leading-relaxed outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft"
              />
            </label>
          </div>
        </Section>

        <Section
          title="Links"
          hint={`Up to ${LINKS_MAX} links shown on your profile.`}
          right={
            links.length < LINKS_MAX && (
              <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => setLinks([...links, ""])}>
                Add link
              </Button>
            )
          }
        >
          {links.length ? (
            <div className="space-y-2">
              {links.map((l, i) => (
                <div key={i} className="flex gap-2">
                  <Input
                    value={l}
                    onChange={(e) => setLinks(links.map((x, j) => (j === i ? e.target.value : x)))}
                    placeholder="https://"
                    className="flex-1"
                  />
                  <Button size="sm" variant="ghost" aria-label="Remove link" icon={<Trash2 className="size-3.5" />} onClick={() => setLinks(links.filter((_, j) => j !== i))} />
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[13px] text-subtle">No links.</p>
          )}
        </Section>

        <Section title="Languages" hint={`Up to ${LANGUAGES_MAX}.`}>
          <div className="flex flex-wrap items-center gap-1.5">
            {languages.map((l) => (
              <span key={l} className="inline-flex h-7 items-center gap-1 rounded-full bg-accent-soft px-2.5 text-xs font-medium">
                {LANGUAGES[l] ?? l}
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
                  .map(([code, name]) => (
                    <option key={code} value={code}>
                      {name}
                    </option>
                  ))}
              </select>
            )}
          </div>
        </Section>

        <Section title="Showcased badges" hint={`Pick up to ${SHOWCASE_MAX} to feature at the top of your profile. ${showcased.size}/${SHOWCASE_MAX} selected.`}>
          {badges.length ? (
            <div className="flex flex-wrap gap-2">
              {badges.map((b) => {
                const on = showcased.has(b.badgeId);
                const full = !on && showcased.size >= SHOWCASE_MAX;
                return (
                  <Tip key={b.badgeId} label={`${b.badgeName ?? "Badge"}${b.badgeDescription ? ` — ${b.badgeDescription}` : ""}`}>
                    <button
                      disabled={full}
                      onClick={() => {
                        const n = new Set(showcased);
                        if (on) n.delete(b.badgeId);
                        else n.add(b.badgeId);
                        setShowcased(n);
                      }}
                      className={cn(
                        "relative rounded-xl p-1.5 transition cursor-pointer disabled:cursor-not-allowed disabled:opacity-40",
                        on ? "bg-accent-soft ring-2 ring-accent" : "bg-panel ring-1 ring-line hover:ring-accent/50",
                      )}
                    >
                      <Img src={b.badgeImageUrl} className="size-12 bg-transparent object-contain" />
                      {on && <Star className="absolute -right-1 -top-1 size-4 fill-amber-400 text-amber-400" />}
                    </button>
                  </Tip>
                );
              })}
            </div>
          ) : (
            <p className="text-[13px] text-subtle">You don't have any badges yet.</p>
          )}
        </Section>

        <Section title="Represented group" hint="The group shown on your profile and nameplate.">
          {groups.isLoading ? (
            <Skeleton className="h-16 w-full" />
          ) : (
            <div className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(220px,1fr))]">
              <GroupOption active={!represented} onClick={() => setRepresented("")}>
                <span className="flex size-9 items-center justify-center rounded-lg bg-panel-2 text-subtle">
                  <X className="size-4" />
                </span>
                <span className="text-[13px] font-medium">None</span>
              </GroupOption>
              {[...(groups.data ?? [])]
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((g: VrcGroup) => (
                  <GroupOption key={g.groupId} active={represented === g.groupId} onClick={() => setRepresented(g.groupId ?? "")}>
                    <Img src={g.iconUrl} className="size-9 shrink-0 rounded-lg" />
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-medium">{g.name}</span>
                      <span className="block text-[11px] text-subtle">{g.memberCount?.toLocaleString()} members</span>
                    </span>
                  </GroupOption>
                ))}
            </div>
          )}
        </Section>
      </div>

      <div className="flex justify-end gap-2 border-t border-line px-6 py-3">
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button variant="primary" loading={saving} onClick={save} icon={<Check className="size-4" />}>
          Save changes
        </Button>
      </div>
    </div>
  );
}

function GroupOption({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-3 rounded-xl border p-2 text-left transition-colors cursor-pointer",
        active ? "border-accent bg-accent-soft" : "border-line bg-panel hover:border-accent/40",
      )}
    >
      {children}
    </button>
  );
}
