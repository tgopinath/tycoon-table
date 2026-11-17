import { GROUP_BY_ID, TILES } from './data/board';
import * as M from './managers';
import type { Action, GameState, Personality, Player, Prompt, TradeOffer } from './types';

interface Persona { reserve: number; buildReserve: number; bidFactor: number; tradeChance: number; tradeOffer: number; acceptMargin: number; bailCash: number }
export const PERSONAS: Record<Personality, Persona> = {
  conservative: { reserve: 450, buildReserve: 550, bidFactor: 0.8, tradeChance: 0.05, tradeOffer: 1.5, acceptMargin: 0.25, bailCash: 900 },
  aggressive: { reserve: 0, buildReserve: 120, bidFactor: 1.35, tradeChance: 0.15, tradeOffer: 1.9, acceptMargin: 0.05, bailCash: 200 },
  builder: { reserve: 150, buildReserve: 100, bidFactor: 1.1, tradeChance: 0.35, tradeOffer: 1.9, acceptMargin: 0.15, bailCash: 400 },
  trader: { reserve: 200, buildReserve: 250, bidFactor: 1.0, tradeChance: 0.6, tradeOffer: 1.8, acceptMargin: 0.1, bailCash: 500 },
  balanced: { reserve: 250, buildReserve: 300, bidFactor: 1.0, tradeChance: 0.2, tradeOffer: 1.8, acceptMargin: 0.12, bailCash: 500 },
};

const persona = (p: Player) => PERSONAS[p.personality ?? 'balanced'];

/** How many of a tile's group would `pid` own if they gained this tile. */
function groupProgress(s: GameState, pid: string, tileId: number) {
  const g = GROUP_BY_ID[TILES[tileId].group!];
  const mine = g.tiles.filter(t => s.props[t].owner === pid || t === tileId).length;
  return { mine, total: g.tiles.length, completes: mine === g.tiles.length };
}

/** Value of a tile to a player, including the bonus for completing its group. */
function tileValue(s: GameState, pid: string, tileId: number, gaining: boolean) {
  const t = TILES[tileId];
  const prog = gaining ? groupProgress(s, pid, tileId) : { completes: M.ownsGroup(s, pid, t.group!), mine: 0, total: 0 };
  let v = t.price! * (s.props[tileId].mortgaged ? 0.55 : 1);
  if (prog.completes && t.kind === 'property') v *= 2.2;
  return v;
}

/** Decide the next action for an AI player, or null if it has nothing to do. */
export function decide(s: GameState, pid: string, rng: () => number = Math.random): Action | null {
  const p = M.getPlayer(s, pid);
  if (p.bankrupt || s.phase === 'over') return null;
  const head = s.queue[0];
  if (head) return head.playerId === pid ? decidePrompt(s, p, head) : null;
  if (M.currentPlayer(s).id !== pid) return null;
  const P = persona(p);
  if (s.phase === 'roll') {
    if (!s.rolledThisTurn && p.inJail) {
      if (p.jailCards.length) return { type: 'useJailCard', playerId: pid };
      if (p.cash >= P.bailCash && s.round < 25) return { type: 'payBail', playerId: pid };
    }
    const m = manage(s, p);
    if (m) return m;
    if (!s.rolledThisTurn && s.tradesThisTurn === 0 && rng() < P.tradeChance) {
      const offer = tradeIdea(s, p);
      if (offer) return { type: 'proposeTrade', playerId: pid, offer };
    }
    return { type: 'roll', playerId: pid };
  }
  if (s.phase === 'end') return manage(s, p) ?? { type: 'endTurn', playerId: pid };
  return null;
}

function manage(s: GameState, p: Player): Action | null {
  const P = persona(p);
  // Unmortgage when comfortably rich, completed groups first.
  for (const t of M.ownedTiles(s, p.id)) {
    if (s.props[t].mortgaged && p.cash - M.unmortgageCost(s, t) > P.buildReserve + 250)
      return { type: 'unmortgage', playerId: p.id, tileId: t };
  }
  // Build on the cheapest-to-improve buildable tile.
  const options = M.ownedTiles(s, p.id)
    .filter(t => !M.canBuild(s, p.id, t) && p.cash - TILES[t].houseCost! >= P.buildReserve)
    .sort((a, b) => s.props[a].houses - s.props[b].houses || TILES[b].rent![1] - TILES[a].rent![1]);
  if (options.length) return { type: 'build', playerId: p.id, tileId: options[0] };
  return null;
}

