import { DEFAULT_RULES, PERSONALITIES, PLAYER_COLORS, TOKENS, TOKEN_BY_ID } from '../engine/data/rules';
import type { GameConfig, GameEngine, PlayerConfig } from '../engine/GameEngine';
import type { Personality, Rules } from '../engine/types';
import { sound } from '../audio/Sound';
import { $, $$, esc, fmtTime, money, type Settings, saveSettings } from './util';
import { ownedTiles } from '../engine/managers';

const screen = () => $('#screen');
const show = (html: string) => { const s = screen(); s.innerHTML = html; s.hidden = false; s.scrollTop = 0; };
export const hideScreen = () => { screen().hidden = true; screen().innerHTML = ''; };

/* ───────────── Welcome ───────────── */
export function welcome(next: () => void) {
  show(`<div class="welcome" data-go>
    <div class="brand-mark">🏙️</div>
    <h1 class="brand">TYCOON<span>TABLE</span></h1>
    <p class="tag">A premium 3D property-trading board game</p>
    <button class="btn gold lg pulse" data-go>Tap to start</button>
  </div>`);
  const go = () => { sound.unlock(); sound.play('click'); next(); };
  $$('[data-go]').forEach(el => el.addEventListener('click', go, { once: true }));
}

/* ───────────── Main menu ───────────── */
export interface MenuHandlers { newGame(mode: 'local' | 'single'): void; tutorial(): void; resume: (() => void) | null; settings(): void; howTo(): void }
export function mainMenu(h: MenuHandlers) {
  show(`<div class="menu">
    <h1 class="brand sm">TYCOON<span>TABLE</span></h1>
    <div class="menu-list">
      ${h.resume ? `<button class="btn gold lg" data-a="resume">▶ Continue saved game</button>` : ''}
      <button class="btn lg primary" data-a="single"><b>Single Player</b><small>Play against AI opponents</small></button>
      <button class="btn lg" data-a="local"><b>Local Multiplayer</b><small>Pass and play on one device</small></button>
      <button class="btn lg" data-a="tutorial"><b>Tutorial</b><small>Learn the game with a guided match</small></button>
      <div class="row2">
        <button class="btn" data-a="how">How to play</button>
        <button class="btn" data-a="settings">Settings</button>
      </div>
    </div>
    <p class="fine">Online multiplayer is not in this build yet. Local and AI games are fully playable.</p>
  </div>`);
  const act: Record<string, () => void> = {
    resume: () => h.resume?.(), single: () => h.newGame('single'), local: () => h.newGame('local'),
    tutorial: h.tutorial, how: h.howTo, settings: h.settings,
  };
  $$('[data-a]', screen()).forEach(b => b.addEventListener('click', () => { sound.play('click'); act[b.dataset.a!](); }));
}

/* ───────────── Player setup ───────────── */
interface Draft { mode: 'local' | 'single'; players: PlayerConfig[]; rules: Rules }
const NAMES = ['Ana', 'Ravi', 'Mei', 'Leo', 'Zara', 'Kofi'];
const personaKeys = Object.keys(PERSONALITIES) as Personality[];

