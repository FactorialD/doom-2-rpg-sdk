import { Injectable, inject, signal } from '@angular/core';
import { DoomFileService } from '../doom-file.service';
import { ByteStream, BinaryWriter } from '../../../utils/byte-stream';
import { J2ME } from '../../../logic/j2me-port';
import { TextureMappingService } from './texture-mapping.service';

export interface PaletteEntry {
    id: number;
    isReference: boolean;
    parentId?: number; // If isReference
    colors: Uint32Array; // Shared reference to colors (ABGR format for Uint32Array views)
}

@Injectable({
  providedIn: 'root'
})
export class TexturePaletteService {
  private fileService = inject(DoomFileService);
  private mappingService = inject(TextureMappingService);
  
  // Store metadata about palettes
  private paletteEntries: PaletteEntry[] = [];
  
  // The unique palette data stores (to allow shared editing)
  private uniquePalettes = new Map<number, Uint32Array>();

  isLoaded = signal(false);
  
  // Version signal to notify components of deep data changes (color updates)
  version = signal(0);

  async loadPalettes(palColors: Int16Array) {
    const palBuffer = this.fileService.getFile('newPalettes.bin');
    if (!palBuffer) return;

    const stream = new ByteStream(palBuffer);
    this.uniquePalettes.clear();
    this.paletteEntries = [];

    // First pass: Load actual data
    for (let i = 0; i < 1024; i++) {
        const rawVal = palColors[i] & 0xFFFF;
        const isReference = (rawVal & 0x8000) !== 0;

        if (!isReference) {
            // It's a root palette definition
            const size = rawVal & 0x3FFF;
            let paletteColors: Uint32Array;
            
            if (size > 0) {
                 paletteColors = new Uint32Array(size);
                 for (let c = 0; c < size; c++) {
                    if (stream.position >= stream.length) break;
                    const color555 = stream.readUShort();
                    const rgba = J2ME.getRGBA(color555);
                    // Store as ABGR for 32-bit array views (Little Endian systems)
                    paletteColors[c] = (rgba.a << 24) | (rgba.b << 16) | (rgba.g << 8) | rgba.r;
                 }
            } else {
                paletteColors = new Uint32Array(0);
            }
            
            this.uniquePalettes.set(i, paletteColors);
            this.paletteEntries[i] = { id: i, isReference: false, colors: paletteColors };
        } else {
            // Placeholder for reference, resolved in second pass
            this.paletteEntries[i] = { id: i, isReference: true, colors: new Uint32Array(0) };
        }
    }
    
    // Second pass: Resolve references
    for (let i = 0; i < 1024; i++) {
        const rawVal = palColors[i] & 0xFFFF;
        const isReference = (rawVal & 0x8000) !== 0;
        
        if (isReference) {
            const parentId = rawVal & 0x7FFF;
            this.paletteEntries[i].parentId = parentId;
            
            if (this.uniquePalettes.has(parentId)) {
                // Point to the SAME Uint32Array object so edits propagate
                this.paletteEntries[i].colors = this.uniquePalettes.get(parentId)!;
            } else {
                console.warn(`Palette ${i} references missing parent ${parentId}`);
            }
        }
    }
    
    this.isLoaded.set(true);
    this.bumpVersion();
  }

  getPalette(id: number): Uint32Array | undefined {
      return this.paletteEntries[id]?.colors;
  }
  
  getAllPalettes(): PaletteEntry[] {
      return this.paletteEntries;
  }
  
  getUsage(paletteId: number): number[] {
      const users: number[] = [];
      let rootId = paletteId;
      if (this.paletteEntries[paletteId]?.isReference) {
          rootId = this.paletteEntries[paletteId].parentId!;
      }

      for(let i=0; i<this.paletteEntries.length; i++) {
          const entry = this.paletteEntries[i];
          if (!entry.isReference && entry.id === rootId) {
              users.push(i);
          } else if (entry.isReference && entry.parentId === rootId) {
              users.push(i);
          }
      }
      return users;
  }

  updateColor(paletteId: number, colorIndex: number, r: number, g: number, b: number) {
      const pal = this.getPalette(paletteId);
      if (pal && colorIndex < pal.length) {
          // Store as ABGR (Little Endian Uint32)
          pal[colorIndex] = (255 << 24) | (b << 16) | (g << 8) | r;
          this.bumpVersion();
      }
  }

  findNextFreeId(): number {
      for(let i=0; i<1024; i++) {
          const entry = this.paletteEntries[i];
          if (entry && !entry.isReference && entry.colors.length === 0) {
              if (i > 0) return i;
          }
          if (!entry) return i;
      }
      return -1;
  }

  createPalette(id: number, size: number = 16) {
      const colors = new Uint32Array(size);
      for(let i=0; i<size; i++) colors[i] = 0xFF000000; 
      
      this.uniquePalettes.set(id, colors);
      this.paletteEntries[id] = {
          id: id,
          isReference: false,
          colors: colors
      };

      if (this.mappingService.mediaPalColors) {
          this.mappingService.mediaPalColors[id] = size & 0x3FFF;
      }
      this.bumpVersion();
  }

  replacePaletteData(id: number, newColors: Uint32Array) {
      let rootId = id;
      if (this.paletteEntries[id].isReference) {
          rootId = this.paletteEntries[id].parentId!;
      }

      this.uniquePalettes.set(rootId, newColors);
      
      for(const entry of this.paletteEntries) {
          if (entry.id === rootId || (entry.isReference && entry.parentId === rootId)) {
              entry.colors = newColors;
          }
      }
      
      if (this.mappingService.mediaPalColors) {
          this.mappingService.mediaPalColors[rootId] = newColors.length & 0x3FFF;
      }
      this.bumpVersion();
  }

  savePalettes(): boolean {
      if (!this.mappingService.mediaPalColors) return false;

      const writer = new BinaryWriter(1024 * 16 * 2);
      const palColors = this.mappingService.mediaPalColors;

      for (let i = 0; i < 1024; i++) {
          const rawVal = palColors[i] & 0xFFFF;
          const isReference = (rawVal & 0x8000) !== 0;

          if (!isReference) {
              const pal = this.uniquePalettes.get(i);
              if (pal) {
                  for(let c=0; c < pal.length; c++) {
                      const col = pal[c];
                      // ABGR -> RGB555
                      const r = col & 0xFF;
                      const g = (col >> 8) & 0xFF;
                      const b = (col >> 16) & 0xFF;
                      const shortVal = J2ME.packRGB555(r, g, b);
                      writer.writeUShort(shortVal);
                  }
              }
          }
      }

      this.fileService.saveBuffer('newPalettes.bin', writer.getData().buffer);
      this.mappingService.saveMappingsFile();
      return true;
  }
  
  private bumpVersion() {
      this.version.update(v => v + 1);
  }
}
