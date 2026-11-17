import { TILES } from './data/board';
import { CARD_BY_ID, DECK_TITLE } from './data/cards';
import { DEFAULT_RULES } from './data/rules';
import * as M from './managers';
import { GameError, getPlayer, currentPlayer, activePlayers } from './managers';
import type {
  Action, Ctx, Followup, GameEvent, GameState, NewPrompt, PayPrompt, Player, Prompt, Result, Rules, TokenId, Personality,
  AuctionPrompt,
} from './types';

export interface PlayerConfig { name: string; token: TokenId; color: string; isAI: boolean; personality?: Personality }
export interface GameConfig { players: PlayerConfig[]; rules?: Partial<Rules>; mode: GameState['mode'] }

/**
 * Authoritative rules engine. Every change goes through dispatch(), which
 * checks who is allowed to act and rolls the whole action back on any error,
 * so state is never left half-updated.
 */
export class GameEngine {
  s: GameState;
  private events: GameEvent[] = [];
  private buffer: Prompt[] | null = null;

  constructor(state: GameState, private rng: () => number = Math.random) { this.s = state; }

  static create(cfg: GameConfig, rng: () => number = Math.random): GameEngine {
    if (cfg.players.length < 2 || cfg.players.length > 6) throw new GameError('2–6 players required');
    const rules: Rules = { ...DEFAULT_RULES, ...cfg.rules };
    const props: GameState['props'] = {};
    for (const t of TILES) if (M.isOwnable(t.id)) props[t.id] = { owner: null, houses: 0, mortgaged: false };
    const s: GameState = {
      id: `g-${Date.now().toString(36)}-${Math.floor(rng() * 1e6).toString(36)}`,
      version: 0, seq: 0, mode: cfg.mode, rules,
      players: cfg.players.map((c, i) => ({
        id: `p${i + 1}`, name: c.name.trim() || `Player ${i + 1}`, token: c.token, color: c.color, isAI: c.isAI,
        personality: c.isAI ? c.personality ?? 'balanced' : undefined,
        cash: rules.startingCash, position: 0, inJail: false, jailTurns: 0, jailCards: [], doublesCount: 0, bankrupt: false,
        stats: { rentCollected: 0, rentPaid: 0, earned: 0, spent: 0 },
      })),
      props, turn: 0, round: 1, phase: 'roll', rolledThisTurn: false, canRollAgain: false, tradesThisTurn: 0,
      lastDice: null, queue: [], decks: M.initDecks(rng), housesLeft: rules.houses, hotelsLeft: rules.hotels, pot: 0,
      log: [], transactions: [], startedAt: Date.now(), elapsedMs: 0, endReason: null,
    };
    const e = new GameEngine(s, rng);
    e.log(`Game started. First turn: ${s.players[0].name}.`);
    return e;
  }

  get ctx(): Ctx { return { s: this.s, emit: ev => this.events.push(ev), rng: this.rng }; }
  drainEvents(): GameEvent[] { const e = this.events; this.events = []; return e; }
  get head(): Prompt | undefined { return this.s.queue[0]; }
  /** Whose input the game is waiting for. */
  get actor(): Player | null {
    if (this.s.phase === 'over') return null;
    const h = this.head;
    return h ? getPlayer(this.s, h.playerId) : currentPlayer(this.s);
  }
  get timeUp(): boolean { return this.s.rules.timeLimitMin > 0 && this.s.elapsedMs >= this.s.rules.timeLimitMin * 60000; }

  dispatch(a: Action): Result {
    if (this.s.phase === 'over') return { ok: false, error: 'The game is over' };
    const snapshot = structuredClone(this.s);
    const evLen = this.events.length;
    try {
      this.apply(a);
      this.afterResolve();
      this.s.version++;
      return { ok: true };
    } catch (err) {
      this.s = snapshot;
      this.events.length = evLen;
      this.buffer = null;
      if (err instanceof GameError) return { ok: false, error: err.message, code: err.code };
      throw err;
    }
  }

