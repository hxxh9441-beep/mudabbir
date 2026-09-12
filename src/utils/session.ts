// src/utils/session.ts
// Tiny sessionStorage helpers — persist active work state so an accidental
// refresh (HMR / mobile browser reload) does NOT lose the recitation screen
// or the unsaved word highlights. Data lives only in the current tab.

const PREFIX = 'mudabbir:';

export function sessionGet<T>(key: string, fallback: T): T {
  try {
    const raw = sessionStorage.getItem(PREFIX + key);
    if (raw == null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function sessionSet(key: string, value: unknown): void {
  try {
    sessionStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* storage full / unavailable — non-critical */
  }
}

export function sessionRemove(key: string): void {
  try {
    sessionStorage.removeItem(PREFIX + key);
  } catch {
    /* ignore */
  }
}