export function setup(mode: 'local' | 'single', onStart: (cfg: GameConfig) => void, onBack: () => void) {
  const d: Draft = {
    mode,
    rules: { ...DEFAULT_RULES },
    players: [0, 1, 2].map(i => ({
      name: mode === 'single' && i === 0 ? 'You' : NAMES[i], token: TOKENS[i].id, color: PLAYER_COLORS[i],
      isAI: mode === 'single' && i > 0, personality: personaKeys[(i + 3) % 5],
    })),
  };
  const render = () => {
    const taken = (i: number) => new Set(d.players.filter((_, j) => j !== i).map(p => p.token));
    show(`<div class="setup">
      <header class="setup-head"><button class="btn ghost" data-a="back">← Back</button><h2>${mode === 'single' ? 'Single Player' : 'Local Multiplayer'} — Game Setup</h2></header>
      <section class="card">
        <div class="sec-title"><h3>Players</h3>
          <div class="stepper"><button class="btn sm" data-a="minus" ${d.players.length <= 2 ? 'disabled' : ''}>−</button><b>${d.players.length}</b><button class="btn sm" data-a="plus" ${d.players.length >= 6 ? 'disabled' : ''}>+</button></div>
        </div>
        ${d.players.map((p, i) => `<div class="prow" style="--pc:${p.color}">
          <span class="pdot"></span>
          <input class="inp" data-name="${i}" value="${esc(p.name)}" maxlength="14" aria-label="Player ${i + 1} name">
          <select class="inp" data-ctl="${i}" aria-label="Player ${i + 1} control">
            <option value="human" ${!p.isAI ? 'selected' : ''}>Human</option>
            ${personaKeys.map(k => `<option value="${k}" ${p.isAI && p.personality === k ? 'selected' : ''}>AI · ${PERSONALITIES[k].label}</option>`).join('')}
          </select>
          <div class="tokens">${TOKENS.map(t => `<button class="tok ${p.token === t.id ? 'on' : ''}" data-tok="${i}:${t.id}" ${taken(i).has(t.id) ? 'disabled' : ''} title="${t.name}">${t.icon}</button>`).join('')}</div>
        </div>`).join('')}
      </section>
      <section class="card grid2">
        <label>Starting money<select class="inp" data-rule="startingCash">${[1000, 1500, 2000, 2500].map(v => `<option ${d.rules.startingCash === v ? 'selected' : ''} value="${v}">${money(v)}</option>`).join('')}</select></label>
        <label>Game duration<select class="inp" data-rule="timeLimitMin">${[[0, 'Unlimited'], [30, '30 minutes'], [60, '60 minutes'], [90, '90 minutes']].map(([v, l]) => `<option ${d.rules.timeLimitMin === v ? 'selected' : ''} value="${v}">${l}</option>`).join('')}</select></label>
        <label>Salary for passing Start<select class="inp" data-rule="salary">${[200, 300, 400].map(v => `<option ${d.rules.salary === v ? 'selected' : ''} value="${v}">${money(v)}</option>`).join('')}</select></label>
        <label>Jail bail<select class="inp" data-rule="bail">${[50, 100, 150].map(v => `<option ${d.rules.bail === v ? 'selected' : ''} value="${v}">${money(v)}</option>`).join('')}</select></label>
        <label>Jail turns before bail<select class="inp" data-rule="maxJailTurns">${[1, 2, 3].map(v => `<option ${d.rules.maxJailTurns === v ? 'selected' : ''} value="${v}">${v}</option>`).join('')}</select></label>
        <div class="toggles">
          <label class="tg"><input type="checkbox" data-flag="auctions" ${d.rules.auctions ? 'checked' : ''}> Auction declined properties</label>
          <label class="tg"><input type="checkbox" data-flag="freeParkingPot" ${d.rules.freeParkingPot ? 'checked' : ''}> Taxes &amp; fines go to a Free Parking jackpot</label>
          <label class="tg"><input type="checkbox" data-flag="doubleSalaryOnStart" ${d.rules.doubleSalaryOnStart ? 'checked' : ''}> Double salary for landing exactly on Start</label>
          <label class="tg"><input type="checkbox" data-flag="evenBuild" ${d.rules.evenBuild ? 'checked' : ''}> Even-building rule</label>
        </div>
      </section>
      <footer class="setup-foot"><button class="btn gold lg" data-a="lobby">Continue to lobby →</button></footer>
    </div>`);
    const s = screen();
    $$('[data-a]', s).forEach(b => b.addEventListener('click', () => {
      sound.play('click');
      const a = b.dataset.a;
      if (a === 'back') return onBack();
      if (a === 'minus') d.players.pop();
      if (a === 'plus') {
        const i = d.players.length;
        const token = TOKENS.find(t => !d.players.some(p => p.token === t.id))!.id;
        d.players.push({ name: NAMES[i], token, color: PLAYER_COLORS[i], isAI: mode === 'single', personality: personaKeys[i % 5] });
      }
      if (a === 'lobby') {
        if (!d.players.some(p => !p.isAI)) { d.players[0].isAI = false; }
        return lobby(d, () => onStart({ mode: d.mode, players: d.players, rules: d.rules }), render);
      }
      render();
    }));
    $$<HTMLInputElement>('[data-name]', s).forEach(inp => inp.addEventListener('input', () => { d.players[+inp.dataset.name!].name = inp.value; }));
    $$<HTMLSelectElement>('[data-ctl]', s).forEach(sel => sel.addEventListener('change', () => {
      const p = d.players[+sel.dataset.ctl!];
      p.isAI = sel.value !== 'human';
      if (p.isAI) p.personality = sel.value as Personality;
    }));
    $$('[data-tok]', s).forEach(b => b.addEventListener('click', () => {
      const [i, t] = b.dataset.tok!.split(':');
      d.players[+i].token = t as PlayerConfig['token']; sound.play('click'); render();
    }));
    $$<HTMLSelectElement>('[data-rule]', s).forEach(sel => sel.addEventListener('change', () => {
      (d.rules as unknown as Record<string, number>)[sel.dataset.rule!] = Number(sel.value);
    }));
    $$<HTMLInputElement>('[data-flag]', s).forEach(cb => cb.addEventListener('change', () => {
      (d.rules as unknown as Record<string, boolean>)[cb.dataset.flag!] = cb.checked;
    }));
  };
  render();
}

