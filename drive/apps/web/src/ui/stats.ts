/** Frame statistics for the overlay: fps, frame time, physics time and renderer counters. */
export class FrameStats {
  fps = 0;
  frameMs = 0;
  physicsMs = 0;
  drawCalls = 0;
  triangles = 0;
  private windowStart = -1;
  private frames = 0;
  private frameMsSum = 0;
  private physicsMsSum = 0;

  constructor(private readonly windowMs = 500) {}

  /** Record one rendered frame. Averages refresh every `windowMs`. */
  frame(nowMs: number, frameMs: number, physicsMs: number, drawCalls: number, triangles: number): void {
    if (this.windowStart < 0) this.windowStart = nowMs;
    this.frames++;
    this.frameMsSum += frameMs;
    this.physicsMsSum += physicsMs;
    this.drawCalls = drawCalls;
    this.triangles = triangles;
    const elapsed = nowMs - this.windowStart;
    if (elapsed >= this.windowMs) {
      this.fps = (this.frames * 1000) / elapsed;
      this.frameMs = this.frameMsSum / this.frames;
      this.physicsMs = this.physicsMsSum / this.frames;
      this.windowStart = nowMs;
      this.frames = 0;
      this.frameMsSum = 0;
      this.physicsMsSum = 0;
    }
  }
}
