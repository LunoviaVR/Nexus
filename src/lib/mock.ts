// Dev-only fake backend so the UI can be previewed in a plain browser (`npm run dev`).
// Loaded from main.tsx only when not running inside Tauri.
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { emit } from "@tauri-apps/api/event";
import type { FeedEntry, GlSession, VrcUser, World } from "./types";

const img = (seed: string, w = 256, h = 192) => `https://picsum.photos/seed/${encodeURIComponent(seed)}/${w}/${h}`;
const now = Date.now();
const W = (n: number) => `wrld_0000000${n}-aaaa-bbbb-cccc-000000000000`;

const worlds: World[] = [
  "The Black Cat", "Midnight Rooftop", "Just B Club", "Movie & Chill", "Sakura Hotel", "Udon Pool Hall", "Murder 4", "The Great Pug",
].map((name, i) => ({
  id: W(i),
  name,
  authorId: "usr_x",
  authorName: ["Fins", "Hiro", "Okami", "Lumen"][i % 4],
  imageUrl: img(name, 1200, 900),
  thumbnailImageUrl: img(name),
  capacity: 32,
  occupants: 40 + i * 37,
  favorites: 12000 + i * 3400,
  visits: 900000 + i * 120000,
  description: "A cozy place to hang out with friends.",
  tags: ["author_tag_chill", "author_tag_social"],
  instances: [[`${10000 + i}~region(us)`, 12], [`${20000 + i}~region(eu)`, 5]],
  updated_at: new Date(now - i * 86400000 * 9).toISOString(),
}));

const names = ["Aurora", "Kitsune", "Pixel", "Nova", "Mochi", "Sable", "Echo", "Juniper", "Rook", "Velvet", "Quill", "Tamago", "Zephyr", "Lumi", "Basil", "Cinder", "Wren", "Opal", "Hex", "Marlowe"];
const statuses = ["join me", "active", "ask me", "busy"] as const;
const locs = [
  `${W(0)}:12345~hidden(usr_1)~region(eu)`,
  `${W(0)}:12345~hidden(usr_1)~region(eu)`,
  `${W(0)}:12345~hidden(usr_1)~region(eu)`,
  `${W(1)}:555~region(us)`,
  `${W(1)}:555~region(us)`,
  `${W(3)}:7777~private(usr_2)~canRequestInvite`,
  "private",
  `${W(2)}:9~group(grp_x)~groupAccessType(public)`,
  "traveling",
];

const friends: VrcUser[] = names.map((displayName, i) => {
  const state = i < 9 ? "online" : i < 12 ? "active" : "offline";
  return {
    id: `usr_${i}`,
    displayName,
    state,
    status: statuses[i % 4],
    statusDescription: ["vibing", "", "afk for a bit", "in a meeting", "", "come say hi!"][i % 6],
    location: state === "online" ? locs[i] : "offline",
    $worldName: state === "online" && locs[i].startsWith("wrld_") ? worlds[Number(locs[i][12])].name : undefined,
    $locationAt: now - (i + 1) * 13 * 60000,
    currentAvatarThumbnailImageUrl: img(displayName, 200, 150),
    currentAvatarImageUrl: img(displayName, 1200, 900),
    tags: [["system_trust_veteran"], ["system_trust_trusted"], ["system_trust_known"], ["system_trust_basic"]][i % 4],
    last_platform: i % 3 ? "standalonewindows" : "android",
    last_login: new Date(now - i * 3600000 * 5).toISOString(),
    bio: "Mostly here for the late-night world hopping.\nSay hi!",
    pronouns: ["she/her", "he/him", "they/them", ""][i % 4],
  };
});

const me = {
  id: "usr_me",
  displayName: "You",
  status: "join me",
  statusDescription: "exploring",
  currentAvatarThumbnailImageUrl: img("me", 200, 150),
  $location: locs[0],
  allowAvatarCopying: false,
  isBoopingEnabled: true,
  receiveMobileInvitations: true,
  hasDiscordFriendsOptOut: false,
} as Record<string, unknown>;

const kinds = ["gps", "online", "status", "avatar", "offline", "gps", "friend"] as const;
const feed: FeedEntry[] = Array.from({ length: 60 }, (_, i) => {
  const f = friends[i % 12];
  const kind = kinds[i % kinds.length];
  return {
    id: 1000 - i,
    ts: now - i * 23 * 60000,
    kind,
    userId: f.id,
    displayName: f.displayName,
    location: kind === "gps" || kind === "online" ? locs[i % 5] : null,
    worldName: kind === "gps" || kind === "online" ? worlds[Number(locs[i % 5][12])].name : null,
    prev: kind === "status" ? JSON.stringify({ status: "active", description: "" }) : kind === "avatar" ? img("a" + i, 64, 64) : null,
    next: kind === "status" ? JSON.stringify({ status: "busy", description: "do not disturb" }) : kind === "avatar" ? img("b" + i, 64, 64) : null,
  };
});

