
import { Injectable, signal, WritableSignal } from '@angular/core';
import { flattenResourceFileIndex, parseResourceFileIndex } from '../core/resource-file-index';

// JSZip is loaded via CDN in index.html
declare var JSZip: any;

@Injectable({
  providedIn: 'root'
})
export class DoomFileService {
  // Stores raw ArrayBuffers for files with their FULL paths (e.g., "com/ea/Game.class")
  files: Map<string, ArrayBuffer> = new Map();
  
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
      this.fontImageSrc.set(null);
      this.files.clear();
      
      const zip = new JSZip();
      const content = await zip.loadAsync(file);
      
      const promises: Promise<void>[] = [];

      content.forEach((relativePath: string, zipEntry: any) => {
        if (!zipEntry.dir) {
          const promise = zipEntry.async('arraybuffer').then((buffer: ArrayBuffer) => {
            this.saveBuffer(relativePath, buffer);
          });
          promises.push(promise);
        }
      });

      await Promise.all(promises);
      console.log(`Loaded ${this.files.size} files from JAR.`);
      
      this.tryExtractFont();
      
      this.loadedFileName.set(file.name);
      this.isLoaded.set(true);

    } catch (e) {
      console.error('Failed to load JAR:', e);
      alert('Error loading .jar file. Ensure it is a valid ZIP/JAR archive.');
      this.isLoaded.set(false);
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
    // Normalize path to prevent duplicates (remove leading slash)
    const normalizedPath = path.startsWith('/') ? path.substring(1) : path;
    this.files.set(normalizedPath, buffer);

    if (normalizedPath.endsWith('strings.idx')) {
      this.stringsIndexLoaded.set(true);
    }
    
    if (normalizedPath.endsWith('font.png')) {
        const blob = new Blob([buffer], { type: 'image/png' });
        const url = URL.createObjectURL(blob);
        this.fontImageSrc.set(url);
    }
  }

  getFile(name: string): ArrayBuffer | undefined {
    const key = name.startsWith('/') ? name.substring(1) : name;
    return this.files.get(key);
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
                  this.fontImageSrc.set(url);
              }
          }
      }
  }

}
