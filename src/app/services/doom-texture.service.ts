import { Injectable, inject, signal } from '@angular/core';
import { DoomFileService } from './doom-file.service';
import { ByteStream } from '../utils/byte-stream';
import { SpriteCodec } from '../logic/sprite-codec';
import { TextureInfo, TextureCategory } from './textures/texture-types';
import { TextureMappingService } from './textures/texture-mapping.service';
import { TexturePaletteService } from './textures/texture-palette.service';
import { TextureRanges, SpecialTextureIds } from '../core/constants/texture-groups';

// Re-export for compatibility
export type { TextureInfo, TextureCategory };

@Injectable({
  providedIn: 'root'
})
export class DoomTextureService {
  private fileService = inject(DoomFileService);
  private mappingService = inject(TextureMappingService);
  private paletteService = inject(TexturePaletteService);

  // Custom cache for runtime generated textures (Skybox)
  private customCache = new Map<number, ImageData>();
  private originalRawIndices = new Map<number, Uint8Array>();
  private editedRawIndices = new Map<number, Uint8Array>();

  texturesLoaded = signal(false);
  textureList = signal<TextureInfo[]>([]);
  
  // Signal to notify components when texture data has changed (e.g. after save)
  textureVersion = signal(0);

  constructor() { }

  async loadTextures() {
    this.texturesLoaded.set(false);
    try {
        const success = this.mappingService.loadMappings();
        if (!success) return;

        const palColors = this.mappingService.mediaPalColors;
        if (palColors) {
            await this.paletteService.loadPalettes(palColors);
        }
        
        this.textureList.set(this.mappingService.getAllTextures());
        this.originalRawIndices.clear();
        this.editedRawIndices.clear();
        for (const texture of this.textureList()) {
            if (texture.fileIndex === -1 || texture.isReference) continue;
            const indices = this.getTextureRawIndices(texture.id);
            if (indices) this.originalRawIndices.set(texture.id, new Uint8Array(indices));
        }
        this.textureVersion.update(v => v + 1);
        this.texturesLoaded.set(true);
    } catch (e) {
        console.error("Failed to parse textures", e);
    }
  }

  async loadSkyTexture(mapId: number) {
      const buffer = this.fileService.getFile('tables.bin');
      if (!buffer) return;
  
      const setIndex = Math.floor((mapId - 1) / 5) % 2 * 2;
      const palTableId = 11 + setIndex;
      const texTableId = 12 + setIndex;
  
      const stream = new ByteStream(buffer);
      const offsets = new Int32Array(15);
      for(let i=0; i<15; i++) offsets[i] = stream.readInt();
      
      const getTableData = (id: number): Uint8Array => {
          const start = id === 0 ? 0 : offsets[id - 1];
          const absStart = 60 + start;
          const oldPos = stream.position;
          stream.position = absStart;
          const size = stream.readInt(); 
          const data = stream.readByteArray(size);
          stream.position = oldPos;
          return data;
      };
  
      const palDataRaw = getTableData(palTableId);
      const texData = getTableData(texTableId);
  
      const palStream = new ByteStream(palDataRaw.buffer);
      const palCount = palDataRaw.byteLength / 4;
      const palette = new Uint32Array(palCount);
      
      for(let i=0; i<palCount; i++) {
          const b0 = palStream.readUByte();
          const b1 = palStream.readUByte(); 
          const b2 = palStream.readUByte(); 
          const b3 = palStream.readUByte(); 
          const r = b2; const g = b1; const b = b0;
          palette[i] = (255 << 24) | (b << 16) | (g << 8) | r;
      }
  
      const width = 128;
      const height = 128;
      const imgData = new ImageData(width, height);
      const pixels = new Uint32Array(imgData.data.buffer);

      for(let i=0; i<width*height; i++) {
          const colorIdx = texData[i] & 0xFF;
          const colorInt = palette[colorIdx]; 
          pixels[i] = colorInt;
      }
  
      // Inject sky info manually into list if not present or just cache it
      this.customCache.set(SpecialTextureIds.SKYBOX, imgData);
      console.log(`Sky texture loaded for Map ID ${mapId}`);
  }
  
  // --- Facade Methods ---

  getTextureByGroup(groupId: number): TextureInfo | undefined {
      return this.mappingService.getTextureByGroup(groupId);
  }
  
