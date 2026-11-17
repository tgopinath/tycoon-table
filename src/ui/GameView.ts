import { decide } from '../engine/AIManager';
import { GROUP_BY_ID, GROUPS, RAIL_RENT, TILES } from '../engine/data/board';
import { CARD_BY_ID, DECK_TITLE } from '../engine/data/cards';
import { PERSONALITIES, TOKEN_BY_ID } from '../engine/data/rules';
import type { GameEngine } from '../engine/GameEngine';
import * as M from '../engine/managers';
import type { Action, GameEvent, PayPrompt, Player, Prompt, TradeOffer } from '../engine/types';
import { sound } from '../audio/Sound';
import type { BoardScene } from '../three/BoardScene';
import { $, $$, esc, fmtTime, money, saveGame, saveSettings, type Settings, toast } from './util';
import { settingsModal } from './screens';

type PanelModal = 'build' | 'mortgage' | 'trade' | 'history' | 'jail' | 'pause' | 'portfolio' | 'tile' | 'settings' | 'confirmEnd';
const DENOMS = [500, 100, 50, 20, 10, 5, 1];
const icon = (p: Player) => TOKEN_BY_ID[p.token].icon;
const chip = (p: Player) => `<span class="chip" style="--pc:${p.color}">${icon(p)} ${esc(p.name)}</span>`;

export class GameView {
  private busy = false;
  private paused = false;
  private modal: string | null = null;
  private aiTimer: number | null = null;
  private tick: number | null = null;
  private selectedTile: number | null = null;
  private shownCash = new Map<string, number>();
  private coachOff = false;
  private hud = $('#hud');
  private modalEl = $('#modal');
  private get leftOpen() { return this.settings.leftPanel; }
  private set leftOpen(v: boolean) { this.settings.leftPanel = v; saveSettings(this.settings); }
  private get rightOpen() { return this.settings.rightPanel; }
  private set rightOpen(v: boolean) { this.settings.rightPanel = v; saveSettings(this.settings); }

  constructor(private e: GameEngine, private scene: BoardScene, private settings: Settings,
    private cb: { exit(): void; finished(): void; applySettings(s: Settings): void }) {}

  get s() { return this.e.s; }

  start() {
    this.scene.resetCamera();
    this.scene.load(this.s);
    this.scene.onTileClick = i => this.selectTile(i);
    this.scene.onStep = () => sound.play('step');
    this.scene.onTileHover = (i, x, y) => this.tileTip(i, x, y);
    this.hud.hidden = false;
    this.hud.innerHTML = this.hudShell();
    this.hud.onclick = ev => this.onHudClick(ev);
    window.onkeydown = ev => this.onKey(ev);
    for (const p of this.s.players) this.shownCash.set(p.id, p.cash);
    this.tick = window.setInterval(() => this.onTick(), 1000);
    this.render();
    this.syncPrompt();
    this.schedule();
    if (this.s.mode === 'tutorial') toast('Welcome to the tutorial! Follow the tips at the top of the screen.', 'info', 4000);
  }

  destroy() {
    if (this.tick) clearInterval(this.tick);
    if (this.aiTimer) clearTimeout(this.aiTimer);
    this.hud.hidden = true; this.hud.innerHTML = ''; this.hud.onclick = null;
    window.onkeydown = null;
    this.closeModal();
    this.hideLanded();
    this.scene.setActive(null);
  }

  /* ───────────── controller ───────────── */
  async act(a: Action, fromAI = false): Promise<boolean> {
    if (this.busy) return false;
    const r = this.e.dispatch(a);
    if (!r.ok) {
      if (!fromAI) { sound.play('error'); toast(esc(r.error ?? 'Not allowed'), 'error'); }
      return false;
    }
    if (this.modal?.startsWith('prompt:')) this.closeModal();
    this.busy = true;
    this.render();
    try { await this.playEvents(this.e.drainEvents()); } finally { this.busy = false; }
    saveGame(this.s);
    this.render();
    this.refreshLanded();
    if (this.s.phase === 'over') { this.finish(); return true; }
    this.syncPrompt();
    this.schedule();
    return true;
  }

  private async playEvents(evs: GameEvent[]) {
    for (const ev of evs) {
      switch (ev.type) {
        case 'dice': {
          sound.play('dice');
          await this.scene.rollDice(ev.d1, ev.d2);
          this.diceBadge(ev.d1, ev.d2);
          break;
        }
        case 'move': {
          const p = M.getPlayer(this.s, ev.playerId);
          this.hideLanded();
          await this.scene.moveToken(ev.playerId, ev.path, ev.teleport, ev.teleport && p.inJail);
          this.showLanded(p.id, ev.path[ev.path.length - 1]);
          break;
        }
        case 'tx': {
          const { tx } = ev;
          const intoPlayer = tx.receiver !== 'bank' && tx.receiver !== 'pot';
          sound.play(intoPlayer ? 'coinIn' : 'coinOut');
          await this.scene.flyCoins(tx.sender, tx.receiver, tx.amount);
          for (const id of [tx.sender, tx.receiver]) {
            if (id === 'bank' || id === 'pot') continue;
            const bal = id === tx.sender ? tx.senderBalance : tx.receiverBalance;
            if (bal !== null) this.animateCash(id, bal);
          }
          if (tx.sender === 'pot' || tx.receiver === 'pot') this.scene.setPot(tx.sender === 'pot' ? tx.senderBalance ?? 0 : tx.receiverBalance ?? 0);
          this.txToast(tx);
          break;
        }
        case 'own': {
          const ps = this.s.props[ev.tileId];
          this.scene.setOwner(ev.tileId, ev.owner, ev.owner ? ps.mortgaged : false);
          if (ev.owner) sound.play('buy');
          break;
        }
        case 'mortgage': this.scene.setOwner(ev.tileId, this.s.props[ev.tileId].owner, ev.mortgaged); break;
        case 'build': {
          const owner = this.s.props[ev.tileId].owner ?? '';
          sound.play(ev.houses === 5 && ev.prev < 5 ? 'hotel' : 'build');
          await this.scene.setBuildings(ev.tileId, ev.houses, owner, ev.houses > ev.prev);
          break;
        }
        case 'card': sound.play('card'); await this.scene.drawCard(ev.deck); break;
        case 'jail': if (ev.inJail) sound.play('jail'); this.scene.setJail(ev.playerId, ev.inJail); break;
        case 'bankrupt': sound.play('bankrupt'); toast(`💥 ${esc(M.getPlayer(this.s, ev.playerId).name)} is bankrupt!`, 'bad', 4000); await this.scene.removeToken(ev.playerId); break;
        case 'turn': {
          const p = M.getPlayer(this.s, ev.playerId);
          this.scene.setActive(p.id);
          this.hideLanded();
          this.turnBanner(p);
          break;
        }
        case 'trade': toast(ev.accepted ? '🤝 Trade completed' : '✋ Trade rejected', ev.accepted ? 'good' : 'bad'); break;
        case 'gameover': break;
      }
    }
  }

  private schedule() {
    if (this.aiTimer) clearTimeout(this.aiTimer);
    this.aiTimer = null;
    if (this.paused || this.busy || this.s.phase === 'over') return;
    const actor = this.e.actor;
    if (!actor?.isAI) return;
    const version = this.s.version;
    this.aiTimer = window.setTimeout(async () => {
      if (this.s.version !== version || this.paused) return;
      const a = decide(this.s, actor.id);
      if (a && await this.act(a, true)) return;
      // Fallbacks so an AI can never stall the game.
      const h = this.e.head;
      const tries: Action[] = h
        ? [{ type: 'confirm', playerId: actor.id, promptId: h.id }, { type: 'decline', playerId: actor.id, promptId: h.id }, { type: 'pass', playerId: actor.id, promptId: h.id }, { type: 'bankrupt', playerId: actor.id, promptId: h.id }, { type: 'respondTrade', playerId: actor.id, promptId: h.id, accept: false }]
        : [{ type: 'roll', playerId: actor.id }, { type: 'endTurn', playerId: actor.id }];
      for (const t of tries) if (await this.act(t, true)) return;
    }, this.settings.fast ? 300 : 800);
  }

  private onTick() {
    if (this.paused || this.s.phase === 'over') return;
    this.s.elapsedMs += 1000;
    const el = $('#h-time');
    if (el) {
      const lim = this.s.rules.timeLimitMin * 60000;
      el.textContent = lim ? fmtTime(Math.max(0, lim - this.s.elapsedMs)) : fmtTime(this.s.elapsedMs);
      el.classList.toggle('bad', this.e.timeUp);
    }
    if (this.s.elapsedMs % 10000 === 0) saveGame(this.s);
  }

