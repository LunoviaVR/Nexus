# Hyperframes Composition Brief: Nexus

## Objective
Create a short launch-style brag video for Nexus, the VRChat companion app for Windows, cut for TikTok.

## Output
- Composition directory: `brag-output-2026-10-19-232120/composition/`
- Rendered video: `brag-output-2026-10-19-232120/brag.mp4`
- Format: vertical — 1080x1920, 30 fps
- Duration: 25 s

## Source Material
- Project root: `D:\GitHub\Nexus`
- Primary files read: `website/index.html`, `website/styles.css`, `README.md`, `website/assets/screens/*.png`, `website/assets/icon.png`, `website/fonts/*.woff2`
- Product name: Nexus
- Tagline / strongest claim: "Your VRChat friends, live on your desktop." / "Everything you'd open the VRChat website for. And a lot it can't do."
- Key UI or visual moment to recreate: the site's `.device` window frame holding the real app screenshots; the live friend cards from the hero; a cursor clicking **Join** on Aurora's friend card.
- Copy that must appear verbatim:
  - Your VRChat friends, live on your desktop.
  - Join in one click.
  - Download for Windows
  - nexus.gxthgirls.tech
  - About 6 MB · Free & open source · encrypted on your PC (README: "Everything Nexus records stays private and encrypted on your PC", "the installer is about 6 MB")
  - Feature names as the app's own nav: Players, Groups, Insights, Notifications, Worlds, Avatars, Inventory, Feed, Game Log

## Creative Direction
- Tone preset: default
- Creative direction: slick TikTok launch reel; phone-first; every feature gets exactly one beat
- Interpretation: fast entrances with real holds, cuts on the 120 BPM grid, large type, real UI punched in so it reads on a phone screen, playful but never gimmicky.
- Angle: "Where are your friends right now?" Nexus answers it live, proves the one-click Join, shows it remembers (Game Log), then runs every important feature past the viewer one beat each, and closes on private / tiny / free with the download button.
- Hook: the two-line question with three live cards popping in on card sounds.
- Outro / punchline: icon on the strong beat, "Nexus", "Your VRChat friends, live.", the Download for Windows button pressing itself, the URL.
- Avoid:
  - Generic SaaS language
  - Abstract filler visuals
  - Unrelated visual redesign (keep the site's exact colours, fonts and window frame)

## Visual Identity
- Background: `#080b12` + radial `#10163a` glow, indigo `#6b70ee` / cyan `#1da6da` aurora orbs, 6 % grain
- Text: `#eef3fb` (muted `#9ba8bf`)
- Accent: `linear-gradient(120deg, #6b70ee, #1da6da)`; gradient text `#cfd2ff → #8d94f5 → #2bc0ee`
- Display font: Inter (local `assets/fonts/inter.woff2`, 760 weight)
- Body font: Inter; JetBrains Mono (local `assets/fonts/jetbrains-mono.woff2`) for small labels
- Visual references from the project: `.device` frame (traffic lights + centred mono title), `.float` live cards, `.chip-join` gradient chip, `.status-dot` green dot, `.btn-primary` pill button, `.avatar.av-1` pink→violet gradient avatar
- Phone-safe framing: all text within x 70–1010 and y 200–1560.

## Storyboard
Use the storyboard in `brag-output-2026-10-19-232120/brag-plan.md` as the creative contract.

Scene summary:
1. Hook — 2.52 s — "Where are your friends / right now?" + three live cards + counter to 23
2. Reveal — 3.0 s — Nexus lockup, "Your VRChat friends, live on your desktop.", Home screen rises in the device frame
3. Join — 4.0 s — Friends screen, cursor opens Join menu and clicks Join, "Joining Aurora in The Black Cat" toast
4. Remembered — 3.0 s — Game Log expanded session, slow drift; "Every world. Everyone you met. Remembered."
5. Montage — 6.0 s — Players / Groups / Insights / Notifications, one card per 1.5 s on the beat grid
6. Trust — 3.5 s — three checks on consecutive beats + "Also:" line (Worlds · Avatars · Inventory · Feed · Discord status · Ctrl+K)
7. Outro — 2.98 s — icon, Nexus, tagline, Download for Windows (presses itself), URL

## Audio
- Audio role: warm upbeat bed with a light motion-matched SFX layer
- Audio arc: bed in under the question → card pops → click sells the Join → soft drops ride the montage and the checks → bell on the logo → bed fades under the URL
- Music: `assets/music/happy-beats-business-moves-vol-1-by-ende-dot-app.mp3`
- Music treatment: volume 0.35, 0.5 s fade-in, fade-out from 24.0 s to 25.0 s via a `data-automation` volume lane
- Music cue guidance: preset `assets/music/cues/happy-beats-business-moves-vol-1-by-ende-dot-app.music-cues.json` (120 BPM, grid at x.02 / x.52). Strong cue locks: 18.52 (first trust check), 22.01 (logo), 23.52 (button press). Grid: montage cards at 12.52 / 14.02 / 15.52 / 17.02; checks at 18.52 / 19.02 / 19.52; Also line at 20.02.
- Audio-reactive treatment: subtle; bass band (bands[0..1]) breathes the aurora orbs (scale ≤ +8 %) and the device-frame glow opacity. No waveform / equalizer graphics, no text pulsing.
- Audio-coupled moments:
  - Hook cards — card-place ×3 at each card's arrival
  - Join click — ui/mouseclick1 at the press; drop on the toast
  - Montage — drop_001 at each card arrival (4)
  - Trust checks — drop_002 at each check (3)
  - Logo — impactBell_heavy_000 at 22.02
  - Button press — click_003 at 23.52
  - Scene cuts — impactSoft_medium_001 on the reveal landing (device lands) only
- SFX selection guidance: match the visible motion; one sound per visible arrival; nothing on text-only entrances.
- SFX analysis guidance: `C:/Users/lunov/.claude/plugins/cache/brag/brag/0.4.0/skills/brag/assets/sfx/sfx-analysis.md`; the chosen files are all low/medium HF-risk picks.
- Exact SFX choice: Hyperframes chooses final timestamps, density and volume from the implemented animation (volumes 0.55–0.75).
- Audio files: copied into `composition/assets/music/` and `composition/assets/sfx/{casino,ui,interface,impact}/`.

## Hyperframes Instructions
Domain skills read: `hyperframes-core` (contract, data attributes, determinism, media), `hyperframes-animation` (cursor-click-ripple, spring-pop-entrance, transitions overview/catalog/push/scale/dissolve, GSAP adapter), `hyperframes-creative` (house style, video composition, beat direction, audio-reactive), `hyperframes-keyframes` (punch-ins on inner wrappers), `hyperframes-cli` (check / snapshot / render). /brag is its own workflow; no intent interview.

Requirements:
- Show at least one real UI, copy, or visual element from the source project.
- Keep all text readable in the final render.
- Keep the video within 15–25 seconds.
- Include the planned music/SFX layer.
- Treat `/brag` audio notes as guidance, not a fixed cue sheet. Choose SFX after the visual animation exists.
- Treat music cue metadata as optional timing hints; readability and story first.
- Use local assets for audio, fonts, images and GSAP (`assets/vendor/gsap.min.js`).
- Run `hyperframes check` before render — it is brag's single gate.
- Keep creation and rendering local.