// Bio/status edits written with VRChat's look-alike punctuation, as the API returns them.
feed.unshift(
  {
    id: 2001, ts: now - 60_000, kind: "bio", userId: friends[3].id, displayName: friends[3].displayName,
    prev: ["Celibate and Aromantic․ I won't date you‚ but I will likely just give you what you want․", "", "AI Art‚ Music and Voice․", "", "Gift VRC＋？"].join("\n"),
    next: ["Celibate and Aromantic․ I won't date you‚ but I'll probably give you what you want․", "", "AI Art‚ Music and Voice˸ all locally generated․", "", "Gift VRC＋？", "Discord˸ ［ask me］"].join("\n"),
  },
  {
    id: 2002, ts: now - 120_000, kind: "status", userId: friends[4].id, displayName: friends[4].displayName,
    prev: JSON.stringify({ status: "join me", description: "Peekaboo ˸3" }),
    next: JSON.stringify({ status: "ask me", description: "Peekaboo ˸3 ［afk］" }),
  },
  { id: 2003, ts: now - 180_000, kind: "bio", userId: friends[5].id, displayName: friends[5].displayName, prev: "", next: "Hi there ǃ New here․" },
);

/** People in the game log who aren't friends; the last two predate VRChat logging user ids. */
const strangers: { id?: string; displayName: string }[] = names.slice(0, 7).map((n, i) => ({ id: i < 5 ? `usr_s${i}` : undefined, displayName: `${n}Stranger${i}` }));
const strangerBrief = (id: string) => {
  const s = strangers.find((x) => x.id === id);
  return s && { id, displayName: s.displayName, currentAvatarThumbnailImageUrl: img("stranger" + id, 128, 128), tags: ["system_trust_known"] };
};

const sessions: GlSession[] = Array.from({ length: 12 }, (_, i) => ({
  id: i,
  ts: now - i * 3 * 3600000,
  location: `${W(i % 8)}:${100 + i}~region(us)`,
  worldId: W(i % 8),
  worldName: worlds[i % 8].name,
  durationMs: (20 + i * 11) * 60000,
  players: [...friends.slice(0, 3 + (i % 5)), ...strangers.slice(i % 3, 4 + (i % 3))].map((f, j) => ({ userId: f.id ?? null, displayName: f.displayName, joinedTs: now - i * 3 * 3600000 + j * 60000, leftTs: now - i * 3 * 3600000 + (j + 15) * 60000 })),
  videos: i % 3 === 0 ? [{ ts: now - i * 3 * 3600000 + 600000, url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }] : [],
}));

let mockWatched: string[] = ["usr_2"];
// Your moderations: Pixel's voice is muted.
let mockModerations: { id: string; type: string; targetUserId: string }[] = [{ id: "pmod_1", type: "mute", targetUserId: "usr_2" }];
// Groups you own (grp_0, grp_2), with roles, posts, bans and instances that change as you manage them.
const OWNED_GROUPS = ["grp_0", "grp_2"];
const mockRoles = [
  { id: "r1", name: "Owner", order: 0, permissions: ["*"], isManagementRole: true },
  { id: "r2", name: "Moderator", order: 1, permissions: ["group-members-remove", "group-bans-manage", "group-announcement-manage", "group-instance-manage", "group-members-viewall"], isManagementRole: true },
  { id: "r3", name: "Member", order: 2, permissions: ["group-instance-join"] },
];
const mockPermissions = [
  ["group-announcement-manage", "Manage Group Posts", "Create and delete group posts", true],
  ["group-bans-manage", "Manage Group Bans", "Ban and unban people from the group", true],
  ["group-members-remove", "Remove Group Members", "Kick members out of the group", true],
  ["group-members-viewall", "View All Members", "See the full member list", false],
  ["group-instance-manage", "Manage Group Instances", "Close group instances", true],
  ["group-instance-join", "Join Group Instances", "Join instances owned by the group", false],
].map(([name, displayName, help, isManagementPermission]) => ({ name, displayName, help, isManagementPermission }));
const mockGroupPatch: Record<string, object> = {};
const mockMemberRoles: Record<string, string[]> = {};
let mockKicked: string[] = [];
let mockBans: { id: string; bannedAt: string; user: { id: string; displayName: string; iconUrl?: string } }[] = [
  { id: "gb_0", bannedAt: new Date(now - 5 * 86400000).toISOString(), user: { id: "usr_s9", displayName: "Grifter", iconUrl: img("grifter", 64, 64) } },
];
let mockRequests = ["Starling", "Moss", "Tidewalker"].map((name, i) => ({
  id: `gmr_${i}`,
  createdAt: new Date(now - (i + 1) * 3 * 3600000).toISOString(),
  user: { id: `usr_r${i}`, displayName: name, iconUrl: img(`req${i}`, 64, 64) },
}));
let mockPosts = [
  { id: "gpst_1", title: "Movie night Friday!", text: "Join us in Movie & Chill at 9pm.", createdAt: new Date(now - 86400000).toISOString(), imageUrl: img("post", 300, 200), visibility: "group" },
];
let mockGroupInstances = [{ instanceId: "4242~group(grp_1)~groupAccessType(public)", location: `${W(3)}:4242~group(grp_1)~groupAccessType(public)`, memberCount: 12, world: worlds[3] }];
const mockRefreshed = new Map<string, number>();
// "Spooky" (avatars3) is full, to exercise the per-list cap.
let mockAvatarFavs: { id: string; favoriteId: string; tags: string[]; type?: string }[] = [
  ...["usr_0", "usr_3", "usr_10"].map((id, i) => ({ id: `fvrt_f${i}`, favoriteId: id, tags: ["group_0"], type: "friend" })),
  ...Array.from({ length: 100 }, (_, i) => ({ id: `fvrt_w${i}`, favoriteId: `wrld_x${i}`, tags: ["worlds4"], type: "world" })),
  { id: "fvrt_a0", favoriteId: "avtr_0", tags: ["avatars1"] },
  ...Array.from({ length: 50 }, (_, i) => ({ id: `fvrt_s${i}`, favoriteId: `avtr_x${i}`, tags: ["avatars3"] })),
];

