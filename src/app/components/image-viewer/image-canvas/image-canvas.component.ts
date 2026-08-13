import {
  Component,
  ElementRef,
  HostListener,
  effect,
  input,
  output,
  viewChild
} from '@angular/core';

import { indexedToRgba, type DecodedPng } from '../../../core/png-codec';
import {
  floodFillPixels,
  moveSelectionPixels,
  paintBrush,
  rasterizeLine,
  type CanvasPoint,
  type PixelBuffer
} from '../../texture-viewer/texture-canvas/texture-canvas-interaction';

export type ImageTool = 'pencil' | 'brush' | 'fill' | 'select';
export interface ImageSelection { x: number; y: number; width: number; height: number }

@Component({
  selector: 'app-image-canvas',
  standalone: true,
  template: `
    <canvas
      #canvas
      class="image-pixelated border border-neutral-700 touch-none"
      [style.width.px]="model().width * zoom()"
      [style.height.px]="model().height * zoom()"
      (pointerdown)="down($event)"
      (pointermove)="move($event)"
      (pointerleave)="cursor.emit(null)"
      (pointerup)="up($event)"
      (pointercancel)="cancel($event)"
    ></canvas>
  `,
  styles: `
    .image-pixelated { image-rendering: pixelated; }
  `
})
export class ImageCanvasComponent {
  readonly model = input.required<DecodedPng>();
  readonly tool = input<ImageTool>('pencil');
  readonly zoom = input(8);
  readonly brushSize = input(1);
  readonly paletteIndex = input(0);
  readonly rgba = input<[number, number, number, number]>([255, 255, 255, 255]);
  readonly indexedClearIndex = input<number | null>(null);
  readonly changed = output<PixelBuffer>();
  readonly cursor = output<CanvasPoint | null>();
  readonly selectionChanged = output<ImageSelection | null>();

  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private last: CanvasPoint | null = null;
  private dragOrigin: CanvasPoint | null = null;
  private selection: ImageSelection | null = null;
  private initialSelection: ImageSelection | null = null;
  private snapshot: PixelBuffer | null = null;
  private working: PixelBuffer | null = null;
  private dragOffset: CanvasPoint = { x: 0, y: 0 };
  private clearedSelectionOnDown = false;

  constructor() {
    effect(() => {
      this.model();
      this.render();
    });
  }

  @HostListener('document:keydown.escape')
  escape(): void {
    if (this.snapshot) {
      this.resetDrag();
      this.render();
      return;
    }
    this.setSelection(null);
    this.render();
  }

  down(event: PointerEvent): void {
    if (event.button !== 0) return;
    const point = this.point(event);
    this.cursor.emit(point);
    this.canvas().nativeElement.setPointerCapture(event.pointerId);
    this.last = point;
    this.dragOrigin = point;
    this.snapshot = this.model().pixels.slice() as PixelBuffer;
    this.working = this.snapshot.slice() as PixelBuffer;

    if (this.tool() === 'select') {
      if (!this.selection || !this.contains(this.selection, point)) {
        this.clearedSelectionOnDown = this.selection !== null;
        this.setSelection(null);
        this.initialSelection = null;
      } else {
        this.initialSelection = { ...this.selection };
      }
      this.render(this.working);
      return;
    }
    if (this.tool() === 'fill') {
      this.working = floodFillPixels(this.working, this.model().width, this.model().height, point, this.color(), this.channels());
      this.commit();
    } else {
      this.draw(point, point);
    }
  }

  move(event: PointerEvent): void {
    const point = this.point(event);
    this.cursor.emit(point);
    if (!this.last || !this.working || !(event.buttons & 1)) return;
    if (this.tool() === 'select') {
      this.previewSelection(point);
    } else {
      this.draw(this.last, point);
      this.last = point;
    }
  }

  up(event: PointerEvent): void {
    if (this.tool() === 'select' && this.dragOrigin) {
      const point = this.point(event);
      if (!this.initialSelection) {
        if (point.x !== this.dragOrigin.x || point.y !== this.dragOrigin.y || !this.clearedSelectionOnDown) {
          this.setSelection(this.rectangle(this.dragOrigin, point));
        }
      } else if (this.dragOffset.x || this.dragOffset.y) {
        this.commit();
      }
    } else if (this.working) {
      this.commit();
    }
    this.resetDrag();
    this.release(event.pointerId);
    this.render();
  }

