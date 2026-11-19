// save.js — the game's memory: cash, story progress, position and clock in
// localStorage, written on mission completions, arrests, hospital visits and
// every few seconds of play, so a closed tab reopens where Rio left off.

const KEY = 'port-marisol-save-v1';

export function loadSave() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (typeof data !== 'object' || data === null || typeof data.cash !== 'number') return null;
    return data;
  } catch {
    return null;
  }
}

export function storeSave(data) {
  try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* private mode: play on unsaved */ }
}

export function clearSave() {
  try { localStorage.removeItem(KEY); } catch { /* nothing to clear */ }
}
