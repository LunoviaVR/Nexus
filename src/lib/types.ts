export type Status = "join me" | "active" | "ask me" | "busy" | "offline";
export type FriendState = "online" | "active" | "offline";

export interface VrcUser {
  id: string;
  displayName: string;
  status?: Status;
  statusDescription?: string;
  state?: FriendState;
  location?: string;
  travelingToLocation?: string;
  bio?: string;
  bioLinks?: string[];
  pronouns?: string;
  tags?: string[];
  currentAvatarImageUrl?: string;
  currentAvatarThumbnailImageUrl?: string;
  profilePicOverride?: string;
  profilePicOverrideThumbnail?: string;
  userIcon?: string;
  iconUrl?: string;
  bannerUrl?: string;
  imageUrl?: string;
  last_platform?: string;
  platform?: string;
  last_login?: string;
  last_activity?: string;
  date_joined?: string;
  isFriend?: boolean;
  developerType?: string;
  note?: string;
  allowAvatarCopying?: boolean;
  ageVerificationStatus?: string;
  currentAvatar?: string;
  homeLocation?: string;
  isBoopingEnabled?: boolean;
  receiveMobileInvitations?: boolean;
  /** Opt-outs: true hides mutual friends / Discord connections. */
  hasSharedConnectionsOptOut?: boolean;
  hasDiscordFriendsOptOut?: boolean;
  pastDisplayNames?: { displayName: string; updated_at: string }[];
  discordDetails?: { global_name?: string; id?: string };
  twitchDetails?: { display_name?: string; login?: string };
  username?: string;
  $locationAt?: number;
  $onlineAt?: number;
  $worldName?: string;
}

export interface CurrentUser extends VrcUser {
  friends?: string[];
  onlineFriends?: string[];
  activeFriends?: string[];
  offlineFriends?: string[];
  username?: string;
  $location?: string;
  $locationAt?: number;
}

export interface VrcBadge {
  badgeId: string;
  badgeName?: string;
  badgeDescription?: string;
  badgeImageUrl?: string;
  showcased?: boolean;
}

export interface VrcGroup {
  id?: string;
  groupId?: string;
  name: string;
  shortCode?: string;
  discriminator?: string;
  description?: string;
  iconUrl?: string | null;
  bannerUrl?: string | null;
  memberCount?: number;
  mutualGroup?: boolean;
  isRepresenting?: boolean;
  ownerId?: string;
}

export interface VrcGroupDetail extends VrcGroup {
  id: string;
  rules?: string;
  links?: string[];
  languages?: string[];
  tags?: string[];
  createdAt?: string;
  isVerified?: boolean;
  joinState?: "open" | "request" | "invite" | "closed" | string;
  privacy?: string;
  membershipStatus?: "member" | "requested" | "invited" | "inactive" | string;
  onlineMemberCount?: number;
  roles?: { id: string; name: string; description?: string; order?: number }[];
  /** Present when you're in the group; `permissions` decide what you may see (e.g. "group-members-viewall"). */
  myMember?: { permissions?: string[]; roleIds?: string[] } | null;
}

export interface VrcGroupMember {
  id: string;
  userId?: string;
  roleIds?: string[];
  joinedAt?: string;
  user: { id: string; displayName: string; iconUrl?: string; thumbnailUrl?: string };
}

export interface VrcGroupInstance {
  instanceId: string;
  location: string;
  memberCount?: number;
  world?: World;
  /** Present on `/users/{me}/instances/groups` results. */
  ownerId?: string;
  displayName?: string | null;
  n_users?: number;
  userCount?: number;
  capacity?: number;
  full?: boolean;
  region?: string;
  groupAccessType?: "public" | "plus" | "members" | string;
  ageGate?: boolean;
  queueSize?: number;
  queueEnabled?: boolean;
  roleRestricted?: boolean;
  platforms?: Record<string, number>;
  languages?: string[];
}

export interface VrcGroupPost {
  id: string;
  title?: string;
  text?: string;
  imageUrl?: string | null;
  createdAt?: string;
  authorId?: string;
}

