// Synthesizes the soundtrack (music + tuned SFX) to audio.wav. 120 bpm, Am–F–C–G, resolving to C.
import fs from 'node:fs';
const SR = 48000, DUR = 20, N = SR * DUR;
const L = new Float32Array(N), R = new Float32Array(N), sendL = new Float32Array(N), sendR = new Float32Array(N);
const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
const add = (i, l, r, send = 0) => { if (i < 0 || i >= N) return; L[i] += l; R[i] += r; sendL[i] += l * send; sendR[i] += r * send; };

// chords (midi), one per 2s bar
const A = [57, 60, 64], F = [53, 57, 60], C = [48, 52, 55, 62], G = [55, 59, 62];
const bars = [A, F, C, G, A, F, C, G, null, null];
const chordAt = t => t >= 17.2 ? [48, 55, 60, 64, 62] : t >= 16 ? [55, 59, 62, 65] : bars[Math.floor(t / 2)];
const rootAt = t => t >= 17.2 ? 36 : t >= 16 ? 43 : [45, 41, 36, 43][Math.floor(t / 2) % 4];

// pad: detuned saws through a moving 2-pole lowpass
{ let lpL = 0, lpL2 = 0, lpR = 0, lpR2 = 0; const ph = new Float64Array(64);
  for (let i = 0; i < N; i++) { const t = i / SR; const ch = chordAt(t); let sl = 0, sr = 0;
    ch.forEach((m, k) => [-0.11, 0, 0.12].forEach((d, j) => { const idx = k * 3 + j; ph[idx] = (ph[idx] + mtof(m + 12 + d) / SR) % 1; const v = ph[idx] * 2 - 1; if (j === 0) sl += v; else if (j === 2) sr += v; else { sl += v * .5; sr += v * .5; } }));
    const cut = t < 3 ? 300 + 1500 * Math.pow(t / 3, 2) : t > 17.2 ? 2200 : 1300 + 300 * Math.sin(t * .8);
    const a = 1 - Math.exp(-2 * Math.PI * cut / SR);
    lpL += a * (sl - lpL); lpL2 += a * (lpL - lpL2); lpR += a * (sr - lpR); lpR2 += a * (lpR - lpR2);
    const pump = t > 3 && t < 17.2 ? 1 - .35 * Math.exp(-((t % .5) / .09)) : 1;
    const g = .028 * Math.min(1, t / 1.2) * pump * (t > 19 ? Math.max(0, 1 - (t - 19)) * .6 + .4 : 1);
    add(i, lpL2 * g, lpR2 * g, .35); } }

// sub bass on every beat from 3s
for (let b = 6; b < 40; b++) { const t0 = b * .5; if (t0 >= 17.2 && t0 < 17.2) continue;
  const m = rootAt(t0 + .01), len = t0 >= 17.2 ? 2.6 : .45, f = mtof(m);
  for (let j = 0; j < len * SR; j++) { const t = j / SR; const e = Math.min(1, t / .01) * Math.exp(-t / (len * .5)); const v = Math.sin(2 * Math.PI * f * t) * e * .16; add(Math.floor(t0 * SR) + j, v, v); }
  if (t0 >= 17.2) break; }
// soft kick
for (let b = 6; b < 35; b++) { const t0 = b * .5; if (t0 > 17.2) break;
  let ph = 0; for (let j = 0; j < .25 * SR; j++) { const t = j / SR; const f = 45 + 80 * Math.exp(-t / .03); ph += f / SR; const v = Math.sin(2 * Math.PI * ph) * Math.exp(-t / .09) * .2; add(Math.floor(t0 * SR) + j, v, v); } }
// offbeat hats from 6.6
{ let hp = 0, prev = 0; for (let b = 13; b < 34; b++) { const t0 = b * .5 + .25; for (let j = 0; j < .06 * SR; j++) { const x = rnd(); hp = .9 * (hp + x - prev); prev = x; const v = hp * Math.exp(-j / SR / .018) * .014; add(Math.floor(t0 * SR) + j, v * .8, v, .2); } } }

// pluck voice (shared by arp + SFX so they sit in the same timbre)
function pluck(t0, m, vel, pan = 0, send = .45, decay = .25) { const f = mtof(m);
  for (let j = 0; j < decay * 5 * SR; j++) { const t = j / SR; const e = Math.min(1, t / .004) * Math.exp(-t / decay);
    const v = (Math.sin(2 * Math.PI * f * t) + .3 * Math.sin(4 * Math.PI * f * t) * Math.exp(-t / .05)) * e * vel; add(Math.floor(t0 * SR) + j, v * (1 - pan) * .7, v * (1 + pan) * .7, send); } }
