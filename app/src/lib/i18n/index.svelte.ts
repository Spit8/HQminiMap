/**
 * UI translations: t(key, params) reads the current locale (a rune), so templates update when the
 * language changes. Add a language: copy en.ts, translate the values, register it in LOCALES.
 */
import { en } from "./en";
import { fr, type MessageKey } from "./fr";

export type { MessageKey };

export const LOCALES = { fr, en } as const;
export type Locale = keyof typeof LOCALES;
const LS_KEY = "hq.locale";

function detect(): Locale {
  try {
    const saved = localStorage.getItem(LS_KEY);
    if (saved && saved in LOCALES) return saved as Locale;
  } catch {
    /* storage unavailable */
  }
  const nav = (typeof navigator !== "undefined" ? navigator.language : "fr").slice(0, 2).toLowerCase();
  return (nav in LOCALES ? nav : "en") as Locale;
}

class I18n {
  locale = $state<Locale>(detect());

  set(locale: Locale): void {
    this.locale = locale;
    try {
      localStorage.setItem(LS_KEY, locale);
    } catch {
      /* storage unavailable */
    }
  }

  /** BCP 47 tag for number/date formatting. */
  get tag(): string {
    return this.locale === "fr" ? "fr-FR" : "en-GB";
  }
}

export const i18n = new I18n();

export type Params = Record<string, string | number>;

/** Translated string; `{name}` placeholders replaced from params. Falls back to French, then the key. */
export function t(key: MessageKey, params?: Params): string {
  const dict = LOCALES[i18n.locale] as Record<MessageKey, string>;
  let s = dict[key] ?? fr[key] ?? key;
  if (params) for (const [k, v] of Object.entries(params)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

/** Locale-aware number / date helpers. */
export function fmtNum(v: number, digits = 0): string {
  return v.toLocaleString(i18n.tag, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function fmtDate(ms: number): string {
  return new Date(ms).toLocaleString(i18n.tag);
}

/** m:ss (or h:mm:ss) clock. */
export function fmtClock(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const two = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${two(m)}:${two(r)}` : `${m}:${two(r)}`;
}