/** `/profile/{id}`: where bio, links, badges and languages live since VRChat's 2026 API change. */
export interface VrcProfile {
  id: string;
  displayName: string;
  bio?: string;
  bioLinks?: string[];
  badges?: VrcBadge[];
  languages?: string[];
  pronouns?: string;
  bannerUrl?: string;
  iconUrl?: string;
  hasVrcPlus?: boolean;
  ageVerificationStatus?: string;
  representedGroup?: VrcGroup | null;
  themeButtonColor?: string;
  bannerType?: "avatarBanner" | "color" | "customImage" | string;
  /** Equipped cosmetics, as inventory template ids. */
  iconFrame?: string | null;
  nameplateEffect?: string | null;
  profileEffect?: string | null;
  bannerColor?: string;
  userIcon?: string;
  backgroundGradientTop?: string;
  backgroundGradientBottom?: string;
  trustTags?: string[];
}

export interface VrcFile {
  id: string;
  name: string;
  tags?: string[];
  versions: { version: number; status?: string; deleted?: boolean; created_at?: string }[];
}

export interface FavoriteGroup {
  id: string;
  name: string;
  displayName: string;
  type: string;
  visibility?: string;
}

export interface InventoryItem {
  id: string;
  name: string;
  description?: string;
  imageUrl?: string;
  itemType: string;
  itemTypeLabel?: string;
  equipSlots?: string[];
  templateId?: string;
  /** The slot it's currently equipped in ("" when not equipped). */
  equipSlot?: string;
  flags?: string[];
  tags?: string[];
  isArchived?: boolean;
  expiryDate?: string | null;
  userAttributes?: Record<string, unknown>;
  created_at?: string;
}

export interface VrcPrint {
  id: string;
  authorName?: string;
  createdAt?: string;
  timestamp?: string;
  note?: string;
  worldId?: string | null;
  worldName?: string | null;
  files: { fileId?: string; image?: string };
}

export interface ProfilePatch {
  bio?: string;
  bioLinks?: string[];
  languages?: string[];
  userIcon?: string;
  bannerType?: string;
  bannerColor?: string;
  iconFrame?: string;
  nameplateEffect?: string;
  profileEffect?: string;
}

export interface World {
  id: string;
  name: string;
  authorId: string;
  authorName: string;
  description?: string;
  imageUrl?: string;
  thumbnailImageUrl?: string;
  capacity?: number;
  recommendedCapacity?: number;
  occupants?: number;
  publicOccupants?: number;
  privateOccupants?: number;
  favorites?: number;
  visits?: number;
  heat?: number;
  popularity?: number;
  tags?: string[];
  instances?: [string, number][];
  /** One per supported platform (standalonewindows, android, ios). */
  unityPackages?: { platform: string }[];
  releaseStatus?: string;
  created_at?: string;
  updated_at?: string;
}

export interface Avatar {
  id: string;
  name: string;
  authorId: string;
  authorName: string;
  description?: string;
  imageUrl?: string;
  thumbnailImageUrl?: string;
  releaseStatus?: string;
  created_at?: string;
  updated_at?: string;
  unityPackages?: { platform: string; performanceRating?: string; unityVersion?: string; variant?: string; scanStatus?: string }[];
  /** Per-platform rating, e.g. { standalonewindows: "Good", android: "VeryPoor" }. */
  performance?: Record<string, string | number>;
  tags?: string[];
  version?: number;
  featured?: boolean;
  searchable?: boolean;
  styles?: { primary?: string | null; secondary?: string | null };
}

/** A public avatar as indexed by avtrDB. */
export interface DiscoverAvatar {
  vrc_id: string;
  name: string;
  description?: string;
  author: { name: string; vrc_id: string };
  created_at?: string;
  updated_at?: string;
  compatibility?: ("pc" | "android" | "ios" | string)[];
  image_url?: string;
  performance?: { pc_rating?: string; android_rating?: string; ios_rating?: string; has_impostor?: boolean };
  tags?: { content_tags?: string[]; non_content_tags?: string[]; author_tags?: string[] };
  explicit?: boolean;
  styles?: { primary?: string; secondary?: string };
}

export interface Instance {
  id: string;
  location?: string;
  instanceId?: string;
  name?: string;
  displayName?: string | null;
  worldId: string;
  type?: string;
  region?: string;
  ownerId?: string | null;
  n_users?: number;
  userCount?: number;
  capacity?: number;
  queueSize?: number;
  full?: boolean;
  platforms?: Record<string, number>;
  users?: VrcUser[];
}

