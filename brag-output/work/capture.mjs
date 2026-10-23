// usage: node capture.mjs stills <t1,t2,...> | node capture.mjs video <out.mp4> <audio.wav> <posterT>
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import ffmpeg from 'ffmpeg-static';

const here = path.dirname(new URL(import.meta.url).pathname).replace(/^\/(\w:)/, '$1');
const FPS = 30, DUR = 20;
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--force-color-profile=srgb'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
await page.goto(pathToFileURL(path.join(here, 'scene.html')).href);
await page.evaluate(() => window.ready);
const shot = async t => { await page.evaluate(t => window.render(t), t); return page.screenshot({ type: 'jpeg', quality: 95 }); };

const [mode, a1, a2, a3] = process.argv.slice(2);
if (mode === 'stills') {
  fs.mkdirSync(path.join(here, 'stills'), { recursive: true });
  for (const t of a1.split(',').map(Number)) fs.writeFileSync(path.join(here, 'stills', `t${t.toFixed(2)}.jpg`), await shot(t));
} else {
  const poster = await shot(Number(a3));
  fs.writeFileSync(path.join(here, '..', 'brag.jpg'), poster);
  const ff = spawn(ffmpeg, ['-y', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-', '-i', a2,
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
    '-c:a', 'aac', '-b:a', '192k', '-shortest', a1], { stdio: ['pipe', 'inherit', 'inherit'] });
  const N = FPS * DUR;
  for (let i = 0; i < N; i++) {
    const buf = i === 0 ? poster : await shot(i / FPS);   // frame 0 = poster
    if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
    if (i % 60 === 0) process.stderr.write(`frame ${i}/${N}\n`);
  }
  ff.stdin.end();
  await new Promise(r => ff.on('close', r));
}
await browser.close();
