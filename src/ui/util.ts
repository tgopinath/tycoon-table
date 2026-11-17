import type { Quality } from '../three/BoardScene';

export const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T;
export const $$ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => [...root.querySelectorAll(sel)] as T[];
export const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
export const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
export const fmtTime = (ms: number) => {
  const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  return `${h ? `${h}:` : ''}${String(m).padStart(h ? 2 : 1, '0')}:${String(ss).padStart(2, '0')}`;
};

export interface Settings { music: boolean; sfx: boolean; volume: number; quality: Quality; fast: boolean; follow: boolean; seenTutorial: boolean }
const KEY = 'tycoon-table.settings';
const SAVE = 'tycoon-table.save';
const defaults: Settings = { music: false, sfx: true, volume: 0.7, quality: 'high', fast: false, follow: true, seenTutorial: false };

export function loadSettings(): Settings {
  try { return { ...defaults, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }; } catch { return { ...defaults }; }
}
export function saveSettings(s: Settings) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage unavailable */ } }
export function saveGame(state: unknown) { try { localStorage.setItem(SAVE, JSON.stringify(state)); } catch { /* ignore */ } }
export function loadGame<T>(): T | null { try { const v = localStorage.getItem(SAVE); return v ? JSON.parse(v) as T : null; } catch { return null; } }
export function clearGame() { try { localStorage.removeItem(SAVE); } catch { /* ignore */ } }

let toastHost: HTMLElement;
export function toast(text: string, tone: 'info' | 'good' | 'bad' | 'error' = 'info', ms = 2600) {
  toastHost ??= $('#toasts');
  const el = document.createElement('div');
  el.className = `toast ${tone}`;
  el.innerHTML = text;
  toastHost.appendChild(el);
  requestAnimationFrame(() => el.classList.add('in'));
  setTimeout(() => { el.classList.remove('in'); setTimeout(() => el.remove(), 300); }, ms);
}
