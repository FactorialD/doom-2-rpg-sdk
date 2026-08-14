import { CommonModule } from '@angular/common';
import { Component, HostListener, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import {
  decodePng,
  encodeIndexedPng,
  encodeRgbaPng,
  indexedToRgba,
  type DecodedPng
} from '../../core/png-codec';
import { DoomImageService, type DoomImageResource } from '../../services/doom-image.service';
import { EditorService } from '../../services/editor.service';
import {
  compositeRgba,
  quantizeRgba,
  resizeCanvas,
  ImageProcessingService,
  type CanvasAnchor,
  type ImageScalingMode
} from '../../services/image-processing.service';
import { downloadBlob } from '../../shared/browser-download';
import { readClipboardImage } from '../../shared/image-clipboard';
import { ImageCanvasComponent, type ImageSelection, type ImageTool } from './image-canvas/image-canvas.component';
import { ImageLoadGuard } from './image-load-guard';
import { ImageListComponent } from './image-list/image-list.component';
import { clearImageThumbnailCache } from './image-thumbnail/image-thumbnail.component';

interface HistoryEntry { model: DecodedPng; bytes: number }
const HISTORY_LIMIT = 40;
const HISTORY_BYTES = 64 * 1024 * 1024;

@Component({
  selector: 'app-image-viewer',
  standalone: true,
  imports: [CommonModule, FormsModule, ImageCanvasComponent, ImageListComponent],
  host: { '(document:paste)': 'onPaste($event)' },
  template: `
    <div data-testid="image-workspace" class="flex h-full bg-neutral-950 text-neutral-300">
      <app-image-list [images]="imageService.images()" [active]="selected()" (selected)="select($event)" />
      <section class="flex min-w-0 flex-1 flex-col">
        @if (model(); as current) {
          <header class="flex flex-wrap items-center gap-2 border-b border-neutral-800 p-2">
            @for (item of tools; track item) { <button class="button" [class.active]="tool() === item" (click)="tool.set(item)">{{ item }}</button> }
            <button class="button" [disabled]="!canUndo()" (click)="undo()">Undo</button>
            <button class="button" [disabled]="!canRedo()" (click)="redo()">Redo</button>
            <label>Brush <input class="num" type="number" [(ngModel)]="brushSize"></label>
            @if (current.indexed) { <label>Index <input class="num" type="number" [(ngModel)]="paletteIndex"></label> }
            @else { <input aria-label="Drawing color" type="color" [(ngModel)]="color"><label>Alpha <input type="range" min="0" max="255" [(ngModel)]="alpha"></label> }
            <label class="button">Import<input hidden type="file" accept="image/*" (change)="importFile($event)"></label>
            <button class="button" (click)="pasteFromClipboard()">Paste</button>
            <button class="button" (click)="exportImage()">Export</button>
            <button class="button" [disabled]="!dirty()" (click)="save()">Save</button>
            <label>Zoom <input type="range" min="1" max="32" [(ngModel)]="zoom"></label>
            @if (selected()?.source === 'file') { <button class="button" (click)="resizeOpen.set(!resizeOpen())">Resize</button> }
          </header>
          @if (importModel()) {
            <div class="flex flex-wrap items-center gap-2 bg-neutral-900 p-2">
              <label>X <input class="num" type="number" [(ngModel)]="importX"></label><label>Y <input class="num" type="number" [(ngModel)]="importY"></label>
              <label>W <input class="num" type="number" [(ngModel)]="importWidth"></label><label>H <input class="num" type="number" [(ngModel)]="importHeight"></label>
              <select [(ngModel)]="scaling"><option value="nearest">nearest</option><option value="bilinear">bilinear</option><option value="high-quality">high quality</option></select>
              <label>Import opacity <input type="range" min="0" max="1" step=".05" [(ngModel)]="importOpacity"></label>
              <button class="button" (click)="applyImport()">Apply</button><button class="button" (click)="cancelImport()">Cancel</button>
            </div>
          }
          @if (resizeOpen()) {
            <div class="flex gap-2 bg-neutral-900 p-2">
              <input class="num" type="number" [(ngModel)]="resizeWidth"><input class="num" type="number" [(ngModel)]="resizeHeight">
              <select [(ngModel)]="resizeMode"><option value="scale">Scale</option><option value="canvas">Canvas resize</option></select>
              <select [(ngModel)]="anchor"><option>top-left</option><option>center</option><option>bottom-right</option></select>
              <button class="button" (click)="resize()">Apply</button><button class="button" (click)="resizeOpen.set(false)">Cancel</button>
            </div>
          }
          <div class="checker grid flex-1 place-items-center overflow-auto p-8">
            <app-image-canvas [model]="current" [tool]="tool()" [zoom]="normalizedZoom()" [brushSize]="normalizedBrush()" [paletteIndex]="normalizedPaletteIndex()" [rgba]="rgba()" [indexedClearIndex]="transparentIndex()" (changed)="pixelsChanged($event)" (cursor)="cursor.set($event)" (selectionChanged)="selection.set($event)" />
          </div>
          <footer class="border-t border-neutral-800 px-3 py-1 text-xs">{{ cursorLabel() }} · {{ selectionLabel() }}</footer>
          @if (current.indexed) { <div class="flex flex-wrap gap-1 p-2">@for (_ of paletteEntries(); track $index) { <button class="h-6 w-6 border" [title]="'Index ' + $index" [style.background]="paletteCss($index)" (click)="paletteIndex = $index"></button> }</div> }
        } @else { <div class="grid flex-1 place-items-center">Select an image.</div> }
      </section>
    </div>
  `,
  styles: `
    .button { border: 1px solid #555; border-radius: .25rem; padding: .3rem .6rem; font-size: .75rem; }
    .button:disabled { cursor: not-allowed; opacity: .4; }
    .active { background: #991b1b; }
    .num { width: 4rem; border: 1px solid #555; background: #111; }
    .checker { background-color: #777; background-image: linear-gradient(45deg,#999 25%,transparent 25%),linear-gradient(-45deg,#999 25%,transparent 25%); background-size: 16px 16px; }
  `
})
export class ImageViewerComponent {
  readonly imageService = inject(DoomImageService);
  private readonly editor = inject(EditorService);
  private readonly processing = inject(ImageProcessingService);
  readonly selected = signal<DoomImageResource | null>(null);
  readonly model = signal<DecodedPng | null>(null);
  readonly importModel = signal<DecodedPng | null>(null);
  readonly dirty = signal(false);
  readonly tool = signal<ImageTool>('pencil');
  readonly resizeOpen = signal(false);
  readonly cursor = signal<{ x: number; y: number } | null>(null);
  readonly selection = signal<ImageSelection | null>(null);
  readonly tools: ImageTool[] = ['pencil', 'brush', 'fill', 'select'];
  readonly paletteEntries = computed(() => Array((this.model()?.palette?.length ?? 0) / 3));
  readonly rgba = computed<[number, number, number, number]>(() => [parseInt(this.color.slice(1, 3), 16), parseInt(this.color.slice(3, 5), 16), parseInt(this.color.slice(5, 7), 16), this.normalize(this.alpha, 0, 255, 255)]);
  readonly transparentIndex = computed(() => {
    const index = this.model()?.transparency?.findIndex(alpha => alpha === 0) ?? -1;
    return index >= 0 ? index : null;
  });
  readonly canUndo = computed(() => this.undoStack().length > 0);
  readonly canRedo = computed(() => this.redoStack().length > 0);
  readonly cursorLabel = computed(() => this.cursor() ? `Cursor ${this.cursor()!.x}, ${this.cursor()!.y}` : 'Cursor —');
  readonly selectionLabel = computed(() => { const area = this.selection(); return area ? `Selection ${area.x}, ${area.y} · ${area.width}×${area.height}` : 'No selection'; });
  readonly normalizedZoom = computed(() => this.normalize(this.zoom, 1, 32, 8));
  readonly normalizedBrush = computed(() => this.normalize(this.brushSize, 1, 32, 1));
  readonly normalizedPaletteIndex = computed(() => this.normalize(this.paletteIndex, 0, Math.max(0, this.paletteEntries().length - 1), 0));
  private readonly undoStack = signal<HistoryEntry[]>([]);
  private readonly redoStack = signal<HistoryEntry[]>([]);
  private readonly loadGuard = new ImageLoadGuard();

  zoom = 8; brushSize = 1; paletteIndex = 0; color = '#ffffff'; alpha = 255;
  importX = 0; importY = 0; importWidth = 1; importHeight = 1; importOpacity = 1;
  scaling: ImageScalingMode = 'nearest'; resizeWidth = 1; resizeHeight = 1;
  resizeMode: 'scale' | 'canvas' = 'scale'; anchor: CanvasAnchor = 'center';

  constructor() {
    effect(() => {
      this.imageService.archiveRevision();
      this.resetForArchive();
    });
  }

  @HostListener('document:keydown', ['$event'])
  shortcuts(event: KeyboardEvent): void {
    if (this.editor.activeTab() !== 'images' || this.isEditableTarget(event.target)) return;
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
    const key = event.key.toLowerCase();
    if (key === 'z' && (event.shiftKey ? this.canRedo() : this.canUndo())) {
      event.preventDefault(); event.shiftKey ? this.redo() : this.undo();
    } else if (key === 'y' && this.canRedo()) {
      event.preventDefault(); this.redo();
    } else if (key === 's' && this.selected() && this.dirty()) {
      event.preventDefault(); void this.save();
    }
  }

  async select(image: DoomImageResource): Promise<void> {
    const dirtyResource = this.editor.dirtyResources().images;
    if (dirtyResource.dirty && dirtyResource.resourceId !== image.id
      && !window.confirm(`You have unsaved images changes for ${dirtyResource.resourceId}. Discard them?`)) return;
    const archiveRevision = this.imageService.archiveRevision();
    if (image.archiveRevision !== archiveRevision) return;
    const request = this.loadGuard.begin(archiveRevision);
    try {
      const model = await decodePng(image.bytes);
      if (!this.loadGuard.isCurrent(request, this.imageService.archiveRevision())) return;
      this.selected.set(image); this.model.set(model); this.dirty.set(false);
      this.editor.clearDirty('images');
      this.cancelImport(); this.resizeOpen.set(false);
      this.resizeWidth = model.width; this.resizeHeight = model.height;
      this.undoStack.set([]); this.redoStack.set([]); this.selection.set(null);
    } catch (error) {
      if (this.loadGuard.isCurrent(request, this.imageService.archiveRevision())) {
        this.editor.notify('error', `Cannot decode image: ${(error as Error).message}`);
      }
    }
  }

  pixelsChanged(pixels: Uint8Array | Uint8ClampedArray): void {
    const model = this.model(); if (!model) return;
    this.pushHistory(model); this.model.set({ ...model, pixels }); this.markDirty();
  }

  undo(): void { this.restore(this.undoStack, this.redoStack); }
  redo(): void { this.restore(this.redoStack, this.undoStack); }

  async beginImport(blob: Blob): Promise<void> {
    try { const imported = await decodePng(await blob.arrayBuffer()); this.importModel.set(imported); this.importWidth = imported.width; this.importHeight = imported.height; this.importX = this.importY = 0; }
    catch (error) { this.editor.notify('error', `Cannot import image: ${(error as Error).message}`); }
  }
  importFile(event: Event): void { const input = event.target as HTMLInputElement; const file = input.files?.[0]; if (file) void this.beginImport(file); input.value = ''; }
  async pasteFromClipboard(): Promise<void> { try { await this.beginImport(await readClipboardImage()); } catch (error) { this.editor.notify('error', (error as Error).message); } }
  onPaste(event: ClipboardEvent): void {
    if (this.editor.activeTab() !== 'images' || this.isEditableTarget(event.target)) return;
    const file = [...(event.clipboardData?.files ?? [])].find(item => item.type.startsWith('image/'));
    if (file) { event.preventDefault(); void this.beginImport(file); }
  }
  cancelImport(): void { this.importModel.set(null); }

  async applyImport(): Promise<void> {
    const target = this.model(), source = this.importModel(); if (!target || !source) return;
    if (!this.validateEditorControls()) return;
    const values = this.validateImport(); if (!values) return;
    const sourceRgba = source.indexed ? indexedToRgba(source) : source.pixels as Uint8ClampedArray;
    const canvas = this.canvasFromRgba(sourceRgba, source.width, source.height);
    const scaled = this.processing.scaleImage(canvas, values.width, values.height, this.scaling).data;
    const targetRgba = target.indexed ? indexedToRgba(target) : new Uint8ClampedArray(target.pixels);
    for (let y = 0; y < values.height; y++) for (let x = 0; x < values.width; x++) {
      const dx = values.x + x, dy = values.y + y; if (dx < 0 || dy < 0 || dx >= target.width || dy >= target.height) continue;
      const sourceOffset = (y * values.width + x) * 4, destinationOffset = (dy * target.width + dx) * 4;
      targetRgba.set(compositeRgba(targetRgba.subarray(destinationOffset, destinationOffset + 4), scaled.subarray(sourceOffset, sourceOffset + 4), values.opacity), destinationOffset);
    }
    this.pushHistory(target);
    const pixels = target.indexed ? quantizeRgba(targetRgba, target.palette!, target.transparency) : targetRgba;
    this.model.set({ ...target, pixels }); this.cancelImport(); this.markDirty();
  }

  async resize(): Promise<void> {
    const image = this.selected(), model = this.model(); if (!image || image.source !== 'file' || !model) return;
    if (!this.validateEditorControls()) return;
    const size = this.validateSize(this.resizeWidth, this.resizeHeight, 'Resize'); if (!size) return;
    this.pushHistory(model);
    if (this.resizeMode === 'scale') {
      const rgba = model.indexed ? indexedToRgba(model) : model.pixels as Uint8ClampedArray;
      const scaled = this.processing.scaleImage(this.canvasFromRgba(rgba, model.width, model.height), size.width, size.height, this.scaling).data;
      this.model.set({ ...model, width: size.width, height: size.height, pixels: model.indexed ? quantizeRgba(scaled, model.palette!, model.transparency) : scaled });
    } else {
      this.model.set({ ...model, width: size.width, height: size.height, pixels: resizeCanvas(model.pixels, model.width, model.height, size.width, size.height, model.indexed ? 1 : 4, this.anchor) });
    }
    this.resizeOpen.set(false); this.markDirty();
  }

  async save(): Promise<void> {
    const image = this.selected(), model = this.model();
    if (!image || !model || !this.dirty()) return;
    const archiveRevision = this.imageService.archiveRevision();
    try {
      const bytes = await this.serialize(model);
      if (archiveRevision !== this.imageService.archiveRevision() || this.selected() !== image) return;
      image.source === 'file' ? this.imageService.saveFileImage(image, bytes) : this.imageService.saveIndexedImage(Number(image.id), bytes);
      clearImageThumbnailCache(); this.editor.clearDirty('images', image.id); this.dirty.set(false);
      const updated = this.imageService.images().find(item => item.id === image.id && item.source === image.source);
      if (updated) {
        const decoded = await decodePng(updated.bytes);
        if (archiveRevision !== this.imageService.archiveRevision() || this.selected() !== image) return;
        this.selected.set(updated); this.model.set(decoded);
      }
      this.editor.notify('success', 'Image saved to the browser VFS.');
    } catch (error) {
      if (archiveRevision === this.imageService.archiveRevision()) this.editor.notify('error', `Could not save image: ${(error as Error).message}`);
    }
  }

  async exportImage(): Promise<void> {
    const image = this.selected(); if (!image) return;
    const bytes = this.dirty() ? await this.serialize() : image.bytes;
    downloadBlob(new Blob([bytes], { type: 'image/png' }), image.path.split('/').at(-1) ?? 'image.png');
  }

  paletteCss(index: number): string { const model = this.model()!, palette = model.palette!; return `rgba(${palette[index * 3]},${palette[index * 3 + 1]},${palette[index * 3 + 2]},${(model.transparency?.[index] ?? 255) / 255})`; }
  private async serialize(model = this.model()!): Promise<ArrayBuffer> { return model.indexed ? encodeIndexedPng(model) : encodeRgbaPng(model.width, model.height, new Uint8Array(model.pixels)); }
  private resetForArchive(): void {
    this.loadGuard.invalidate();
    this.selected.set(null); this.model.set(null); this.importModel.set(null);
    this.resizeOpen.set(false); this.selection.set(null); this.cursor.set(null);
    this.undoStack.set([]); this.redoStack.set([]); this.dirty.set(false);
    this.importX = this.importY = 0; this.importWidth = this.importHeight = 1; this.importOpacity = 1;
    this.resizeWidth = this.resizeHeight = 1; this.resizeMode = 'scale'; this.anchor = 'center';
    this.editor.clearDirty('images');
  }
  private markDirty(): void { const image = this.selected(); if (image) { this.dirty.set(true); this.editor.markDirty('images', image.id); } }
  private clone(model: DecodedPng): DecodedPng { return { ...model, pixels: model.pixels.slice(), palette: model.palette?.slice(), transparency: model.transparency?.slice() }; }
  private pushHistory(model: DecodedPng): void { const entry = { model: this.clone(model), bytes: model.pixels.byteLength + (model.palette?.byteLength ?? 0) + (model.transparency?.byteLength ?? 0) }; let stack = [...this.undoStack(), entry]; while (stack.length > HISTORY_LIMIT || stack.reduce((sum, item) => sum + item.bytes, 0) > HISTORY_BYTES) stack.shift(); this.undoStack.set(stack); this.redoStack.set([]); }
  private restore(from: typeof this.undoStack, to: typeof this.redoStack): void { const current = this.model(), entry = from().at(-1); if (!current || !entry) return; to.update(items => [...items, { model: this.clone(current), bytes: current.pixels.byteLength }]); from.update(items => items.slice(0, -1)); this.model.set(this.clone(entry.model)); this.markDirty(); }
  private isEditableTarget(target: EventTarget | null): boolean {
    return target instanceof Element && target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])') !== null;
  }
  private canvasFromRgba(pixels: ArrayLike<number>, width: number, height: number): HTMLCanvasElement { const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(pixels), width, height), 0, 0); return canvas; }
  private normalize(value: number, min: number, max: number, fallback: number): number { return Number.isFinite(Number(value)) ? Math.min(max, Math.max(min, Math.round(Number(value)))) : fallback; }
  private validateSize(width: number, height: number, label: string): { width: number; height: number } | null { if (![width, height].every(Number.isFinite) || width < 1 || height < 1 || width > 4096 || height > 4096) { this.editor.notify('error', `${label} width and height must be finite values from 1 to 4096.`); return null; } return { width: Math.round(width), height: Math.round(height) }; }
  private validateImport(): { x: number; y: number; width: number; height: number; opacity: number } | null { const size = this.validateSize(this.importWidth, this.importHeight, 'Import'); if (!size || ![this.importX, this.importY, this.importOpacity].every(Number.isFinite) || this.importOpacity < 0 || this.importOpacity > 1) { this.editor.notify('error', 'Import X/Y must be finite and opacity must be between 0 and 1.'); return null; } return { x: Math.round(this.importX), y: Math.round(this.importY), ...size, opacity: this.importOpacity }; }
  private validateEditorControls(): boolean {
    const paletteMaximum = Math.max(0, this.paletteEntries().length - 1);
    if (!Number.isFinite(this.zoom) || this.zoom < 1 || this.zoom > 32
      || !Number.isFinite(this.brushSize) || this.brushSize < 1 || this.brushSize > 32
      || !Number.isFinite(this.alpha) || this.alpha < 0 || this.alpha > 255
      || !Number.isFinite(this.paletteIndex) || this.paletteIndex < 0 || this.paletteIndex > paletteMaximum) {
      this.editor.notify('error', `Zoom, brush size, alpha, and palette index must be finite values within their displayed ranges.`);
      return false;
    }
    return true;
  }
}
