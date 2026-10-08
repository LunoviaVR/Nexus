import { invoke as tauriInvoke, type InvokeArgs } from "@tauri-apps/api/core";
import { fixDeep } from "./text";

/** Every response passes through `fixDeep` so VRChat's look-alike punctuation displays normally. */
const invoke = <T>(cmd: string, args?: InvokeArgs) => tauriInvoke<T>(cmd, args).then((r) => fixDeep(r));
import type {
  Account,
  FolderInfo,
  VrchatInstall,
  AppSettings,
  Avatar,
  CurrentUser,
  FeedEntry,
  FeedKind,
  GlEvent,
  GlSession,
  Insights,
  Instance,
  InstanceState,
  LoginResult,
  Status,
  VrcxDetected,
  VrcxSummary,
  UserHistory,
  VrcNotification,
  VrcFile,
  DiscoverAvatar,
  FavoriteGroup,
  InventoryItem,
  VrcPrint,
  ProfilePatch,
  VrcGroup,
  VrcGroupDetail,
  VrcGroupInstance,
  VrcGroupMember,
  VrcGroupPost,
  VrcProfile,
  VrcUser,
  World,
} from "./types";

export type FavoriteKind = "avatar" | "world" | "vrcPlusWorld" | "friend";

export interface FeedQuery {
  kinds?: FeedKind[];
  search?: string;
  userIds?: string[];
  before?: number;
  limit?: number;
}

export interface GlQuery {
  kinds?: string[];
  search?: string;
  before?: number;
  limit?: number;
}