  private finish() {
    this.closeModal();
    const winner = this.e.ranking()[0].p;
    sound.play('victory');
    this.scene.celebrate(winner.id).then(() => this.cb.finished());
  }

  /* ───────────── HUD ───────────── */
  private hudShell() {
    return `
    <header class="top">
      <div class="brand xs">TYCOON<span>TABLE</span></div>
      <div class="stat"><small>Round</small><b id="h-round"></b></div>
      <div class="stat"><small>${this.s.rules.timeLimitMin ? 'Time left' : 'Time'}</small><b id="h-time">0:00</b></div>
      <div class="top-players" id="h-players"></div>
      <div class="turnchip" id="h-turn"></div>
      <div class="top-actions">
        <button class="icon tg-btn" data-ui="left" title="Players &amp; portfolio" aria-label="Players and portfolio">👥</button>
        <button class="icon tg-btn" data-ui="right" title="Activity &amp; property info" aria-label="Activity and property info">📜</button>
        <button class="icon" data-ui="history" title="Transaction history">🧾</button>
        <button class="icon" data-ui="settings" title="Settings">⚙️</button>
        <button class="icon" data-ui="pause" title="Pause">⏸</button>
      </div>
    </header>
    <div class="coach" id="coach" hidden></div>
    <aside class="panel left" id="p-left"></aside>
    <aside class="panel right" id="p-right"></aside>
    <div class="viewctl" id="viewctl">
      <button class="icon" data-ui="cam-l" title="Rotate board left" aria-label="Rotate board left">⟲</button>
      <button class="icon" data-ui="cam-r" title="Rotate board right" aria-label="Rotate board right">⟳</button>
      <button class="icon" data-ui="cam-top" title="Top view" aria-label="Toggle top view">⬒</button>
      <button class="icon" data-ui="cam-in" title="Zoom in" aria-label="Zoom in">＋</button>
      <button class="icon" data-ui="cam-out" title="Zoom out" aria-label="Zoom out">－</button>
      <button class="icon" data-ui="cam-c" title="Recenter on the active player" aria-label="Recenter">⌖</button>
    </div>
    <div class="tile-tip" id="tile-tip" hidden></div>
    <div class="dice-badge" id="dice-badge" hidden></div>
    <footer class="actions" id="p-actions"></footer>
    <div class="scrim" id="scrim"></div>`;
  }

  render() {
    const s = this.s;
    const cur = M.currentPlayer(s);
    $('#h-round').textContent = String(s.round);
    $('#h-turn').innerHTML = `${chip(cur)}<small>${cur.isAI ? 'AI' : 'Your turn'}</small>`;
    $('#h-turn').style.setProperty('--pc', cur.color);
    $('#p-left').innerHTML = `<button class="panel-x" data-ui="left" aria-label="Close panel">✕ Close</button>${this.leftPanel()}`;
    $('#p-right').innerHTML = `<button class="panel-x" data-ui="right" aria-label="Close panel">✕ Close</button>${this.rightPanel()}`;
    $('#p-actions').innerHTML = this.actionBar();
    this.hud.classList.toggle('left-open', this.leftOpen);
    this.hud.classList.toggle('right-open', this.rightOpen);
    this.hud.classList.toggle('static', this.scene.isStatic);
    document.body.classList.toggle('left-open', this.leftOpen);
    $$('[data-ui="left"]', this.hud).forEach(b => b.classList.toggle('on', this.leftOpen));
    $$('[data-ui="right"]', this.hud).forEach(b => b.classList.toggle('on', this.rightOpen));
    $('[data-ui="cam-top"]', this.hud)?.classList.toggle('on', this.scene.isTopView);
    $('#h-players').innerHTML = s.players.map(p => `<button class="tpl ${p.id === cur.id ? 'on' : ''} ${p.bankrupt ? 'out' : ''}" style="--pc:${p.color}" data-ui="portfolio" data-pid="${p.id}" title="${esc(p.name)}">
      <span>${icon(p)}</span><b data-cash="${p.id}">${p.bankrupt ? '—' : money(this.shownCash.get(p.id) ?? p.cash)}</b></button>`).join('');
    this.renderCoach();
    for (const p of s.players) if (!this.busy) this.animateCash(p.id, p.cash);
  }

  private leftPanel() {
    const s = this.s, cur = M.currentPlayer(s);
    const owned = M.ownedTiles(s, cur.id);
    const groups = GROUPS.map(g => ({ g, tiles: owned.filter(t => TILES[t].group === g.id) })).filter(x => x.tiles.length);
    return `
    <section class="pcard" style="--pc:${cur.color}">
      <div class="pc-top"><div class="pc-tok">${icon(cur)}</div>
        <div><small>${cur.isAI ? `AI · ${PERSONALITIES[cur.personality!].label}` : 'Current player'}</small><h3>${esc(cur.name)}</h3></div></div>
      <div class="cash"><span class="coin-ico"></span><b data-cash="${cur.id}">${money(this.shownCash.get(cur.id) ?? cur.cash)}</b></div>
      <div class="pc-flags">
        ${cur.inJail ? `<span class="flag bad">🔒 In jail · ${s.rules.maxJailTurns - cur.jailTurns} tries left</span>` : ''}
        ${cur.jailCards.length ? `<span class="flag good">🎟 ${cur.jailCards.length} Get Out of Jail card</span>` : ''}
      </div>
      <div class="mini-stats">
        <div><small>Net worth</small><b>${money(M.netWorth(s, cur.id))}</b></div>
        <div><small>Rent in</small><b>${money(cur.stats.rentCollected)}</b></div>
        <div><small>Rent out</small><b>${money(cur.stats.rentPaid)}</b></div>
      </div>
    </section>
    <section class="block"><h4>Portfolio <small>${owned.length} properties</small></h4>
      ${groups.length ? groups.map(({ g, tiles }) => `<div class="pg"><span class="sw" style="background:${g.color}"></span>
        <div class="pg-tiles">${tiles.map(t => this.tilePill(t)).join('')}</div>
        ${M.ownsGroup(s, cur.id, g.id) && g.id !== 'rail' && g.id !== 'utility' ? '<span class="full" title="Complete group">★</span>' : ''}</div>`).join('')
        : '<p class="muted sm">No properties yet.</p>'}
    </section>
    <section class="block"><h4>Players</h4>
      ${s.players.map(p => `<button class="prow-mini ${p.id === cur.id ? 'on' : ''} ${p.bankrupt ? 'out' : ''}" data-ui="portfolio" data-pid="${p.id}" style="--pc:${p.color}">
        <span class="pm-tok">${icon(p)}</span><span class="pm-name">${esc(p.name)}${p.isAI ? ' <em>AI</em>' : ''}</span>
        <b data-cash="${p.id}">${p.bankrupt ? 'Bankrupt' : money(this.shownCash.get(p.id) ?? p.cash)}</b>
        <small>${M.ownedTiles(s, p.id).length} props${p.inJail ? ' · 🔒' : ''}</small></button>`).join('')}
      <div class="bank-line"><span>🏦 Bank supply</span><span>🏠 ${s.housesLeft} · 🏨 ${s.hotelsLeft}</span></div>
      ${s.rules.freeParkingPot ? `<div class="bank-line"><span>🅿️ Free Parking pot</span><b>${money(s.pot)}</b></div>` : ''}
    </section>`;
  }

  private tilePill(t: number) {
    const ps = this.s.props[t];
    const b = ps.houses === 5 ? '🏨' : '🏠'.repeat(ps.houses);
    return `<button class="tp ${ps.mortgaged ? 'mort' : ''}" data-ui="tile" data-tile="${t}">${esc(TILES[t].name)}${b ? ` <span>${b}</span>` : ''}${ps.mortgaged ? ' <em>M</em>' : ''}</button>`;
  }

  private rightPanel() {
    const s = this.s;
    const log = s.log.slice(-40).reverse();
    return `
    <section class="block now"><h4>Current action</h4><p>${this.currentActionText()}</p></section>
    <section class="block tile-info">${this.selectedTile !== null ? this.tileCard(this.selectedTile) : '<h4>Property info</h4><p class="muted sm">Tap any tile on the board to inspect it.</p>'}</section>
    <section class="block log"><h4>Activity <button class="link" data-ui="history">All transactions →</button></h4>
      <ul>${log.map(l => {
        const p = l.playerId ? s.players.find(x => x.id === l.playerId) : null;
        return `<li class="${l.tone ?? ''}" style="--pc:${p?.color ?? '#888'}">${esc(l.text)}</li>`;
      }).join('')}</ul>
    </section>`;
  }