  /* ───────────── helpers ───────────── */
  log(text: string, playerId?: string, tone?: 'good' | 'bad' | 'info') {
    this.s.log.push({ t: Date.now(), text, playerId, tone });
    if (this.s.log.length > 300) this.s.log.splice(0, this.s.log.length - 300);
  }
  private push(p: NewPrompt) {
    const full = { ...p, id: `q${++this.s.seq}` } as Prompt;
    (this.buffer ?? this.s.queue).push(full);
  }
  /** Removes the head prompt; prompts created while resolving it go to the front of the queue. */
  private resolve(fn: () => void) {
    this.s.queue.shift();
    this.buffer = [];
    fn();
    const b = this.buffer;
    this.buffer = null;
    this.s.queue.unshift(...b);
  }
  private fineSink() { return this.s.rules.freeParkingPot ? 'pot' : 'bank'; }
  private requireTurn(pid: string) {
    const cur = currentPlayer(this.s);
    if (cur.id !== pid) throw new GameError("It's not your turn", 'NOT_YOUR_TURN');
  }
  private requirePrompt(pid: string, promptId: string): Prompt {
    const h = this.head;
    if (!h || h.id !== promptId) throw new GameError('That action is no longer available', 'STALE');
    if (h.playerId !== pid) throw new GameError('Waiting for another player', 'NOT_YOUR_TURN');
    return h;
  }
  private requireManage(pid: string, selling: boolean) {
    const h = this.head;
    if (selling && h && h.kind === 'pay' && h.playerId === pid) return; // debt resolution
    this.requireTurn(pid);
    if (h) throw new GameError('Finish the current action first');
  }

  /* ───────────── action router ───────────── */
  private apply(a: Action) {
    const s = this.s;
    switch (a.type) {
      case 'roll': {
        this.requireTurn(a.playerId);
        if (s.phase !== 'roll' || s.queue.length) throw new GameError('You cannot roll right now');
        this.doRoll(getPlayer(s, a.playerId));
        break;
      }
      case 'endTurn': {
        this.requireTurn(a.playerId);
        if (s.queue.length) throw new GameError('Finish the current action first');
        if (s.phase !== 'end') throw new GameError(s.canRollAgain ? 'You rolled doubles — roll again' : 'Roll the dice first');
        this.advanceTurn();
        break;
      }
      case 'confirm': this.confirm(this.requirePrompt(a.playerId, a.promptId)); break;
      case 'buy': {
        const h = this.requirePrompt(a.playerId, a.promptId);
        if (h.kind !== 'buy') throw new GameError('Nothing to buy');
        const p = getPlayer(s, a.playerId), t = TILES[h.tileId];
        if (p.cash < t.price!) throw new GameError(`You need $${t.price} to buy ${t.name}`, 'INSUFFICIENT_FUNDS');
        this.resolve(() => {
          M.transfer(this.ctx, { from: p.id, to: 'bank', amount: t.price!, type: 'buy_property', reason: `Bought ${t.name}` });
          s.props[t.id].owner = p.id;
          this.events.push({ type: 'own', tileId: t.id, owner: p.id });
          this.log(`${p.name} bought ${t.name} for $${t.price}.`, p.id, 'good');
        });
        break;
      }
      case 'decline': {
        const h = this.requirePrompt(a.playerId, a.promptId);
        if (h.kind !== 'buy') throw new GameError('Nothing to decline');
        const t = TILES[h.tileId];
        this.resolve(() => {
          this.log(`${getPlayer(s, a.playerId).name} declined ${t.name}.`, a.playerId);
          if (s.rules.auctions) {
            const order = this.turnOrderFrom(s.turn).filter(p => p.cash > 0).map(p => p.id);
            if (order.length) {
              this.push({ kind: 'auction', playerId: order[0], tileId: t.id, active: order, highBid: 0, highBidder: null });
              this.log(`${t.name} goes to auction.`);
            }
          }
        });
        break;
      }
      case 'bid': case 'pass': {
        const h = this.requirePrompt(a.playerId, a.promptId);
        if (h.kind !== 'auction') throw new GameError('No auction running');
        this.auctionStep(h, a.playerId, a.type === 'bid' ? a.amount : null);
        break;
      }
      case 'choose': {
        const h = this.requirePrompt(a.playerId, a.promptId);
        if (h.kind !== 'choose') throw new GameError('Nothing to choose');
        if (!M.isOwnable(a.tileId)) throw new GameError('Pick a property, railway or utility');
        this.resolve(() => this.moveTo(getPlayer(s, a.playerId), a.tileId));
        break;
      }
      case 'build': this.requireManage(a.playerId, false); M.build(this.ctx, a.playerId, a.tileId); this.logBuild(a.playerId, a.tileId, true); break;
      case 'sell': this.requireManage(a.playerId, true); M.sell(this.ctx, a.playerId, a.tileId); this.logBuild(a.playerId, a.tileId, false); break;
      case 'mortgage': this.requireManage(a.playerId, true); M.mortgage(this.ctx, a.playerId, a.tileId); this.log(`${getPlayer(s, a.playerId).name} mortgaged ${TILES[a.tileId].name}.`, a.playerId); break;
      case 'unmortgage': this.requireManage(a.playerId, false); M.unmortgage(this.ctx, a.playerId, a.tileId); this.log(`${getPlayer(s, a.playerId).name} unmortgaged ${TILES[a.tileId].name}.`, a.playerId); break;
      case 'payBail': {
        this.requireManage(a.playerId, false);
        const p = getPlayer(s, a.playerId);
        if (!p.inJail || s.rolledThisTurn) throw new GameError('You can only pay bail at the start of your turn in jail');
        this.push({ kind: 'pay', playerId: p.id, to: this.fineSink(), amount: s.rules.bail, title: 'Jail Bail', reason: 'Bail to leave jail', txType: 'bail', after: { type: 'leaveJail' } });
        break;
      }
      case 'useJailCard': {
        this.requireManage(a.playerId, false);
        const p = getPlayer(s, a.playerId);
        if (!p.inJail || s.rolledThisTurn) throw new GameError('You can only use this at the start of your turn in jail');
        M.useJailCard(this.ctx, p);
        this.log(`${p.name} used a Get Out of Jail Free card.`, p.id, 'good');
        break;
      }
      case 'proposeTrade': {
        this.requireManage(a.playerId, false);
        if (a.offer.from !== a.playerId) throw new GameError('You can only propose your own trades');
        const err = M.validateTrade(s, a.offer);
        if (err) throw new GameError(err);
        s.tradesThisTurn++;
        this.push({ kind: 'trade', playerId: a.offer.to, offer: a.offer });
        this.log(`${getPlayer(s, a.playerId).name} proposed a trade to ${getPlayer(s, a.offer.to).name}.`, a.playerId);
        break;
      }
      case 'respondTrade': {
        const h = this.requirePrompt(a.playerId, a.promptId);
        if (h.kind !== 'trade') throw new GameError('No trade to review');
        this.resolve(() => {
          if (a.accept) {
            M.executeTrade(this.ctx, h.offer);
            this.log(`${getPlayer(s, h.offer.to).name} accepted the trade from ${getPlayer(s, h.offer.from).name}.`, a.playerId, 'good');
          } else this.log(`${getPlayer(s, h.offer.to).name} rejected the trade.`, a.playerId, 'bad');
          this.events.push({ type: 'trade', offer: h.offer, accepted: a.accept });
        });
        break;
      }
      case 'bankrupt': {
        const h = this.requirePrompt(a.playerId, a.promptId);
        if (h.kind !== 'pay') throw new GameError('There is no debt to settle');
        const p = getPlayer(s, a.playerId);
        if (p.cash >= h.amount) throw new GameError('You can afford this payment');
        this.bankrupt(p, h);
        break;
      }
      case 'endGame': this.gameOver('agreement'); break;
    }
  }

