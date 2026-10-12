export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export class ChapterNav {
  private targetIdx = 0;
  private startMs = -1;
  private durationMs: number;
  private reducedMotion: boolean;
  constructor(durationMs = 900, reducedMotion = false) {
    this.durationMs = durationMs;
    this.reducedMotion = reducedMotion;
  }
  request(i: number, nowMs: number) {
    this.targetIdx = i;
    this.startMs = nowMs;
  }
  setDuration(ms: number) {
    this.durationMs = ms;
  }
  target() {
    return this.targetIdx;
  }
  alpha(nowMs: number) {
    if (this.reducedMotion || this.startMs < 0) return 1;
    return easeInOutCubic(Math.min(1, Math.max(0, (nowMs - this.startMs) / this.durationMs)));
  }
  done(nowMs: number) {
    return this.alpha(nowMs) >= 1;
  }
}
