import { CommonModule } from '@angular/common';
import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DoomFileService } from '../../services/doom-file.service';
import { DoomImageService, type DoomImageResource } from '../../services/doom-image.service';
import { EditorService } from '../../services/editor.service';
import { readClipboardImage } from '../../shared/image-clipboard';

@Component({
  selector: 'app-image-viewer', standalone: true, imports: [CommonModule, FormsModule],
  host: { '(document:paste)': 'onPaste($event)' },
  template: `
    <div data-testid="image-workspace" class="flex h-full bg-neutral-950 text-neutral-300">
      <aside class="w-80 shrink-0 border-r border-neutral-800 flex flex-col">
        <h2 class="p-4 border-b border-neutral-800 font-bold text-white">Images</h2>
        <div class="overflow-y-auto p-2">
          @for (image of imageService.images(); track image.id) {
            <button (click)="select(image)" [class.bg-red-950]="selected()?.id === image.id" class="w-full text-left p-2 rounded hover:bg-neutral-800">
              <div class="truncate text-sm text-white">{{ image.source === 'index' ? 'Image #' + image.id : image.path }}</div>
              <div class="text-[10px] text-neutral-500">{{ image.width }}×{{ image.height }} · {{ image.kind }}</div>
            </button>
          } @empty { <p class="p-3 text-xs text-neutral-500">Load a JAR containing images.idx or PNG files.</p> }
        </div>
      </aside>
      <section class="flex-1 flex flex-col min-w-0">
        @if (selected(); as image) {
          <header class="min-h-16 border-b border-neutral-800 px-4 py-2 flex items-center justify-between gap-4">
            <div><b class="text-white">{{ image.source === 'index' ? 'Image #' + image.id : image.path }}</b><div class="text-xs text-neutral-500">{{ image.path }} · PNG/{{ image.kind }} · {{ image.indexed ? 'indexed' : 'truecolor' }} · {{ image.width }}×{{ image.height }} · alpha: {{ image.hasAlpha ? 'yes' : 'no' }}</div></div>
            <div class="flex gap-2">
              <label class="button">Import<input class="hidden" type="file" accept="image/*" (change)="importFile($event)"></label>
              <button class="button" (click)="pasteFromClipboard()">Paste from clipboard</button>
              <button class="button" (click)="exportImage()">Export</button>
              @if (image.source === 'file') {
                <input aria-label="Image width" type="number" min="1" max="4096" class="w-20 bg-black border border-neutral-700 px-2 text-xs" [(ngModel)]="resizeWidth">
                <input aria-label="Image height" type="number" min="1" max="4096" class="w-20 bg-black border border-neutral-700 px-2 text-xs" [(ngModel)]="resizeHeight">
                <button class="button" (click)="resize()">Resize…</button>
              }
              <button class="button bg-red-800" [disabled]="!pending()" (click)="save()">Save</button>
            </div>
          </header>
          <div class="flex-1 overflow-auto grid place-items-center checkerboard p-8"><img [src]="previewUrl()" [alt]="'Preview of ' + image.id" class="max-w-full image-pixelated shadow-2xl"></div>
          @if (pending()) { <p class="absolute bottom-4 right-4 text-amber-400 text-xs">Modified — save to browser VFS</p> }
        } @else { <div class="flex-1 grid place-items-center text-neutral-500">Select an image.</div> }
      </section>
    </div>`,
  styles: [`
    .button { cursor:pointer; border:1px solid #525252; border-radius:.25rem; background:#262626; padding:.4rem .7rem; color:#eee; font-size:.75rem; font-weight:600 }
    .button:disabled { opacity:.4; cursor:not-allowed }.image-pixelated { image-rendering:pixelated }
    .checkerboard { background-color:#777;background-image:linear-gradient(45deg,#999 25%,transparent 25%),linear-gradient(-45deg,#999 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#999 75%),linear-gradient(-45deg,transparent 75%,#999 75%);background-size:20px 20px;background-position:0 0,0 10px,10px -10px,-10px 0 }
  `]
})
export class ImageViewerComponent {
  readonly imageService = inject(DoomImageService); private readonly editor = inject(EditorService); private readonly files = inject(DoomFileService);
  readonly selected = signal<DoomImageResource | null>(null); readonly pending = signal<ArrayBuffer | null>(null);
  readonly previewUrl = signal('');
  resizeWidth = 1; resizeHeight = 1;
  constructor() { effect(onCleanup => { const image = this.selected(), bytes = this.pending() ?? image?.bytes; if (!bytes) { this.previewUrl.set(''); return; } const url = URL.createObjectURL(new Blob([bytes], {type:'image/png'})); this.previewUrl.set(url); onCleanup(() => URL.revokeObjectURL(url)); }); }
  select(image: DoomImageResource) { if (!this.editor.confirmResourceChange('images', image.id)) return; this.pending.set(null); this.selected.set(image); this.resizeWidth = image.width; this.resizeHeight = image.height; }
  async beginImport(blob: Blob) { const image = this.selected(); if (!image) return; try { const bytes = await blob.arrayBuffer(); const { inspectPng } = await import('../../core/png-codec'); inspectPng(bytes); this.pending.set(bytes); this.editor.markDirty('images', image.id); } catch (error) { this.editor.notify('error', `Cannot import image: ${(error as Error).message}`); } }
  importFile(event: Event) { const input = event.target as HTMLInputElement, file = input.files?.[0]; if (file) void this.beginImport(file); input.value = ''; }
  async pasteFromClipboard() { try { await this.beginImport(await readClipboardImage()); } catch (error) { this.editor.notify('error', (error as Error).message); } }
  onPaste(event: ClipboardEvent) { const file = [...(event.clipboardData?.files ?? [])].find(item => item.type.startsWith('image/')); if (file) { event.preventDefault(); void this.beginImport(file); } }
  save() { const image = this.selected(), bytes = this.pending(); if (!image || !bytes) return; try { if (image.source === 'file') this.imageService.saveFileImage(image, bytes); else this.imageService.saveIndexedImage(Number(image.id), bytes); this.pending.set(null); this.editor.clearDirty('images', image.id); const updated = this.imageService.images().find(item => item.id === image.id && item.source === image.source); if (updated) this.selected.set(updated); this.editor.notify('success', 'Image saved to the browser VFS.'); } catch (error) { this.editor.notify('error', `Could not save image: ${(error as Error).message}`); } }
  exportImage() { const image = this.selected(), bytes = this.pending() ?? image?.bytes; if (!image || !bytes) return; const url = URL.createObjectURL(new Blob([bytes], {type:'image/png'})), anchor = document.createElement('a'); anchor.href = url; anchor.download = image.path.split('/').at(-1) ?? 'image.png'; anchor.click(); URL.revokeObjectURL(url); }
  async resize() {
    const image = this.selected(); if (!image || image.source !== 'file') return;
    const width = Number(this.resizeWidth), height = Number(this.resizeHeight);
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 4096 || height > 4096) { this.editor.notify('error', 'PNG dimensions must be positive integers no larger than 4096.'); return; }
    try {
      const bitmap = await createImageBitmap(new Blob([this.pending() ?? image.bytes], {type:'image/png'})), canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
      const context = canvas.getContext('2d'); if (!context) throw new Error('Canvas is unavailable');
      // Scaling is the default; Cancel selects a centered canvas resize (anchor = center).
      if (confirm('Scale pixels to the new dimensions? Choose Cancel to resize the canvas with a centered anchor.')) context.drawImage(bitmap, 0, 0, width, height);
      else context.drawImage(bitmap, Math.floor((width - bitmap.width) / 2), Math.floor((height - bitmap.height) / 2));
      bitmap.close(); const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('PNG encoder failed')), 'image/png'));
      await this.beginImport(blob);
    } catch (error) { this.editor.notify('error', `Could not resize image: ${(error as Error).message}`); }
  }
}