  private logBuild(pid: string, tileId: number, built: boolean) {
    const h = this.s.props[tileId].houses;
    const what = built ? (h === 5 ? 'built a hotel' : 'built a house') : 'sold a building';
    this.log(`${getPlayer(this.s, pid).name} ${what} on ${TILES[tileId].name}.`, pid, built ? 'good' : 'info');
  }

  private turnOrderFrom(idx: number): Player[] {
    const n = this.s.players.length;
    const out: Player[] = [];
    for (let k = 0; k < n; k++) { const p = this.s.players[(idx + k) % n]; if (!p.bankrupt) out.push(p); }
    return out;
  }

  /* ───────────── dice & movement ───────────── */
  private doRoll(p: Player) {
    const s = this.s;
    const [d1, d2] = M.rollDice(this.rng);
    s.lastDice = [d1, d2];
    s.rolledThisTurn = true;
    const total = d1 + d2, dbl = d1 === d2;
    this.events.push({ type: 'dice', d1, d2 });
    this.log(`${p.name} rolled ${d1} + ${d2} = ${total}${dbl ? ' (doubles!)' : ''}.`, p.id);
    if (p.inJail) {
      s.canRollAgain = false;
      if (dbl) {
        M.releaseFromJail(this.ctx, p);
        this.log(`${p.name} rolled doubles and left jail.`, p.id, 'good');
        this.move(p, total);
      } else {
        p.jailTurns++;
        if (p.jailTurns >= s.rules.maxJailTurns) {
          this.push({ kind: 'pay', playerId: p.id, to: this.fineSink(), amount: s.rules.bail, title: 'Jail Bail', reason: 'Final jail turn — bail is mandatory', txType: 'bail', after: { type: 'leaveJailMove', steps: total } });
        } else {
          const left = s.rules.maxJailTurns - p.jailTurns;
          this.push({ kind: 'notice', playerId: p.id, title: 'Still in Jail', text: `No doubles this time. ${left} attempt${left === 1 ? '' : 's'} left before bail is mandatory.` });
        }
      }
      return;
    }
    if (dbl && p.doublesCount + 1 >= 3) {
      p.doublesCount = 0;
      s.canRollAgain = false;
      this.push({ kind: 'notice', playerId: p.id, title: 'Three Doubles!', text: 'Speeding! Three doubles in a row — go directly to Jail.', after: { type: 'jail' } });
      return;
    }
    if (dbl) p.doublesCount++;
    s.canRollAgain = dbl;
    this.move(p, total);
  }

