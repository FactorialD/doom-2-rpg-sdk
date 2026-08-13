import { Injectable } from '@angular/core';

export interface NavigationHighlightOptions {
  find: () => HTMLElement | null;
  expand?: () => void;
  timeoutMs?: number;
  durationMs?: number;
}

/** Coordinates the transient visual effect used by cross-editor navigation. */
@Injectable({ providedIn: 'root' })
export class NavigationHighlightService {
  private generation = 0;
  private cleanup: (() => void) | null = null;

  async reveal(options: NavigationHighlightOptions): Promise<boolean> {
    const generation = ++this.generation;
    this.cleanup?.();
    this.cleanup = null;
    options.expand?.();

    const timeout = options.timeoutMs ?? 5000;
    const started = Date.now();
    let element: HTMLElement | null = null;
    while (generation === this.generation && Date.now() - started < timeout) {
      element = options.find();
      if (element) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    if (!element || generation !== this.generation) return false;

    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const previous = {
      outline: element.style.outline,
      outlineOffset: element.style.outlineOffset,
      backgroundColor: element.style.backgroundColor,
      boxShadow: element.style.boxShadow,
    };
    element.style.outline = '2px solid #fbbf24';
    element.style.outlineOffset = '-2px';
    element.style.backgroundColor = 'rgba(245, 158, 11, .22)';
    element.style.boxShadow = 'inset 0 0 0 1px rgba(254, 240, 138, .8)';

    const restore = () => {
      element!.style.outline = previous.outline;
      element!.style.outlineOffset = previous.outlineOffset;
      element!.style.backgroundColor = previous.backgroundColor;
      element!.style.boxShadow = previous.boxShadow;
    };
    const timer = setTimeout(() => {
      restore();
      if (this.cleanup === cancel) this.cleanup = null;
    }, options.durationMs ?? 1600);
    const cancel = () => { clearTimeout(timer); restore(); };
    this.cleanup = cancel;
    return true;
  }
}
