import { describe, expect, it } from "vitest";
import { en } from "../src/lib/i18n/en";
import { fr } from "../src/lib/i18n/fr";

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("translations", () => {
  it("every language has the same keys and placeholders as French", () => {
    for (const [name, dict] of Object.entries({ en })) {
      expect(Object.keys(dict).sort(), name).toEqual(Object.keys(fr).sort());
      for (const [k, v] of Object.entries(fr)) {
        expect(placeholders((dict as Record<string, string>)[k]), `${name} ${k}`).toEqual(placeholders(v));
      }
    }
  });
});
