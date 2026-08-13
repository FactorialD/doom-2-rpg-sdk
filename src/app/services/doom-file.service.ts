
import { Injectable, signal, WritableSignal } from '@angular/core';
import JSZip from 'jszip';
import { flattenResourceFileIndex, parseResourceFileIndex } from '../core/resource-file-index';

export class ResourceCompatibilityError extends Error {
  readonly code = 'AMBIGUOUS_RESOURCE_BASENAME';

  constructor(
    readonly resourceName: string,
    readonly conflictingPaths: string[]
  ) {
    super(`Resource "${resourceName}" is ambiguous: ${conflictingPaths.join(', ')}`);
    this.name = 'ResourceCompatibilityError';
  }
}

@Injectable({
  providedIn: 'root'
})
export class DoomFileService {
  // Stores raw ArrayBuffers for files with their FULL paths (e.g., "com/ea/Game.class")
  files: Map<string, ArrayBuffer> = new Map();
  private resourcePathsByBasename: Map<string, string[]> = new Map();
  
  // Signal to notify app that a JAR is loaded
  isLoaded: WritableSignal<boolean> = signal(false);
  loadedFileName: WritableSignal<string> = signal('');

  // Specific signal for Font image source
  fontImageSrc: WritableSignal<string | null> = signal(null);
  
  // Signal to notify when critical text files are loaded
  stringsIndexLoaded: WritableSignal<boolean> = signal(false);
  
  constructor() {}

  async loadFile(name: string, file: File): Promise<void> {
    const buffer = await file.arrayBuffer();
    this.saveBuffer(name, buffer);
  }

  async loadJar(file: File): Promise<void> {
    try {
      const zip = new JSZip();
      const content = await zip.loadAsync(file);
      const nextFiles = new Map<string, ArrayBuffer>();
      const promises: Promise<void>[] = [];

      content.forEach((relativePath: string, zipEntry: any) => {
        if (!zipEntry.dir) {
          const promise = zipEntry.async('arraybuffer').then((buffer: ArrayBuffer) => {
            nextFiles.set(this.normalizePath(relativePath), buffer);
          });
          promises.push(promise);
        }
      });

      await Promise.all(promises);
      const nextResourceIndex = this.buildResourceIndex(nextFiles);
      this.validateResourceIndex(nextResourceIndex);
      const nextFontBuffer = this.findFontBuffer(nextFiles, nextResourceIndex);
      const nextFontUrl = nextFontBuffer
        ? URL.createObjectURL(new Blob([nextFontBuffer], { type: 'image/png' }))
        : null;
      const nextStringsIndexLoaded = this.resolveResourcePathFromIndex('strings.idx', nextResourceIndex) !== undefined;

      this.files = nextFiles;
      this.resourcePathsByBasename = nextResourceIndex;
      this.loadedFileName.set(file.name);
      this.stringsIndexLoaded.set(nextStringsIndexLoaded);
      this.setFontImageSrc(nextFontUrl);
      this.isLoaded.set(true);
      console.log(`Loaded ${this.files.size} files from JAR.`);

    } catch (e) {
      console.error('Failed to load JAR:', e);
      if (e instanceof ResourceCompatibilityError) {
        throw e;
      }
      if (typeof alert === 'function') {
        alert('Error loading .jar file. Ensure it is a valid ZIP/JAR archive.');
      }
    }
  }

