/**
 * UI translations: t(key, params) reads the current locale (a rune), so templates update when the
 * language changes. fr and en are written by hand; de, it, es and zh are generated (tools/i18n/README.md).
 * Add a language: generate it, register it in LOCALES and TAGS.
 */
import { de } from "./de";
import { en } from "./en";
import { es } from "./es";
import { fr, type MessageKey } from "./fr";
import { it } from "./it";
import { zh } from "./zh";

export type { MessageKey };

export const LOCALES = { fr, en, de, it, es, zh } as const;
export type Locale = keyof typeof LOCALES;
/** BCP 47 tag of each language (number / date formatting, and the page's lang for CJK glyphs). */
const TAGS: Record<Locale, string> = { fr: "fr-FR", en: "en-GB", de: "de-DE", it: "it-IT", es: "es-ES", zh: "zh-CN" };
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

/** The page's language: the browser picks Simplified Chinese glyphs for zh, hyphenation, etc. */
function setDocumentLang(locale: Locale): void {
  if (typeof document !== "undefined") document.documentElement.lang = TAGS[locale];
}

class I18n {
  locale = $state<Locale>(detect());

  constructor() {
    setDocumentLang(this.locale);
  }

  set(locale: Locale): void {
    this.locale = locale;
    setDocumentLang(locale);
    try {
      localStorage.setItem(LS_KEY, locale);
    } catch {
      /* storage unavailable */
    }
  }

  /** BCP 47 tag for number/date formatting. */
  get tag(): string {
    return TAGS[this.locale];
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