/* ───────────── Lobby ───────────── */
function lobby(d: Draft, start: () => void, back: () => void) {
  show(`<div class="lobby">
    <h2>Game Lobby</h2>
    <p class="muted">${d.mode === 'single' ? 'You against the AI.' : 'Pass the device to each player on their turn.'} Starting money ${money(d.rules.startingCash)} · ${d.rules.timeLimitMin ? `${d.rules.timeLimitMin}-minute game` : 'No time limit'}</p>
    <div class="lobby-players">${d.players.map((p, i) => `<div class="lp" style="--pc:${p.color}; animation-delay:${i * 80}ms">
      <div class="lp-tok">${TOKEN_BY_ID[p.token].icon}</div><b>${esc(p.name || `Player ${i + 1}`)}</b>
      <small>${p.isAI ? PERSONALITIES[p.personality!].label : 'Human'}</small><span class="ready">✓ Ready</span></div>`).join('')}</div>
    <div class="row2"><button class="btn" data-a="back">← Edit setup</button><button class="btn gold lg" data-a="go">Start game</button></div>
  </div>`);
  $('[data-a="back"]', screen()).addEventListener('click', back);
  $('[data-a="go"]', screen()).addEventListener('click', () => { sound.play('buy'); start(); });
}

/* ───────────── How to play ───────────── */
export function howTo(back: () => void) {
  show(`<div class="howto card">
    <h2>How to play</h2>
    <ol>
      <li><b>Roll the dice</b> and move around the board. Passing Start pays your salary.</li>
      <li><b>Buy properties</b> you land on. If you decline, the property goes to auction.</li>
      <li><b>Collect rent</b> when others land on your properties. Owning a whole colour group doubles base rent.</li>
      <li><b>Build houses</b> on complete colour groups (evenly). Four houses upgrade to a hotel.</li>
      <li><b>Pay taxes, fines and card penalties</b> by counting out coins in the payment tray.</li>
      <li><b>Doubles</b> give another roll — three doubles in a row sends you to Jail.</li>
      <li><b>Jail</b>: roll doubles, pay bail, or use a Get Out of Jail Free card.</li>
      <li><b>Short on cash?</b> Sell buildings, mortgage property or trade. If you still can't pay, you're bankrupt.</li>
      <li>The last player standing wins — or the richest player when the timer runs out.</li>
    </ol>
    <p class="muted">Tip: tap any tile on the board to see its details. Drag to rotate, pinch or scroll to zoom.</p>
    <button class="btn gold" data-a="back">Got it</button>
  </div>`);
  $('[data-a="back"]', screen()).addEventListener('click', back);
}