function decidePrompt(s: GameState, p: Player, h: Prompt): Action {
  const P = persona(p);
  const base = { playerId: p.id, promptId: h.id };
  switch (h.kind) {
    case 'buy': {
      const t = TILES[h.tileId];
      const after = p.cash - t.price!;
      const prog = groupProgress(s, p.id, h.tileId);
      const keen = prog.completes || (p.personality === 'builder' && prog.mine >= 2);
      const ok = after >= 0 && (after >= P.reserve || (keen && after >= 40) || (p.personality === 'aggressive'));
      return ok ? { type: 'buy', ...base } : { type: 'decline', ...base };
    }
    case 'auction': {
      const t = TILES[h.tileId];
      const prog = groupProgress(s, p.id, h.tileId);
      let max = t.price! * P.bidFactor * (prog.completes ? 1.4 : 1);
      max = Math.min(max, p.cash - Math.min(P.reserve, p.cash * 0.4));
      const step = Math.max(5, Math.round(t.price! * 0.05 / 5) * 5);
      const next = h.highBid + step;
      return next <= max && h.highBidder !== p.id ? { type: 'bid', ...base, amount: Math.floor(next) } : { type: 'pass', ...base };
    }
    case 'pay': {
      if (p.cash >= h.amount) return { type: 'confirm', ...base };
      return raiseFunds(s, p) ?? { type: 'bankrupt', ...base };
    }
    case 'choose': {
      const candidates = TILES.filter(t => M.isOwnable(t.id));
      const unowned = candidates.filter(t => !s.props[t.id].owner && t.price! <= p.cash);
      const mineGroup = unowned.find(t => groupProgress(s, p.id, t.id).completes);
      const pick = mineGroup ?? unowned.sort((a, b) => b.price! - a.price!)[0] ?? candidates.find(t => s.props[t.id].owner === p.id) ?? candidates[0];
      return { type: 'choose', ...base, tileId: pick.id };
    }
    case 'trade': return { type: 'respondTrade', ...base, accept: evaluateTrade(s, p, h.offer) };
    default: return { type: 'confirm', ...base };
  }
}

/** Sell buildings first, then mortgage the least valuable property. */
function raiseFunds(s: GameState, p: Player): Action | null {
  const owned = M.ownedTiles(s, p.id);
  const sellable = owned.filter(t => !M.canSell(s, p.id, t)).sort((a, b) => s.props[b].houses - s.props[a].houses);
  if (sellable.length) return { type: 'sell', playerId: p.id, tileId: sellable[0] };
  const mort = owned.filter(t => !M.canMortgage(s, p.id, t))
    .sort((a, b) => Number(M.ownsGroup(s, p.id, TILES[a].group!)) - Number(M.ownsGroup(s, p.id, TILES[b].group!)) || TILES[a].price! - TILES[b].price!);
  if (mort.length) return { type: 'mortgage', playerId: p.id, tileId: mort[0] };
  return null;
}

export function evaluateTrade(s: GameState, p: Player, o: TradeOffer): boolean {
  if (M.validateTrade(s, o)) return false;
  const P = persona(p);
  const iAmTo = o.to === p.id;
  const inProps = iAmTo ? o.giveProps : o.getProps;
  const outProps = iAmTo ? o.getProps : o.giveProps;
  const cashIn = iAmTo ? o.giveCash : o.getCash;
  const cashOut = iAmTo ? o.getCash : o.giveCash;
  const other = iAmTo ? o.from : o.to;
  let gain = cashIn - cashOut;
  for (const t of inProps) gain += tileValue(s, p.id, t, true);
  for (const t of outProps) {
    gain -= tileValue(s, p.id, t, false);
    // Don't hand an opponent a complete group cheaply.
    if (groupProgress(s, other, t).completes && TILES[t].kind === 'property') gain -= TILES[t].price! * 0.6;
  }
  gain += (o.giveJailCards - o.getJailCards) * (iAmTo ? 40 : -40);
  if (p.cash - cashOut < 50) return false;
  const scale = [...inProps, ...outProps].reduce((a, t) => a + TILES[t].price!, 0) + cashIn + cashOut;
  return gain >= scale * P.acceptMargin * 0.5;
}

/** Look for a single property that would complete one of our groups and offer cash for it. */
export function tradeIdea(s: GameState, p: Player): TradeOffer | null {
  const P = persona(p);
  for (const g of Object.values(GROUP_BY_ID)) {
    if (g.id === 'rail' || g.id === 'utility') continue;
    const mine = g.tiles.filter(t => s.props[t].owner === p.id);
    if (mine.length !== g.tiles.length - 1) continue;
    const missing = g.tiles.find(t => s.props[t].owner !== p.id)!;
    const owner = s.props[missing].owner;
    if (!owner || M.getPlayer(s, owner).bankrupt || M.groupHasBuildings(s, g.id)) continue;
    const offer = Math.round((TILES[missing].price! * P.tradeOffer) / 10) * 10;
    if (p.cash - offer < P.reserve * 0.5) continue;
    return { from: p.id, to: owner, giveProps: [], getProps: [missing], giveCash: offer, getCash: 0, giveJailCards: 0, getJailCards: 0 };
  }
  return null;
}