  /**
   * Returns all textures belonging to a specific group ID (e.g. all frames of an NPC).
   */
  getGroupTextures(groupId: number): TextureInfo[] {
      return this.textureList().filter(t => t.groupId === groupId).sort((a,b) => a.id - b.id);
  }

  getTextureFrame(groupId: number, frameIndex: number): TextureInfo | undefined {
      return this.mappingService.getTextureFrame(groupId, frameIndex);
  }

  getTextureDimensions(id: number): {width: number, height: number} | null {
      const info = this.mappingService.getTextureById(id);
      if (!info) return null;
      return { width: info.width, height: info.height };
  }
  
  isTextureCompressed(id: number): boolean {
      const info = this.mappingService.getTextureById(id);
      if (!info || info.fileIndex === -1) return false;
      const expectedSize = info.width * info.height;
      return info.dataLength !== expectedSize;
  }

  isIndex0Transparent(id: number): boolean {
      if (this.isTextureCompressed(id)) return true;
      const info = this.mappingService.getTextureById(id);
      if (!info) return false;
      const groupId = info.groupId;
      const isOpaqueException = (
          groupId === 175 || 
          groupId === 162 || 
          groupId === 129 || 
          groupId === 173 || 
          groupId === 184
      );
      if (groupId < SpecialTextureIds.WALL_OFFSET && !isOpaqueException) {
          return true;
      }
      return false;
  }

  isTextureEditable(id: number): boolean {
      const info = this.mappingService.getTextureById(id);
      if (!info) return false;
      if (!info.valid || info.isReference || info.fileIndex === -1) return false;
      return true;
  }

  getTexturePalette(id: number): Uint32Array | undefined {
      return this.paletteService.getPalette(id);
  }

  getTextureRawIndices(id: number): Uint8Array | null {
    const info = this.mappingService.getTextureById(id);
    if (!info || info.fileIndex === -1) return null;
    
    const fileData = this.getTextureBinary(id);
    if (!fileData) return null;
    
    const isCompressed = this.isTextureCompressed(id);
    
    if (!isCompressed) {
        return new Uint8Array(fileData);
    }
    
    // Decompress
    const expectedSize = info.width * info.height;
    const uncompressed = new Uint8Array(expectedSize).fill(0); 
    if (info.bounds) {
        SpriteCodec.decompressIndices(fileData, uncompressed, info);
    }
    return uncompressed;
  }

  setEditedTexture(id: number, indices: Uint8Array | null) {
    if (indices) this.editedRawIndices.set(id, indices);
    else this.editedRawIndices.delete(id);
    this.textureVersion.update(v => v + 1);
  }

  notifyTexturePixelsChanged() {
    this.textureVersion.update(v => v + 1);
  }

  getPreviewTextureImageData(id: number, mode: 'edited' | 'original'): ImageData | null {
    const raw = mode === 'original' ? this.originalRawIndices.get(id) : this.editedRawIndices.get(id) ?? this.getTextureRawIndices(id);
    return raw ? this.createTextureImageData(id, raw) : null;
  }

  private createTextureImageData(id: number, rawIndices: Uint8Array): ImageData | null {
    const info = this.mappingService.getTextureById(id);
    if (!info) return null;
    const palette = this.paletteService.getPalette(id);
    const image = new ImageData(info.width, info.height);
    const pixels = new Uint32Array(image.data.buffer);
    const transparentZero = this.isIndex0Transparent(id);
    for (let i = 0; i < pixels.length; i++) {
      const index = rawIndices[i] ?? 0;
      if (index === 0 && transparentZero) pixels[i] = 0;
      else pixels[i] = palette?.[index] ?? (0xff000000 | index << 16 | index << 8 | index);
    }
    return image;
  }

  getTextureImageData(id: number): ImageData | null {
    if (this.customCache.has(id)) {
        return this.customCache.get(id)!;
    }

    const info = this.mappingService.getTextureById(id);
    if (!info || info.fileIndex === -1) return null;
    
    const palette = this.paletteService.getPalette(id);
    const rawIndices = this.getTextureRawIndices(id);
    if (!rawIndices) return null;
    
    const imgData = new ImageData(info.width, info.height);
    const pixels = new Uint32Array(imgData.data.buffer);
    
    const index0IsTransparent = this.isIndex0Transparent(id);
    
    for (let i = 0; i < rawIndices.length; i++) {
        const colorIdx = rawIndices[i];
        if (palette && colorIdx < palette.length) {
            if (colorIdx === 0 && index0IsTransparent) { 
                 pixels[i] = 0x00000000; 
            } else {
                 let col = palette[colorIdx];
                 col = col | 0xFF000000; 
                 pixels[i] = col;
            }
        } else {
            const val = colorIdx;
            pixels[i] = (255 << 24) | (val << 16) | (val << 8) | val;
        }
    }
    return imgData;
  }