  private move(p: Player, steps: number, opts: M.RentOpts = {}) {
    const from = p.position;
    const path = M.pathFrom(from, steps);
    const to = path.length ? path[path.length - 1] : from;
    p.position = to;
    this.events.push({ type: 'move', playerId: p.id, path: [from, ...path] });
    if (steps > 0 && from + steps >= M.BOARD_LEN) {
      const exact = to === 0 && this.s.rules.doubleSalaryOnStart;
      const amount = this.s.rules.salary * (exact ? 2 : 1);
      this.push({ kind: 'collect', playerId: p.id, from: 'bank', amount, title: exact ? 'Landed on Start — Double Salary' : 'Passed Start', reason: 'Salary', txType: 'salary' });
    }
    this.land(p, opts);
  }
  private moveTo(p: Player, tile: number, opts: M.RentOpts = {}) {
    this.move(p, (tile - p.position + M.BOARD_LEN) % M.BOARD_LEN, opts);
  }

  private land(p: Player, opts: M.RentOpts) {
    const s = this.s, t = TILES[p.position];
    if (M.isOwnable(t.id)) {
      const ps = s.props[t.id];
      if (!ps.owner) this.push({ kind: 'buy', playerId: p.id, tileId: t.id });
      else if (ps.owner !== p.id) {
        const owner = getPlayer(s, ps.owner);
        if (ps.mortgaged) {
          this.push({ kind: 'notice', playerId: p.id, title: 'Mortgaged Property', text: `${t.name} is mortgaged by ${owner.name}. No rent is due.` });
        } else {
          const dice = s.lastDice ? s.lastDice[0] + s.lastDice[1] : 7;
          const amount = M.calcRent(s, t.id, dice, opts);
          this.push({ kind: 'pay', playerId: p.id, to: owner.id, amount, title: 'Rent Payment', reason: `Rent for ${t.name}`, txType: 'rent', tileId: t.id });
        }
      }
      return;
    }
    switch (t.kind) {
      case 'tax':
        this.push({ kind: 'pay', playerId: p.id, to: this.fineSink(), amount: t.tax!, title: t.name.toUpperCase(), reason: t.name, txType: 'tax', tileId: t.id });
        break;
      case 'chance': case 'community': {
        const cardId = M.drawCard(s, t.kind);
        this.events.push({ type: 'card', deck: t.kind });
        this.push({ kind: 'card', playerId: p.id, deck: t.kind, cardId });
        break;
      }
      case 'gotojail':
        this.push({ kind: 'notice', playerId: p.id, title: 'Go to Jail', text: 'Go directly to Jail. Do not pass Start, do not collect your salary.', after: { type: 'jail' } });
        break;
      case 'parking':
        if (s.rules.freeParkingPot && s.pot > 0)
          this.push({ kind: 'collect', playerId: p.id, from: 'pot', amount: s.pot, title: 'Free Parking Jackpot', reason: 'Free Parking pot', txType: 'free_parking' });
        break;
      default: break;
    }
  }