// arpeggio 8ths, 0–17.2
for (let s = 0; s < 34; s++) { const t0 = s * .5 + (s % 2 ? .25 : 0); const t = s * .5; const ch = chordAt(t + .01);
  for (let h = 0; h < 2; h++) { const tt = s * .5 + h * .25; if (tt >= 17.2) break; const c = chordAt(tt + .01); const n = c[(s * 2 + h) % c.length] + 24;
    pluck(tt, n, (tt < 3 ? .018 + .01 * tt / 3 : .026) * (h ? .7 : 1), h ? .35 : -.35, .5, .16); } }

// SFX, tuned to the chord under them
const pops = [[.65, 76], [1.0, 81], [1.35, 84]]; pops.forEach(([t, m]) => pluck(t, m, .07, 0, .6, .22));
for (let k = 0; k < 12; k++) pluck(1.4 + k * .075, 88 + [0, 3, 7][k % 3], .008, (k % 2) - .5, .5, .05); // count-up ticks
pluck(9.05, 81, .08, .2, .5, .2); pluck(9.32, 88, .05, .3, .6, .35);                                  // Join click + toast
[[14.7, 79], [15.0, 83], [15.3, 86]].forEach(([t, m]) => pluck(t, m, .07, 0, .6, .25));               // checks
[72, 76, 79, 84, 88].forEach((m, k) => pluck(17.3 + k * .06, m, .05, (k - 2) * .2, .7, .9));             // logo shimmer
pluck(18.9, 84, .035, 0, .6, .15);                                                                       // button press
// click transient for Join / button
[9.05, 18.9].forEach(t0 => { for (let j = 0; j < .01 * SR; j++) { const v = rnd() * Math.exp(-j / SR / .0015) * .05; add(Math.floor(t0 * SR) + j, v, v, .3); } });

// whoosh swells into each cut
{ [3.0, 6.6, 10.6, 14.6, 17.2].forEach(tc => { let lp = 0, lp2 = 0; const len = .6;
  for (let j = 0; j < (len + .35) * SR; j++) { const t = j / SR - len; const env = t < 0 ? Math.pow(1 + t / len, 2) : Math.exp(-t / .12);
    const cut = 250 + 1600 * env; const a = 1 - Math.exp(-2 * Math.PI * cut / SR); lp += a * (rnd() - lp); lp2 += a * (lp - lp2);
    const v = lp2 * env * .05; add(Math.floor((tc - len) * SR) + j, v * (1 - .4 * Math.sin(j / SR * 6)), v * (1 + .4 * Math.sin(j / SR * 6)), .4); } });
  // low impact on the reveal and logo
  [3.0, 17.2].forEach(t0 => { for (let j = 0; j < 1.2 * SR; j++) { const t = j / SR; const v = Math.sin(2 * Math.PI * (38 + 30 * Math.exp(-t / .08)) * t) * Math.exp(-t / .35) * .18; add(Math.floor(t0 * SR) + j, v, v); } }); }

// reverb (Schroeder): 4 combs + 2 allpasses per side
function verb(x, off) { const out = new Float32Array(N); const combs = [1557, 1617, 1491, 1422].map(d => ({ b: new Float32Array(d + off), i: 0, s: 0 }));
  for (let i = 0; i < N; i++) { let y = 0; for (const c of combs) { const o = c.b[c.i]; c.s = o * .8 + c.s * .2; c.b[c.i] = x[i] + c.s * .84; c.i = (c.i + 1) % c.b.length; y += o; } out[i] = y * .25; }
  for (const d of [225, 556]) { const b = new Float32Array(d + off); let k = 0; for (let i = 0; i < N; i++) { const o = b[k]; const v = out[i] + o * .5; b[k] = v; out[i] = o - v * .5; k = (k + 1) % b.length; } }
  return out; }
const vL = verb(sendL, 0), vR = verb(sendR, 23);
// 1.5s predelay-less mix, gentle bus glue, fade tail
const buf = Buffer.alloc(44 + N * 4);
for (let i = 0; i < N; i++) { const t = i / SR; const fade = t > 19.3 ? Math.max(0, (20 - t) / .7) : 1; const fin = Math.min(1, t / .05);
  const l = Math.tanh((L[i] + vL[i] * .55) * 1.6) * .8 * fade * fin, r = Math.tanh((R[i] + vR[i] * .55) * 1.6) * .8 * fade * fin;
  buf.writeInt16LE(Math.round(l * 32767), 44 + i * 4); buf.writeInt16LE(Math.round(r * 32767), 46 + i * 4); }
buf.write('RIFF', 0); buf.writeUInt32LE(36 + N * 4, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(N * 4, 40);
fs.writeFileSync(new URL('./audio.wav', import.meta.url), buf);
let peak = 0, rms = 0; for (let i = 0; i < N; i++) { peak = Math.max(peak, Math.abs(L[i] + vL[i] * .55)); rms += L[i] * L[i]; }
console.log('pre-glue peak', peak.toFixed(3), 'rms', Math.sqrt(rms / N).toFixed(3));