  private currentActionText() {
    const s = this.s, h = this.e.head, actor = this.e.actor;
    if (!actor) return 'Game over.';
    const who = `<b>${esc(actor.name)}</b>`;
    if (this.busy) return `${who} — animating…`;
    if (h) {
      switch (h.kind) {
        case 'buy': return `${who} is deciding whether to buy <b>${esc(TILES[h.tileId].name)}</b>.`;
        case 'pay': return `${who} owes <b>${money(h.amount)}</b> — ${esc(h.reason)}.`;
        case 'collect': return `${who} is collecting <b>${money(h.amount)}</b>.`;
        case 'auction': return `Auction for <b>${esc(TILES[h.tileId].name)}</b>: high bid ${money(h.highBid)}. ${who} to bid.`;
        case 'card': return `${who} drew a ${DECK_TITLE[h.deck]} card.`;
        case 'trade': return `${who} is reviewing a trade offer.`;
        case 'choose': return `${who} is choosing a destination.`;
        default: return `${who}: ${esc(h.title)}.`;
      }
    }
    if (s.phase === 'roll') return actor.inJail && !s.rolledThisTurn ? `${who} is in jail — roll for doubles, pay bail or use a card.` : `${who} to roll the dice${s.canRollAgain ? ' again (doubles!)' : ''}.`;
    return `${who} can build, trade or mortgage, then end the turn.${this.e.timeUp ? ' <b class="bad">Time is up — this is the final turn.</b>' : ''}`;
  }

  private tileCard(i: number) {
    const s = this.s, t = TILES[i];
    if (!M.isOwnable(i)) {
      const desc: Record<string, string> = {
        start: `Collect ${money(s.rules.salary)} salary every time you pass.`, jail: 'Just visiting — or serving time.',
        parking: s.rules.freeParkingPot ? `Land here to win the jackpot (${money(s.pot)}).` : 'A free resting spot.',
        gotojail: 'Go directly to Jail.', chance: 'Draw a Chance card.', community: 'Draw a Community Chest card.',
        tax: `Pay ${money(t.tax ?? 0)} to the ${s.rules.freeParkingPot ? 'Free Parking pot' : 'bank'}.`,
      };
      return `<h4>${esc(t.name)}</h4><p class="muted sm">${desc[t.kind] ?? ''}</p>`;
    }
    const ps = s.props[i], g = GROUP_BY_ID[t.group!];
    const owner = ps.owner ? M.getPlayer(s, ps.owner) : null;
    let rows = '';
    if (t.kind === 'property') {
      const labels = ['Rent', 'With 1 house', 'With 2 houses', 'With 3 houses', 'With 4 houses', 'With hotel'];
      rows = t.rent!.map((r, k) => `<tr class="${ps.owner && ps.houses === k ? 'on' : ''}"><td>${labels[k]}</td><td>${money(r)}</td></tr>`).join('')
        + `<tr><td>Full group (no houses)</td><td>${money(t.rent![0] * 2)}</td></tr><tr><td>House / hotel cost</td><td>${money(t.houseCost!)}</td></tr>`;
    } else if (t.kind === 'railway') rows = RAIL_RENT.map((r, k) => `<tr><td>${k + 1} railway${k ? 's' : ''} owned</td><td>${money(r)}</td></tr>`).join('');
    else rows = '<tr><td>1 utility owned</td><td>4 × dice</td></tr><tr><td>Both utilities</td><td>10 × dice</td></tr>';
    return `<div class="deed" style="--gc:${g.color}">
      <div class="deed-band"><small>${esc(g.name)}</small><b>${esc(t.name)}</b></div>
      <table>${rows}<tr><td>Mortgage value</td><td>${money(t.mortgage!)}</td></tr></table>
      <div class="deed-foot"><span>Price ${money(t.price!)}</span><span>${owner ? `Owner: ${chip(owner)}` : 'Unowned'}</span></div>
      ${ps.mortgaged ? '<div class="stamp">MORTGAGED</div>' : ''}
      ${ps.houses ? `<div class="deed-b">${ps.houses === 5 ? '🏨 Hotel' : `🏠 × ${ps.houses}`}</div>` : ''}
    </div>`;
  }

  /** Card for any space: a title deed for properties, an illustrated card for the rest. */
  private placeCard(i: number) {
    if (M.isOwnable(i)) return this.tileCard(i);
    const s = this.s, t = TILES[i];
    const spec: Record<string, [string, string, string]> = {
      start: ['🏁', '#D7263D', `Collect ${money(s.rules.salary)} salary every time you pass Start.${s.rules.doubleSalaryOnStart ? ` Land exactly here for ${money(s.rules.salary * 2)}.` : ''}`],
      jail: ['🔒', '#F08A24', `Just visiting — or serving time. Leave by rolling doubles, paying ${money(s.rules.bail)} bail, or using a Get Out of Jail Free card.`],
      parking: ['🅿️', '#1F9D55', s.rules.freeParkingPot ? `Land here to win the Free Parking jackpot — currently ${money(s.pot)}.` : 'A free resting spot. Nothing happens here.'],
      gotojail: ['🚔', '#2A4BA0', 'Go directly to Jail. Do not pass Start, do not collect salary.'],
      chance: ['❓', '#E76F1E', 'Draw a Chance card: it may reward you, fine you or move you.'],
      community: ['🧰', '#138A8A', 'Draw a Community Chest card: rewards, fees and surprises.'],
      tax: [i === 4 ? '💰' : '💎', '#7A3E9D', `Pay ${money(t.tax ?? 0)} to the ${s.rules.freeParkingPot ? 'Free Parking pot' : 'bank'}.`],
    };
    const [ico, col, text] = spec[t.kind] ?? ['📍', '#555', ''];
    return `<div class="deed spot" style="--gc:${col}">
      <div class="deed-band"><small>Space ${i}</small><b>${esc(t.name)}</b></div>
      <div class="spot-ico">${ico}</div><p class="spot-text">${text}</p></div>`;
  }

  private landedStatus(i: number, p: Player) {
    const s = this.s, t = TILES[i];
    if (M.isOwnable(i)) {
      const ps = s.props[i];
      if (!ps.owner) return { tone: 'sale', text: `For sale · ${money(t.price!)}` };
      if (ps.owner === p.id) return { tone: 'mine', text: 'Your property — no rent due' };
      const o = M.getPlayer(s, ps.owner);
      if (ps.mortgaged) return { tone: 'info', text: `Mortgaged by ${esc(o.name)} — no rent` };
      const h = this.e.head;
      const due = h?.kind === 'pay' && h.tileId === i && h.playerId === p.id ? h.amount : M.calcRent(s, i, s.lastDice ? s.lastDice[0] + s.lastDice[1] : 7);
      return { tone: 'due', text: `Owned by ${chip(o)} · rent ${money(due)}` };
    }
    const map: Record<string, { tone: string; text: string }> = {
      tax: { tone: 'due', text: `Tax due · ${money(t.tax ?? 0)}` },
      chance: { tone: 'info', text: 'Drawing a Chance card' },
      community: { tone: 'info', text: 'Drawing a Community Chest card' },
      gotojail: { tone: 'due', text: 'Off to Jail!' },
      jail: { tone: 'info', text: p.inJail ? 'In Jail' : 'Just visiting' },
      parking: { tone: 'mine', text: s.rules.freeParkingPot && s.pot ? `Jackpot · ${money(s.pot)}` : 'Free rest stop' },
      start: { tone: 'mine', text: 'Salary collected' },
    };
    return map[t.kind] ?? { tone: 'info', text: '' };
  }

  private landedFor: number | null = null;
  private tileTip(i: number | null, x: number, y: number) {
    const el = $('#tile-tip');
    if (!el) return;
    if (i === null || this.modal) { el.hidden = true; return; }
    const t = TILES[i], ps = this.s.props[i];
    const g = t.group ? GROUP_BY_ID[t.group] : null;
    const owner = ps?.owner ? M.getPlayer(this.s, ps.owner) : null;
    const extra = M.isOwnable(i)
      ? `${owner ? `${icon(owner)} ${esc(owner.name)}${ps.mortgaged ? ' · mortgaged' : ` · rent ${money(M.calcRent(this.s, i, 7))}`}` : `For sale · ${money(t.price!)}`}${ps.houses ? ` · ${ps.houses === 5 ? '🏨' : '🏠×' + ps.houses}` : ''}`
      : t.kind === 'tax' ? `Pay ${money(t.tax!)}` : '';
    el.innerHTML = `${g && t.kind === 'property' ? `<i style="background:${g.color}"></i>` : ''}<b>${esc(t.name)}</b>${extra ? `<small>${extra}</small>` : ''}`;
    el.hidden = false;
    el.style.left = `${Math.min(window.innerWidth - 230, x + 16)}px`;
    el.style.top = `${y + 18}px`;
  }

