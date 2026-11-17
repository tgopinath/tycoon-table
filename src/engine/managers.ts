// Small, focused managers. Each works on plain GameState so the engine can be
// serialised, replayed and validated on a server.
import { GROUPS, GROUP_BY_ID, RAIL_RENT, TILES, UTILITY_MULT } from './data/board';
import { CARDS } from './data/cards';
import type { Ctx, Deck, EntityId, GameState, Player, Transaction, TradeOffer, TxType } from './types';

export class GameError extends Error {
  constructor(message: string, public code = 'RULE') { super(message); }
}

/* ───────────── BoardManager ───────────── */
export const BOARD_LEN = 40;
export const JAIL_TILE = 10;
export const isOwnable = (i: number) => ['property', 'railway', 'utility'].includes(TILES[i].kind);
export const groupOf = (i: number) => GROUP_BY_ID[TILES[i].group!];
export function pathFrom(from: number, steps: number): number[] {
  const out: number[] = [];
  const dir = steps >= 0 ? 1 : -1;
  for (let k = 1; k <= Math.abs(steps); k++) out.push((from + dir * k + BOARD_LEN * 4) % BOARD_LEN);
  return out;
}
export function nearestOf(from: number, kind: string): number {
  for (let k = 1; k <= BOARD_LEN; k++) {
    const j = (from + k) % BOARD_LEN;
    if (TILES[j].kind === kind) return j;
  }
  return from;
}

/* ───────────── PlayerManager ───────────── */
export function getPlayer(s: GameState, id: string): Player {
  const p = s.players.find(x => x.id === id);
  if (!p) throw new GameError(`Unknown player ${id}`);
  return p;
}
export const activePlayers = (s: GameState) => s.players.filter(p => !p.bankrupt);
export const currentPlayer = (s: GameState) => s.players[s.turn];
export const entityName = (s: GameState, e: EntityId) =>
  e === 'bank' ? 'Bank' : e === 'pot' ? 'Free Parking' : getPlayer(s, e).name;

/* ───────────── DiceManager ───────────── */
export const rollDie = (rng: () => number) => 1 + Math.floor(rng() * 6);
export const rollDice = (rng: () => number): [number, number] => [rollDie(rng), rollDie(rng)];

/* ───────────── TransactionManager (single source of truth for money) ───────────── */
export interface Leg { from: EntityId; to: EntityId; amount: number; type: TxType; reason: string }

function balance(s: GameState, e: EntityId): number {
  if (e === 'bank') return Infinity;
  if (e === 'pot') return s.pot;
  return getPlayer(s, e).cash;
}
function adjust(s: GameState, e: EntityId, d: number) {
  if (e === 'bank') return;
  if (e === 'pot') { s.pot += d; return; }
  getPlayer(s, e).cash += d;
}

