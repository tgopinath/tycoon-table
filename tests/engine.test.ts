import { describe, expect, it } from 'vitest';
import { GameEngine } from '../src/engine/GameEngine';
import { decide } from '../src/engine/AIManager';
import * as M from '../src/engine/managers';
import type { Action, Prompt } from '../src/engine/types';

function setup(n = 2, ai = false) {
  const q: number[] = [];
  const rng = () => (q.length ? q.shift()! : 0.5);
  const e = GameEngine.create({
    mode: 'local',
    players: Array.from({ length: n }, (_, i) => ({ name: `P${i + 1}`, token: 'car' as const, color: '#f00', isAI: ai, personality: 'balanced' as const })),
  }, rng);
  const dice = (a: number, b: number) => q.push((a - 1) / 6 + 0.01, (b - 1) / 6 + 0.01);
  const ok = (a: Action) => { const r = e.dispatch(a); expect(r.error).toBeUndefined(); expect(r.ok).toBe(true); };
  const head = () => e.s.queue[0] as Prompt;
  const confirm = () => ok({ type: 'confirm', playerId: head().playerId, promptId: head().id });
  const settle = () => {
    while (e.s.queue.length) {
      const h = head();
      if (h.kind === 'buy') ok({ type: 'decline', playerId: h.playerId, promptId: h.id });
      else if (h.kind === 'auction') ok({ type: 'pass', playerId: h.playerId, promptId: h.id });
      else confirm();
    }
  };
  return { e, s: () => e.s, dice, ok, head, confirm, settle, p: (i: number) => e.s.players[i] };
}

