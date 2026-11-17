// Captures the portfolio card screenshots: node tools/shots.mjs
// Phone shots: 600-wide JPEGs in prototype/shots. Desktop: 1440x900 JPEG at tools/web-tycoon.jpg (copied to the portfolio's assets/thumbs).
// Runs the Vite dev server so it can play four AI players a few hundred moves with the real engine,
// save that mid-game position, and resume it (houses, hotels, mortgages and a full transaction history).
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'prototype');
const SHOTS = path.join(OUT, 'shots');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

fs.mkdirSync(SHOTS, { recursive: true });
const tmp = fs.mkdtempSync(path.join(ROOT, '.shots-'));
const port = 5700 + Math.floor(Math.random() * 200), dbg = port + 1000;
const server = spawn('npx', ['vite', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
const chrome = spawn(CHROME, ['--headless=new', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars', '--mute-audio',
  `--remote-debugging-port=${dbg}`, `--user-data-dir=${tmp}/profile`, 'about:blank'], { stdio: 'ignore' });

// Plays a seeded all-AI game until "You" has hotels, someone else has built too, and it is your turn to roll.
const SEED = `(async () => {
  const { GameEngine } = await import('/src/engine/GameEngine.ts');
  const { decide } = await import('/src/engine/AIManager.ts');
  for (let g = 1; g < 200; g++) {
    let seed = g * 7919; const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const e = GameEngine.create({ mode: 'single', players: [
      { name: 'You', token: 'car', color: '#E63946', isAI: true, personality: 'builder' },
      { name: 'Ravi', token: 'ship', color: '#3A86FF', isAI: true, personality: 'balanced' },
      { name: 'Mei', token: 'cat', color: '#2EC4B6', isAI: true, personality: 'conservative' },
      { name: 'Arjun', token: 'rocket', color: '#FFB703', isAI: true, personality: 'aggressive' }] }, rng);
    for (let i = 0; i < 3000 && e.s.phase !== 'over'; i++) {
      e.dispatch(decide(e.s, e.actor.id, rng));
      const pr = Object.values(e.s.props);
      if (pr.filter((p) => p.houses > 0 && p.owner === 'p1').length >= 3 && pr.some((p) => p.houses === 5)
        && pr.filter((p) => p.houses > 0 && p.owner !== 'p1').length >= 2 && e.s.players.every((p) => !p.bankrupt)
        && e.s.turn === 0 && e.s.phase === 'roll' && !e.s.queue.length && e.s.players[0].cash > 250) {
        const s = JSON.parse(JSON.stringify(e.s));
        s.players[0].isAI = false; delete s.players[0].personality;
        s.elapsedMs = 47 * 60000 + 12000;
        localStorage.setItem('tycoon-table.save', JSON.stringify(s));
        return 'seeded game ' + g + ' round ' + s.round;
      }
    }
  }
  return 'no seed';
})()`;
const SETTINGS = `localStorage.setItem('tycoon-table.settings', JSON.stringify({ music: false, sfx: false, volume: 0, quality: 'high', fast: false, follow: true, seenTutorial: true, leftPanel: false, rightPanel: false }))`;
// Picks the most built-up rival-owned property (a hotel if any) so the side card shows a full title deed with rent due.
const INSPECT = () => `(() => { const t = window.__tycoon; if (!t) return 'no dev handle';
  const props = Object.entries(t.engine.s.props).map(([i, p]) => [Number(i), p]).filter(([, p]) => p.owner && p.owner !== 'p1');
  props.sort((a, b) => b[1].houses - a[1].houses);
  const i = props[0]?.[0] ?? 39; t.view.selectTile(i);
  return 'inspecting tile ' + i; })()`;
const click = (text) => `(() => { const b = [...document.querySelectorAll('button')].find((x) => [x.getAttribute('aria-label'), x.title, x.textContent].join(' ').includes(${JSON.stringify(text)})); if (b) b.click(); return !!b; })()`;

try {
  let ws;
  for (let i = 0; i < 80 && !ws; i++) {
    try { const p = (await (await fetch(`http://127.0.0.1:${dbg}/json`)).json()).find((t) => t.type === 'page'); if (p) ws = new WebSocket(p.webSocketDebuggerUrl); } catch {}
    if (!ws) await sleep(250);
  }
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const pending = {};
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (pending[m.id]) { pending[m.id](m); delete pending[m.id]; } };
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
  const run = async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;
  const origin = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 80; i++) { try { if ((await fetch(origin)).ok) break; } catch {} await sleep(250); }

  const phone = () => send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  const desktop = () => send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  const open = async ({ seed = false } = {}) => {
    await send('Page.navigate', { url: `${origin}/` }); await sleep(2500);
    await run(`localStorage.clear(); ${SETTINGS}`);
    if (seed) console.log(await run(SEED));
    await send('Page.navigate', { url: `${origin}/` }); await sleep(3500);
  };
  const resume = async () => { await run(click('Tap to start')); await sleep(900); await run(click('Continue saved game')); await sleep(4500); };
  const grab = async (file, { width = 600, dest = path.join(SHOTS, file + '.jpg') } = {}) => {
    const s = await send('Page.captureScreenshot', { format: 'png' });
    const png = path.join(tmp, file + '.png');
    fs.writeFileSync(png, Buffer.from(s.result.data, 'base64'));
    execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '84', '--resampleWidth', String(width), png, '--out', dest], { stdio: 'pipe' });
  };

  await send('Page.enable');
  await phone();
  await open(); await sleep(1500); await grab('title');
  await run(click('Tap to start')); await sleep(900); await run(click('Single Player')); await sleep(1200); await grab('setup');
  await open({ seed: true }); await resume(); await grab('board');
  await run(click('Players')); await sleep(1500); await grab('players');
  await open({ seed: true }); await resume(); await run(click('Transaction history')); await sleep(1500); await grab('history');

  await desktop();
  await open({ seed: true }); await resume(); console.log(await run(INSPECT())); await sleep(1800);
  await grab('web', { width: 1440, dest: path.join(ROOT, 'tools', 'web-tycoon.jpg') });
  console.log('captured', fs.readdirSync(SHOTS).join(', '), '+ tools/web-tycoon.jpg');
  ws.close();
} finally {
  const exited = new Promise((r) => chrome.once('exit', r));
  chrome.kill(); server.kill();
  await Promise.race([exited, sleep(5000)]);
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
