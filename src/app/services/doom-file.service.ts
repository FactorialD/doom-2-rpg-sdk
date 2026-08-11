
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
      this.isLoaded.set(false);
      this.stringsIndexLoaded.set(false); // Reset this so UI cleans up
      this.setFontImageSrc(null);
      this.files.clear();
      this.resourcePathsByBasename.clear();
      
      const zip = new JSZip();
      const content = await zip.loadAsync(file);
      
      const promises: Promise<void>[] = [];

      content.forEach((relativePath: string, zipEntry: any) => {
        if (!zipEntry.dir) {
          const promise = zipEntry.async('arraybuffer').then((buffer: ArrayBuffer) => {
            this.files.set(this.normalizePath(relativePath), buffer);
          });
          promises.push(promise);
        }
      });

      await Promise.all(promises);
      this.rebuildResourceIndex();
      console.log(`Loaded ${this.files.size} files from JAR.`);

      this.updateStringsIndexLoaded();
      
      const fontBuffer = this.getFile('font.png');
      if (fontBuffer) {
        this.setFontImageSrc(URL.createObjectURL(new Blob([fontBuffer], { type: 'image/png' })));
      }
      this.tryExtractFont();
      
      this.loadedFileName.set(file.name);
      this.isLoaded.set(true);

    } catch (e) {
      console.error('Failed to load JAR:', e);
      this.isLoaded.set(false);
      this.setFontImageSrc(null);
      if (e instanceof ResourceCompatibilityError) {
        throw e;
      }
      alert('Error loading .jar file. Ensure it is a valid ZIP/JAR archive.');
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

  private tryExtractFont() {
      const idxBuffer = this.getFile('images.idx');
      if (!idxBuffer) return;

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
              const binBuffer = this.getFile(binName);
              
              if (binBuffer && offset + length <= binBuffer.byteLength) {
                  const fontBlob = binBuffer.slice(offset, offset + length);
                  const blob = new Blob([fontBlob], { type: 'image/png' }); 
                  const url = URL.createObjectURL(blob);
                  this.setFontImageSrc(url);
              }
          }
      }
  }

  private normalizePath(path: string): string {
    return path.replace(/^\/+/, '');
  }

  private basename(path: string): string {
    return path.substring(path.lastIndexOf('/') + 1);
  }

  private rebuildResourceIndex(): void {
    this.resourcePathsByBasename.clear();
    for (const path of this.files.keys()) {
      const basename = this.basename(path);
      const paths = this.resourcePathsByBasename.get(basename) ?? [];
      paths.push(path);
      this.resourcePathsByBasename.set(basename, paths);
    }
  }

  private resolveResourcePath(basename: string): string | undefined {
    const paths = this.resourcePathsByBasename.get(basename) ?? [];
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
