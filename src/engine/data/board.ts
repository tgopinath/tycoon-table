import type { GroupDef, TileDef } from '../types';

// Configurable board data. Values follow classic property-trading game economics.
export const GROUPS: GroupDef[] = [
  { id: 'brown', name: 'Harbor', color: '#8B5A3C', tiles: [1, 3] },
  { id: 'sky', name: 'Garden', color: '#5DB7DE', tiles: [6, 8, 9] },
  { id: 'pink', name: 'Blossom', color: '#D9579B', tiles: [11, 13, 14] },
  { id: 'orange', name: 'Spice', color: '#F08A24', tiles: [16, 18, 19] },
  { id: 'red', name: 'Gem', color: '#D7263D', tiles: [21, 23, 24] },
  { id: 'yellow', name: 'Sunshine', color: '#E9B500', tiles: [26, 27, 29] },
  { id: 'green', name: 'Evergreen', color: '#1F9D55', tiles: [31, 32, 34] },
  { id: 'navy', name: 'Marina', color: '#2A4BA0', tiles: [37, 39] },
  { id: 'rail', name: 'Railways', color: '#3A3A44', tiles: [5, 15, 25, 35] },
  { id: 'utility', name: 'Utilities', color: '#7A8590', tiles: [12, 28] },
];

const st = (id: number, name: string, group: string, price: number, rent: number[], houseCost: number): TileDef =>
  ({ id, kind: 'property', name, group, price, rent, houseCost, mortgage: price / 2 });
const rail = (id: number, name: string): TileDef =>
  ({ id, kind: 'railway', name, group: 'rail', price: 200, mortgage: 100 });
const util = (id: number, name: string): TileDef =>
  ({ id, kind: 'utility', name, group: 'utility', price: 150, mortgage: 75 });

export const TILES: TileDef[] = [
  { id: 0, kind: 'start', name: 'Start' },
  st(1, 'Harbor Lane', 'brown', 60, [2, 10, 30, 90, 160, 250], 50),
  { id: 2, kind: 'community', name: 'Community Chest' },
  st(3, 'Fisher Row', 'brown', 60, [4, 20, 60, 180, 320, 450], 50),
  { id: 4, kind: 'tax', name: 'Income Tax', tax: 200 },
  rail(5, 'North Station'),
  st(6, 'Maple Avenue', 'sky', 100, [6, 30, 90, 270, 400, 550], 50),
  { id: 7, kind: 'chance', name: 'Chance' },
  st(8, 'Willow Street', 'sky', 100, [6, 30, 90, 270, 400, 550], 50),
  st(9, 'Cedar Court', 'sky', 120, [8, 40, 100, 300, 450, 600], 50),
  { id: 10, kind: 'jail', name: 'Jail' },
  st(11, 'Rose Boulevard', 'pink', 140, [10, 50, 150, 450, 625, 750], 100),
  util(12, 'Power Grid Co.'),
  st(13, 'Lily Gardens', 'pink', 140, [10, 50, 150, 450, 625, 750], 100),
  st(14, 'Orchid Plaza', 'pink', 160, [12, 60, 180, 500, 700, 900], 100),
  rail(15, 'East Line Depot'),
  st(16, 'Amber Road', 'orange', 180, [14, 70, 200, 550, 750, 950], 100),
  { id: 17, kind: 'community', name: 'Community Chest' },
  st(18, 'Saffron Square', 'orange', 180, [14, 70, 200, 550, 750, 950], 100),
  st(19, 'Copper Hill', 'orange', 200, [16, 80, 220, 600, 800, 1000], 100),
  { id: 20, kind: 'parking', name: 'Free Parking' },
  st(21, 'Ruby Drive', 'red', 220, [18, 90, 250, 700, 875, 1050], 150),
  { id: 22, kind: 'chance', name: 'Chance' },
  st(23, 'Crimson Way', 'red', 220, [18, 90, 250, 700, 875, 1050], 150),
  st(24, 'Scarlet Park', 'red', 240, [20, 100, 300, 750, 925, 1100], 150),
  rail(25, 'South Central'),
  st(26, 'Sunflower Terrace', 'yellow', 260, [22, 110, 330, 800, 975, 1150], 150),
  st(27, 'Golden Mews', 'yellow', 260, [22, 110, 330, 800, 975, 1150], 150),
  util(28, 'Aqua Works'),
  st(29, 'Honey Crescent', 'yellow', 280, [24, 120, 360, 850, 1025, 1200], 150),
  { id: 30, kind: 'gotojail', name: 'Go to Jail' },
  st(31, 'Emerald Heights', 'green', 300, [26, 130, 390, 900, 1100, 1275], 200),
  st(32, 'Jade Parkway', 'green', 300, [26, 130, 390, 900, 1100, 1275], 200),
  { id: 33, kind: 'community', name: 'Community Chest' },
  st(34, 'Fern Embankment', 'green', 320, [28, 150, 450, 1000, 1200, 1400], 200),
  rail(35, 'West Express'),
  { id: 36, kind: 'chance', name: 'Chance' },
  st(37, 'Sapphire Bay', 'navy', 350, [35, 175, 500, 1100, 1300, 1500], 200),
  { id: 38, kind: 'tax', name: 'Luxury Tax', tax: 100 },
  st(39, 'Royal Marina', 'navy', 400, [50, 200, 600, 1400, 1700, 2000], 200),
];

export const GROUP_BY_ID: Record<string, GroupDef> = Object.fromEntries(GROUPS.map(g => [g.id, g]));
export const RAIL_RENT = [25, 50, 100, 200];
export const UTILITY_MULT = [4, 10];
