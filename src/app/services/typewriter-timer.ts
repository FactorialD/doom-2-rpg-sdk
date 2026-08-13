type TimerHandle = ReturnType<typeof globalThis.setTimeout>;
type ScheduleTimer = (callback: () => void, delay: number) => TimerHandle;
type CancelTimer = (handle: TimerHandle) => void;

export class TypewriterTimer {
  private timer: TimerHandle | null = null;
  private generation = 0;

  constructor(
    private readonly schedule: ScheduleTimer = (callback, delay) => globalThis.setTimeout(callback, delay),
    private readonly cancel: CancelTimer = handle => globalThis.clearTimeout(handle),
  ) {}

  start(length: number, delay: number, frame: (position: number) => void, complete: () => void) {
    this.stop();
    const generation = this.generation;
    let position = 0;
    const tick = () => {
      if (generation !== this.generation) return;
      frame(++position);
      if (position >= length) { this.timer = null; complete(); }
      else this.timer = this.schedule(tick, delay);
    };
    if (length === 0) complete();
    else this.timer = this.schedule(tick, delay);
  }

  stop() {
    this.generation++;
    if (this.timer !== null) this.cancel(this.timer);
    this.timer = null;
  }
}
