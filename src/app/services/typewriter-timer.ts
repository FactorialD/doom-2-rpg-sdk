export class TypewriterTimer {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;

  constructor(private readonly schedule = setTimeout, private readonly cancel = clearTimeout) {}

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
