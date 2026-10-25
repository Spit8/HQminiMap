import { describe, expect, it } from "vitest";
import { viewerFilters as vf } from "../src/lib/state/viewerFilters.svelte";

describe("filter configurations", () => {
  it("save, apply, rename, default, delete", () => {
    vf.set({ search: "gare" });
    vf.saveAs("Gares");
    vf.reset();
    expect(vf.current.search).toBe("");
    vf.apply("Gares");
    expect(vf.current.search).toBe("gare");
    expect(vf.activeName).toBe("Gares");
    vf.setDefault("Gares");
    vf.rename("Gares", "Réseau");
    expect(vf.store.defaultName).toBe("Réseau");
    expect(vf.activeName).toBe("Réseau");
    vf.remove("Réseau");
    expect(vf.store.presets).toEqual([]);
    expect(vf.store.defaultName).toBeNull();
  });

  it("JSON export / import round trip", () => {
    vf.reset();
    vf.hide("towns", 7);
    vf.saveAs("A");
    const json = vf.exportJson();
    vf.remove("A");
    expect(vf.importJson(json)).toBe(1);
    vf.apply("A");
    expect(vf.current.hidden).toEqual(["towns:7"]);
    expect(() => vf.importJson("{}")).toThrow();
  });
});
