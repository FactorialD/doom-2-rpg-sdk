import { computed, effect, inject, Injectable, signal } from '@angular/core';
import { parseResourceFileIndex, serializeResourceFileIndex, type ResourceFileIndexEntry } from '../core/resource-file-index';
import { inspectPng, type PngInfo } from '../core/png-codec';
import { DoomFileService } from './doom-file.service';

export interface DoomImageResource extends PngInfo { id: string; source: 'index' | 'file'; path: string; chunk?: number; offset?: number; length: number; bytes: ArrayBuffer; }

@Injectable({ providedIn: 'root' })
export class DoomImageService {
  private readonly files = inject(DoomFileService);
  readonly images = signal<DoomImageResource[]>([]);
  readonly indexedImages = computed(() => this.images().filter(image => image.source === 'index'));
  constructor() { effect(() => { this.files.isLoaded(); this.reload(); }); }

  reload(): void {
    const result: DoomImageResource[] = [];
    const index = this.files.getFile('images.idx');
    if (index) parseResourceFileIndex(index).forEach((entry, id) => {
      const path = `images${entry.fileId}.bin`, chunk = this.files.getFile(path);
      if (!chunk || entry.offset < 0 || entry.length <= 0 || entry.offset + entry.length > chunk.byteLength) return;
      const bytes = chunk.slice(entry.offset, entry.offset + entry.length);
      try { result.push({ id: String(id), source: 'index', path, chunk: entry.fileId, offset: entry.offset, length: entry.length, bytes, ...inspectPng(bytes) }); } catch { /* J2ME supports formats this editor cannot safely rewrite. */ }
    });
    for (const [path, bytes] of this.files.files) {
      if (!path.toLowerCase().endsWith('.png')) continue;
      try { result.push({ id: path, source: 'file', path, length: bytes.byteLength, bytes, ...inspectPng(bytes) }); } catch { /* ignore malformed PNG */ }
    }
    this.images.set(result);
  }

  saveFileImage(image: DoomImageResource, bytes: ArrayBuffer): void {
    if (image.source !== 'file') throw new Error('Expected a standalone image');
    inspectPng(bytes); this.files.saveBuffersAtomically(new Map([[image.path, bytes]])); this.reload();
  }

  /** Reflows indexed PNGs at the game's 32768-byte chunk boundary and commits index/chunks together. */
  saveIndexedImage(id: number, replacement: ArrayBuffer): void {
    inspectPng(replacement);
    const indexBuffer = this.files.getFile('images.idx'); if (!indexBuffer) throw new Error('images.idx was not found');
    const oldEntries = parseResourceFileIndex(indexBuffer);
    if (!oldEntries[id]) throw new RangeError(`Image #${id} does not exist`);
    const payloads = oldEntries.map((entry, entryId) => entryId === id ? replacement : this.readEntry(entry));
    if (payloads.some(bytes => bytes.byteLength > 32768)) throw new Error('A J2ME image chunk cannot exceed 32768 bytes');
    const entries: ResourceFileIndexEntry[] = []; const chunks = new Map<number, Uint8Array[]>();
    let fileId = 0, offset = 0;
    payloads.forEach(bytes => { if (offset && offset + bytes.byteLength > 32768) { fileId++; offset = 0; } (chunks.get(fileId) ?? (chunks.set(fileId, []), chunks.get(fileId)!)).push(new Uint8Array(bytes)); entries.push({ fileId, offset, length: bytes.byteLength }); offset += bytes.byteLength; });
    const updates = new Map<string, ArrayBuffer>([['images.idx', serializeResourceFileIndex(entries)]]);
    chunks.forEach((parts, chunkId) => { const total = parts.reduce((n, part) => n + part.length, 0), joined = new Uint8Array(total); let at = 0; parts.forEach(part => { joined.set(part, at); at += part.length; }); updates.set(`images${chunkId}.bin`, joined.buffer); });
    this.files.saveBuffersAtomically(updates); this.reload();
  }

  private readEntry(entry: ResourceFileIndexEntry): ArrayBuffer { const chunk = this.files.getFile(`images${entry.fileId}.bin`); if (!chunk || entry.offset + entry.length > chunk.byteLength) throw new Error('Invalid images.idx entry'); return chunk.slice(entry.offset, entry.offset + entry.length); }
}
