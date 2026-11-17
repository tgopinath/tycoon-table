import type { Deck } from '../types';

export type CardEffect =
  | { type: 'collect'; amount: number }
  | { type: 'pay'; amount: number }
  | { type: 'collectEach'; amount: number }
  | { type: 'payEach'; amount: number }
  | { type: 'moveTo'; tile: number }
  | { type: 'moveBy'; steps: number }
  | { type: 'nearest'; kind: 'railway' | 'utility' }
  | { type: 'jail' }
  | { type: 'jailFree' }
  | { type: 'repairs'; house: number; hotel: number }
  | { type: 'choose' };

export interface CardDef { id: string; deck: Deck; text: string; effect: CardEffect }

const c = (deck: Deck, n: number, text: string, effect: CardEffect): CardDef => ({ id: `${deck === "chance" ? "c" : "m"}${n}`, deck, text, effect });

export const CARDS: CardDef[] = [
  c('chance', 1, 'Advance to Start. Collect your salary.', { type: 'moveTo', tile: 0 }),
  c('chance', 2, 'Advance to Scarlet Park. If you pass Start, collect your salary.', { type: 'moveTo', tile: 24 }),
  c('chance', 3, 'Advance to Rose Boulevard. If you pass Start, collect your salary.', { type: 'moveTo', tile: 11 }),
  c('chance', 4, 'Advance to the nearest railway. If owned, pay the owner double rent.', { type: 'nearest', kind: 'railway' }),
  c('chance', 5, 'Advance to the nearest railway. If owned, pay the owner double rent.', { type: 'nearest', kind: 'railway' }),
  c('chance', 6, 'Advance to the nearest utility. If owned, pay 10× your dice roll.', { type: 'nearest', kind: 'utility' }),
  c('chance', 7, 'The bank pays you a dividend of $100.', { type: 'collect', amount: 100 }),
  c('chance', 8, 'Get Out of Jail Free. Keep this card until needed.', { type: 'jailFree' }),
  c('chance', 9, 'Move backward three spaces.', { type: 'moveBy', steps: -3 }),
  c('chance', 10, 'Go directly to Jail. Do not pass Start.', { type: 'jail' }),
  c('chance', 11, 'Repair fee: pay $25 per house and $100 per hotel.', { type: 'repairs', house: 25, hotel: 100 }),
  c('chance', 12, 'Speeding fine. Pay $15.', { type: 'pay', amount: 15 }),
  c('chance', 13, 'Take a trip to North Station.', { type: 'moveTo', tile: 5 }),
  c('chance', 14, 'Advance to Royal Marina.', { type: 'moveTo', tile: 39 }),
  c('chance', 15, 'You are elected chairman. Pay every player $25.', { type: 'payEach', amount: 25 }),
  c('chance', 16, 'Your building loan matures. Collect $150.', { type: 'collect', amount: 150 }),
  c('chance', 17, 'Move forward three spaces.', { type: 'moveBy', steps: 3 }),
  c('chance', 18, 'Advance to any property of your choice.', { type: 'choose' }),
  c('chance', 19, 'Pay a tax of $150.', { type: 'pay', amount: 150 }),

  c('community', 1, 'Advance to Start. Collect your salary.', { type: 'moveTo', tile: 0 }),
  c('community', 2, 'Bank error in your favour. The bank pays you $200.', { type: 'collect', amount: 200 }),
  c('community', 3, 'Building maintenance. Pay $50.', { type: 'pay', amount: 50 }),
  c('community', 4, 'From the sale of shares, collect $50.', { type: 'collect', amount: 50 }),
  c('community', 5, 'Get Out of Jail Free. Keep this card until needed.', { type: 'jailFree' }),
  c('community', 6, 'Go directly to Jail. Do not pass Start.', { type: 'jail' }),
  c('community', 7, 'Holiday fund matures. Collect $100.', { type: 'collect', amount: 100 }),
  c('community', 8, 'It is your birthday! Receive $10 from every player.', { type: 'collectEach', amount: 10 }),
  c('community', 9, 'Grand opening! Receive $50 from every player.', { type: 'collectEach', amount: 50 }),
  c('community', 10, 'Hospital fees. Pay $100.', { type: 'pay', amount: 100 }),
  c('community', 11, 'Repair fee: pay $40 per house and $115 per hotel.', { type: 'repairs', house: 40, hotel: 115 }),
  c('community', 12, 'Repair fee. Pay $100.', { type: 'pay', amount: 100 }),
  c('community', 13, 'Consultancy fee. Collect $25.', { type: 'collect', amount: 25 }),
  c('community', 14, 'You inherit $100.', { type: 'collect', amount: 100 }),
  c('community', 15, 'Tax refund. Collect $20.', { type: 'collect', amount: 20 }),
  c('community', 16, 'Community fundraiser. Pay every player $25.', { type: 'payEach', amount: 25 }),
  c('community', 17, 'You won second prize in a design contest. Collect $10.', { type: 'collect', amount: 10 }),
];

export const CARD_BY_ID: Record<string, CardDef> = Object.fromEntries(CARDS.map(x => [x.id, x]));
export const DECK_TITLE: Record<Deck, string> = { chance: 'Chance', community: 'Community Chest' };