  /* ───────────── prompt resolution ───────────── */
  private confirm(h: Prompt) {
    const s = this.s;
    const p = getPlayer(s, h.playerId);
    switch (h.kind) {
      case 'pay': {
        if (p.cash < h.amount) throw new GameError('Not enough cash. Sell buildings, mortgage or trade to raise funds — or declare bankruptcy.', 'INSUFFICIENT_FUNDS');
        this.resolve(() => {
          if (h.split) {
            const each = h.amount / h.split.length;
            M.transferBatch(this.ctx, h.split.map(to => ({ from: p.id, to, amount: each, type: h.txType, reason: h.reason })));
          } else M.transfer(this.ctx, { from: p.id, to: h.to, amount: h.amount, type: h.txType, reason: h.reason });
          this.log(`${p.name} paid $${h.amount} — ${h.reason}${h.split ? '' : ` → ${M.entityName(s, h.to)}`}.`, p.id, 'bad');
          if (h.after) this.followup(p, h.after);
        });
        break;
      }
      case 'collect': {
        const amount = h.from === 'pot' ? s.pot : h.amount;
        this.resolve(() => {
          if (amount > 0) M.transfer(this.ctx, { from: h.from, to: p.id, amount, type: h.txType, reason: h.reason });
          this.log(`${p.name} collected $${amount} — ${h.reason}.`, p.id, 'good');
        });
        break;
      }
      case 'notice': this.resolve(() => { if (h.after) this.followup(p, h.after); }); break;
      case 'card': this.resolve(() => this.applyCard(p, h.deck, h.cardId)); break;
      default: throw new GameError('Choose one of the available options');
    }
  }

  private followup(p: Player, f: Followup) {
    if (f.type === 'jail') { M.sendToJail(this.ctx, p); this.log(`${p.name} was sent to Jail.`, p.id, 'bad'); }
    if (f.type === 'leaveJail') { M.releaseFromJail(this.ctx, p); this.log(`${p.name} paid bail and left jail.`, p.id); }
    if (f.type === 'leaveJailMove') { M.releaseFromJail(this.ctx, p); this.move(p, f.steps); }
  }

  private applyCard(p: Player, deck: 'chance' | 'community', cardId: string) {
    const s = this.s, card = CARD_BY_ID[cardId], e = card.effect, title = DECK_TITLE[deck];
    this.log(`${p.name} drew ${title}: “${card.text}”`, p.id);
    if (e.type !== 'jailFree') M.returnCard(s, deck, cardId);
    const others = activePlayers(s).filter(x => x.id !== p.id);
    switch (e.type) {
      case 'collect': this.push({ kind: 'collect', playerId: p.id, from: 'bank', amount: e.amount, title, reason: card.text, txType: 'reward' }); break;
      case 'pay': this.push({ kind: 'pay', playerId: p.id, to: this.fineSink(), amount: e.amount, title: `${title} Penalty`, reason: card.text, txType: 'penalty' }); break;
      case 'collectEach':
        for (const q of others) this.push({ kind: 'pay', playerId: q.id, to: p.id, amount: e.amount, title: `${title}: Pay ${p.name}`, reason: card.text, txType: 'reward' });
        break;
      case 'payEach':
        if (others.length) this.push({ kind: 'pay', playerId: p.id, to: 'players', split: others.map(o => o.id), amount: e.amount * others.length, title: `${title} Penalty`, reason: `${card.text} ($${e.amount} × ${others.length})`, txType: 'penalty' });
        break;
      case 'moveTo': this.moveTo(p, e.tile); break;
      case 'moveBy': this.move(p, e.steps); break;
      case 'nearest': this.moveTo(p, M.nearestOf(p.position, e.kind), e.kind === 'railway' ? { rentMult: 2 } : { utilityMult: 10 }); break;
      case 'jail': M.sendToJail(this.ctx, p); break;
      case 'jailFree': p.jailCards.push(deck); break;
      case 'repairs': {
        const { houses, hotels } = M.buildingCounts(s, p.id);
        const amount = houses * e.house + hotels * e.hotel;
        if (amount > 0) this.push({ kind: 'pay', playerId: p.id, to: this.fineSink(), amount, title: 'Repair Fee', reason: `${houses} house(s) × $${e.house} + ${hotels} hotel(s) × $${e.hotel}`, txType: 'penalty' });
        else this.push({ kind: 'notice', playerId: p.id, title: 'Repair Fee', text: 'You own no buildings, so there is nothing to pay.' });
        break;
      }
      case 'choose': this.push({ kind: 'choose', playerId: p.id, title, text: 'Pick any property, railway or utility to advance to.' }); break;
    }
  }

