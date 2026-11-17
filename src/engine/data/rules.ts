import type { Personality, Rules, TokenId } from '../types';

export const DEFAULT_RULES: Rules = {
  startingCash: 1500,
  salary: 200,
  doubleSalaryOnStart: false,
  auctions: true,
  freeParkingPot: false,
  bail: 50,
  maxJailTurns: 3,
  mortgageInterest: 0.1,
  timeLimitMin: 0,
  houses: 32,
  hotels: 12,
  evenBuild: true,
};

export const TOKENS: { id: TokenId; name: string; icon: string }[] = [
  { id: 'car', name: 'Racing Car', icon: '🏎️' },
  { id: 'ship', name: 'Ship', icon: '🚢' },
  { id: 'cat', name: 'Cat', icon: '🐱' },
  { id: 'dog', name: 'Dog', icon: '🐶' },
  { id: 'rocket', name: 'Rocket', icon: '🚀' },
  { id: 'crown', name: 'Crown', icon: '👑' },
  { id: 'plane', name: 'Airplane', icon: '✈️' },
  { id: 'robot', name: 'Robot', icon: '🤖' },
];
export const TOKEN_BY_ID = Object.fromEntries(TOKENS.map(t => [t.id, t])) as Record<TokenId, (typeof TOKENS)[number]>;

export const PLAYER_COLORS = ['#E63946', '#3A86FF', '#2EC4B6', '#FFB703', '#9B5DE5', '#FB5607'];

export const PERSONALITIES: Record<Personality, { label: string; desc: string }> = {
  conservative: { label: 'Conservative Investor', desc: 'Saves money and buys carefully.' },
  aggressive: { label: 'Aggressive Investor', desc: 'Buys whenever possible.' },
  builder: { label: 'Strategic Builder', desc: 'Completes colour groups and builds.' },
  trader: { label: 'Smart Trader', desc: 'Negotiates property exchanges.' },
  balanced: { label: 'Balanced Player', desc: 'A mix of every strategy.' },
};