/* ───────────── Settings (shared modal) ───────────── */
export function settingsModal(s: Settings, apply: (s: Settings) => void, extra = '') {
  const m = $('#modal');
  m.innerHTML = `<div class="sheet settings">
    <h2>Settings</h2>
    <label class="tg"><input type="checkbox" data-k="music" ${s.music ? 'checked' : ''}> Background music</label>
    <label class="tg"><input type="checkbox" data-k="sfx" ${s.sfx ? 'checked' : ''}> Sound effects</label>
    <label>Volume <input type="range" min="0" max="1" step="0.05" value="${s.volume}" data-k="volume"></label>
    <label>Graphics quality <select class="inp" data-k="quality">${['high', 'medium', 'low'].map(q => `<option ${s.quality === q ? 'selected' : ''}>${q}</option>`).join('')}</select></label>
    <label class="tg"><input type="checkbox" data-k="fast" ${s.fast ? 'checked' : ''}> Fast animations</label>
    <label class="tg"><input type="checkbox" data-k="follow" ${s.follow ? 'checked' : ''}> Camera follows the active player</label>
    ${extra}
    <button class="btn gold" data-close>Done</button>
  </div>`;
  m.hidden = false;
  $$<HTMLInputElement>('[data-k]', m).forEach(el => el.addEventListener('input', () => {
    const k = el.dataset.k as keyof Settings;
    const v = el.type === 'checkbox' ? el.checked : el.type === 'range' ? Number(el.value) : el.value;
    (s as unknown as Record<string, unknown>)[k] = v;
    saveSettings(s); apply(s);
  }));
  $('[data-close]', m).addEventListener('click', () => { m.hidden = true; m.innerHTML = ''; });
}

/* ───────────── Results ───────────── */
export function results(e: GameEngine, again: () => void, menu: () => void) {
  const s = e.s;
  const rank = e.ranking();
  const why = s.endReason === 'last' ? 'Last player standing' : s.endReason === 'time' ? 'Time limit reached — ranked by net worth' : 'Game ended by agreement — ranked by net worth';
  show(`<div class="results">
    <div class="confetti">${Array.from({ length: 40 }, (_, i) => `<i style="--x:${(i * 37) % 100}%;--d:${(i % 7) * 0.3}s;--c:${['#F6D57A', '#E63946', '#3A86FF', '#2EC4B6', '#9B5DE5'][i % 5]}"></i>`).join('')}</div>
    <div class="trophy">🏆</div>
    <h1>${esc(rank[0].p.name)} wins!</h1>
    <p class="muted">${why} · ${s.round} rounds · ${fmtTime(s.elapsedMs)}</p>
    <div class="table-wrap"><table class="lb">
      <thead><tr><th>#</th><th>Player</th><th>Net worth</th><th>Properties</th><th>Rent collected</th><th>Rent paid</th><th>Earned</th><th>Spent</th></tr></thead>
      <tbody>${rank.map((r, i) => `<tr class="${i === 0 ? 'win' : ''}">
        <td>${i + 1}</td><td><span class="chip" style="--pc:${r.p.color}">${TOKEN_BY_ID[r.p.token].icon} ${esc(r.p.name)}</span>${r.p.bankrupt ? ' <em class="bad">bankrupt</em>' : ''}</td>
        <td><b>${money(r.worth)}</b></td><td>${ownedTiles(s, r.p.id).length}</td><td>${money(r.p.stats.rentCollected)}</td>
        <td>${money(r.p.stats.rentPaid)}</td><td>${money(r.p.stats.earned)}</td><td>${money(r.p.stats.spent)}</td></tr>`).join('')}</tbody>
    </table></div>
    <div class="row2"><button class="btn" data-a="menu">Main menu</button><button class="btn gold lg" data-a="again">New game</button></div>
  </div>`);
  $('[data-a="menu"]', screen()).addEventListener('click', menu);
  $('[data-a="again"]', screen()).addEventListener('click', again);
}