export interface VrcNotification {
  id: string;
  type: "invite" | "requestInvite" | "friendRequest" | "inviteResponse" | "requestInviteResponse" | "votetokick" | "boop" | string;
  senderUserId: string;
  senderUsername: string;
  message?: string;
  details?: Record<string, unknown> | string;
  created_at: string;
  seen?: boolean;
  /** From VRChat's newer notification system (boops); dismissed differently. */
  v2?: boolean;
}

export type FeedKind = "online" | "offline" | "gps" | "status" | "avatar" | "bio" | "friend" | "unfriend";

export interface FeedEntry {
  id: number;
  ts: number;
  kind: FeedKind;
  userId: string;
  displayName: string;
  location?: string | null;
  worldName?: string | null;
  prev?: string | null;
  next?: string | null;
}

export interface GlEvent {
  id: number;
  ts: number;
  kind: "join" | "leave" | "video" | "avatar";
  userId?: string | null;
  displayName?: string | null;
  location?: string | null;
  data?: string | null;
}

export interface PresenceRow {
  userId?: string | null;
  displayName: string;
  joinedTs: number;
  leftTs?: number | null;
}

export interface GlSession {
  id: number;
  ts: number;
  location: string;
  worldId: string;
  worldName?: string | null;
  durationMs: number;
  players: PresenceRow[];
  videos: { ts: number; url: string }[];
}

export interface Player {
  userId?: string | null;
  displayName: string;
  joinedTs: number;
}

export interface InstanceState {
  location?: string | null;
  worldName?: string | null;
  since?: number | null;
  players: Player[];
}

export interface Encounter {
  ts: number;
  durationMs: number;
  location: string;
  worldName?: string | null;
  /** Start of the Game Log session it belongs to. */
  sessionTs?: number | null;
}

export interface UserHistory {
  feed: FeedEntry[];
  encounters: number;
  timeTogetherMs: number;
  firstSeen?: number | null;
  lastSeen?: number | null;
  friendAdded?: number | null;
  totalPlayMs: number;
  recent: Encounter[];
}

export interface Insights {
  totalPlayMs: number;
  sessions: number;
  uniqueWorlds: number;
  uniquePlayers: number;
  daily: { date: string; ms: number }[];
  heatmap: number[][];
  topWorlds: { worldId: string; worldName?: string | null; ms: number; visits: number }[];
  topPeople: { userId: string; displayName: string; ms: number; encounters: number }[];
  friendsAdded: { key: string; count: number }[];
  feedCounts: { key: string; count: number }[];
}

export type Scope = "off" | "favorites" | "all";

export interface AppSettings {
  notifyOnline: Scope;
  notifyOffline: Scope;
  notifyInstanceJoin: Scope;
  notifyInvites: boolean;
  notifyInviteRequests: boolean;
  notifyFriendRequests: boolean;
  notifyNewFriends: boolean;
  notifyUnfriends: boolean;
  notifyBoops: boolean;
  minimizeToTray: boolean;
  logDir?: string | null;
  vrchatDir?: string | null;
  savePrints: boolean;
  saveStickers: boolean;
  ugcDir?: string | null;
}

export interface FolderInfo {
  current?: string | null;
  default?: string | null;
}

export interface VrchatInstall extends FolderInfo {
  /** Whether Windows can open vrchat:// links. */
  linksOk: boolean;
}

export interface Account {
  id: string;
  displayName: string;
  thumbnail?: string | null;
  username?: string | null;
}

export type LoginResult =
  | { kind: "ok"; user: CurrentUser }
  | { kind: "twoFactor"; methods: string[] }
  | { kind: "loggedOut"; username?: string | null };

export interface VrcxDetected {
  path?: string | null;
  sizeBytes?: number | null;
  lastImported?: number | null;
}

export interface VrcxSummary {
  feed: number;
  worlds: number;
  events: number;
  friendDates: number;
  memos: number;
}

export interface UpdateInfo {
  current: string;
  available?: { version: string; notes?: string | null; date?: string | null } | null;
}
