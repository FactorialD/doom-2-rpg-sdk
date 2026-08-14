import { Component, ElementRef, OnDestroy, effect, input, viewChild } from '@angular/core';

import { decodePng, indexedToRgba } from '../../../core/png-codec';
import type { DoomImageResource } from '../../../services/doom-image.service';

const previewCache = new Map<string, ImageData>();
export function clearImageThumbnailCache(key?: string): void { key ? previewCache.delete(key) : previewCache.clear(); }
export function imageThumbnailCacheKey(image: DoomImageResource): string {
  return `${image.archiveRevision}:${image.source}:${image.id}:${image.length}:${image.bytes.byteLength}`;
}

@Component({
  selector: 'app-image-thumbnail',
  standalone: true,
  template: `<canvas #canvas class="checker image-pixelated h-12 w-12 rounded border border-neutral-700"></canvas>`,
  styles: `
    .image-pixelated { image-rendering: pixelated; }
    .checker { background-color: #777; background-image: linear-gradient(45deg,#999 25%,transparent 25%),linear-gradient(-45deg,#999 25%,transparent 25%); background-size: 8px 8px; }
  `
})
export class ImageThumbnailComponent implements OnDestroy {
  readonly image = input.required<DoomImageResource>();
  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private observer?: IntersectionObserver;
  private renderRequest = 0;

  constructor() {
    effect(() => {
      const image = this.image();
      queueMicrotask(() => this.observe(image));
    });
  }

  ngOnDestroy(): void { this.renderRequest++; this.observer?.disconnect(); }

  private observe(image: DoomImageResource): void {
    this.observer?.disconnect();
    const request = ++this.renderRequest;
    const canvas = this.canvas().nativeElement;
    if (!('IntersectionObserver' in globalThis)) { void this.render(image, request); return; }
    this.observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { this.observer?.disconnect(); void this.render(image, request); }
    }, { rootMargin: '160px' });
    this.observer.observe(canvas);
  }

  private async render(image: DoomImageResource, request: number): Promise<void> {
    const key = imageThumbnailCacheKey(image);
    let data = previewCache.get(key);
    if (!data) {
      const decoded = await decodePng(image.bytes);
      const rgba = decoded.indexed ? indexedToRgba(decoded) : decoded.pixels;
      data = new ImageData(new Uint8ClampedArray(rgba), decoded.width, decoded.height);
      previewCache.set(key, data);
    }
    if (request !== this.renderRequest) return;
    const canvas = this.canvas().nativeElement;
    canvas.width = data.width; canvas.height = data.height;
    canvas.getContext('2d')?.putImageData(data, 0, 0);
  }
}
