/**
 * Visibility of the steps strip (map creation workflow). Shown by default; hiding it remembers
 * the current capture grid, and the strip comes back by itself as soon as a new grid is written.
 */
import { app } from "./app.svelte";

const LS = "hq.stepsHidden";

function load(): string | null {
  try {
    return localStorage.getItem(LS);
  } catch {
    return null;
  }
}

/** Identity of the grid currently written for the mod ("none" before the first one). */
const gridKey = () => String(app.capturePlan?.stamp ?? "none");

class StepsBar {
  /** Grid the strip was hidden for (null: never hidden, or shown again by hand). */
  hiddenFor = $state<string | null>(load());

  get visible(): boolean {
    return this.hiddenFor === null || this.hiddenFor !== gridKey();
  }

  private save(): void {
    try {
      if (this.hiddenFor === null) localStorage.removeItem(LS);
      else localStorage.setItem(LS, this.hiddenFor);
    } catch {
      /* storage unavailable */
    }
  }

  hide(): void {
    this.hiddenFor = gridKey();
    this.save();
  }

  show(): void {
    this.hiddenFor = null;
    this.save();
  }
}

export const stepsBar = new StepsBar();