  cancel(event: PointerEvent): void {
    this.resetDrag();
    this.release(event.pointerId);
    this.render();
  }

  private previewSelection(point: CanvasPoint): void {
    if (!this.dragOrigin || !this.initialSelection || !this.snapshot) return;
    const clear = this.model().indexed ? this.indexedClearIndex() : [0, 0, 0, 0];
    if (clear === null) return;
    this.dragOffset = { x: point.x - this.dragOrigin.x, y: point.y - this.dragOrigin.y };
    const next = {
      ...this.initialSelection,
      x: this.initialSelection.x + this.dragOffset.x,
      y: this.initialSelection.y + this.dragOffset.y
    };
    this.working = moveSelectionPixels(
      this.snapshot,
      this.model().width,
      this.model().height,
      this.initialSelection,
      next.x,
      next.y,
      clear,
      this.channels()
    );
    this.setSelection(next);
    this.render(this.working);
  }

  private draw(start: CanvasPoint, end: CanvasPoint): void {
    for (const point of rasterizeLine(start, end)) {
      this.working = paintBrush(this.working!, this.model().width, this.model().height, point, this.color(), this.tool() === 'brush' ? this.brushSize() : 1, this.channels());
    }
    this.render(this.working!);
  }

  private commit(): void {
    if (this.working) this.changed.emit(this.working);
  }

  private resetDrag(): void {
    this.last = null;
    this.dragOrigin = null;
    this.initialSelection = null;
    this.snapshot = null;
    this.working = null;
    this.dragOffset = { x: 0, y: 0 };
    this.clearedSelectionOnDown = false;
  }

  private setSelection(selection: ImageSelection | null): void {
    this.selection = selection;
    this.selectionChanged.emit(selection);
  }

  private render(pixels = this.model().pixels): void {
    queueMicrotask(() => {
      const canvas = this.canvas().nativeElement;
      const model = this.model();
      canvas.width = model.width;
      canvas.height = model.height;
      const rgba = model.indexed ? indexedToRgba({ ...model, pixels }) : pixels as Uint8ClampedArray;
      const context = canvas.getContext('2d')!;
      context.putImageData(new ImageData(new Uint8ClampedArray(rgba), model.width, model.height), 0, 0);
      if (this.selection) {
        context.save();
        context.strokeStyle = '#fff';
        context.lineWidth = 1;
        context.setLineDash([2, 1]);
        context.strokeRect(this.selection.x + 0.5, this.selection.y + 0.5, this.selection.width, this.selection.height);
        context.strokeStyle = '#dc2626';
        context.setLineDash([1, 2]);
        context.strokeRect(this.selection.x + 0.5, this.selection.y + 0.5, this.selection.width, this.selection.height);
        context.restore();
      }
    });
  }

  private point(event: PointerEvent): CanvasPoint {
    const rect = this.canvas().nativeElement.getBoundingClientRect();
    const model = this.model();
    return {
      x: Math.max(0, Math.min(model.width - 1, Math.floor((event.clientX - rect.left) * model.width / rect.width))),
      y: Math.max(0, Math.min(model.height - 1, Math.floor((event.clientY - rect.top) * model.height / rect.height)))
    };
  }

  private rectangle(start: CanvasPoint, end: CanvasPoint): ImageSelection {
    return { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width: Math.abs(end.x - start.x) + 1, height: Math.abs(end.y - start.y) + 1 };
  }

  private contains(selection: ImageSelection, point: CanvasPoint): boolean {
    return point.x >= selection.x && point.y >= selection.y && point.x < selection.x + selection.width && point.y < selection.y + selection.height;
  }

  private channels(): number { return this.model().indexed ? 1 : 4; }
  private color(): number[] { return this.model().indexed ? [this.paletteIndex()] : this.rgba(); }
  private release(pointerId: number): void { if (this.canvas().nativeElement.hasPointerCapture(pointerId)) this.canvas().nativeElement.releasePointerCapture(pointerId); }
}