export function installMock() {
  mockWindows("main");
  mockIPC(
    (cmd, args) => {
      const a = (args ?? {}) as Record<string, unknown>;
      switch (cmd) {
        case "auth_restore":
          setTimeout(() => {
            emit("session:ready");
            emit("pipeline:status", true);
          }, 400);
          return { kind: "ok", user: me };
        case "auth_login":
          return { kind: "twoFactor", methods: ["totp", "otp"] };
        case "accounts_list":
          return [{ id: "usr_me", displayName: "You", username: "you@example.com", thumbnail: img("me", 64, 64) }];
        case "friends_list":
          return { friends, favorites: ["usr_0", "usr_3", "usr_10"] };
        case "gamelog_current":
          return {
            location: locs[0],
            worldName: worlds[0].name,
            since: now - 47 * 60000,
            players: [me, ...friends.slice(0, 3), ...strangers].map((f, i) => ({
              userId: f.id ?? null,
              displayName: f.displayName,
              joinedTs: now - (40 - i * 4) * 60000,
            })),
          };
        case "world_get":
          return worlds.find((w) => w.id === a.worldId) ?? worlds[0];
        case "users_brief": {
          // Half are known already; the rest "arrive" later, like the backend's background lookups.
          const ids = (a.ids as string[]).filter((id) => strangerBrief(id));
          setTimeout(() => ids.filter((_, i) => i % 2).forEach((id) => emit("user:brief", strangerBrief(id))), 1500);
          return Object.fromEntries(ids.filter((_, i) => i % 2 === 0).map((id) => [id, strangerBrief(id)]));
        }
        case "user_get":
          return friends.find((f) => f.id === a.userId) ?? friends[0];
        case "instance_get":
          return { id: a.location, worldId: W(0), n_users: 14, capacity: 32 };
        case "worlds_list":
        case "worlds_search":
          return worlds;
        case "avatar_discover": {
          const mk = (i: number, name: string, author: string, compat: string[], pc: string, quest: string, tags: string[], extra: object = {}) => ({
            vrc_id: `avtr_d${i}`, name, author: { name: author, vrc_id: `usr_${i}` }, compatibility: compat,
            image_url: img("disc" + i, 300, 400), performance: { pc_rating: pc, android_rating: quest, ios_rating: quest, has_impostor: i % 2 === 0 },
            tags: { content_tags: [], non_content_tags: [], author_tags: tags }, explicit: false, ...extra,
          });
          const all = [
            mk(0, "Protogen Nova", "SynthLab", ["pc", "android", "ios"], "Good", "Medium", ["protogen", "furry"]),
            mk(1, "Neon Proto", "SynthLab", ["pc"], "VeryPoor", "", ["protogen", "cyberpunk"]),
            mk(2, "Fox Courier", "Kitavali", ["pc", "android"], "Excellent", "Good", ["fox", "furry"]),
            mk(3, "Midnight Rogue", "ShadeWorks", ["pc", "android", "ios"], "Medium", "Poor", ["goth"], { explicit: true, tags: { content_tags: ["content_sex"], non_content_tags: [], author_tags: ["goth"] } }),
            mk(4, "Tiny Protogen", "PocketMods", ["pc", "android", "ios"], "Excellent", "Excellent", ["protogen", "chibi"]),
          ];
          return { avatars: (a.page as number) > 0 ? [] : all, has_more: false };
        }
        case "favorite_groups":
          return a.kind === "avatar"
            ? [1, 2, 3].map((i) => ({ id: `fvgrp_${i}`, name: `avatars${i}`, displayName: ["Favorites", "Cute", "Spooky"][i - 1], type: "avatar" }))
            : a.kind === "friend"
              ? [0, 1, 2].map((i) => ({ id: `fvgrp_f${i}`, name: `group_${i}`, displayName: ["Besties", "Event crew", "Group 3"][i], type: "friend" }))
              : a.kind === "world"
              ? [1, 2, 3, 4].map((i) => ({ id: `fvgrp_w${i}`, name: `worlds${i}`, displayName: ["Worlds I Visit", "Horror", "Games", "Photos"][i - 1], type: "world" }))
              : [{ id: "fvgrp_v1", name: "vrcPlusWorlds1", displayName: "vrcPlusWorlds1", type: "vrcPlusWorld" }];
        case "favorites_of":
          return mockAvatarFavs.filter((f) => (f.type ?? "avatar") === a.kind);
        case "favorite_add":
          mockAvatarFavs = [...mockAvatarFavs, { id: `fvrt_${Date.now()}`, favoriteId: String(a.id), tags: [String(a.list)], type: String(a.kind) }];
          if (a.kind === "friend") emit("favorites:update", mockAvatarFavs.filter((f) => f.type === "friend").map((f) => f.favoriteId));
          return null;
        case "favorite_remove":
          mockAvatarFavs = mockAvatarFavs.filter((f) => f.id !== a.favoriteId);
          if (a.kind === "friend") emit("favorites:update", mockAvatarFavs.filter((f) => f.type === "friend").map((f) => f.favoriteId));
          return null;
        case "avatar_favorites":
          return mockAvatarFavs;
        case "avatar_favorite_add":
          mockAvatarFavs = [...mockAvatarFavs, { id: `fvrt_${Date.now()}`, favoriteId: String(a.avatarId), tags: [String(a.list)] }];
          return null;
        case "avatar_favorite_remove":
          mockAvatarFavs = mockAvatarFavs.filter((f) => f.id !== a.favoriteId);
          return null;
        case "seen_avatars":
          return String(a.userId) === "usr_1"
            ? [
                { name: "Kitsune Mk.II", times: 7, firstSeen: now - 20 * 86400000, lastSeen: now - 3600000, lastLocation: locs[0] },
                { name: "Cozy Sweater Fox", times: 2, firstSeen: now - 6 * 86400000, lastSeen: now - 2 * 86400000, lastLocation: locs[3] },
                { name: "Robot (Halloween)", times: 1, firstSeen: now - 30 * 86400000, lastSeen: now - 30 * 86400000, lastLocation: null },
              ]
            : [];
        case "avatar_get": {
          const i = Number(String(a.avatarId).split("_")[1]) || 0;
          return {
            id: a.avatarId, name: `${names[i] ?? "Clarissa"} Fox`, authorId: "usr_5", authorName: "Okami",
            description: "A fluffy fox with toggles for hats, glasses and a tail wag.",
            imageUrl: img("av" + (names[i] ?? "x"), 900, 1200), thumbnailImageUrl: img("av" + (names[i] ?? "x"), 300, 400),
            releaseStatus: i % 3 ? "private" : "public", version: 17, featured: i === 0, searchable: true,
            created_at: "2024-05-15T18:51:25.758Z", updated_at: "2025-12-13T23:51:26.553Z",
            performance: { standalonewindows: "Medium", android: "VeryPoor" },
            unityPackages: [
              { platform: "standalonewindows", performanceRating: "Medium", unityVersion: "2022.3.22f1" },
              { platform: "android", performanceRating: "VeryPoor", unityVersion: "2022.3.22f1" },
            ],
            tags: ["content_horror", "author_tag_fox", "author_tag_cute"],
            styles: { primary: "Furry", secondary: "Anime" },
          };
        }
        case "avatars_list":
          return names.slice(0, 10).map((n, i) => ({ id: `avtr_${i}`, name: `${n} Fox`, authorName: "Okami", thumbnailImageUrl: img("av" + n, 300, 400), releaseStatus: i % 3 ? "private" : "public", created_at: new Date(now - i * 9e8).toISOString(), updated_at: new Date(now - ((i * 7) % 10) * 8e7).toISOString(),
            // VRChat sometimes sends list fields in other shapes; keep a few here so the UI stays tolerant.
            unityPackages: i === 1 ? {} : i === 2 ? "standalonewindows" : [{ platform: "standalonewindows" }, ...(i % 2 ? [] : [{ platform: "android" }])] }));
        case "users_search": {
          const strangers = ["Starling", "Moss", "Tidewalker", "Lantern", "Quokka"].map((name, i) => ({
            id: `usr_s${i}`,
            displayName: `${name}${String(a.query ?? "").slice(0, 3)}`,
            statusDescription: ["hi!", "", "making worlds", "afk", ""][i],
            tags: i % 2 ? ["system_trust_known"] : ["system_trust_veteran"],
            last_platform: i % 2 ? "android" : "standalonewindows",
            currentAvatarThumbnailImageUrl: img(`s${i}`, 128, 128),
          }));
          return [...friends.slice(0, 2), ...strangers];
        }
        case "feed_query":
          return (a.query as { before?: number }).before ? [] : feed;
        case "gamelog_sessions":
          {
            const before = (a.query as { before?: number }).before;
            // Pages of 30: a cursor inside the list returns what's older than it.
            return before ? sessions.filter((s) => s.ts < before).slice(0, 30) : sessions;
          }
        case "gamelog_events":
          return [];
        case "notifications_list":
          return [
            { id: "n1", type: "invite", senderUserId: "usr_1", senderUsername: "Kitsune", details: { worldId: locs[0], worldName: "The Black Cat" }, created_at: new Date(now - 300000).toISOString() },
            { id: "ntf_b1", type: "boop", v2: true, senderUserId: "usr_2", senderUsername: "Pixel", details: { imageUrl: null }, created_at: new Date(now - 60000).toISOString() },
            { id: "n2", type: "friendRequest", senderUserId: "usr_19", senderUsername: "Marlowe", created_at: new Date(now - 7200000).toISOString() },
          ];
        case "user_history":
          return { feed: feed.slice(0, 8), encounters: 23, timeTogetherMs: 31 * 3600000, lastSeen: now - 86400000, friendAdded: now - 200 * 86400000, recent: sessions.slice(0, 5).map((s) => ({ ts: s.ts + 60000, durationMs: s.durationMs, location: s.location, worldName: s.worldName, sessionTs: s.ts })) };
        case "profile_get": {
          const f = friends.find((x) => x.id === a.userId);
          return {
            id: a.userId,
            displayName: f?.displayName ?? "You",
            bio: a.userId === "usr_1" ? "Long word test: " + "aaaaaaaaaa".repeat(30) : "Mostly here for the late-night world hopping. Say hi!",
            bioLinks: a.userId === "usr_1"
              ? ["https://according.to.all.known.laws.of.aviation.there.is.no.way.a.bee.should.be.able.to.fly.its.wings.are.too.small.to.get.its.fat.little.body.off.the.ground.example.com/", "https://discord.gg/example"]
              : ["https://twitch.tv/example", "https://discord.gg/example"],
            badges: [1, 2, 3].map((i) => ({ badgeId: `bdg_${i}`, badgeDescription: `Badge ${i}`, badgeImageUrl: img("badge" + i, 64, 64), showcased: i === 1 })),
            languages: ["eng", "jpn"],
            iconFrame: "invt_f2",
            nameplateEffect: "invt_n1",
            hasVrcPlus: true,
            ageVerificationStatus: "18+",
            bannerUrl: img("banner" + a.userId, 900, 300),
            representedGroup: { groupId: "grp_1", name: "Verified Goth", shortCode: "GOTH", discriminator: "0001", memberCount: 9, iconUrl: img("grp", 64, 64), bannerUrl: img("grpb", 600, 200) },
          };
        }
        case "user_groups":
          return [0, 1, 2, 3].map((i) => ({
            groupId: `grp_${i}`, name: ["Verified Goth", "Night Owls", "Movie Club", "Builders"][i], memberCount: 100 * (i + 1), iconUrl: img("g" + i, 64, 64), isRepresenting: i === 0, mutualGroup: i % 2 === 1,
            // You own grp_0 and grp_2; anyone else owns their grp_1.
            ownerId: a.userId === "usr_me" ? (OWNED_GROUPS.includes(`grp_${i}`) ? "usr_me" : "usr_5") : i === 1 ? a.userId : "usr_5",
          }));
        case "user_mutuals":
          return { counts: { friends: 3, groups: 2 }, friends: friends.slice(0, 3) };
        case "user_worlds":
          return worlds.slice(0, 3);
        case "group_get": {
          const owned = OWNED_GROUPS.includes(String(a.groupId));
          return {
            id: a.groupId, name: "Verified Goth", shortCode: "GOTH", discriminator: "0001", isVerified: true,
            description: "A cozy community for late-night hangouts.", rules: "Be kind. 18+ only.", links: ["https://discord.gg/example"], languages: ["eng"],
            memberCount: 1270, onlineMemberCount: 104, ownerId: owned ? "usr_me" : "usr_0", joinState: "open", membershipStatus: "member",
            myMember: { permissions: owned ? ["*"] : ["group-members-viewall"] },
            createdAt: "2024-02-04T18:23:56.673Z", iconUrl: img("grp", 128, 128), bannerUrl: img("grpb", 900, 300),
            roles: mockRoles.map(({ id, name, order }) => ({ id, name, order })),
            ...mockGroupPatch[String(a.groupId)],
          };
        }
        case "group_update":
          mockGroupPatch[String(a.groupId)] = { ...mockGroupPatch[String(a.groupId)], ...(a.patch as object) };
          return { id: a.groupId, ...mockGroupPatch[String(a.groupId)] };
        case "group_post_create":
          mockPosts = [{ id: `gpst_${Date.now()}`, title: String(a.title), text: String(a.text), createdAt: new Date().toISOString(), imageUrl: null as unknown as string, visibility: String(a.visibility) }, ...mockPosts];
          return mockPosts[0];
        case "group_post_delete":
          mockPosts = mockPosts.filter((p) => p.id !== a.postId);
          return null;
        case "group_roles":
          return mockRoles;
        case "group_permissions":
          return mockPermissions;
        case "group_member_get": {
          const f = friends.find((x) => x.id === a.userId);
          const i = friends.indexOf(f!);
          return { id: `gm_${i}`, roleIds: mockMemberRoles[String(a.userId)] ?? [i < 3 ? "r2" : "r3"], joinedAt: new Date(now - (i + 2) * 30 * 86400000).toISOString(), user: { id: a.userId, displayName: f?.displayName ?? "Someone" } };
        }
        case "group_member_role": {
          const uid = String(a.userId);
          const i = friends.findIndex((x) => x.id === uid);
          const cur = mockMemberRoles[uid] ?? [i < 3 ? "r2" : "r3"];
          mockMemberRoles[uid] = a.add ? [...new Set([...cur, String(a.roleId)])] : cur.filter((r) => r !== a.roleId);
          return mockMemberRoles[uid];
        }
        case "group_member_kick":
          mockKicked = [...mockKicked, String(a.userId)];
          return null;
        case "group_bans":
          return mockBans;
        case "moderations_of":
          return mockModerations.filter((m) => m.targetUserId === a.userId);
        case "moderation_set": {
          const opposite: Record<string, string> = { mute: "unmute", muteChat: "unmuteChat", hideAvatar: "showAvatar" };
          mockModerations = mockModerations.filter((m) => !(m.targetUserId === a.userId && (m.type === a.kind || m.type === opposite[String(a.kind)])));
          if (a.on) mockModerations.push({ id: `pmod_${Date.now()}`, type: String(a.kind), targetUserId: String(a.userId) });
          if (a.on && a.kind === "block") setTimeout(() => emit("friend:remove", a.userId), 300);
          return { vrchatRunning: true };
        }
        case "friend_remove":
          setTimeout(() => emit("friend:remove", a.userId), 100);
          return null;
        case "group_requests":
          return OWNED_GROUPS.includes(String(a.groupId)) ? mockRequests : [];
        case "group_request_respond":
          mockRequests = mockRequests.filter((r) => r.user.id !== a.userId);
          return null;
        case "group_ban": {
          const f = friends.find((x) => x.id === a.userId);
          mockKicked = [...mockKicked, String(a.userId)];
          mockBans = [{ id: `gb_${Date.now()}`, bannedAt: new Date().toISOString(), user: { id: String(a.userId), displayName: f?.displayName ?? "Someone", iconUrl: f?.currentAvatarThumbnailImageUrl } }, ...mockBans];
          return null;
        }
        case "group_unban":
          mockBans = mockBans.filter((b) => b.user.id !== a.userId);
          mockKicked = mockKicked.filter((id) => id !== a.userId);
          return null;
        case "group_instance_create": {
          const r = a.req as { worldId: string; access: string; region: string };
          const num = Math.floor(10000 + Math.random() * 89999);
          const instanceId = `${num}~group(${a.groupId})~groupAccessType(${r.access})~region(${r.region})`;
          const location = `${r.worldId}:${instanceId}`;
          mockGroupInstances = [...mockGroupInstances, { instanceId, location, memberCount: 0, world: worlds.find((w) => w.id === r.worldId) ?? worlds[0] }];
          return { id: location, location, worldId: r.worldId, instanceId };
        }
        case "instance_create": {
          const owner: Record<string, string> = { "friends+": "~hidden(usr_me)", friends: "~friends(usr_me)", "invite+": "~private(usr_me)~canRequestInvite", invite: "~private(usr_me)" };
          const instanceId = `${Math.floor(10000 + Math.random() * 89999)}${owner[String(a.access)] ?? ""}~region(${a.region})`;
          const location = `${a.worldId}:${instanceId}`;
          return { id: location, location, worldId: a.worldId, instanceId };
        }
        case "instance_close":
          mockGroupInstances = mockGroupInstances.filter((i) => i.location !== a.location);
          return null;
        case "groups_search": {
          const qq = String(a.query).toLowerCase();
          const all = [
            { id: "grp_10", name: "Night Owls Society", shortCode: "OWLS", discriminator: "1234", memberCount: 15230, description: "Late night hangouts for everyone.", tags: ["admin_verified"] },
            { id: "grp_11", name: "Owl Pixel Art", shortCode: "PIXEL", discriminator: "0042", memberCount: 820, description: "Make pixel art together.", membershipStatus: "requested" },
            { id: "grp_12", name: "Tiny Owls", shortCode: "TINY", discriminator: "0007", memberCount: 45, description: "" },
            { id: "grp_1", name: "Night Owls", shortCode: "NOWL", discriminator: "0001", memberCount: 200, description: "Your group.", membershipStatus: "member" },
          ].map((g) => ({ ...g, iconUrl: img(g.id, 128, 128), bannerUrl: img(g.id + "b", 600, 200) }));
          return (a.offset as number) > 0 ? [] : all.filter((g) => g.name.toLowerCase().includes(qq) || g.shortCode.toLowerCase().includes(qq));
        }
        case "group_join":
          return { membershipStatus: String(a.groupId) === "grp_12" ? "requested" : "member" };
        case "group_leave":
        case "group_cancel_request":
          return null;
        case "my_group_instances": {
          const gi = (w: number, num: number, grp: number, acc: string, region: string, n: number, cap: number, extra: object = {}) => ({
            instanceId: `${num}~group(grp_${grp})~groupAccessType(${acc})~region(${region})`,
            location: `${W(w)}:${num}~group(grp_${grp})~groupAccessType(${acc})~region(${region})`,
            ownerId: `grp_${grp}`, groupAccessType: acc, region, n_users: n, capacity: cap, full: n >= cap,
            platforms: { standalonewindows: Math.ceil(n * 0.7), android: Math.floor(n * 0.3), ios: 0 },
            world: { ...worlds[w], unityPackages: w % 2 ? [{ platform: "standalonewindows" }] : [{ platform: "standalonewindows" }, { platform: "android" }] },
            ...extra,
          });
          return [
            gi(0, 12345, 0, "plus", "eu", 14, 32),
            gi(1, 2222, 0, "public", "us", 31, 32),
            gi(2, 3333, 1, "members", "use", 8, 40, { ageGate: true }),
            gi(3, 4444, 2, "plus", "us", 40, 40, { queueSize: 3 }),
            gi(4, 5555, 3, "public", "jp", 5, 24, { roleRestricted: true }),
            gi(5, 6666, 1, "plus", "use", 22, 64, { ageGate: true }),
          ];
        }
        case "my_group_instances_refresh":
          return { refreshed: true, retryInMs: 30_000 };
        case "group_members_search":
          return friends.filter((f) => f.displayName.toLowerCase().includes(String(a.query).toLowerCase())).map((f, i) => ({ id: `gs_${i}`, roleIds: ["r3"], user: { id: f.id, displayName: f.displayName, iconUrl: f.currentAvatarThumbnailImageUrl } }));
        case "group_posts":
          return { posts: mockPosts, total: mockPosts.length };
        case "group_instances":
          return mockGroupInstances;
        case "group_members": {
          if ((a.offset as number) > 0) return [];
          const owned = OWNED_GROUPS.includes(String(a.groupId));
          const people = friends.slice(0, 12).filter((f) => !mockKicked.includes(f.id));
          const list = people.map((f) => {
            const i = friends.indexOf(f);
            return { id: `gm_${i}`, roleIds: mockMemberRoles[f.id] ?? [!owned && i === 0 ? "r1" : i < 3 ? "r2" : "r3"], user: { id: f.id, displayName: f.displayName, iconUrl: f.currentAvatarThumbnailImageUrl } };
          });
          return owned ? [{ id: "gm_me", roleIds: ["r1"], user: { id: "usr_me", displayName: "You", iconUrl: img("me", 64, 64) } }, ...list] : list;
        }
        case "avatar_lists":
          return [1, 2, 3].map((i) => ({ id: `fvgrp_${i}`, name: `avatars${i}`, displayName: ["Favorites", "Cute", "Spooky"][i - 1], type: "avatar", visibility: "private" }));
        case "inventory_all": {
          const mk = (id: string, name: string, itemType: string, extra: object = {}) => ({ id, name, itemType, imageUrl: img(id, 300, 300), flags: ["instantiatable"], equipSlots: [], equipSlot: "", isArchived: false, expiryDate: null, ...extra });
          const eq = (slot: string, on = false) => ({ flags: ["equippable", "instantiatable"], equipSlots: [slot], equipSlot: on ? slot : "" });
          return [
            mk("inv_f1", "Reference Cube", "iconFrame", { ...eq("iconFrame"), templateId: "invt_f1" }),
            mk("inv_f2", "Tidal Pool", "iconFrame", { ...eq("iconFrame"), templateId: "invt_f2" }),
            mk("inv_f3", "Crown of Vines", "iconFrame", { ...eq("iconFrame"), templateId: "invt_f3" }),
            mk("inv_f4", "Archived Frame", "iconFrame", { ...eq("iconFrame"), templateId: "invt_f4", isArchived: true }),
            mk("inv_n1", "Tidal Flows", "nameplateEffect", { ...eq("nameplateEffect"), templateId: "invt_n1" }),
            mk("inv_n2", "Molten Mantle", "nameplateEffect", { ...eq("nameplateEffect"), templateId: "invt_n2" }),
            mk("inv_e1", "Reference Cube Purple", "profileEffect", { ...eq("profileEffect"), templateId: "invt_e1" }),
            mk("inv_e2", "Starfall", "profileEffect", { ...eq("profileEffect"), templateId: "invt_e2" }),
          ];
        }
        case "prints_list":
          return [1, 2, 3].map((i) => ({ id: `prnt_${i}`, note: ["Sunset crew", "", "Movie night"][i - 1], worldName: worlds[i].name, worldId: worlds[i].id, timestamp: new Date(now - i * 86400000).toISOString(), files: { image: img("print" + i, 800, 600) } }));
        case "files_list":
          return [1, 2, 3, 4, 5, 6].map((i) => ({ id: `file_0000000${i}-aaaa-bbbb-cccc-00000000000${i}`, name: "img", tags: i === 2 && String(a.tag).includes("emoji") ? ["emojianimated"] : [], versions: [{ version: 1 }] }));
        case "icons_list":
          return [1, 2, 3, 4].map((i) => ({ id: `file_0000000${i}-aaaa-bbbb-cccc-000000000000`, name: "icon", versions: [{ version: 1 }] }));
        case "profile_update":
          return { id: "usr_me", displayName: "You", ...(a.patch as object) };
        case "photo_dir_get":
          return { current: "S:/VRChat/", default: "C:/Users/you/Pictures/VRChat" };
        case "ugc_dir_get":
          return { current: null, default: "C:/Users/you/Pictures/Nexus" };
        case "balance_get":
          return { balance: 101 };
        case "memo_get":
          return "";
        case "insights_get": {
          const days = a.days as number;
          return {
            totalPlayMs: days * 2.6 * 3600000,
            sessions: days * 4,
            uniqueWorlds: 37,
            uniquePlayers: 812,
            daily: Array.from({ length: days }, (_, i) => ({ date: new Date(now - (days - 1 - i) * 86400000).toISOString().slice(0, 10), ms: Math.max(0, Math.sin(i / 2) + 1.2) * 1.4 * 3600000 * (i % 7 > 4 ? 1.8 : 1) })),
            heatmap: Array.from({ length: 7 }, (_, d) => Array.from({ length: 24 }, (_, h) => (h >= 19 || h < 2 ? Math.round(30 + 25 * Math.sin(d + h)) + (d > 4 ? 20 : 0) : h > 13 && d > 4 ? 15 : 0))),
            topWorlds: worlds.slice(0, 6).map((w, i) => ({ worldId: w.id, worldName: w.name, ms: (30 - i * 4) * 3600000, visits: 40 - i * 5 })),
            topPeople: friends.slice(0, 8).map((f, i) => ({ userId: f.id, displayName: f.displayName, ms: (20 - i * 2) * 3600000, encounters: 30 - i * 3 })),
            friendsAdded: [{ key: "2026-09-28", count: 3 }],
            feedCounts: [{ key: "gps", count: 420 }, { key: "online", count: 210 }],
          };
        }
        case "settings_get":
          return { notifyOnline: "favorites", notifyOffline: "off", notifyInstanceJoin: "favorites", notifyInvites: true, notifyInviteRequests: true, notifyFriendRequests: true, notifyNewFriends: true, notifyUnfriends: true, notifyBoops: true, minimizeToTray: true, logDir: null, savePrints: true, saveStickers: true, ugcDir: null, discordPresence: true, discordHidePrivate: true, discordJoinButton: false };
        case "discord_status":
          return { state: "showing", details: worlds[0].name };
        case "vrchat_install_get":
          return { current: null, default: "E:\\SteamLibrary\\steamapps\\common\\VRChat", linksOk: false };
        case "boop_user":
        case "vrchat_dir_set":
        case "vrchat_links_repair":
          return null;
        case "default_log_dir":
          return "C:\\Users\\you\\AppData\\LocalLow\\VRChat\\VRChat";
        case "me_update": {
          // Pretend VRChat refuses mobile invitations, to exercise the rollback.
          const t = (a.toggles ?? {}) as Record<string, boolean>;
          if ("receiveMobileInvitations" in t) throw "VRChat didn't apply that setting. Try changing it in VRChat instead.";
          Object.assign(me, t);
          return { ...me };
        }
        case "friends_refresh":
          if (Date.now() - (mockRefreshed.get("friends") ?? 0) < 60_000) return { refreshed: false, retryInMs: 60_000 - (Date.now() - (mockRefreshed.get("friends") ?? 0)) };
          mockRefreshed.set("friends", Date.now());
          return { refreshed: true, retryInMs: 60_000 };
        case "profile_refresh":
        case "entity_refresh": {
          const id = String(a.userId ?? a.id);
          const last = mockRefreshed.get(id) ?? 0;
          if (Date.now() - last < 30_000) return { refreshed: false, retryInMs: 30_000 - (Date.now() - last) };
          mockRefreshed.set(id, Date.now());
          return { refreshed: true, retryInMs: 30_000 };
        }
        case "watch_list":
          return mockWatched;
        case "watch_set": {
          const id = String(a.userId);
          mockWatched = a.on ? [...new Set([...mockWatched, id])] : mockWatched.filter((x) => x !== id);
          return mockWatched;
        }
        case "status_set":
          return { ...me, status: a.status, statusDescription: a.description ?? me.statusDescription };
        case "plugin:autostart|is_enabled":
          return false;
        case "vrcx_detect":
          return { path: "C:/Users/you/AppData/Roaming/VRCX/VRCX.sqlite3", sizeBytes: 29290496, lastImported: null };
        case "vrcx_import":
          return new Promise((r) => setTimeout(() => r({ feed: 47569, worlds: 407, events: 24400, friendDates: 28, memos: 0 }), 900));
        case "plugin:app|version":
          return "1.0.0";
        case "plugin:updater|check":
          return null;
        default:
          return null;
      }
    },
    { shouldMockEvents: true },
  );
}