export const ipc = {
  login: (username: string, password: string, remember: boolean) =>
    invoke<LoginResult>("auth_login", { username, password, remember }),
  verify: (method: string, code: string) => invoke<LoginResult>("auth_verify", { method, code }),
  restore: (userId?: string) => invoke<LoginResult>("auth_restore", { userId }),
  logout: () => invoke<void>("auth_logout"),
  accounts: () => invoke<Account[]>("accounts_list"),
  removeAccount: (userId: string) => invoke<void>("account_remove", { userId }),

  me: () => invoke<CurrentUser | null>("me_get"),
  friends: () => invoke<{ friends: VrcUser[]; favorites: string[] }>("friends_list"),
  refreshFriends: () => invoke<{ refreshed: boolean; retryInMs: number }>("friends_refresh"),
  user: (userId: string, force = false) => invoke<VrcUser>("user_get", { userId, force }),
  profile: (userId: string, force = false) => invoke<VrcProfile>("profile_get", { userId, force }),
  updateProfile: (patch: ProfilePatch) => invoke<VrcProfile>("profile_update", { patch }),
  updateMe: (pronouns?: string, toggles?: Partial<Record<"allowAvatarCopying" | "isBoopingEnabled" | "receiveMobileInvitations" | "hasSharedConnectionsOptOut" | "hasDiscordFriendsOptOut", boolean>>) =>
    invoke<CurrentUser>("me_update", { pronouns, toggles }),
  setBadge: (badgeId: string, showcased: boolean) => invoke<void>("badge_set", { badgeId, showcased }),
  representGroup: (groupId: string, representing: boolean) => invoke<void>("group_represent", { groupId, representing }),
  icons: () => invoke<VrcFile[]>("icons_list"),
  uploadIcon: (data: string) => invoke<VrcFile>("icon_upload", { data }),
  refreshProfile: (userId: string) => invoke<{ refreshed: boolean; retryInMs: number }>("profile_refresh", { userId }),
  refreshEntity: (kind: "world" | "group", id: string) =>
    invoke<{ refreshed: boolean; retryInMs: number }>("entity_refresh", { kind, id }),
  userGroups: (userId: string) => invoke<VrcGroup[]>("user_groups", { userId }),
  userMutuals: (userId: string) =>
    invoke<{ counts: { friends?: number; groups?: number }; friends: VrcUser[] }>("user_mutuals", { userId }),
  group: (groupId: string) => invoke<VrcGroupDetail>("group_get", { groupId }),
  groupInstances: (groupId: string) => invoke<VrcGroupInstance[]>("group_instances", { groupId }),
  searchGroups: (query: string, offset = 0) => invoke<VrcGroupDetail[]>("groups_search", { query, offset }),
  joinGroup: (groupId: string) => invoke<{ membershipStatus?: string }>("group_join", { groupId }),
  leaveGroup: (groupId: string) => invoke<void>("group_leave", { groupId }),
  cancelGroupRequest: (groupId: string) => invoke<void>("group_cancel_request", { groupId }),
  myGroupInstances: () => invoke<VrcGroupInstance[]>("my_group_instances"),
  refreshMyGroupInstances: () => invoke<{ refreshed: boolean; retryInMs: number }>("my_group_instances_refresh"),
  groupMembers: (groupId: string, offset = 0) => invoke<VrcGroupMember[]>("group_members", { groupId, offset }),
  searchGroupMembers: (groupId: string, query: string) => invoke<VrcGroupMember[]>("group_members_search", { groupId, query }),
  groupPosts: (groupId: string) => invoke<{ posts: VrcGroupPost[]; total: number }>("group_posts", { groupId }),
  userWorlds: (userId: string) => invoke<World[]>("user_worlds", { userId }),
  setNote: (userId: string, note: string) => invoke<unknown>("user_note_set", { userId, note }),
  balance: () => invoke<{ balance: number }>("balance_get"),
  world: (worldId: string, force = false) => invoke<World>("world_get", { worldId, force }),
  avatar: (avatarId: string) => invoke<Avatar>("avatar_get", { avatarId }),
  instance: (location: string) => invoke<Instance>("instance_get", { location }),
  searchUsers: (query: string) => invoke<VrcUser[]>("users_search", { query }),
  searchWorlds: (query: string, sort?: string) => invoke<World[]>("worlds_search", { query, sort }),
  worlds: (kind: "popular" | "favorites" | "recent" | "mine") => invoke<World[]>("worlds_list", { kind }),
  avatars: (kind: "favorites" | "mine", tag?: string) => invoke<Avatar[]>("avatars_list", { kind, tag }),
  discoverAvatars: (query: string, mode: "any" | "name", page = 0) =>
    invoke<{ avatars: DiscoverAvatar[]; has_more: boolean }>("avatar_discover", { query, mode, page }),
  avatarLists: () => invoke<FavoriteGroup[]>("avatar_lists"),
  favoriteGroups: (kind: FavoriteKind) => invoke<FavoriteGroup[]>("favorite_groups", { kind }),
  favoritesOf: (kind: FavoriteKind) => invoke<{ id: string; favoriteId: string; tags: string[]; type: string }[]>("favorites_of", { kind }),
  addFavorite: (kind: FavoriteKind, id: string, list: string) => invoke<unknown>("favorite_add", { kind, id, list }),
  removeFavorite: (kind: FavoriteKind, favoriteId: string) => invoke<void>("favorite_remove", { kind, favoriteId }),
  avatarFavorites: () => invoke<{ id: string; favoriteId: string; tags: string[] }[]>("avatar_favorites"),
  addAvatarFavorite: (avatarId: string, list: string) => invoke<unknown>("avatar_favorite_add", { avatarId, list }),
  removeAvatarFavorite: (favoriteId: string) => invoke<void>("avatar_favorite_remove", { favoriteId }),
  seenAvatars: (userId: string, displayName: string) =>
    invoke<{ name: string; times: number; firstSeen: number; lastSeen: number; lastLocation?: string | null }[]>("seen_avatars", { userId, displayName }),
  files: (tag: string) => invoke<VrcFile[]>("files_list", { tag }),
  prints: () => invoke<VrcPrint[]>("prints_list"),
  unequip: (slot: string) => invoke<unknown>("inventory_unequip", { slot }),
  inventoryAll: () => invoke<InventoryItem[]>("inventory_all"),
  deleteFromInventory: (kind: "print" | "file", id: string) => invoke<void>("inventory_delete", { kind, id }),
  uploadImage: (
    kind: "icon" | "gallery" | "emoji" | "sticker" | "print",
    data: string,
    options?: { note?: string; animationStyle?: string; maskTag?: string },
  ) => invoke<unknown>("image_upload", { kind, data, options }),
  selectAvatar: (avatarId: string) => invoke<unknown>("avatar_select", { avatarId }),
  toggleFavorite: (userId: string) => invoke<boolean>("favorite_friend_toggle", { userId }),
  watchList: () => invoke<string[]>("watch_list"),
  setWatch: (userId: string, on: boolean) => invoke<string[]>("watch_set", { userId, on }),

  invite: (userId: string) => invoke<void>("invite_user", { userId }),
  requestInvite: (userId: string) => invoke<void>("request_invite", { userId }),
  boop: (userId: string, emojiId?: string) => invoke<void>("boop_user", { userId, emojiId: emojiId ?? null }),
  inviteSelf: (location: string) => invoke<void>("invite_self", { location }),
  launch: (location: string) => invoke<void>("launch_location", { location }),
  openExternal: (url: string) => invoke<void>("open_external", { url }),
  setStatus: (status: Status, description?: string) => invoke<CurrentUser>("status_set", { status, description }),
  friendRequest: (userId: string) => invoke<void>("friend_request", { userId }),
  notifications: () => invoke<VrcNotification[]>("notifications_list"),
  acceptNotification: (id: string) => invoke<void>("notification_accept", { id }),
  hideNotification: (id: string) => invoke<void>("notification_hide", { id }),
  deleteNotificationV2: (id: string) => invoke<void>("notification_v2_delete", { id }),

  feed: (query: FeedQuery) => invoke<FeedEntry[]>("feed_query", { query }),
  sessions: (query: GlQuery) => invoke<GlSession[]>("gamelog_sessions", { query }),
  gamelogEvents: (query: GlQuery) => invoke<GlEvent[]>("gamelog_events", { query }),
  currentInstance: () => invoke<InstanceState>("gamelog_current"),
  userHistory: (userId: string) => invoke<UserHistory>("user_history", { userId }),
  insights: (days: number) => invoke<Insights>("insights_get", { days }),
  memo: (userId: string) => invoke<string>("memo_get", { userId }),
  setMemo: (userId: string, text: string) => invoke<void>("memo_set", { userId, text }),

  settings: () => invoke<AppSettings>("settings_get"),
  saveSettings: (settings: AppSettings) => invoke<void>("settings_set", { settings }),
  defaultLogDir: () => invoke<string | null>("default_log_dir"),
  vrchatInstall: () => invoke<VrchatInstall>("vrchat_install_get"),
  setVrchatDir: (dir: string | null) => invoke<void>("vrchat_dir_set", { dir }),
  repairVrchatLinks: () => invoke<void>("vrchat_links_repair"),
  photoDir: () => invoke<FolderInfo>("photo_dir_get"),
  setPhotoDir: (dir: string | null) => invoke<void>("photo_dir_set", { dir }),
  ugcDir: () => invoke<FolderInfo>("ugc_dir_get"),
  openFolder: (path: string) => invoke<void>("open_folder", { path }),
  downloadImage: (url: string, path: string) => invoke<void>("image_download", { url, path }),
  clearCache: () => invoke<void>("cache_clear"),
  exportCsv: (kind: "feed" | "gamelog" | "worlds" | "friends") => invoke<string>("export_csv", { kind }),
  reveal: (path: string) => invoke<void>("reveal_path", { path }),
  exportDecrypted: (path: string) => invoke<void>("db_export_decrypted", { path }),
  vrcxDetect: () => invoke<VrcxDetected>("vrcx_detect"),
  vrcxImport: (path?: string) => invoke<VrcxSummary>("vrcx_import", { path: path ?? null }),
};

export function errorText(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  return "Something went wrong";
}
