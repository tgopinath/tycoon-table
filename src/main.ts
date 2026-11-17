import './style.css';
import { GameEngine, type GameConfig } from './engine/GameEngine';
import type { GameState } from './engine/types';
import { BoardScene } from './three/BoardScene';
import { sound } from './audio/Sound';
import { GameView } from './ui/GameView';
import { hideScreen, howTo, mainMenu, results, settingsModal, setup, welcome } from './ui/screens';
import { $, clearGame, loadGame, loadSettings, saveGame, type Settings } from './ui/util';

const settings = loadSettings();
const scene = new BoardScene($('#stage'));
let view: GameView | null = null;
let lastConfig: GameConfig | null = null;

function applySettings(s: Settings) {
  sound.sfxOn = s.sfx;
  sound.setVolume(s.volume);
  sound.setMusic(s.music);
  scene.setQuality(s.quality);
  scene.speed = s.fast ? 2.2 : 1;
  scene.follow = s.follow;
}
applySettings(settings);

function menu() {
  view?.destroy(); view = null;
  scene.idleSpin = true;
  const saved = loadGame<GameState>();
  mainMenu({
    newGame: mode => setup(mode, startNew, menu),
    tutorial: () => startNew({
      mode: 'tutorial',
      players: [
        { name: 'You', token: 'car', color: '#E63946', isAI: false },
        { name: 'Coach Bot', token: 'robot', color: '#3A86FF', isAI: true, personality: 'balanced' },
      ],
    }),
    resume: saved && saved.phase !== 'over' ? () => startGame(new GameEngine(saved)) : null,
    settings: () => settingsModal(settings, applySettings),
    howTo: () => howTo(menu),
  });
}

function startNew(cfg: GameConfig) {
  lastConfig = cfg;
  const e = GameEngine.create(cfg);
  saveGame(e.s);
  startGame(e);
}

function startGame(e: GameEngine) {
  hideScreen();
  view?.destroy();
  view = new GameView(e, scene, settings, {
    exit: menu,
    applySettings,
    finished: () => {
      clearGame();
      view?.destroy(); view = null;
      scene.idleSpin = true;
      results(e, () => (lastConfig ? startNew(lastConfig) : menu()), menu);
    },
  });
  view.start();
  if (import.meta.env.DEV) Object.assign(window, { __tycoon: { engine: e, scene, view } });
}

scene.idleSpin = true;
welcome(menu);
