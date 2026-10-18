// Publishes the built NSIS installer to Cloudflare R2 and writes the updater manifests.
//
//   npm run release:r2 -- [--notes "Short summary"] [--dry-run]
//
// Expects `npx tauri build --bundles nsis` to have produced Nexus_<v>_x64-setup.exe and its .sig.
// Writes latest.json (R2 URLs, uploaded) and latest.github.json (GitHub URLs, attach to the
// GitHub release as latest.json). Wrangler must be logged in (`npx wrangler login`) or have
// CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID set.
import { spawnSync } from "node:child_process";
import { createHash, createPublicKey, verify } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BUCKET = "app-releases";
const PREFIX = "nexus";
const PUBLIC_BASE = "https://downloads.gxthgirls.tech";
const GITHUB_DOWNLOAD = "https://github.com/LunoviaVR/Nexus/releases/download";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const wranglerBin = join(root, "node_modules", "wrangler", "bin", "wrangler.js");
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const notesIdx = args.indexOf("--notes");
const notesArg = notesIdx >= 0 ? args[notesIdx + 1] : undefined;

const fail = (msg) => {
  console.error(`publish-r2: ${msg}`);
  process.exit(1);
};

const conf = JSON.parse(readFileSync(join(root, "src-tauri", "tauri.conf.json"), "utf8"));
const version = conf.version;
const pubkey = conf.plugins?.updater?.pubkey;
if (!version || !pubkey) fail("tauri.conf.json is missing version or plugins.updater.pubkey");

const bundleDir = join(root, "src-tauri", "target", "release", "bundle", "nsis");
const exeName = `Nexus_${version}_x64-setup.exe`;
const exePath = join(bundleDir, exeName);
const sigPath = `${exePath}.sig`;
if (!existsSync(exePath)) fail(`missing ${exePath}; build first`);
if (!existsSync(sigPath)) fail(`missing ${sigPath}; build with TAURI_SIGNING_PRIVATE_KEY set`);

const signature = readFileSync(sigPath, "utf8").trim();
verifySignature(readFileSync(exePath), signature, pubkey);
console.log(`Signature OK for ${exeName}`);

const notes = notesArg ?? `Nexus ${version} is here. Open What's new in Nexus for the details.`;
const manifest = (url) => ({
  version,
  notes,
  pub_date: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
  platforms: { "windows-x86_64": { signature, url } },
});

const keyDir = `${PREFIX}/v${version}`;
const r2Manifest = manifest(`${PUBLIC_BASE}/${keyDir}/${exeName}`);
const ghManifest = { ...manifest(`${GITHUB_DOWNLOAD}/v${version}/${exeName}`), pub_date: r2Manifest.pub_date };
const latestPath = join(bundleDir, "latest.json");
const latestGithubPath = join(bundleDir, "latest.github.json");
if (!dryRun) {
  writeFileSync(latestPath, `${JSON.stringify(r2Manifest, null, 2)}\n`);
  writeFileSync(latestGithubPath, `${JSON.stringify(ghManifest, null, 2)}\n`);
  console.log(`Wrote ${latestPath}\nWrote ${latestGithubPath}`);
}

// Installer and signature first, manifest last, so no client sees a manifest pointing at a missing file.
const uploads = [
  { key: `${keyDir}/${exeName}`, file: exePath, type: "application/vnd.microsoft.portable-executable", cache: "public, max-age=31536000, immutable" },
  { key: `${keyDir}/${exeName}.sig`, file: sigPath, type: "text/plain; charset=utf-8", cache: "public, max-age=31536000, immutable" },
  { key: `${PREFIX}/latest.json`, file: latestPath, type: "application/json", cache: "public, max-age=60" },
];

for (const u of uploads) {
  const cmd = ["r2", "object", "put", `${BUCKET}/${u.key}`, "--remote", "--file", u.file, "--content-type", u.type, "--cache-control", u.cache];
  if (dryRun) {
    console.log(`[dry-run] npx wrangler ${cmd.map((c) => (/\s/.test(c) ? `"${c}"` : c)).join(" ")}`);
    continue;
  }
  console.log(`Uploading ${u.key}`);
  // Run wrangler's JS entry with node directly: no shell, so arguments with spaces stay intact on Windows.
  const res = spawnSync(process.execPath, [wranglerBin, ...cmd], { cwd: root, stdio: "inherit" });
  if (res.status !== 0) fail(`upload of ${u.key} failed`);
}

if (dryRun) {
  console.log(`\nlatest.json (R2):\n${JSON.stringify(r2Manifest, null, 2)}`);
  console.log(`\nlatest.github.json:\n${JSON.stringify(ghManifest, null, 2)}`);
  process.exit(0);
}

const live = await fetch(`${PUBLIC_BASE}/${PREFIX}/latest.json`, { cache: "no-store" })
  .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
  .catch((e) => fail(`could not read back ${PUBLIC_BASE}/${PREFIX}/latest.json: ${e.message}`));
if (live.version !== version) fail(`live latest.json reports ${live.version}, expected ${version} (edge cache can lag up to 60 s)`);
console.log(`\nLive: ${PUBLIC_BASE}/${PREFIX}/latest.json → ${live.version}`);
console.log(`Attach ${exeName}, ${exeName}.sig and latest.github.json (renamed to latest.json) to the GitHub release.`);

/** Minisign "ED" check: Ed25519 over BLAKE2b-512 of the file, plus the global signature over the trusted comment. */
function verifySignature(data, sigB64, keyB64) {
  const keyLines = Buffer.from(keyB64, "base64").toString("utf8").trim().split(/\r?\n/);
  const key = Buffer.from(keyLines[1], "base64");
  if (key.length !== 42 || key.subarray(0, 2).toString() !== "Ed") fail("unexpected public key format");

  const sigLines = Buffer.from(sigB64, "base64").toString("utf8").trim().split(/\r?\n/);
  const sig = Buffer.from(sigLines[1], "base64");
  const trusted = sigLines[2]?.replace(/^trusted comment: /, "");
  const globalSig = Buffer.from(sigLines[3] ?? "", "base64");
  if (sig.length !== 74 || sig.subarray(0, 2).toString() !== "ED") fail("unexpected signature format");
  if (!sig.subarray(2, 10).equals(key.subarray(2, 10))) fail("signature key id does not match the updater pubkey");

  const publicKey = createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: key.subarray(10).toString("base64url") }, format: "jwk" });
  const digest = createHash("blake2b512").update(data).digest();
  if (!verify(null, digest, publicKey, sig.subarray(10))) fail("installer signature is INVALID");
  if (trusted === undefined || !verify(null, Buffer.concat([sig.subarray(10), Buffer.from(trusted)]), publicKey, globalSig)) {
    fail("trusted comment signature is INVALID");
  }
}