  private auctionStep(h: AuctionPrompt, pid: string, bid: number | null) {
    const s = this.s, t = TILES[h.tileId], p = getPlayer(s, pid);
    const idx = h.active.indexOf(pid);
    if (bid !== null) {
      if (!Number.isInteger(bid) || bid <= h.highBid) throw new GameError(`Bid more than $${h.highBid}`);
      if (bid > p.cash) throw new GameError('You cannot bid more than your cash');
      h.highBid = bid; h.highBidder = pid;
      this.log(`${p.name} bids $${bid} for ${t.name}.`, pid);
      if (h.active.length === 1) { this.finishAuction(h); return; }
      h.playerId = h.active[(idx + 1) % h.active.length];
      return;
    }
    h.active.splice(idx, 1);
    this.log(`${p.name} passes.`, pid);
    if (h.active.length === 0) { this.resolve(() => this.log(`No one bought ${t.name}.`)); return; }
    if (h.active.length === 1 && h.highBidder === h.active[0]) { this.finishAuction(h); return; }
    h.playerId = h.active[idx % h.active.length];
  }
  private finishAuction(h: AuctionPrompt) {
    const t = TILES[h.tileId], w = getPlayer(this.s, h.highBidder!);
    this.resolve(() => {
      M.transfer(this.ctx, { from: w.id, to: 'bank', amount: h.highBid, type: 'auction', reason: `Won auction for ${t.name}` });
      this.s.props[t.id].owner = w.id;
      this.events.push({ type: 'own', tileId: t.id, owner: w.id });
      this.log(`${w.name} won ${t.name} at auction for $${h.highBid}.`, w.id, 'good');
    });
  }

  private bankrupt(p: Player, h: PayPrompt) {
    const s = this.s;
    const creditor = h.split || h.to === 'pot' ? 'bank' : h.to;
    this.resolve(() => M.declareBankruptcy(this.ctx, p.id, creditor));
    this.log(`${p.name} is bankrupt!`, p.id, 'bad');
    // Drop anything still waiting on, or paying, the bankrupt player.
    s.queue = s.queue.filter(q => q.playerId !== p.id && !(q.kind === 'pay' && q.to === p.id));
    for (const q of s.queue) {
      if (q.kind === 'pay' && q.split?.includes(p.id)) {
        const each = q.amount / q.split.length;
        q.split = q.split.filter(x => x !== p.id); q.amount = each * q.split.length;
      }
      if (q.kind === 'auction' && q.active.includes(p.id)) {
        q.active = q.active.filter(x => x !== p.id);
        if (q.highBidder === p.id) { q.highBidder = null; q.highBid = 0; }
      }
    }
    s.queue = s.queue.filter(q => !(q.kind === 'pay' && q.split && q.split.length === 0) && !(q.kind === 'auction' && q.active.length === 0));
    if (activePlayers(s).length <= 1) this.gameOver('last');
  }

  /* ───────────── turns & end ───────────── */
  private afterResolve() {
    const s = this.s;
    if (s.phase === 'over') return;
    const cur = currentPlayer(s);
    if (cur.bankrupt && !s.queue.length) { this.advanceTurn(); return; }
    if (s.queue.length) { s.phase = 'action'; return; }
    s.phase = !s.rolledThisTurn || (s.canRollAgain && !cur.inJail) ? 'roll' : 'end';
  }

  private advanceTurn() {
    const s = this.s;
    const cur = currentPlayer(s);
    cur.doublesCount = 0;
    s.rolledThisTurn = false; s.canRollAgain = false; s.tradesThisTurn = 0;
    if (this.timeUp) { this.gameOver('time'); return; }
    const n = s.players.length;
    let idx = s.turn;
    for (let k = 1; k <= n; k++) {
      const j = (s.turn + k) % n;
      if (!s.players[j].bankrupt) { idx = j; break; }
    }
    if (idx <= s.turn) s.round++;
    s.turn = idx;
    s.phase = 'roll';
    const next = currentPlayer(s);
    this.events.push({ type: 'turn', playerId: next.id });
    this.log(`Turn → ${next.name}${next.inJail ? ' (in Jail)' : ''}`, next.id, 'info');
  }

  private gameOver(reason: 'last' | 'time' | 'agreement') {
    this.s.phase = 'over';
    this.s.endReason = reason;
    this.s.queue = [];
    this.log(reason === 'last' ? 'Only one player remains. Game over!' : reason === 'time' ? 'Time is up! Final scores by net worth.' : 'Players agreed to end the game.', undefined, 'info');
    this.events.push({ type: 'gameover' });
  }

  ranking() {
    const s = this.s;
    return [...s.players]
      .map(p => ({ p, worth: p.bankrupt ? 0 : M.netWorth(s, p.id), props: M.ownedTiles(s, p.id).length }))
      .sort((a, b) => Number(a.p.bankrupt) - Number(b.p.bankrupt) || b.worth - a.worth);
  }
}