/** Atomic: every leg is validated before any balance changes. */
export function transferBatch(ctx: Ctx, legs: Leg[]): Transaction[] {
  const { s } = ctx;
  const net = new Map<EntityId, number>();
  for (const l of legs) {
    if (!Number.isInteger(l.amount) || l.amount < 0) throw new GameError('Invalid amount');
    if (l.from === l.to) throw new GameError('Cannot pay yourself');
    if (l.from !== 'bank' && l.from !== 'pot' && getPlayer(s, l.from).bankrupt) throw new GameError('Bankrupt players cannot pay');
    net.set(l.from, (net.get(l.from) ?? 0) - l.amount);
    net.set(l.to, (net.get(l.to) ?? 0) + l.amount);
  }
  for (const [e, d] of net) {
    if (balance(s, e) + d < 0) throw new GameError(`${entityName(s, e)} does not have enough cash`, 'INSUFFICIENT_FUNDS');
  }
  const out: Transaction[] = [];
  for (const l of legs) {
    if (l.amount === 0) continue;
    adjust(s, l.from, -l.amount);
    adjust(s, l.to, l.amount);
    const sp = l.from !== 'bank' && l.from !== 'pot' ? getPlayer(s, l.from) : null;
    const rp = l.to !== 'bank' && l.to !== 'pot' ? getPlayer(s, l.to) : null;
    if (sp) { sp.stats.spent += l.amount; if (l.type === 'rent') sp.stats.rentPaid += l.amount; }
    if (rp) { rp.stats.earned += l.amount; if (l.type === 'rent') rp.stats.rentCollected += l.amount; }
    const main = sp ?? rp;
    const tx: Transaction = {
      id: `tx-${++s.seq}`, gameId: s.id, playerId: main ? main.id : 'bank', type: l.type, amount: l.amount,
      sender: l.from, receiver: l.to, reason: l.reason, timestamp: Date.now(),
      resultingBalance: main ? main.cash : 0,
      senderBalance: sp ? sp.cash : l.from === 'pot' ? s.pot : null,
      receiverBalance: rp ? rp.cash : l.to === 'pot' ? s.pot : null,
    };
    s.transactions.push(tx);
    ctx.emit({ type: 'tx', tx });
    out.push(tx);
  }
  return out;
}
export const transfer = (ctx: Ctx, leg: Leg) => transferBatch(ctx, [leg])[0];

/* ───────────── PropertyManager ───────────── */
export const ownsGroup = (s: GameState, pid: string, groupId: string) =>
  GROUP_BY_ID[groupId].tiles.every(t => s.props[t].owner === pid);
export const ownedTiles = (s: GameState, pid: string) =>
  TILES.filter(t => isOwnable(t.id) && s.props[t.id].owner === pid).map(t => t.id);
export const groupHasBuildings = (s: GameState, groupId: string) =>
  GROUP_BY_ID[groupId].tiles.some(t => s.props[t].houses > 0);
export const unmortgageCost = (s: GameState, tileId: number) =>
  Math.ceil(Math.round(TILES[tileId].mortgage! * (1 + s.rules.mortgageInterest) * 100) / 100);

export function canMortgage(s: GameState, pid: string, tileId: number): string | null {
  if (!isOwnable(tileId)) return 'Not a property';
  const ps = s.props[tileId];
  if (ps.owner !== pid) return 'You do not own this property';
  if (ps.mortgaged) return 'Already mortgaged';
  if (groupHasBuildings(s, TILES[tileId].group!)) return 'Sell all buildings in this colour group first';
  return null;
}
export function mortgage(ctx: Ctx, pid: string, tileId: number) {
  const err = canMortgage(ctx.s, pid, tileId);
  if (err) throw new GameError(err);
  transfer(ctx, { from: 'bank', to: pid, amount: TILES[tileId].mortgage!, type: 'mortgage', reason: `Mortgaged ${TILES[tileId].name}` });
  ctx.s.props[tileId].mortgaged = true;
  ctx.emit({ type: 'mortgage', tileId, mortgaged: true });
}
export function canUnmortgage(s: GameState, pid: string, tileId: number): string | null {
  const ps = s.props[tileId];
  if (!ps || ps.owner !== pid) return 'You do not own this property';
  if (!ps.mortgaged) return 'Not mortgaged';
  if (getPlayer(s, pid).cash < unmortgageCost(s, tileId)) return 'Not enough cash';
  return null;
}
export function unmortgage(ctx: Ctx, pid: string, tileId: number) {
  const err = canUnmortgage(ctx.s, pid, tileId);
  if (err) throw new GameError(err);
  transfer(ctx, { from: pid, to: 'bank', amount: unmortgageCost(ctx.s, tileId), type: 'unmortgage', reason: `Unmortgaged ${TILES[tileId].name} (incl. interest)` });
  ctx.s.props[tileId].mortgaged = false;
  ctx.emit({ type: 'mortgage', tileId, mortgaged: false });
}

