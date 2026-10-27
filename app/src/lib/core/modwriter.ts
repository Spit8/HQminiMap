/**
 * Files GridLab writes for a capture:
 *   - one cutscene per pitch, in the installed mod (content/hqminimap/cutscenes/) — the game
 *     re-reads cutscene files at each playCutscene;
 *   - the plan, as a userdata table (<UD>/hqminimap/capture_plan.lua) that the mod re-reads at
 *     each scan with app.loadUserdata (ug_require would keep a stale copy until reload).
 * Plan and cutscenes are always written together and carry the same planStamp. Pure.
 */
import { FOV_V_DEG_MAX, FOV_V_DEG_MIN, type Mosaic } from "./geometry";
import { terrainSourceLabel, type Heightmap } from "./lua";
import {
  captureTiming, cutsceneFileName, NADIR_PITCH, renderCutscene, renderPlan, timingIssue, type TimingIssue,
} from "./plan";

/** Userdata file name of the plan (<UD>/hqminimap/<name>.lua). */
export const CAPTURE_PLAN_NAME = "capture_plan";

export interface ModFiles {
  /** capture_plan.lua (userdata format: function data() … return M end). */
  plan: string;
  cutscenes: { name: string; text: string }[];
}

export type WriteIssue =
  | { kind: "fov"; fov: number; min: number; max: number }
  | { kind: "coverage"; dx: number; dy: number; minGrid: { nX: number; nY: number } | null }
  | TimingIssue;

/** Why this mosaic cannot be written (null = OK); the UI turns it into a message. */
export function writeIssue(mo: Mosaic): WriteIssue | null {
  const fov = mo.config.FOV_V_DEG;
  if (!(fov >= FOV_V_DEG_MIN && fov <= FOV_V_DEG_MAX)) {
    return { kind: "fov", fov, min: FOV_V_DEG_MIN, max: FOV_V_DEG_MAX };
  }
  if (!mo.covered) {
    return { kind: "coverage", dx: Math.max(0, mo.deficitX), dy: Math.max(0, mo.deficitY), minGrid: mo.minGrid };
  }
  return timingIssue(captureTiming(mo.config));
}

/** renderPlan() text wrapped as a userdata table, with the write stamp (unix s). */
export function userdataPlan(planText: string, stamp: number): string {
  const body = planText.replace(/\nreturn M\n$/, `\nM.planStamp = ${Math.round(stamp)}\nreturn M\n`);
  return "function data()\n" + body + "end\n";
}

/** Plan content without comments / wrapper / stamp: equal ⇔ same capture. */
export function planSignature(text: string): string {
  return text
    .split("\n")
    .filter((l) => !l.startsWith("--") && l !== "function data()" && l !== "end" && !l.startsWith("M.planStamp"))
    .join("\n")
    .trim();
}

export function modFiles(mo: Mosaic, hm: Heightmap, stamp: number, pitches: number[] = [NADIR_PITCH]): ModFiles {
  return {
    plan: userdataPlan(renderPlan(mo, { terrainSource: terrainSourceLabel(hm) }, pitches), stamp),
    cutscenes: pitches.map((p, i) => ({ name: cutsceneFileName(i + 1), text: renderCutscene(mo, p, i + 1) })),
  };
}
