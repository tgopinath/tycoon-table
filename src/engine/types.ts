// Core game types. The engine is pure data + functions so it can run in the
// browser today and on an authoritative server later.

export type EntityId = string; // 'bank' | 'pot' | player id
export type TokenId = 'car' | 'ship' | 'cat' | 'dog' | 'rocket' | 'crown' | 'plane' | 'robot';
export type Personality = 'conservative' | 'aggressive' | 'builder' | 'trader' | 'balanced';
export type TileKind =
  | 'start' | 'property' | 'railway' | 'utility' | 'chance' | 'community'
  | 'tax' | 'jail' | 'parking' | 'gotojail';
export type Deck = 'chance' | 'community';

export interface TileDef {
  id: number;
  kind: TileKind;
  name: string;
  group?: string;
  price?: number;
  /** [base, 1 house, 2, 3, 4, hotel] for streets; base rent for railways/utilities is rule-based */
  rent?: number[];
  houseCost?: number;
  mortgage?: number;
  tax?: number;
}

export interface GroupDef { id: string; name: string; color: string; tiles: number[] }

export interface PropState { owner: string | null; houses: number; /* 5 = hotel */ mortgaged: boolean }

export interface PlayerStats { rentCollected: number; rentPaid: number; earned: number; spent: number }

export interface Player {
  id: string;
  name: string;
  token: TokenId;
  color: string;
  isAI: boolean;
  personality?: Personality;
  cash: number;
  position: number;
  inJail: boolean;
  jailTurns: number;
  jailCards: Deck[];
  doublesCount: number;
  bankrupt: boolean;
  stats: PlayerStats;
}

export interface Rules {
  startingCash: number;
  salary: number;
  doubleSalaryOnStart: boolean;
  auctions: boolean;
  freeParkingPot: boolean;
  bail: number;
  maxJailTurns: number;
  mortgageInterest: number;
  timeLimitMin: number; // 0 = unlimited
  houses: number;
  hotels: number;
  evenBuild: boolean;
}

export type TxType =
  | 'salary' | 'buy_property' | 'auction' | 'rent' | 'build_house' | 'build_hotel'
  | 'sell_building' | 'tax' | 'penalty' | 'reward' | 'trade' | 'mortgage'
  | 'unmortgage' | 'bail' | 'bankruptcy' | 'free_parking';

export interface Transaction {
  id: string;
  gameId: string;
  playerId: string;
  type: TxType;
  amount: number;
  sender: EntityId;
  receiver: EntityId;
  reason: string;
  timestamp: number;
  resultingBalance: number;
  senderBalance: number | null;
  receiverBalance: number | null;
}

export type Followup =
  | { type: 'jail' }
  | { type: 'leaveJail' }
  | { type: 'leaveJailMove'; steps: number };

interface PromptBase { id: string; playerId: string }
export interface PayPrompt extends PromptBase {
  kind: 'pay'; to: EntityId; amount: number; title: string; reason: string; txType: TxType;
  tileId?: number; split?: string[]; after?: Followup;
}
export interface CollectPrompt extends PromptBase {
  kind: 'collect'; from: EntityId; amount: number; title: string; reason: string; txType: TxType;
}
export interface BuyPrompt extends PromptBase { kind: 'buy'; tileId: number }
export interface AuctionPrompt extends PromptBase {
  kind: 'auction'; tileId: number; active: string[]; highBid: number; highBidder: string | null;
}
export interface CardPrompt extends PromptBase { kind: 'card'; deck: Deck; cardId: string }
export interface NoticePrompt extends PromptBase { kind: 'notice'; title: string; text: string; after?: Followup }
export interface ChoosePrompt extends PromptBase { kind: 'choose'; title: string; text: string }
export interface TradePrompt extends PromptBase { kind: 'trade'; offer: TradeOffer }

export type Prompt =
  | PayPrompt | CollectPrompt | BuyPrompt | AuctionPrompt | CardPrompt
  | NoticePrompt | ChoosePrompt | TradePrompt;
export type NewPrompt = Prompt extends infer P ? (P extends Prompt ? Omit<P, 'id'> : never) : never;

export interface TradeOffer {
  from: string;
  to: string;
  giveProps: number[];
  getProps: number[];
  giveCash: number;
  getCash: number;
  giveJailCards: number;
  getJailCards: number;
}

export type GameEvent =
  | { type: 'dice'; d1: number; d2: number }
  | { type: 'move'; playerId: string; path: number[]; teleport?: boolean }
  | { type: 'tx'; tx: Transaction }
  | { type: 'own'; tileId: number; owner: string | null }
  | { type: 'build'; tileId: number; houses: number; prev: number }
  | { type: 'mortgage'; tileId: number; mortgaged: boolean }
  | { type: 'card'; deck: Deck }
  | { type: 'jail'; playerId: string; inJail: boolean }
  | { type: 'bankrupt'; playerId: string }
  | { type: 'turn'; playerId: string }
  | { type: 'trade'; offer: TradeOffer; accepted: boolean }
  | { type: 'gameover' };

export interface LogEntry { t: number; text: string; playerId?: string; tone?: 'good' | 'bad' | 'info' }

export type Phase = 'roll' | 'action' | 'end' | 'over';

export interface GameState {
  id: string;
  version: number;
  seq: number;
  mode: 'local' | 'single' | 'tutorial';
  rules: Rules;
  players: Player[];
  props: Record<number, PropState>;
  turn: number;
  round: number;
  phase: Phase;
  rolledThisTurn: boolean;
  canRollAgain: boolean;
  tradesThisTurn: number;
  lastDice: [number, number] | null;
  queue: Prompt[];
  decks: Record<Deck, string[]>;
  housesLeft: number;
  hotelsLeft: number;
  pot: number;
  log: LogEntry[];
  transactions: Transaction[];
  startedAt: number;
  elapsedMs: number;
  endReason: 'last' | 'time' | 'agreement' | null;
}

export type Action =
  | { type: 'roll'; playerId: string }
  | { type: 'endTurn'; playerId: string }
  | { type: 'confirm'; playerId: string; promptId: string }
  | { type: 'buy'; playerId: string; promptId: string }
  | { type: 'decline'; playerId: string; promptId: string }
  | { type: 'bid'; playerId: string; promptId: string; amount: number }
  | { type: 'pass'; playerId: string; promptId: string }
  | { type: 'choose'; playerId: string; promptId: string; tileId: number }
  | { type: 'build'; playerId: string; tileId: number }
  | { type: 'sell'; playerId: string; tileId: number }
  | { type: 'mortgage'; playerId: string; tileId: number }
  | { type: 'unmortgage'; playerId: string; tileId: number }
  | { type: 'payBail'; playerId: string }
  | { type: 'useJailCard'; playerId: string }
  | { type: 'proposeTrade'; playerId: string; offer: TradeOffer }
  | { type: 'respondTrade'; playerId: string; promptId: string; accept: boolean }
  | { type: 'bankrupt'; playerId: string; promptId: string }
  | { type: 'endGame' };

export interface Result { ok: boolean; error?: string; code?: string }

export interface Ctx { s: GameState; emit(e: GameEvent): void; rng(): number }
