// Publishes the built NSIS installer to Nexus's update server (downloads.gxthgirls.tech) and writes the
// GitHub updater manifest.
//
//   npm run release -- [--notes "Short summary"] [--dry-run]
//
// Expects `npx tauri build --bundles nsis` to have produced Nexus_<v>_x64-setup.exe and its .sig, and
// NEXUS_PUBLISH_TOKEN in the environment. The server checks the signature too, then points
// latest.json at the new release. Writes latest.github.json (GitHub URLs, attach to the GitHub release
// as latest.json).
import { createHash, createPublicKey, verify } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const API = "https://api.gxthgirls.tech/nexus";
const GITHUB_DOWNLOAD = "https://github.com/LunoviaVR/Nexus/releases/download";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const notesIdx = args.indexOf("--notes");
const notesArg = notesIdx >= 0 ? args[notesIdx + 1] : undefined;

const fail = (msg) => {
  console.error(`publish: ${msg}`);
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
const ghManifest = {
  version,
  notes,
  pub_date: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
  platforms: { "windows-x86_64": { signature, url: `${GITHUB_DOWNLOAD}/v${version}/${exeName}` } },
};
const latestGithubPath = join(bundleDir, "latest.github.json");

if (dryRun) {
  console.log(`[dry-run] PUT ${API}/releases/${version} (${exeName}, notes: ${JSON.stringify(notes)})`);
  console.log(`\nlatest.github.json:\n${JSON.stringify(ghManifest, null, 2)}`);
  process.exit(0);
}

const token = process.env.NEXUS_PUBLISH_TOKEN;
if (!token) fail("set NEXUS_PUBLISH_TOKEN");
writeFileSync(latestGithubPath, `${JSON.stringify(ghManifest, null, 2)}\n`);
console.log(`Wrote ${latestGithubPath}`);

console.log(`Uploading ${exeName}`);
const res = await fetch(`${API}/releases/${version}`, {
  method: "PUT",
  headers: { Authorization: `Bearer ${token}`, "X-Signature": signature, "X-Notes": encodeURIComponent(notes) },
  body: readFileSync(exePath),
});
const body = await res.json().catch(() => ({}));
if (res.status !== 201) fail(`upload refused: HTTP ${res.status} ${body.error ?? ""}`);
if (!body.latest) fail(`uploaded, but latest.json still points at an older or equal version`);

const live = await fetch(`${API}/releases/latest`, { cache: "no-store" })
  .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
  .catch((e) => fail(`could not read back ${API}/releases/latest: ${e.message}`));
if (live.version !== version) fail(`live release is ${live.version}, expected ${version}`);
console.log(`\nLive: ${body.url}`);
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
