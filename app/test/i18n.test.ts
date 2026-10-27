import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fr } from "../src/lib/i18n/fr";
import { LOCALES } from "../src/lib/i18n/index.svelte";

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const formats = (s: string) => [...s.matchAll(/%(?:%|[-+ #0]*\d*(?:\.\d+)?[a-zA-Z])/g)].map((m) => m[0]);

describe("translations", () => {
  it("every language has the same keys and placeholders as French", () => {
    for (const [name, dict] of Object.entries(LOCALES)) {
      if (name === "fr") continue;
      expect(Object.keys(dict).sort(), name).toEqual(Object.keys(fr).sort());
      for (const [k, v] of Object.entries(fr)) {
        expect(placeholders((dict as Record<string, string>)[k]), `${name} ${k}`).toEqual(placeholders(v));
      }
    }
  });

  it("every mod language has the same keys and string.format codes as English", () => {
    const lua = readFileSync(new URL("../../mod/content/hqminimap/i18n.lua", import.meta.url), "utf8").replace(/\r\n/g, "\n");
    const tables: Record<string, Record<string, string>> = {};
    for (const m of lua.matchAll(/\n\t(\w+) = \{\n([\s\S]*?)\n\t\},/g)) {
      const t: Record<string, string> = {};
      for (const e of m[2]!.matchAll(/^\s*(\w+)\s*=\s*"((?:[^"\\]|\\.)*)",?\s*$/gm)) t[e[1]!] = e[2]!;
      tables[m[1]!] = t;
    }
    expect(Object.keys(tables)).toContain("en");
    const en = tables.en!;
    for (const [lang, t] of Object.entries(tables)) {
      expect(Object.keys(t).sort(), lang).toEqual(Object.keys(en).sort());
      for (const [k, v] of Object.entries(en)) expect(formats(t[k]!), `${lang} ${k}`).toEqual(formats(v));
    }
  });
});