describe('Tycoon engine', () => {
  it('1. purchases an unowned property', () => {
    const t = setup();
    t.dice(1, 2); t.ok({ type: 'roll', playerId: 'p1' });
    expect(t.head().kind).toBe('buy');
    t.ok({ type: 'buy', playerId: 'p1', promptId: t.head().id });
    expect(t.p(0).cash).toBe(1440);
    expect(t.s().props[3].owner).toBe('p1');
    expect(t.s().transactions.at(-1)).toMatchObject({ type: 'buy_property', amount: 60, sender: 'p1', receiver: 'bank', resultingBalance: 1440 });
    expect(t.s().phase).toBe('end');
  });

  it('2–3. pays rent to the owner atomically (doubled with full group)', () => {
    const t = setup();
    t.s().props[1].owner = 'p2'; t.s().props[3].owner = 'p2';
    t.dice(1, 2); t.ok({ type: 'roll', playerId: 'p1' });
    const h = t.head();
    expect(h).toMatchObject({ kind: 'pay', to: 'p2', amount: 8, title: 'Rent Payment' });
    t.confirm();
    expect(t.p(0).cash).toBe(1492);
    expect(t.p(1).cash).toBe(1508);
    expect(t.p(1).stats.rentCollected).toBe(8);
    expect(t.p(0).stats.rentPaid).toBe(8);
  });

  it('4. collects salary when passing Start', () => {
    const t = setup();
    t.p(0).position = 38;
    t.dice(1, 2); t.ok({ type: 'roll', playerId: 'p1' });
    expect(t.head()).toMatchObject({ kind: 'collect', amount: 200 });
    t.confirm();
    expect(t.p(0).cash).toBe(1700);
    expect(t.head()).toMatchObject({ kind: 'buy', tileId: 1 });
  });

  it('5. pays income tax', () => {
    const t = setup();
    t.dice(1, 3); t.ok({ type: 'roll', playerId: 'p1' });
    expect(t.head()).toMatchObject({ kind: 'pay', amount: 200, title: 'INCOME TAX', to: 'bank' });
    t.confirm();
    expect(t.p(0).cash).toBe(1300);
  });

  it('6. draws a penalty card and pays it', () => {
    const t = setup();
    t.s().decks.chance = ['c12', ...t.s().decks.chance.filter(x => x !== 'c12')];
    t.dice(3, 4); t.ok({ type: 'roll', playerId: 'p1' });
    expect(t.head()).toMatchObject({ kind: 'card', cardId: 'c12' });
    t.confirm();
    expect(t.head()).toMatchObject({ kind: 'pay', amount: 15 });
    t.confirm();
    expect(t.p(0).cash).toBe(1485);
    expect(t.s().decks.chance.at(-1)).toBe('c12');
  });

  it('birthday card makes every other player pay', () => {
    const t = setup(3);
    t.s().decks.community = ['m8'];
    t.dice(1, 1); t.ok({ type: 'roll', playerId: 'p1' });
    t.confirm(); // card
    expect(t.head()).toMatchObject({ kind: 'pay', playerId: 'p2', to: 'p1', amount: 10 });
    t.confirm(); t.confirm();
    expect(t.p(0).cash).toBe(1520);
  });

  it('7–8. builds evenly and upgrades to a hotel', () => {
    const t = setup();
    t.s().props[1].owner = 'p1'; t.s().props[3].owner = 'p1';
    t.ok({ type: 'build', playerId: 'p1', tileId: 1 });
    expect(t.e.dispatch({ type: 'build', playerId: 'p1', tileId: 1 }).ok).toBe(false); // even build
    t.ok({ type: 'build', playerId: 'p1', tileId: 3 });
    for (let i = 0; i < 3; i++) { t.ok({ type: 'build', playerId: 'p1', tileId: 1 }); t.ok({ type: 'build', playerId: 'p1', tileId: 3 }); }
    expect(t.s().housesLeft).toBe(24);
    t.ok({ type: 'build', playerId: 'p1', tileId: 1 });
    expect(t.s().props[1].houses).toBe(5);
    expect(t.s().hotelsLeft).toBe(11);
    expect(t.s().housesLeft).toBe(28);
    expect(t.p(0).cash).toBe(1500 - 9 * 50);
    t.ok({ type: 'sell', playerId: 'p1', tileId: 1 });
    expect(t.s().props[1].houses).toBe(4);
  });

  it('9. goes to jail on Go to Jail', () => {
    const t = setup();
    t.p(0).position = 25;
    t.dice(2, 3); t.ok({ type: 'roll', playerId: 'p1' });
    expect(t.head()).toMatchObject({ kind: 'notice', title: 'Go to Jail' });
    t.confirm();
    expect(t.p(0)).toMatchObject({ inJail: true, position: 10 });
    expect(t.s().phase).toBe('end');
  });

  it('three doubles send the player to jail', () => {
    const t = setup();
    t.s().decks.community = ['m4', 'm7', 'm13'];
    t.dice(1, 1); t.ok({ type: 'roll', playerId: 'p1' }); t.settle();
    t.dice(2, 2); t.ok({ type: 'roll', playerId: 'p1' }); t.settle();
    t.dice(3, 3); t.ok({ type: 'roll', playerId: 'p1' });
    expect(t.head()).toMatchObject({ title: 'Three Doubles!' });
    t.confirm();
    expect(t.p(0).inJail).toBe(true);
  });

  it('10. pays bail and leaves jail', () => {
    const t = setup();
    t.p(0).inJail = true; t.p(0).position = 10;
    t.ok({ type: 'payBail', playerId: 'p1' });
    t.confirm();
    expect(t.p(0).inJail).toBe(false);
    expect(t.p(0).cash).toBe(1450);
    expect(t.s().phase).toBe('roll');
  });

  it('11. trades properties and money', () => {
    const t = setup();
    t.s().props[1].owner = 'p1'; t.s().props[6].owner = 'p2';
    t.ok({ type: 'proposeTrade', playerId: 'p1', offer: { from: 'p1', to: 'p2', giveProps: [1], getProps: [6], giveCash: 100, getCash: 0, giveJailCards: 0, getJailCards: 0 } });
    expect(t.head()).toMatchObject({ kind: 'trade', playerId: 'p2' });
    expect(t.e.dispatch({ type: 'respondTrade', playerId: 'p1', promptId: t.head().id, accept: true }).ok).toBe(false);
    t.ok({ type: 'respondTrade', playerId: 'p2', promptId: t.head().id, accept: true });
    expect(t.s().props[1].owner).toBe('p2');
    expect(t.s().props[6].owner).toBe('p1');
    expect(t.p(0).cash).toBe(1400);
    expect(t.p(1).cash).toBe(1600);
  });

  it('12. mortgages and unmortgages with interest', () => {
    const t = setup();
    t.s().props[39].owner = 'p1';
    t.ok({ type: 'mortgage', playerId: 'p1', tileId: 39 });
    expect(t.p(0).cash).toBe(1700);
    t.ok({ type: 'unmortgage', playerId: 'p1', tileId: 39 });
    expect(t.p(0).cash).toBe(1700 - 220);
  });

  it('13. goes bankrupt and transfers assets to the creditor', () => {
    const t = setup();
    t.s().props[37].owner = 'p2'; t.s().props[39].owner = 'p2'; t.s().props[39].houses = 5;
    t.s().props[1].owner = 'p1';
    t.p(0).cash = 100; t.p(0).position = 34;
    t.dice(2, 3); t.ok({ type: 'roll', playerId: 'p1' });
    const h = t.head();
    expect(h).toMatchObject({ kind: 'pay', amount: 2000 });
    expect(t.e.dispatch({ type: 'confirm', playerId: 'p1', promptId: h.id }).code).toBe('INSUFFICIENT_FUNDS');
    t.ok({ type: 'mortgage', playerId: 'p1', tileId: 1 });
    t.ok({ type: 'bankrupt', playerId: 'p1', promptId: h.id });
    expect(t.p(0).bankrupt).toBe(true);
    expect(t.s().props[1].owner).toBe('p2');
    expect(t.p(1).cash).toBe(1630);
    expect(t.s().phase).toBe('over');
    expect(t.s().endReason).toBe('last');
  });

  it('14. AI completes its turn by itself', () => {
    const t = setup(3, true);
    let guard = 0;
    while (t.s().turn === 0 && guard++ < 50) {
      const actor = t.e.actor!;
      const a = decide(t.s(), actor.id, () => 0.99);
      expect(a).not.toBeNull();
      t.ok(a!);
    }
    expect(t.s().turn).toBe(1);
  });

  it('17. rejects actions from the wrong player and rolls back failures', () => {
    const t = setup();
    expect(t.e.dispatch({ type: 'roll', playerId: 'p2' }).code).toBe('NOT_YOUR_TURN');
    t.dice(1, 2); t.ok({ type: 'roll', playerId: 'p1' });
    expect(t.e.dispatch({ type: 'roll', playerId: 'p1' }).ok).toBe(false); // no double roll
    const before = JSON.stringify(t.s());
    expect(t.e.dispatch({ type: 'buy', playerId: 'p2', promptId: t.head().id }).ok).toBe(false);
    expect(t.e.dispatch({ type: 'buy', playerId: 'p1', promptId: 'stale' }).code).toBe('STALE');
    expect(JSON.stringify(t.s())).toBe(before);
  });

  it('auction sells a declined property to the highest bidder', () => {
    const t = setup();
    t.dice(1, 2); t.ok({ type: 'roll', playerId: 'p1' });
    t.ok({ type: 'decline', playerId: 'p1', promptId: t.head().id });
    expect(t.head()).toMatchObject({ kind: 'auction', playerId: 'p1' });
    t.ok({ type: 'bid', playerId: 'p1', promptId: t.head().id, amount: 20 });
    t.ok({ type: 'bid', playerId: 'p2', promptId: t.head().id, amount: 30 });
    t.ok({ type: 'pass', playerId: 'p1', promptId: t.head().id });
    expect(t.s().props[3].owner).toBe('p2');
    expect(t.p(1).cash).toBe(1470);
  });

  it('time limit ends the game with net worth ranking', () => {
    const t = setup();
    t.s().rules.timeLimitMin = 1; t.s().elapsedMs = 61000;
    t.dice(1, 3); t.ok({ type: 'roll', playerId: 'p1' }); t.confirm();
    t.ok({ type: 'endTurn', playerId: 'p1' });
    expect(t.s().phase).toBe('over');
    expect(t.e.ranking()[0].p.id).toBe('p2');
  });
});