  /** Inspect any space: same side card, without a player landing. */
  private showPlace(i: number) { this.showLanded(null, i); }
  private showLanded(pid: string | null, i: number) {
    const viewer = M.currentPlayer(this.s);
    const p = pid ? M.getPlayer(this.s, pid) : null;
    const el = $('#landed');
    const st = this.landedStatus(i, p ?? viewer);
    this.landedFor = i;
    this.scene.markTile(i, p?.color ?? '#ffe27a');
    el.style.setProperty('--pc', p?.color ?? '#e8c268');
    el.innerHTML = `<div class="ld-head"><span class="ld-tok">${p ? icon(p) : '🔎'}</span><span><small>${p ? `${esc(p.name)} landed on` : `Space ${i} · tap other tiles to compare`}</small><b>${esc(TILES[i].name)}</b></span>
      <button class="x sm" data-ld="close" aria-label="Close">✕</button></div>
      <div class="ld-card">${this.placeCard(i)}</div>
      <div class="ld-status ${st.tone}">${st.text}</div>`;
    el.hidden = false;
    el.classList.remove('in'); void el.offsetWidth; el.classList.add('in');
    $('[data-ld="close"]', el).addEventListener('click', ev => { ev.stopPropagation(); this.hideLanded(); });
    // On phones the card starts as a compact strip; tap it to see the full card.
    $('.ld-head', el).addEventListener('click', () => el.classList.toggle('open'));
    if (!p) el.classList.add('open');
  }
  private refreshLanded() {
    if (this.landedFor === null || $('#landed').hidden) return;
    const st = this.landedStatus(this.landedFor, M.currentPlayer(this.s));
    const box = $('#landed .ld-status');
    const card = $('#landed .ld-card');
    if (card) card.innerHTML = this.placeCard(this.landedFor);
    if (box) { box.className = `ld-status ${st.tone}`; box.innerHTML = st.text; }
  }
  private hideLanded() {
    this.landedFor = null;
    const el = $('#landed');
    if (el) { el.hidden = true; el.innerHTML = ''; }
    this.scene.markTile(null);
  }

  private canHumanManage() {
    const cur = M.currentPlayer(this.s);
    return !this.busy && !cur.isAI && !this.e.head && this.s.phase !== 'over';
  }

  private actionBar() {
    const s = this.s, cur = M.currentPlayer(s), h = this.e.head;
    if (s.phase === 'over') return '';
    if (cur.isAI && !(h && !M.getPlayer(s, h.playerId).isAI)) {
      return `<div class="ai-wait" style="--pc:${cur.color}"><span class="spin">${icon(cur)}</span> ${esc(cur.name)} is playing… <small>${PERSONALITIES[cur.personality!].label}</small></div>`;
    }
    const manage = this.canHumanManage();
    const canRoll = manage && s.phase === 'roll';
    const canBuy = !this.busy && h?.kind === 'buy' && !M.getPlayer(s, h.playerId).isAI;
    const jail = manage && cur.inJail && !s.rolledThisTurn;
    const btn = (ui: string, label: string, ico: string, on: boolean, cls = '') =>
      `<button class="abtn ${cls}" data-ui="${ui}" ${on ? '' : 'disabled'}><span>${ico}</span>${label}</button>`;
    return `
      ${btn('roll', canRoll && s.canRollAgain ? 'Roll Again' : jail ? 'Roll for Doubles' : 'Roll Dice', '🎲', canRoll, 'primary')}
      ${btn('buy', 'Buy', '🏷️', !!canBuy)}
      ${btn('build', 'Build', '🏗️', manage)}
      ${btn('trade', 'Trade', '🤝', manage)}
      ${btn('mortgage', 'Mortgage', '🏦', manage)}
      ${jail ? btn('jail', 'Jail', '🔓', true, 'warn') : ''}
      ${btn('end', 'End Turn', '⏭️', manage && s.phase === 'end', 'gold')}`;
  }

  private renderCoach() {
    const el = $('#coach');
    if (this.s.mode !== 'tutorial' || this.coachOff) { el.hidden = true; return; }
    const s = this.s, h = this.e.head, cur = M.currentPlayer(s);
    let tip = '';
    if (cur.isAI && !h) tip = 'Your opponent is playing. Watch the coins fly whenever money changes hands.';
    else if (h?.kind === 'buy') tip = 'You landed on an unowned property. <b>Buy</b> it to collect rent from others — or decline to send it to auction.';
    else if (h?.kind === 'pay') tip = h.txType === 'rent' ? 'Rent is due! Tap coins to count out the amount (or tap <b>Count for me</b>), then pay.' : 'Every tax and fine is paid by counting coins into the tray.';
    else if (h?.kind === 'collect') tip = 'Money in! Tap <b>Collect</b> to pull the coins into your wallet.';
    else if (h?.kind === 'card') tip = 'Cards can reward you, fine you or move you. Read it, then apply it.';
    else if (h?.kind === 'auction') tip = 'Auction! Raise the bid with the + buttons, or pass. Highest bidder wins.';
    else if (s.phase === 'roll' && !s.rolledThisTurn) tip = cur.inJail ? 'You are in jail. Roll for doubles, pay bail, or use a Get Out of Jail Free card.' : 'Tap <b>🎲 Roll Dice</b> (or press Space). Your token moves automatically.';
    else if (s.phase === 'roll') tip = 'Doubles! You get to roll again.';
    else if (s.phase === 'end') {
      const full = GROUPS.some(g => g.id !== 'rail' && g.id !== 'utility' && M.ownsGroup(s, cur.id, g.id));
      tip = full ? 'You own a full colour group! Open <b>🏗️ Build</b> to add houses — rent jumps a lot.' : 'Done? Tap <b>⏭️ End Turn</b>. You can also Trade or Mortgage first. Tap tiles to inspect them.';
    }
    el.hidden = !tip;
    el.innerHTML = `<span class="coach-ico">💡</span><p>${tip}</p><button class="link" data-ui="coachoff">Hide tips</button>`;
  }