  saveTexture(id: number, newUncompressedData: Uint8Array): boolean {
    const info = this.mappingService.getTextureById(id);
    if (!info || info.isReference || info.fileIndex === -1) return false;

    let newBinaryData: Uint8Array;
    let newBounds: { minX: number, maxX: number, minY: number, maxY: number } | undefined;
    const isRawType = !this.isTextureCompressed(id);

    if (isRawType) {
        newBinaryData = newUncompressedData;
    } else {
        const compResult = SpriteCodec.compressSprite(newUncompressedData, info.width, info.height);
        newBinaryData = compResult.data;
        newBounds = compResult.bounds;
    }
    
    // 1. Snapshot all data BEFORE updating mappings
    const allTexturesData: (Uint8Array | null)[] = [];
    const allInfos = this.mappingService.getAllTextures();

    for (let i = 0; i < 1024; i++) {
        const texInfo = allInfos[i];
        if (i === id) {
            allTexturesData.push(newBinaryData);
        } else if (texInfo.isReference) {
            allTexturesData.push(null);
        } else if (texInfo.valid || texInfo.dataLength > 0) {
            const data = this.getTextureBinary(i);
            allTexturesData.push(data);
        } else {
            allTexturesData.push(null);
        }
    }

    // 2. Update Mapping Data
    this.mappingService.updateMappingData(id, newBinaryData.length - 1, newBounds);
    this.mappingService.saveMappingsFile();

    // 3. Rebuild Texture Files
    this.rebuildAllTextureFilesFromSnapshot(allTexturesData);
    
    // 4. Update List signal
    this.textureList.set(this.mappingService.getAllTextures());

    // 5. Notify all listeners (Thumbnails)
    (this.editedRawIndices ??= new Map()).set(id, new Uint8Array(newUncompressedData));
    this.textureVersion.update(v => v + 1);

    return true;
  }

  // --- I/O Helpers ---

  private getTextureBinary(id: number): Uint8Array | null {
      const info = this.mappingService.getTextureById(id);
      if (!info || info.fileIndex === -1) return null;
      
      const fileIndexStr = info.fileIndex < 10 ? '0' + info.fileIndex : info.fileIndex.toString();
      const buffer = this.fileService.getFile(`tex${fileIndexStr}.bin`);
      if (!buffer) return null;
      if (info.fileOffset + info.dataLength > buffer.byteLength) return null;
      return new Uint8Array(buffer.slice(info.fileOffset, info.fileOffset + info.dataLength));
  }

  private rebuildAllTextureFilesFromSnapshot(allData: (Uint8Array | null)[]) {
      const newFilesMap = new Map<string, ArrayBuffer>();
      let currentFileIndex = 0;
      let currentAccum = 0;
      let fileParts: Uint8Array[] = [];
      const TEXELS_PER_FILE = 32768;
      
      for (let i = 0; i < 1024; i++) {
           const data = allData[i];
           
           if (data) {
               fileParts.push(data);
               const size = data.length;
               currentAccum += size;
               if (currentAccum > TEXELS_PER_FILE) {
                   this.flushTextureFileToMap(currentFileIndex, fileParts, newFilesMap);
                   currentFileIndex++;
                   currentAccum = 0;
                   fileParts = [];
               }
           }
      }
      if (fileParts.length > 0) {
          this.flushTextureFileToMap(currentFileIndex, fileParts, newFilesMap);
      }
      for (const [name, buffer] of newFilesMap.entries()) {
          this.fileService.saveBuffer(name, buffer);
      }
  }
  
  private flushTextureFileToMap(index: number, parts: Uint8Array[], map: Map<string, ArrayBuffer>) {
      const totalSize = parts.reduce((acc, p) => acc + p.length, 0);
      const buffer = new Uint8Array(totalSize);
      let offset = 0;
      for (const p of parts) {
          buffer.set(p, offset);
          offset += p.length;
      }
      const fileIndexStr = index < 10 ? '0' + index : index.toString();
      map.set(`tex${fileIndexStr}.bin`, buffer.buffer);
  }
}
