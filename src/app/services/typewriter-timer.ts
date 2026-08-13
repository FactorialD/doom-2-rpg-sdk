type TimerHandle = ReturnType<typeof globalThis.setTimeout>;
type ScheduleTimer = (callback: () => void, delay: number) => TimerHandle;
type CancelTimer = (handle: TimerHandle) => void;

export interface TypewriterState {
  lineIndex: number;
  characterCount: number;
}

/** Canvas.dialogState reveals one character every 25 milliseconds. */
export const MS_PER_CHAR = 25;

export class TypewriterTimer {
  private timer: TimerHandle | null = null;
  private generation = 0;

  constructor(
    private readonly schedule: ScheduleTimer = (callback, delay) => globalThis.setTimeout(callback, delay),
    private readonly cancel: CancelTimer = handle => globalThis.clearTimeout(handle),
  ) {}

  start(lineLengths: readonly number[], frame: (state: TypewriterState) => void, complete: () => void) {
    this.stop();
    const generation = this.generation;
    let lineIndex = 0;
    let characterCount = 0;
    const advanceEmptyLines = () => {
      while (lineIndex < lineLengths.length && lineLengths[lineIndex] === 0) lineIndex++;
    };
    advanceEmptyLines();
    const tick = () => {
      if (generation !== this.generation) return;
      characterCount++;
      frame({ lineIndex, characterCount });
      if (characterCount >= lineLengths[lineIndex]) {
        lineIndex++;
        characterCount = 0;
        advanceEmptyLines();
      }
      if (lineIndex >= lineLengths.length) { this.timer = null; complete(); }
      else this.timer = this.schedule(tick, MS_PER_CHAR);
    };
    if (lineIndex >= lineLengths.length) complete();
    else this.timer = this.schedule(tick, MS_PER_CHAR);
  }

  stop() {
    this.generation++;
    if (this.timer !== null) this.cancel(this.timer);
    this.timer = null;
  }
}