  // --- EXPORT FUNCTION ---
  async downloadModdedJar() {
    if (!this.isLoaded()) return;

    try {
        const zip = new JSZip();

        // Repack all files preserving their original paths
        for (const [path, buffer] of this.files.entries()) {
            zip.file(path, buffer);
        }

        const blob = await zip.generateAsync({ type: 'blob' });
        
        // Trigger download
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'doom2rpg_modded.jar';
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);

    } catch (e) {
        console.error("Failed to pack JAR", e);
        alert("Failed to create JAR file.");
    }
  }

  saveBuffer(path: string, buffer: ArrayBuffer) {
    const normalizedPath = this.normalizePath(path);
    const targetPath = normalizedPath.includes('/')
      ? normalizedPath
      : this.resolveResourcePath(normalizedPath) ?? normalizedPath;
    this.files.set(targetPath, buffer);
    this.rebuildResourceIndex();

    this.updateStringsIndexLoaded();
    
    if (this.basename(targetPath) === 'font.png') {
        const blob = new Blob([buffer], { type: 'image/png' });
        const url = URL.createObjectURL(blob);
        this.setFontImageSrc(url);
    }
  }

  /** Resolves every destination before committing a group of related files. */
  saveBuffersAtomically(buffers: ReadonlyMap<string, ArrayBuffer>): void {
    this.updateBuffersAtomically(buffers, []);
  }

  /** Resolves all paths first, then applies related updates and deletions as one VFS mutation. */
  updateBuffersAtomically(buffers: ReadonlyMap<string, ArrayBuffer>, deletes: readonly string[]): void {
    const resolved = [...buffers].map(([path, buffer]) => {
      const normalized = this.normalizePath(path);
      const target = normalized.includes('/') ? normalized : this.resolveResourcePath(normalized) ?? normalized;
      return [target, buffer] as const;
    });
    const resolvedDeletes = deletes.map(path => {
      const normalized = this.normalizePath(path);
      return normalized.includes('/') ? normalized : this.resolveResourcePath(normalized) ?? normalized;
    });
    for (const path of resolvedDeletes) this.files.delete(path);
    for (const [path, buffer] of resolved) this.files.set(path, buffer);
    this.rebuildResourceIndex();
    this.updateStringsIndexLoaded();
  }

  getFile(name: string): ArrayBuffer | undefined {
    const key = this.normalizePath(name);
    const resourcePath = key.includes('/') ? key : this.resolveResourcePath(key);
    return resourcePath ? this.files.get(resourcePath) : undefined;
  }

  getFilesByPrefix(prefix: string): Map<string, ArrayBuffer> {
    const result = new Map<string, ArrayBuffer>();
    const cleanPrefix = prefix.startsWith('/') ? prefix.substring(1) : prefix;
    
    for (const [key, val] of this.files.entries()) {
      if (key.startsWith(cleanPrefix)) {
        result.set(key, val);
      }
    }
    return result;
  }

  private findFontBuffer(
    files: ReadonlyMap<string, ArrayBuffer>,
    index: ReadonlyMap<string, string[]>
  ): ArrayBuffer | undefined {
      const getFile = (name: string): ArrayBuffer | undefined => {
        const path = this.resolveResourcePathFromIndex(name, index);
        return path ? files.get(path) : undefined;
      };
      const directFont = getFile('font.png');
      const idxBuffer = getFile('images.idx');
      if (!idxBuffer) return directFont;

      const indexData = flattenResourceFileIndex(parseResourceFileIndex(idxBuffer));
      const FONT_ID = 11;
      const STRIDE = 3;
      const pos = FONT_ID * STRIDE;
      
      if (pos + 2 < indexData.length) {
          const chunkId = indexData[pos];
          const offset = indexData[pos + 1];
          const length = indexData[pos + 2];
          
          if (chunkId !== 255 && length > 0) {
              const binName = `images${chunkId}.bin`;
              const binBuffer = getFile(binName);
              
              if (binBuffer && offset + length <= binBuffer.byteLength) {
                  return binBuffer.slice(offset, offset + length);
              }
          }
      }
      return directFont;
  }

  private normalizePath(path: string): string {
    return path.replace(/^\/+/, '');
  }

  private basename(path: string): string {
    return path.substring(path.lastIndexOf('/') + 1);
  }

  private rebuildResourceIndex(): void {
    this.resourcePathsByBasename = this.buildResourceIndex(this.files);
  }

  private buildResourceIndex(files: ReadonlyMap<string, ArrayBuffer>): Map<string, string[]> {
    const index = new Map<string, string[]>();
    for (const path of files.keys()) {
      const basename = this.basename(path);
      const paths = index.get(basename) ?? [];
      paths.push(path);
      index.set(basename, paths);
    }
    return index;
  }

  private validateResourceIndex(index: ReadonlyMap<string, string[]>): void {
    for (const [basename, paths] of index) {
      if (paths.length > 1) {
        throw new ResourceCompatibilityError(basename, [...paths].sort());
      }
    }
  }

  private resolveResourcePath(basename: string): string | undefined {
    return this.resolveResourcePathFromIndex(basename, this.resourcePathsByBasename);
  }

  private resolveResourcePathFromIndex(
    basename: string,
    index: ReadonlyMap<string, string[]>
  ): string | undefined {
    const paths = index.get(basename) ?? [];
    if (paths.length > 1) {
      throw new ResourceCompatibilityError(basename, [...paths].sort());
    }
    return paths[0];
  }

  private setFontImageSrc(url: string | null): void {
    const previousUrl = this.fontImageSrc();
    if (previousUrl && previousUrl !== url) {
      URL.revokeObjectURL(previousUrl);
    }
    this.fontImageSrc.set(url);
  }

  private updateStringsIndexLoaded(): void {
    try {
      this.stringsIndexLoaded.set(this.getFile('strings.idx') !== undefined);
    } catch (error) {
      this.stringsIndexLoaded.set(false);
      throw error;
    }
  }

}
