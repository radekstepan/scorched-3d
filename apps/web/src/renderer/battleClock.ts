/** A suspended battle consumes wall time without advancing any presentation/simulation clocks. */
export class BattleClock {
  private elapsed = 0;
  sample(delta: number, suspended: boolean): { dt: number; t: number } | null {
    if (suspended) return null;
    const dt = Math.max(0, Math.min(delta, 0.05));
    this.elapsed += dt;
    return { dt, t: this.elapsed };
  }
}
