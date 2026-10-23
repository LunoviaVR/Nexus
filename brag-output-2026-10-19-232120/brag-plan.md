# Brag Plan: Nexus

## What is this app?
Nexus is a free, ~6 MB Windows companion app for VRChat: it shows where your friends are the moment it changes, joins them in one click, and keeps a private, encrypted history of every world you visit and everyone you meet, plus profiles, Game Log, Players, Groups owner tools, Insights and Notifications, all from one small app with no servers of its own.

## Planning rubric
1. **What is it?** A desktop VRChat companion (Tauri 2, Rust + React) that replaces the VRChat website tab and adds a searchable local history.
2. **Funniest / most impressive claim:** "Everything you'd open the VRChat website for. And a lot it can't do." Also: the Game Log "works even when VRChat's API doesn't."
3. **Visual hook:** the live friend cards from the site's hero ("Nova came online · just now", "Aurora joined The Black Cat · Join", "Friends online 23") over the indigo/cyan aurora on `#080b12`.
4. **Real UI to show:** the real screenshots from the website (`website/assets/screens/*.png`, taken from Nexus's built-in demo account): Home, Friends (with a Join menu), Game Log (expanded session), Players, Groups (Owner tools), Insights (heatmap), Notifications.
5. **Shortest satisfying video:** 25 s. The user asked for every important feature, so the middle is a beat-synced feature montage rather than three long highlights.
6. **Tone:** `default` (inferred). Creative direction: "slick TikTok launch reel, phone-first, every feature gets exactly one beat."
7. **Audio:** upbeat bed (bundled `vol-1`, 120 BPM), card/drop sounds on reveals, one click for the Join, one bell for the logo. Subtle audio-reactive glow on the aurora.
8. **Share caption:** see `share-copy.txt`.
9. **User flow worth showing:** open Nexus → see who's online and where → click **Join** on a friend → "Joining Aurora in The Black Cat" → later, the Game Log remembers the session with everyone who was there.

## The angle
"Where are your friends right now?" Nexus answers it live, then proves it has everything else too: history, players, groups, insights, notifications, all private and tiny. The pacing is TikTok-native: one idea per beat, cut on the music, no slide-deck holds.

## Hook (first 2.5 seconds)
Big two-line question, "Where are your friends / **right now?**", while three live cards pop in around it on card sounds: Nova came online, Aurora joined The Black Cat with a **Join** chip, Friends online counting up to 23.

## Key moments (the middle)
- **Join in one click:** Friends page punched in on the Favourites; a cursor rides in, clicks **Join**, the chip reads "Joining…" and a toast says "Joining Aurora in The Black Cat".
- **It remembers:** Game Log punched in on the expanded *Movie & Chill* session: player list with durations, timeline of joins.
- **Feature montage, one beat each (1.5 s):** Players ("Everyone in your instance, live"), Groups ("Owner tools: posts, instances, requests, bans"), Insights ("Hours played, when you play"), Notifications ("Invites, friend requests, boops").
- **Trust checks:** Private & encrypted on your PC · About 6 MB · Free & open source, then an "Also:" line: Worlds · Avatars · Inventory · Feed · Discord status · Ctrl+K.

## Outro / punchline
Nexus icon locks in on the strong beat, "Nexus", "Your VRChat friends, live.", a **Download for Windows** button that presses itself on the next strong beat, `nexus.gxthgirls.tech`.

## User flow worth showing
Entry: Home ("9 of your 20 friends are in VRChat right now") → key action: click Join on Aurora's card → result: "Joining Aurora in The Black Cat" toast; later the Game Log session with its player list.

## Tone
- Preset: default
- Creative direction: slick TikTok launch reel; phone-first; every feature gets exactly one beat
- Interpretation: snappy entrances (0.3–0.5 s), cuts on the 120 BPM grid, big type (≥ 56 px), real UI punched in so it reads on a phone, playful but never gimmicky.

## Format: vertical — 1080x1920
## Duration: 25 s (30 fps)

Phone-safe framing: keep all text inside x 70–1010 and y 200–1560 (TikTok's bottom caption band and right-side icon column stay clear).

## Visual identity (from the project)
- Background: `#080b12` (with `#10163a` radial glow, indigo `#6b70ee` and cyan `#1da6da` aurora orbs, 6% grain)
- Accent: `#6b70ee` → `#1da6da` gradient; gradient text `#cfd2ff → #8d94f5 → #2bc0ee`
- Text: `#eef3fb`, muted `#9ba8bf`
- Status colours: online `#3ccf6e`, join me `#3d9bff`, ask me `#ff9a3d`, busy `#ff4d5e`
- Display font: Inter (variable, `website/fonts/inter.woff2`), 760 weight, -0.035em tracking
- Body font: Inter; JetBrains Mono for small labels
- Strongest visual element: the site's `.device` window frame (traffic lights + mono title) holding real app screenshots; the floating live cards; the gradient **Join** chip.
- Names in the screenshots (Aurora, Nova, Kitsune, The Black Cat…) are Nexus's own demo account, so nothing real appears. The Join menu and "Joining…" toast are drawn over the Friends screenshot to show that real action.

## Share copy (draft)
Where are your VRChat friends right now? Nexus shows you live on your Windows desktop. One-click Join, a private encrypted history of every world and everyone you met, group owner tools, insights and notifications, in about 6 MB. Free and open source: nexus.gxthgirls.tech

## Audio direction
- Role: warm upbeat bed with a light rhythmic SFX layer
- Music: `happy-beats-business-moves-vol-1-by-ende-dot-app.mp3` (120 BPM, most energetic of the set)
- Music treatment: starts at 0 at ~0.35, half-second fade-in, fades out over the last second under the URL
- Music cue guidance: preset `assets/music/cues/happy-beats-business-moves-vol-1-by-ende-dot-app.music-cues.{md,json}`; beat grid every 0.50 s at `x.02` / `x.52`; strong cues 16.02, 17.02, 17.52, 18.02, 18.52, 20.02, 21.01, 22.01, 23.02, 23.52. Locks: first trust check at 18.52, logo at 22.02, button press at 23.52. Montage cards on the grid at 12.52 / 14.02 / 15.52 / 17.02.
- Audio-reactive treatment: subtle; bass band breathes the aurora orbs' scale (≤ 8 %) and the device frame glow. No waveforms, no pulsing text.
- SFX posture: moderate, motion-matched; low high-frequency-risk files only
- Audio-coupled moments: hook cards (card-place), count-up (none, let the music carry), Join click (mouse click), montage cards (soft drop on each arrival), trust checks (drop), logo (bell), button press (click)
- Restraint rule: no SFX on text-only entrances; never more than one SFX per 0.4 s; nothing above 0.75 volume.

## Storyboard

### Scene 1 — Hook — 2.52 s (0.00–2.52)
Aurora background. "Where are your friends" then "right now?" in gradient slam up word by word (fast in, then hold ~1.6 s). Three live cards pop in around the question: Nova came online · just now (0.6 s), Aurora joined The Black Cat · **Join** (0.95 s), Friends online **23** counting up with a sparkline (1.3 s).
Sequential/interaction: yes — 3 cards one by one, counter ticks to 23.
Audio intent: curiosity, instant energy.
Audio-coupled idea: card-place on each card arrival.
Music: bed starts under the first word.
Transition mood: zoom-through (the question pushes into the camera, the app rises) → Scene 2

### Scene 2 — Reveal — 3.0 s (2.52–5.52)
Icon + "Nexus" lockup at the top, then "Your VRChat friends, *live on your desktop.*" The Home screen rises in the site's device frame, punched in on "Good morning / 9 In game / 3 Favorites online / You're in The Black Cat".
Sequential/interaction: lockup, then tagline, then device rises.
Audio intent: the answer lands with weight.
Audio-coupled idea: soft impact as the device lands.
Transition mood: vertical push with blur → Scene 3

### Scene 3 — Join — 4.0 s (5.52–9.52)
Caption "See where every friend is. **Join in one click.**" The Friends screen in the device frame, punched in on Favourites. A cursor glides to Aurora's card, a Join / Invite me / Request invite menu pops, the cursor clicks **Join** (ripple), the chip reads "Joining…" and a toast slides up: "Joining **Aurora** in **The Black Cat**".
Sequential/interaction: yes — cursor move → menu → click → toast.
Audio intent: tactile, satisfying.
Audio-coupled idea: mouse click on the Join press; soft drop on the toast.
Transition mood: vertical push with blur → Scene 4

### Scene 4 — Remembered — 3.0 s (9.52–12.52)
Caption "Every world. Everyone you met. **Remembered.**" Game Log in the device frame, punched in on the expanded *Movie & Chill* session (player list with 15 m durations, timeline of joins), with a slow upward drift.
Sequential/interaction: none (slow pan).
Audio intent: calm confidence.
Audio-coupled idea: none.
Transition mood: hard cut on the beat → Scene 5

### Scene 5 — Feature montage — 6.0 s (12.52–18.52)
Four cards, one every 1.5 s on the beat grid, each a device-framed punch-in with a title + one line:
1. 12.52 **Players** — "Everyone in your instance, live" (players.png, Friends + Everyone else lists)
2. 14.02 **Groups** — "Owner tools: posts, instances, requests, bans" (groups.png, Owner tools panel)
3. 15.52 **Insights** — "Hours played. When you play." (insights.png, line chart + heatmap)
4. 17.02 **Notifications** — "Invites, friend requests, boops" (notifications.png) · beat-locked to the 17.02 strong cue
Each card slides up and replaces the previous (push). Text hold ≥ 1.2 s per card.
Sequential/interaction: yes — card-by-card.
Audio intent: momentum.
Audio-coupled idea: soft drop on each card arrival (4 total).
Transition mood: push → Scene 6

### Scene 6 — Trust — 3.5 s (18.52–22.02)
Three checks slide in on consecutive beats (18.52 beat-locked, 19.02, 19.52): "Private & encrypted **on your PC**", "About **6 MB**", "**Free** & open source". At 20.02 a mono "Also:" line fades up: Worlds · Avatars · Inventory · Feed · Discord status · Ctrl+K. Everything holds until the cut.
Sequential/interaction: yes — checks one per beat, then the Also line.
Audio intent: reassurance.
Audio-coupled idea: soft drop on each check.
Transition mood: blur crossfade → Scene 7

### Scene 7 — Outro — 2.98 s (22.02–25.00)
Icon pops in at 22.02 (beat-locked), "Nexus" rises, "Your VRChat friends, *live.*", **Download for Windows** button, `nexus.gxthgirls.tech`. The button presses itself at 23.52 (beat-locked). Music fades over the last second; the bell rings over it.
Sequential/interaction: yes — logo → word → tagline → button → URL; simulated button press.
Audio intent: payoff.
Audio-coupled idea: bell on the icon; click on the button press.
Transition mood: hold (end on the lockup, no fade to black).

**Music mood for this video:** upbeat
**Audio summary:** the bed starts under the question, card sounds punctuate the hook, one click sells the Join, soft drops ride the montage and the checks, the bell lands the logo and the bed fades out under the URL.