/* ───────────── RentCalculator ───────────── */
export interface RentOpts { rentMult?: number; utilityMult?: number }
export function calcRent(s: GameState, tileId: number, diceTotal: number, opts: RentOpts = {}): number {
  const t = TILES[tileId];
  const ps = s.props[tileId];
  if (!ps.owner || ps.mortgaged) return 0;
  const owner = ps.owner;
  if (t.kind === 'property') {
    if (ps.houses > 0) return t.rent![ps.houses];
    return t.rent![0] * (ownsGroup(s, owner, t.group!) ? 2 : 1);
  }
  const groupTiles = GROUP_BY_ID[t.group!].tiles;
  const n = groupTiles.filter(g => s.props[g].owner === owner).length;
  if (t.kind === 'railway') return RAIL_RENT[n - 1] * (opts.rentMult ?? 1);
  if (t.kind === 'utility') return diceTotal * (opts.utilityMult ?? UTILITY_MULT[n - 1]);
  return 0;
}

/* ───────────── BuildingManager ───────────── */
export function canBuild(s: GameState, pid: string, tileId: number): string | null {
  const t = TILES[tileId];
  if (t.kind !== 'property') return 'Buildings can only go on colour-group streets';
  const ps = s.props[tileId];
  if (ps.owner !== pid) return 'You do not own this property';
  if (!ownsGroup(s, pid, t.group!)) return 'You must own every property in the colour group';
  const g = GROUP_BY_ID[t.group!];
  if (g.tiles.some(x => s.props[x].mortgaged)) return 'Unmortgage the whole colour group first';
  if (ps.houses >= 5) return 'Already has a hotel';
  if (s.rules.evenBuild) {
    const min = Math.min(...g.tiles.map(x => s.props[x].houses));
    if (ps.houses > min) return 'Build evenly: add to the other properties in this group first';
  }
  if (ps.houses === 4 ? s.hotelsLeft <= 0 : s.housesLeft <= 0) return `The bank has no ${ps.houses === 4 ? 'hotels' : 'houses'} left`;
  if (getPlayer(s, pid).cash < t.houseCost!) return 'Not enough cash';
  return null;
}
export function build(ctx: Ctx, pid: string, tileId: number) {
  const err = canBuild(ctx.s, pid, tileId);
  if (err) throw new GameError(err);
  const { s } = ctx;
  const ps = s.props[tileId];
  const hotel = ps.houses === 4;
  transfer(ctx, { from: pid, to: 'bank', amount: TILES[tileId].houseCost!, type: hotel ? 'build_hotel' : 'build_house', reason: `${hotel ? 'Hotel' : 'House'} on ${TILES[tileId].name}` });
  const prev = ps.houses;
  if (hotel) { s.hotelsLeft--; s.housesLeft += 4; } else s.housesLeft--;
  ps.houses++;
  ctx.emit({ type: 'build', tileId, houses: ps.houses, prev });
}
export function canSell(s: GameState, pid: string, tileId: number): string | null {
  const t = TILES[tileId];
  const ps = s.props[tileId];
  if (!ps || ps.owner !== pid) return 'You do not own this property';
  if (ps.houses === 0) return 'No buildings to sell';
  if (s.rules.evenBuild) {
    const max = Math.max(...GROUP_BY_ID[t.group!].tiles.map(x => s.props[x].houses));
    if (ps.houses < max) return 'Sell evenly: sell from the other properties first';
  }
  return null;
}
export function sell(ctx: Ctx, pid: string, tileId: number) {
  const err = canSell(ctx.s, pid, tileId);
  if (err) throw new GameError(err);
  const { s } = ctx;
  const ps = s.props[tileId];
  const half = TILES[tileId].houseCost! / 2;
  const prev = ps.houses;
  let units = 1;
  if (ps.houses === 5) {
    // Break a hotel back into houses if the bank has them; otherwise sell further.
    const back = Math.min(4, s.housesLeft);
    units = 5 - back;
    s.hotelsLeft++; s.housesLeft -= back; ps.houses = back;
  } else { ps.houses--; s.housesLeft++; }
  transfer(ctx, { from: 'bank', to: pid, amount: half * units, type: 'sell_building', reason: `Sold ${prev === 5 ? 'hotel' : 'house'} on ${TILES[tileId].name}` });
  ctx.emit({ type: 'build', tileId, houses: ps.houses, prev });
}
export function buildingCounts(s: GameState, pid: string) {
  let houses = 0, hotels = 0;
  for (const t of ownedTiles(s, pid)) {
    const h = s.props[t].houses;
    if (h === 5) hotels++; else houses += h;
  }
  return { houses, hotels };
}