describe('AI simulation', () => {
  it('plays complete 4-player AI games without stalling or negative balances', () => {
    const personalities = ['conservative', 'aggressive', 'builder', 'trader', 'balanced'] as const;
    for (let g = 0; g < 6; g++) {
      let seed = g + 1;
      const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      const e = GameEngine.create({
        mode: 'single',
        players: Array.from({ length: 4 }, (_, i) => ({ name: `AI${i}`, token: 'car' as const, color: '#fff', isAI: true, personality: personalities[(i + g) % 5] })),
      }, rng);
      let steps = 0;
      while (e.s.phase !== 'over' && steps < 5000) {
        const a = decide(e.s, e.actor!.id, rng);
        expect(a).not.toBeNull();
        const r = e.dispatch(a!);
        if (!r.ok) throw new Error(`game ${g} step ${steps}: ${r.error} for ${JSON.stringify(a)} head=${JSON.stringify(e.s.queue[0])}`);
        for (const p of e.s.players) expect(p.cash).toBeGreaterThanOrEqual(0);
        steps++;
        if (steps === 4999) e.dispatch({ type: 'endGame' });
      }
      expect(e.s.phase).toBe('over');
      const owned = Object.values(e.s.props).filter(p => p.houses === 5).length;
      expect(e.s.hotelsLeft + owned).toBe(12);
    }
  }, 60000);

  it('19. values railways and utilities without NaN (net worth, liquidation)', () => {
    const t = setup();
    t.s().props[5].owner = 'p1'; t.s().props[12].owner = 'p1'; t.s().props[1].owner = 'p1'; t.s().props[1].houses = 2;
    expect(M.netWorth(t.s(), 'p1')).toBe(1500 + 200 + 150 + 60 + 2 * 50);
    expect(M.liquidationValue(t.s(), 'p1')).toBe(1500 + 100 + 75 + 30 + 2 * 25);
  });
});