  private animateCash(pid: string, to: number) {
    const from = this.shownCash.get(pid) ?? to;
    this.shownCash.set(pid, to);
    const els = $$(`[data-cash="${pid}"]`);
    if (from === to || !els.length) { els.forEach(el => { if (!M.getPlayer(this.s, pid).bankrupt) el.textContent = money(to); }); return; }
    const t0 = performance.now();
    els.forEach(el => el.classList.add(to > from ? 'up' : 'down'));
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / 700);
      const v = from + (to - from) * (1 - (1 - k) ** 3);
      $$(`[data-cash="${pid}"]`).forEach(el => { el.textContent = money(v); });
      if (k < 1) requestAnimationFrame(step); else $$(`[data-cash="${pid}"]`).forEach(el => el.classList.remove('up', 'down'));
    };
    requestAnimationFrame(step);
  }

  private diceBadge(d1: number, d2: number) {
    const el = $('#dice-badge');
    const pips = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
    el.innerHTML = `<span>${pips[d1]}</span><span>${pips[d2]}</span><b>${d1 + d2}</b>${d1 === d2 ? '<em>DOUBLES</em>' : ''}`;
    el.hidden = false; el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop');
    setTimeout(() => { el.hidden = true; }, 2600);
  }

  private turnBanner(p: Player) {
    const human = this.s.players.filter(x => !x.isAI && !x.bankrupt).length;
    toast(`${icon(p)} Turn → <b>${esc(p.name)}</b>${!p.isAI && human > 1 ? ' — pass the device' : ''}`, 'info', 1800);
  }

  private txToast(tx: { sender: string; receiver: string; amount: number; reason: string }) {
    const n = (e: string) => esc(M.entityName(this.s, e));
    toast(`💰 ${n(tx.sender)} → ${n(tx.receiver)} <b>${money(tx.amount)}</b><br><small>${esc(tx.reason)}</small>`, 'info', 2200);
  }

  private selectTile(i: number) {
    this.selectedTile = i;
    sound.play('click');
    this.render();
    this.showPlace(i);
  }

  /* ───────────── input ───────────── */
  private onHudClick(ev: MouseEvent) {
    const b = (ev.target as HTMLElement).closest<HTMLElement>('[data-ui]');
    if (!b || (b as HTMLButtonElement).disabled) return;
    sound.play('click');
    const cur = M.currentPlayer(this.s);
    switch (b.dataset.ui) {
      case 'roll': this.act({ type: 'roll', playerId: cur.id }); break;
      case 'end': this.act({ type: 'endTurn', playerId: cur.id }); break;
      case 'buy': { const h = this.e.head; if (h?.kind === 'buy') this.act({ type: 'buy', playerId: h.playerId, promptId: h.id }); break; }
      case 'build': this.openPanel('build'); break;
      case 'trade': this.openPanel('trade'); break;
      case 'mortgage': this.openPanel('mortgage'); break;
      case 'jail': this.openPanel('jail'); break;
      case 'history': this.openPanel('history'); break;
      case 'settings': this.openPanel('settings'); break;
      case 'pause': this.openPanel('pause'); break;
      case 'portfolio': this.portfolioPid = b.dataset.pid!; this.openPanel('portfolio'); break;
      case 'tile': this.selectTile(Number(b.dataset.tile)); break;
      case 'coachoff': this.coachOff = true; this.renderCoach(); break;
      case 'left': this.leftOpen = !this.leftOpen; if (window.innerWidth < 900) this.rightOpen = false; this.render(); break;
      case 'right': this.rightOpen = !this.rightOpen; if (window.innerWidth < 900) this.leftOpen = false; this.render(); break;
      case 'cam-l': this.scene.rotateView(-1); break;
      case 'cam-r': this.scene.rotateView(1); break;
      case 'cam-top': this.scene.toggleTopView().then(() => this.render()); this.render(); break;
      case 'cam-in': this.scene.zoom(0.82); break;
      case 'cam-out': this.scene.zoom(1.22); break;
      case 'cam-c': this.scene.recenter(); break;
    }
  }
  private portfolioPid = '';

  private onKey(ev: KeyboardEvent) {
    if ((ev.target as HTMLElement).matches('input, select, textarea')) return;
    const cur = M.currentPlayer(this.s);
    if (ev.key === 'Escape') { if (this.modal?.startsWith('panel:')) this.closeModal(); else if (!this.modal) this.openPanel('pause'); return; }
    if (this.modal || cur.isAI) return;
    if (ev.key === ' ' || ev.key === 'r') { ev.preventDefault(); this.act({ type: 'roll', playerId: cur.id }); }
    if (ev.key === 'e') this.act({ type: 'endTurn', playerId: cur.id });
  }

  /* ───────────── modals ───────────── */
  private openModal(key: string, html: string, cls = '') {
    this.modal = key;
    this.modalEl.innerHTML = `<div class="sheet ${cls}">${html}</div>`;
    this.modalEl.hidden = false;
    document.body.classList.add('modal-open');
    this.modalEl.onclick = ev => { if (ev.target === this.modalEl && key.startsWith('panel:')) this.closeModal(); };
  }
  private closeModal() {
    this.modal = null;
    this.modalEl.hidden = true;
    this.modalEl.innerHTML = '';
    document.body.classList.remove('modal-open');
  }
  private bind(sel: string, fn: (el: HTMLElement) => void) {
    $$(sel, this.modalEl).forEach(el => el.addEventListener('click', () => { if (!(el as HTMLButtonElement).disabled) { sound.play('click'); fn(el); } }));
  }

  /** Show the popup for the head prompt if a human must act on it. */
  private syncPrompt() {
    const h = this.e.head;
    if (!h) { if (this.modal?.startsWith('prompt:')) this.closeModal(); this.render(); return; }
    const actor = M.getPlayer(this.s, h.playerId);
    if (actor.isAI) { if (this.modal?.startsWith('prompt:')) this.closeModal(); return; }
    const key = `prompt:${h.id}:${h.kind === 'auction' ? h.playerId + h.highBid : ''}`;
    if (this.modal === key) return;
    this.renderPrompt(h, actor, key);
  }

  private who(p: Player) {
    const humans = this.s.players.filter(x => !x.isAI && !x.bankrupt).length;
    return humans > 1 ? `<div class="whose" style="--pc:${p.color}">${icon(p)} ${esc(p.name)}, it's your decision</div>` : '';
  }

  private renderPrompt(h: Prompt, p: Player, key: string) {
    const s = this.s;
    const base = { playerId: p.id, promptId: h.id };
    switch (h.kind) {
      case 'buy': {
        const t = TILES[h.tileId], afford = p.cash >= t.price!;
        this.openModal(key, `${this.who(p)}
          <h2 class="mh">Property for sale</h2>
          <div class="deed3d"><div class="deed3d-in">${this.tileCard(h.tileId)}<div class="house3d"></div></div></div>
          <dl class="rows"><dt>Purchase price</dt><dd class="big">${money(t.price!)}</dd>
            <dt>Your balance</dt><dd>${money(p.cash)}</dd><dt>Balance after</dt><dd class="${afford ? '' : 'bad'}">${money(p.cash - t.price!)}</dd>
            ${t.houseCost ? `<dt>House cost</dt><dd>${money(t.houseCost)}</dd>` : ''}<dt>Colour group</dt><dd>${esc(GROUP_BY_ID[t.group!].name)}</dd></dl>
          ${afford ? '' : '<p class="warnline">You cannot afford this property. Mortgage or sell first, or decline.</p>'}
          <div class="row2"><button class="btn" data-b="decline">${s.rules.auctions ? 'Decline → Auction' : 'Decline'}</button>
          <button class="btn gold lg" data-b="buy" ${afford ? '' : 'disabled'}>Buy for ${money(t.price!)}</button></div>`, 'buy');
        this.bind('[data-b="buy"]', () => this.act({ type: 'buy', ...base }));
        this.bind('[data-b="decline"]', () => this.act({ type: 'decline', ...base }));
        break;
      }
      case 'pay': this.payModal(h, p, key); break;
      case 'collect': {
        this.openModal(key, `${this.who(p)}
          <div class="collect"><div class="big-coin">$</div>
          <h2>${esc(h.title)}</h2><p class="muted">${esc(h.reason)}</p>
          <div class="amount good">+${money(h.amount)}</div>
          <dl class="rows"><dt>From</dt><dd>${esc(M.entityName(s, h.from))}</dd><dt>Your balance</dt><dd>${money(p.cash)}</dd><dt>Balance after</dt><dd>${money(p.cash + h.amount)}</dd></dl>
          <button class="btn gold lg" data-b="ok">Collect ${money(h.amount)}</button></div>`, 'collect-sheet');
        this.bind('[data-b="ok"]', () => this.act({ type: 'confirm', ...base }));
        break;
      }
      case 'card': {
        const c = CARD_BY_ID[h.cardId];
        this.openModal(key, `${this.who(p)}
          <div class="flipcard ${h.deck}" id="flip"><div class="fc-in">
            <div class="fc-back">${h.deck === 'chance' ? '<b>?</b><span>CHANCE</span>' : '<span>COMMUNITY<br>CHEST</span>'}</div>
            <div class="fc-front"><small>${DECK_TITLE[h.deck]}</small><p>${esc(c.text)}</p></div></div></div>
          <button class="btn gold lg" data-b="ok">Apply card</button>`, 'card-sheet');
        setTimeout(() => $('#flip', this.modalEl)?.classList.add('flipped'), 350);
        this.bind('#flip', el => el.classList.add('flipped'));
        this.bind('[data-b="ok"]', () => this.act({ type: 'confirm', ...base }));
        break;
      }
      case 'notice': {
        const jail = h.after?.type === 'jail' || h.title.includes('Jail');
        this.openModal(key, `${this.who(p)}<div class="notice"><div class="n-ico">${jail ? '🚔' : 'ℹ️'}</div><h2>${esc(h.title)}</h2><p>${esc(h.text)}</p>
          <button class="btn ${jail ? 'danger' : 'gold'} lg" data-b="ok">${h.after?.type === 'jail' ? 'Go to Jail' : 'OK'}</button></div>`);
        this.bind('[data-b="ok"]', () => this.act({ type: 'confirm', ...base }));
        break;
      }
      case 'choose': {
        this.openModal(key, `${this.who(p)}<h2 class="mh">${esc(h.title)}</h2><p class="muted">${esc(h.text)}</p>
          <div class="choose">${TILES.filter(t => M.isOwnable(t.id)).map(t => {
            const o = s.props[t.id].owner;
            return `<button class="tp" data-tile="${t.id}" style="border-left:6px solid ${GROUP_BY_ID[t.group!].color}">${esc(t.name)} <small>${o ? `owned by ${esc(M.getPlayer(s, o).name)}` : money(t.price!)}</small></button>`;
          }).join('')}</div>`);
        this.bind('[data-tile]', el => this.act({ type: 'choose', ...base, tileId: Number(el.dataset.tile) }));
        break;
      }
      case 'auction': {
        const t = TILES[h.tileId];
        const hb = h.highBidder ? M.getPlayer(s, h.highBidder) : null;
        const minBid = h.highBid + 1;
        this.openModal(key, `${this.who(p)}
          <h2 class="mh">Auction · ${esc(t.name)}</h2>
          <div class="auction-top"><div><small>Current high bid</small><b class="big">${money(h.highBid)}</b><span>${hb ? chip(hb) : 'No bids yet'}</span></div>
          <div><small>List price</small><b>${money(t.price!)}</b></div></div>
          <div class="bidders">${h.active.map(id => { const q = M.getPlayer(s, id); return `<span class="chip ${id === p.id ? 'on' : ''}" style="--pc:${q.color}">${icon(q)} ${esc(q.name)}</span>`; }).join('')}</div>
          <label class="bid-in">Your bid (cash ${money(p.cash)})<input class="inp" type="number" id="bid" min="${minBid}" max="${p.cash}" value="${Math.min(p.cash, h.highBid + 10)}"></label>
          <div class="row3">${[10, 50, 100].map(v => `<button class="btn sm" data-inc="${v}">+${v}</button>`).join('')}</div>
          <div class="row2"><button class="btn" data-b="pass">Pass</button><button class="btn gold lg" data-b="bid" ${p.cash < minBid ? 'disabled' : ''}>Place bid</button></div>`);
        const inp = $<HTMLInputElement>('#bid', this.modalEl);
        this.bind('[data-inc]', el => { inp.value = String(Math.min(p.cash, Math.max(minBid, Number(inp.value) || 0) + Number(el.dataset.inc) - (Number(inp.value) >= minBid ? 0 : Number(el.dataset.inc)))); });
        this.bind('[data-b="pass"]', () => this.act({ type: 'pass', ...base }));
        this.bind('[data-b="bid"]', () => this.act({ type: 'bid', ...base, amount: Math.floor(Number(inp.value)) }));
        break;
      }
      case 'trade': {
        const o = h.offer, from = M.getPlayer(s, o.from);
        this.openModal(key, `${this.who(p)}<h2 class="mh">Trade offer from ${chip(from)}</h2>
          ${this.tradeSummary(o)}
          <div class="row2"><button class="btn danger" data-b="no">Reject</button><button class="btn gold lg" data-b="yes">Accept trade</button></div>`);
        this.bind('[data-b="yes"]', () => this.act({ type: 'respondTrade', ...base, accept: true }));
        this.bind('[data-b="no"]', () => this.act({ type: 'respondTrade', ...base, accept: false }));
        break;
      }
    }
  }

  private tradeSummary(o: TradeOffer) {
    const s = this.s, a = M.getPlayer(s, o.from), b = M.getPlayer(s, o.to);
    const side = (p: Player, props: number[], cash: number, cards: number) => `<div class="ts"><h4>${chip(p)} gives</h4><ul>
      ${props.map(t => `<li><span class="sw" style="background:${GROUP_BY_ID[TILES[t].group!].color}"></span>${esc(TILES[t].name)}${s.props[t].mortgaged ? ' <em>(mortgaged)</em>' : ''}</li>`).join('')}
      ${cash ? `<li>💰 ${money(cash)}</li>` : ''}${cards ? `<li>🎟 ${cards} jail card</li>` : ''}
      ${!props.length && !cash && !cards ? '<li class="muted">Nothing</li>' : ''}</ul></div>`;
    return `<div class="trade-sum">${side(a, o.giveProps, o.giveCash, o.giveJailCards)}<div class="swap">⇄</div>${side(b, o.getProps, o.getCash, o.getJailCards)}</div>`;
  }

  /** Interactive payment: count coins into a tray, or resolve debt when short. */
  private payModal(h: PayPrompt, p: Player, key: string) {
    const s = this.s;
    const afford = p.cash >= h.amount;
    const ico = h.txType === 'rent' ? '🏠' : h.txType === 'tax' ? '🧾' : h.txType === 'bail' ? '🔒' : h.txType === 'reward' ? '🎁' : '⚖️';
    const to = h.split ? `${h.split.length} players (${money(h.amount / h.split.length)} each)` : esc(M.entityName(s, h.to));
    const rows = `<dl class="rows">
      ${h.tileId !== undefined && h.txType === 'rent' ? `<dt>Property</dt><dd>${esc(TILES[h.tileId].name)}</dd><dt>Owner</dt><dd>${chip(M.getPlayer(s, h.to))}</dd>` : `<dt>Reason</dt><dd>${esc(h.reason)}</dd><dt>Pay to</dt><dd>${to}</dd>`}
      <dt>Amount due</dt><dd class="big bad">${money(h.amount)}</dd>
      <dt>Your balance</dt><dd>${money(p.cash)}</dd>
      <dt>Balance after payment</dt><dd class="${afford ? '' : 'bad'}">${money(p.cash - h.amount)}</dd></dl>`;
    const btnLabel = h.txType === 'rent' ? 'Pay Rent' : h.txType === 'tax' ? 'Pay Tax' : h.txType === 'bail' ? 'Pay Bail' : 'Pay';
    if (afford) {
      let counted: number[] = [];
      this.openModal(key, `${this.who(p)}
        <div class="pay-head"><span>${ico}</span><h2>${esc(h.title)}</h2></div>${rows}
        <div class="tray"><div class="tray-coins" id="tray"></div><div class="tray-sum" id="traysum"></div></div>
        <div class="wallet">${DENOMS.map(d => `<button class="wcoin w${d >= 100 ? 'g' : d >= 20 ? 's' : 'b'}" data-d="${d}">${d}</button>`).join('')}</div>
        <div class="row2"><button class="btn sm" data-b="auto">Count for me</button><button class="btn sm" data-b="clear">Clear tray</button></div>
        <button class="btn gold lg" data-b="pay" disabled>${btnLabel} ${money(h.amount)}</button>`, 'pay');
      const upd = () => {
        const sum = counted.reduce((a, b) => a + b, 0);
        $('#tray', this.modalEl).innerHTML = counted.slice(-24).map(d => `<i class="tc w${d >= 100 ? 'g' : d >= 20 ? 's' : 'b'}">${d}</i>`).join('');
        $('#traysum', this.modalEl).innerHTML = `Counted <b>${money(sum)}</b> of ${money(h.amount)}${sum > h.amount ? ` · change <b>${money(sum - h.amount)}</b> returned` : ''}`;
        ($('[data-b="pay"]', this.modalEl) as HTMLButtonElement).disabled = sum < h.amount;
        $$<HTMLButtonElement>('[data-d]', this.modalEl).forEach(b => { b.disabled = sum >= h.amount || sum + Number(b.dataset.d) > p.cash; });
      };
      upd();
      this.bind('[data-d]', el => { counted.push(Number(el.dataset.d)); sound.play('coinOut'); upd(); });
      this.bind('[data-b="clear"]', () => { counted = []; upd(); });
      this.bind('[data-b="auto"]', () => {
        counted = []; let left = h.amount;
        for (const d of DENOMS) while (left >= d) { counted.push(d); left -= d; }
        sound.play('coinOut'); upd();
      });
      this.bind('[data-b="pay"]', () => this.act({ type: 'confirm', playerId: p.id, promptId: h.id }));
      return;
    }
    // Debt resolution
    const owned = M.ownedTiles(s, p.id);
    const sellable = owned.filter(t => !M.canSell(s, p.id, t));
    const mortgageable = owned.filter(t => !M.canMortgage(s, p.id, t));
    const liq = M.liquidationValue(s, p.id);
    this.openModal(key, `${this.who(p)}
      <div class="pay-head debt"><span>⚠️</span><h2>${esc(h.title)} — not enough cash</h2></div>${rows}
      <div class="debt-box"><div><small>Outstanding debt</small><b>${money(h.amount)}</b></div><div><small>Cash</small><b>${money(p.cash)}</b></div>
        <div><small>Shortfall</small><b class="bad">${money(h.amount - p.cash)}</b></div><div><small>Max you can raise</small><b>${money(liq)}</b></div></div>
      <p class="muted sm">${liq >= h.amount ? 'Raise funds by selling buildings or mortgaging properties, then pay.' : 'Even selling everything won’t cover this debt. You can try a trade, or declare bankruptcy.'}</p>
      ${sellable.length ? `<h4>Sell buildings (half price)</h4><div class="debt-list">${sellable.map(t => `<button class="btn sm" data-sell="${t}">${esc(TILES[t].name)} ${s.props[t].houses === 5 ? '🏨' : '🏠'} +${money(TILES[t].houseCost! / 2)}</button>`).join('')}</div>` : ''}
      ${mortgageable.length ? `<h4>Mortgage properties</h4><div class="debt-list">${mortgageable.map(t => `<button class="btn sm" data-mort="${t}">${esc(TILES[t].name)} +${money(TILES[t].mortgage!)}</button>`).join('')}</div>` : ''}
      <div class="row2"><button class="btn danger" data-b="bankrupt">Declare bankruptcy</button><button class="btn gold" data-b="pay" disabled>${btnLabel} ${money(h.amount)}</button></div>`, 'pay');
    this.bind('[data-sell]', el => this.act({ type: 'sell', playerId: p.id, tileId: Number(el.dataset.sell) }).then(() => this.refreshPrompt()));
    this.bind('[data-mort]', el => this.act({ type: 'mortgage', playerId: p.id, tileId: Number(el.dataset.mort) }).then(() => this.refreshPrompt()));
    this.bind('[data-b="bankrupt"]', el => {
      if (el.dataset.sure) this.act({ type: 'bankrupt', playerId: p.id, promptId: h.id });
      else { el.dataset.sure = '1'; el.textContent = 'Tap again to confirm bankruptcy'; }
    });
  }
  private refreshPrompt() { this.modal = null; this.syncPrompt(); }

  /* ───────────── panel modals ───────────── */
  private openPanel(kind: PanelModal) {
    if (this.modal?.startsWith('prompt:')) return;
    const s = this.s, cur = M.currentPlayer(s), key = `panel:${kind}`;
    const close = '<button class="x" data-b="close" aria-label="Close">✕</button>';
    switch (kind) {
      case 'build': {
        const groups = GROUPS.filter(g => g.id !== 'rail' && g.id !== 'utility' && M.ownsGroup(s, cur.id, g.id));
        this.openModal(key, `${close}<h2 class="mh">🏗️ Building management</h2>
          <p class="muted sm">Bank supply: 🏠 ${s.housesLeft} houses · 🏨 ${s.hotelsLeft} hotels · Your cash ${money(cur.cash)}</p>
          ${groups.length ? groups.map(g => `<div class="bgroup" style="--gc:${g.color}"><h4>${esc(g.name)}</h4>
            ${g.tiles.map(t => {
              const ps = s.props[t], tt = TILES[t];
              const bErr = M.canBuild(s, cur.id, t), sErr = M.canSell(s, cur.id, t);
              const next = ps.houses === 4 ? 'Hotel' : ps.houses === 5 ? '—' : `House ${ps.houses + 1}`;
              return `<div class="brow"><div class="b-name"><b>${esc(tt.name)}</b><span class="b-vis">${ps.houses === 5 ? '🏨' : '🏠'.repeat(ps.houses) || '<em>empty</em>'}</span>
                <small>Rent now ${money(M.calcRent(s, t, 7))}${ps.houses < 5 ? ` → ${money(tt.rent![ps.houses + 1])}` : ''}</small></div>
                <button class="btn sm gold" data-build="${t}" ${bErr ? `disabled title="${esc(bErr)}"` : ''}>${next === '—' ? 'Max' : `Build ${next} · ${money(tt.houseCost!)}`}</button>
                <button class="btn sm" data-sellb="${t}" ${sErr ? `disabled title="${esc(sErr)}"` : ''}>Sell +${money(tt.houseCost! / 2)}</button></div>`;
            }).join('')}</div>`).join('')
          : '<p class="empty">You need to own every property in a colour group before you can build. Trade with other players to complete a set.</p>'}`, 'wide');
        this.bind('[data-build]', el => this.act({ type: 'build', playerId: cur.id, tileId: Number(el.dataset.build) }).then(() => this.openPanel('build')));
        this.bind('[data-sellb]', el => this.act({ type: 'sell', playerId: cur.id, tileId: Number(el.dataset.sellb) }).then(() => this.openPanel('build')));
        break;
      }
      case 'mortgage': {
        const owned = M.ownedTiles(s, cur.id);
        this.openModal(key, `${close}<h2 class="mh">🏦 Mortgages</h2>
          <p class="muted sm">Mortgaged properties collect no rent. Unmortgaging costs the mortgage value plus ${Math.round(s.rules.mortgageInterest * 100)}% interest.</p>
          ${owned.length ? `<div class="mlist">${owned.map(t => {
            const ps = s.props[t], tt = TILES[t];
            const err = ps.mortgaged ? M.canUnmortgage(s, cur.id, t) : M.canMortgage(s, cur.id, t);
            return `<div class="brow ${ps.mortgaged ? 'mort' : ''}"><span class="sw" style="background:${GROUP_BY_ID[tt.group!].color}"></span>
              <div class="b-name"><b>${esc(tt.name)}</b><small>${ps.mortgaged ? `Mortgaged · unmortgage ${money(M.unmortgageCost(s, t))}` : `Mortgage value ${money(tt.mortgage!)}`}</small></div>
              <button class="btn sm ${ps.mortgaged ? 'gold' : ''}" data-m="${t}" ${err ? `disabled title="${esc(err)}"` : ''}>${ps.mortgaged ? 'Unmortgage' : `Mortgage +${money(tt.mortgage!)}`}</button></div>`;
          }).join('')}</div>` : '<p class="empty">You don’t own any properties yet.</p>'}`, 'wide');
        this.bind('[data-m]', el => {
          const t = Number(el.dataset.m);
          this.act({ type: s.props[t].mortgaged ? 'unmortgage' : 'mortgage', playerId: cur.id, tileId: t }).then(() => this.openPanel('mortgage'));
        });
        break;
      }
      case 'trade': this.tradePanel(); return;
      case 'history': {
        const filter = this.historyFilter;
        const txs = s.transactions.filter(t => !filter || t.sender === filter || t.receiver === filter).slice(-200).reverse();
        this.openModal(key, `${close}<h2 class="mh">🧾 Transaction history</h2>
          <div class="hist-filter"><button class="chip ${!filter ? 'on' : ''}" data-f="">All</button>${s.players.map(p => `<button class="chip ${filter === p.id ? 'on' : ''}" style="--pc:${p.color}" data-f="${p.id}">${icon(p)} ${esc(p.name)}</button>`).join('')}</div>
          <div class="table-wrap"><table class="hist"><thead><tr><th>ID</th><th>Time</th><th>Type</th><th>From → To</th><th>Amount</th><th>Reason</th><th>Balance after</th></tr></thead><tbody>
          ${txs.map(t => `<tr><td class="mono">${t.id}</td><td>${new Date(t.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td><td><span class="tt">${t.type.replace('_', ' ')}</span></td>
            <td>${esc(M.entityName(s, t.sender))} → ${esc(M.entityName(s, t.receiver))}</td><td class="mono"><b>${money(t.amount)}</b></td><td>${esc(t.reason)}</td>
            <td class="mono">${t.senderBalance !== null && t.sender !== 'pot' ? `${esc(M.entityName(s, t.sender))}: ${money(t.senderBalance)}` : ''}${t.senderBalance !== null && t.receiverBalance !== null && t.sender !== 'pot' && t.receiver !== 'pot' ? '<br>' : ''}${t.receiverBalance !== null && t.receiver !== 'pot' ? `${esc(M.entityName(s, t.receiver))}: ${money(t.receiverBalance)}` : ''}</td></tr>`).join('')
            || '<tr><td colspan="7" class="muted">No transactions yet.</td></tr>'}
          </tbody></table></div>`, 'wide');
        this.bind('[data-f]', el => { this.historyFilter = el.dataset.f!; this.openPanel('history'); });
        break;
      }
      case 'jail': {
        const left = s.rules.maxJailTurns - cur.jailTurns;
        this.openModal(key, `${close}<div class="notice"><div class="n-ico">🔒</div><h2>In Jail</h2>
          <p>${left} attempt${left === 1 ? '' : 's'} left to roll doubles. After that, bail of ${money(s.rules.bail)} is mandatory.</p>
          <div class="jail-actions">
            <button class="btn primary lg" data-b="roll">🎲 Roll for doubles</button>
            <button class="btn gold" data-b="bail" ${cur.cash < s.rules.bail ? 'disabled' : ''}>Pay bail ${money(s.rules.bail)}</button>
            <button class="btn" data-b="card" ${cur.jailCards.length ? '' : 'disabled'}>🎟 Use Get Out of Jail Free (${cur.jailCards.length})</button>
          </div></div>`);
        this.bind('[data-b="roll"]', () => { this.closeModal(); this.act({ type: 'roll', playerId: cur.id }); });
        this.bind('[data-b="bail"]', () => { this.closeModal(); this.act({ type: 'payBail', playerId: cur.id }); });
        this.bind('[data-b="card"]', () => { this.closeModal(); this.act({ type: 'useJailCard', playerId: cur.id }); });
        break;
      }
      case 'portfolio': {
        const p = M.getPlayer(s, this.portfolioPid || cur.id);
        const owned = M.ownedTiles(s, p.id);
        this.openModal(key, `${close}<div class="pcard big" style="--pc:${p.color}"><div class="pc-top"><div class="pc-tok">${icon(p)}</div>
          <div><small>${p.isAI ? `AI · ${PERSONALITIES[p.personality!].label}` : 'Human player'}</small><h3>${esc(p.name)}</h3></div></div>
          <div class="mini-stats four"><div><small>Cash</small><b>${money(p.cash)}</b></div><div><small>Net worth</small><b>${money(p.bankrupt ? 0 : M.netWorth(s, p.id))}</b></div>
          <div><small>Earned</small><b>${money(p.stats.earned)}</b></div><div><small>Spent</small><b>${money(p.stats.spent)}</b></div>
          <div><small>Rent collected</small><b>${money(p.stats.rentCollected)}</b></div><div><small>Rent paid</small><b>${money(p.stats.rentPaid)}</b></div>
          <div><small>Jail cards</small><b>${p.jailCards.length}</b></div><div><small>Properties</small><b>${owned.length}</b></div></div></div>
          <div class="pf-tiles">${owned.map(t => this.tilePill(t)).join('') || '<p class="muted">No properties.</p>'}</div>`);
        this.bind('[data-tile]', el => { this.selectTile(Number(el.dataset.tile)); this.openPanel('tile'); });
        break;
      }
      case 'tile': {
        if (this.selectedTile === null) return;
        this.openModal(key, `${close}${this.tileCard(this.selectedTile)}`);
        break;
      }
      case 'settings': {
        this.modal = key;
        settingsModal(this.settings, st => this.cb.applySettings(st));
        const done = $('[data-close]', this.modalEl);
        done?.addEventListener('click', () => { this.modal = null; });
        return;
      }
      case 'pause': {
        this.paused = true;
        this.openModal(key, `<div class="notice"><div class="n-ico">⏸</div><h2>Game paused</h2>
          <p class="muted">Round ${s.round} · ${fmtTime(s.elapsedMs)} played. Your game is saved automatically.</p>
          <div class="jail-actions"><button class="btn gold lg" data-b="resume">Resume</button>
          <button class="btn" data-b="settings">Settings</button>
          <button class="btn" data-b="exit">Save &amp; exit to menu</button>
          <button class="btn danger" data-b="end">End game now</button></div></div>`);
        this.bind('[data-b="resume"]', () => this.resume());
        this.bind('[data-b="settings"]', () => { this.paused = false; this.openPanel('settings'); this.paused = true; });
        this.bind('[data-b="exit"]', () => { saveGame(s); this.cb.exit(); });
        this.bind('[data-b="end"]', () => this.openPanel('confirmEnd'));
        this.modalEl.onclick = null;
        return;
      }
      case 'confirmEnd': {
        this.openModal(key, `<div class="notice"><div class="n-ico">🏁</div><h2>End the game?</h2>
          <p>All players agree to finish now. Players are ranked by net worth: cash + property value + buildings − mortgages.</p>
          <div class="row2"><button class="btn" data-b="no">Keep playing</button><button class="btn danger lg" data-b="yes">End game</button></div></div>`);
        this.bind('[data-b="no"]', () => this.resume());
        this.bind('[data-b="yes"]', () => { this.paused = false; this.closeModal(); this.act({ type: 'endGame' }); });
        return;
      }
    }
    this.bind('[data-b="close"]', () => this.closeModal());
  }
  private historyFilter = '';

  private resume() { this.paused = false; this.closeModal(); this.schedule(); }

  private tradeDraft: TradeOffer | null = null;
  private tradePanel() {
    const s = this.s, cur = M.currentPlayer(s);
    const others = M.activePlayers(s).filter(p => p.id !== cur.id);
    if (!this.tradeDraft || this.tradeDraft.from !== cur.id || M.getPlayer(s, this.tradeDraft.to).bankrupt)
      this.tradeDraft = { from: cur.id, to: others[0].id, giveProps: [], getProps: [], giveCash: 0, getCash: 0, giveJailCards: 0, getJailCards: 0 };
    const d = this.tradeDraft, them = M.getPlayer(s, d.to);
    const list = (pid: string, sel: number[], attr: string) => {
      const tiles = M.ownedTiles(s, pid);
      return tiles.length ? tiles.map(t => {
        const blocked = M.groupHasBuildings(s, TILES[t].group!);
        return `<label class="tsel ${blocked ? 'off' : ''}"><input type="checkbox" data-${attr}="${t}" ${sel.includes(t) ? 'checked' : ''} ${blocked ? 'disabled' : ''}>
          <span class="sw" style="background:${GROUP_BY_ID[TILES[t].group!].color}"></span>${esc(TILES[t].name)}${s.props[t].mortgaged ? ' <em>M</em>' : ''}${blocked ? ' <small>(has buildings)</small>' : ''}</label>`;
      }).join('') : '<p class="muted sm">No properties</p>';
    };
    const err = M.validateTrade(s, d);
    this.openModal('panel:trade', `<button class="x" data-b="close">✕</button><h2 class="mh">🤝 Propose a trade</h2>
      <div class="hist-filter">${others.map(p => `<button class="chip ${p.id === d.to ? 'on' : ''}" style="--pc:${p.color}" data-to="${p.id}">${icon(p)} ${esc(p.name)}</button>`).join('')}</div>
      <div class="trade-grid">
        <div><h4>You offer ${chip(cur)}</h4>${list(cur.id, d.giveProps, 'give')}
          <label>Cash <input class="inp" type="number" min="0" max="${cur.cash}" step="10" data-cash="give" value="${d.giveCash}"></label>
          ${cur.jailCards.length ? `<label class="tg"><input type="checkbox" data-jc="give" ${d.giveJailCards ? 'checked' : ''}> Include a jail card</label>` : ''}</div>
        <div><h4>You request ${chip(them)}</h4>${list(them.id, d.getProps, 'get')}
          <label>Cash <input class="inp" type="number" min="0" max="${them.cash}" step="10" data-cash="get" value="${d.getCash}"></label>
          ${them.jailCards.length ? `<label class="tg"><input type="checkbox" data-jc="get" ${d.getJailCards ? 'checked' : ''}> Request a jail card</label>` : ''}</div>
      </div>
      <p class="warnline" ${err ? '' : 'hidden'}>${esc(err ?? '')}</p>
      <button class="btn gold lg" data-b="propose" ${err ? 'disabled' : ''}>Send offer to ${esc(them.name)}</button>
      <p class="muted sm">${them.isAI ? `${esc(them.name)} (AI) will evaluate the offer immediately.` : `Pass the device to ${esc(them.name)} to review it.`}</p>`, 'wide');
    const m = this.modalEl;
    this.bind('[data-b="close"]', () => this.closeModal());
    this.bind('[data-to]', el => { this.tradeDraft = { ...d, to: el.dataset.to!, getProps: [], getCash: 0, getJailCards: 0 }; this.tradePanel(); });
    $$<HTMLInputElement>('[data-give],[data-get]', m).forEach(cb => cb.addEventListener('change', () => {
      const t = Number(cb.dataset.give ?? cb.dataset.get), arr = cb.dataset.give ? d.giveProps : d.getProps;
      if (cb.checked) arr.push(t); else arr.splice(arr.indexOf(t), 1);
      this.tradePanel();
    }));
    $$<HTMLInputElement>('[data-cash]', m).forEach(inp => inp.addEventListener('change', () => {
      const v = Math.max(0, Math.floor(Number(inp.value) || 0));
      if (inp.dataset.cash === 'give') d.giveCash = v; else d.getCash = v;
      this.tradePanel();
    }));
    $$<HTMLInputElement>('[data-jc]', m).forEach(cb => cb.addEventListener('change', () => {
      if (cb.dataset.jc === 'give') d.giveJailCards = cb.checked ? 1 : 0; else d.getJailCards = cb.checked ? 1 : 0;
      this.tradePanel();
    }));
    this.bind('[data-b="propose"]', () => {
      const offer = { ...d, giveProps: [...d.giveProps], getProps: [...d.getProps] };
      this.closeModal();
      this.tradeDraft = null;
      this.act({ type: 'proposeTrade', playerId: cur.id, offer });
    });
  }
}