/* ───────────── CardManager ───────────── */
export function shuffle<T>(arr: T[], rng: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
export const initDecks = (rng: () => number): Record<Deck, string[]> => ({
  chance: shuffle(CARDS.filter(c => c.deck === 'chance').map(c => c.id), rng),
  community: shuffle(CARDS.filter(c => c.deck === 'community').map(c => c.id), rng),
});
export function drawCard(s: GameState, deck: Deck): string {
  const id = s.decks[deck].shift();
  if (!id) throw new GameError('Deck is empty');
  return id;
}
export const returnCard = (s: GameState, deck: Deck, id: string) => { s.decks[deck].push(id); };
const jailCardId = (deck: Deck) => CARDS.find(c => c.deck === deck && c.effect.type === 'jailFree')!.id;

/* ───────────── JailManager ───────────── */
export function sendToJail(ctx: Ctx, p: Player) {
  const from = p.position;
  p.position = JAIL_TILE; p.inJail = true; p.jailTurns = 0; p.doublesCount = 0;
  ctx.s.canRollAgain = false;
  ctx.emit({ type: 'move', playerId: p.id, path: [from, JAIL_TILE], teleport: true });
  ctx.emit({ type: 'jail', playerId: p.id, inJail: true });
}
export function releaseFromJail(ctx: Ctx, p: Player) {
  p.inJail = false; p.jailTurns = 0;
  ctx.emit({ type: 'jail', playerId: p.id, inJail: false });
}
export function useJailCard(ctx: Ctx, p: Player) {
  const deck = p.jailCards.shift();
  if (!deck) throw new GameError('You have no Get Out of Jail Free card');
  returnCard(ctx.s, deck, jailCardId(deck));
  releaseFromJail(ctx, p);
}

/* ───────────── TradeManager ───────────── */
export function validateTrade(s: GameState, o: TradeOffer): string | null {
  if (o.from === o.to) return 'Choose another player';
  const a = getPlayer(s, o.from), b = getPlayer(s, o.to);
  if (a.bankrupt || b.bankrupt) return 'Player is bankrupt';
  if (!o.giveProps.length && !o.getProps.length && !o.giveCash && !o.getCash && !o.giveJailCards && !o.getJailCards) return 'The trade is empty';
  for (const t of o.giveProps) if (s.props[t]?.owner !== a.id) return `${a.name} does not own ${TILES[t].name}`;
  for (const t of o.getProps) if (s.props[t]?.owner !== b.id) return `${b.name} does not own ${TILES[t].name}`;
  for (const t of [...o.giveProps, ...o.getProps]) if (groupHasBuildings(s, TILES[t].group!)) return `Sell buildings in the ${groupOf(t).name} group before trading`;
  if (o.giveCash < 0 || o.getCash < 0 || !Number.isInteger(o.giveCash) || !Number.isInteger(o.getCash)) return 'Invalid cash amount';
  if (o.giveCash > a.cash) return `${a.name} does not have $${o.giveCash}`;
  if (o.getCash > b.cash) return `${b.name} does not have $${o.getCash}`;
  if (o.giveJailCards > a.jailCards.length || o.getJailCards > b.jailCards.length) return 'Not enough Get Out of Jail Free cards';
  return null;
}
export function executeTrade(ctx: Ctx, o: TradeOffer) {
  const err = validateTrade(ctx.s, o);
  if (err) throw new GameError(err);
  const { s } = ctx;
  const legs: Leg[] = [];
  if (o.giveCash) legs.push({ from: o.from, to: o.to, amount: o.giveCash, type: 'trade', reason: 'Trade payment' });
  if (o.getCash) legs.push({ from: o.to, to: o.from, amount: o.getCash, type: 'trade', reason: 'Trade payment' });
  transferBatch(ctx, legs);
  for (const t of o.giveProps) { s.props[t].owner = o.to; ctx.emit({ type: 'own', tileId: t, owner: o.to }); }
  for (const t of o.getProps) { s.props[t].owner = o.from; ctx.emit({ type: 'own', tileId: t, owner: o.from }); }
  const a = getPlayer(s, o.from), b = getPlayer(s, o.to);
  for (let i = 0; i < o.giveJailCards; i++) b.jailCards.push(a.jailCards.shift()!);
  for (let i = 0; i < o.getJailCards; i++) a.jailCards.push(b.jailCards.shift()!);
}

/* ───────────── BankruptcyManager ───────────── */
export function liquidationValue(s: GameState, pid: string): number {
  let v = getPlayer(s, pid).cash;
  for (const t of ownedTiles(s, pid)) {
    const ps = s.props[t];
    v += ps.houses * (TILES[t].houseCost! / 2);
    if (!ps.mortgaged) v += TILES[t].mortgage!;
  }
  return v;
}
export function netWorth(s: GameState, pid: string): number {
  let v = getPlayer(s, pid).cash;
  for (const t of ownedTiles(s, pid)) {
    const ps = s.props[t];
    v += TILES[t].price! + ps.houses * TILES[t].houseCost!;
    if (ps.mortgaged) v -= TILES[t].mortgage!;
  }
  return v;
}
export function declareBankruptcy(ctx: Ctx, pid: string, creditor: EntityId) {
  const { s } = ctx;
  const p = getPlayer(s, pid);
  const toPlayer = creditor !== 'bank' && creditor !== 'pot' && !getPlayer(s, creditor).bankrupt;
  // Buildings go back to the bank for half value first.
  for (const t of ownedTiles(s, pid)) {
    const ps = s.props[t];
    if (ps.houses > 0) {
      const prev = ps.houses;
      if (ps.houses === 5) s.hotelsLeft++; else s.housesLeft += ps.houses;
      const refund = prev * (TILES[t].houseCost! / 2);
      ps.houses = 0;
      ctx.emit({ type: 'build', tileId: t, houses: 0, prev });
      if (toPlayer) transfer(ctx, { from: 'bank', to: pid, amount: refund, type: 'bankruptcy', reason: `Buildings on ${TILES[t].name} liquidated` });
    }
  }
  if (p.cash > 0) transfer(ctx, { from: pid, to: toPlayer ? creditor : 'bank', amount: p.cash, type: 'bankruptcy', reason: `${p.name} bankruptcy settlement` });
  for (const t of ownedTiles(s, pid)) {
    const ps = s.props[t];
    if (toPlayer) ps.owner = creditor; else { ps.owner = null; ps.mortgaged = false; }
    ctx.emit({ type: 'own', tileId: t, owner: ps.owner });
    if (!toPlayer) ctx.emit({ type: 'mortgage', tileId: t, mortgaged: false });
  }
  if (toPlayer) getPlayer(s, creditor).jailCards.push(...p.jailCards);
  else for (const d of p.jailCards) returnCard(s, d, jailCardId(d));
  p.jailCards = [];
  p.bankrupt = true;
  p.inJail = false;
  ctx.emit({ type: 'bankrupt', playerId: pid });
}

export { GROUPS, TILES };
