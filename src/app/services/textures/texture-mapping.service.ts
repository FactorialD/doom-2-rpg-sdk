import { Injectable, inject } from '@angular/core';
import { DoomFileService } from '../doom-file.service';
import { ByteStream, BinaryWriter } from '../../utils/byte-stream';
import { TextureInfo, TextureCategory } from './texture-types';

@Injectable({
  providedIn: 'root'
})
export class TextureMappingService {
  private fileService = inject(DoomFileService);

  // Raw mapping data
  public mediaMappings: Int16Array | null = null;
  public mediaDimensions: Uint8Array | null = null;
  public mediaBounds: Uint8Array | null = null; 
  public mediaPalColors: Int16Array | null = null;
  public mediaTexelSizes: Int16Array | null = null;

  // Computed Lookups
  private textureLocations: TextureInfo[] = [];
  private groupToTextureMap = new Map<number, TextureInfo>();

  loadMappings(): boolean {
    const buffer = this.fileService.getFile('newMappings.bin');
    if (!buffer) return false;

    const stream = new ByteStream(buffer);
    this.mediaMappings = new Int16Array(stream.readInt16Array(512));
    this.mediaDimensions = new Uint8Array(stream.readByteArray(1024));
    this.mediaBounds = new Uint8Array(stream.readByteArray(4096)); 
    this.mediaPalColors = new Int16Array(stream.readInt16Array(1024));
    this.mediaTexelSizes = new Int16Array(stream.readInt16Array(1024));

    this.precomputeTextureLocations();
    return true;
  }

  getAllTextures(): TextureInfo[] {
      return this.textureLocations;
  }

  getTextureByGroup(groupId: number): TextureInfo | undefined {
      return this.groupToTextureMap.get(groupId);
  }

  getTextureById(id: number): TextureInfo | undefined {
      return this.textureLocations[id];
  }

  getTextureFrame(groupId: number, frameIndex: number): TextureInfo | undefined {
      if (!this.mediaMappings) return undefined;
      if (groupId < 0 || groupId >= this.mediaMappings.length - 1) return undefined;

      const startIndex = this.mediaMappings[groupId];
      const endIndex = this.mediaMappings[groupId + 1];
      const targetIndex = startIndex + frameIndex;

      if (targetIndex >= endIndex) return undefined;
      return this.textureLocations[targetIndex];
  }

  updateMappingData(id: number, newSize: number, newBounds?: {minX: number, maxX: number, minY: number, maxY: number}) {
      if (this.mediaTexelSizes) {
          const oldFlags = this.mediaTexelSizes[id] & 0x4000; // Preserve the 0x4000 flag
          this.mediaTexelSizes[id] = oldFlags | ((newSize) & 0x3FFF);
      }
      if (newBounds && this.mediaBounds) {
          const idx = id * 4;
          this.mediaBounds[idx] = newBounds.minX;
          this.mediaBounds[idx + 1] = newBounds.maxX;
          this.mediaBounds[idx + 2] = newBounds.minY;
          this.mediaBounds[idx + 3] = newBounds.maxY;
      }
      this.precomputeTextureLocations();
  }
  
  saveMappingsFile() {
      if (!this.mediaMappings || !this.mediaDimensions || !this.mediaBounds || !this.mediaPalColors || !this.mediaTexelSizes) return;
      
      const writer = new BinaryWriter(10000);
      
      const writeArray = (arr: Int16Array | Uint8Array) => {
          if (arr instanceof Int16Array) {
              for(let i=0; i<arr.length; i++) writer.writeShort(arr[i]);
          } else {
              writer.writeBytes(arr);
          }
      };
      
      writeArray(this.mediaMappings);
      writeArray(this.mediaDimensions);
      writeArray(this.mediaBounds);
      writeArray(this.mediaPalColors);
      writeArray(this.mediaTexelSizes);
      
      this.fileService.saveBuffer('newMappings.bin', writer.getData().buffer);
  }

  private precomputeTextureLocations() {
    if (!this.mediaDimensions || !this.mediaTexelSizes || !this.mediaMappings || !this.mediaBounds) return;
    this.textureLocations = [];
    this.groupToTextureMap.clear();

    const flatIndexToGroupId = new Int32Array(1024).fill(-1);
    
    for (let g = 0; g < this.mediaMappings.length - 1; g++) {
        const start = this.mediaMappings[g];
        const end = this.mediaMappings[g + 1];
        if (start >= 0 && end <= 1024 && start < end) {
            for (let k = start; k < end; k++) {
                flatIndexToGroupId[k] = g;
            }
        }
    }

    const TEXELS_PER_FILE = 32768;
    let currentFileIndex = 0;
    let currentAccum = 0; 
    let currentFileOffset = 0; 

    for (let i = 0; i < 1024; i++) {
        const dimByte = this.mediaDimensions[i];
        const w = 1 << ((dimByte >> 4) & 15);
        const h = 1 << (dimByte & 15);
        
        const bIdx = i * 4;
        const bounds = {
            minX: this.mediaBounds[bIdx],
            maxX: this.mediaBounds[bIdx + 1],
            minY: this.mediaBounds[bIdx + 2],
            maxY: this.mediaBounds[bIdx + 3]
        };
        
        const rawVal = this.mediaTexelSizes[i] & 0xFFFF;
        const isReference = (rawVal & 0x8000) !== 0;
        const groupId = flatIndexToGroupId[i] !== -1 ? flatIndexToGroupId[i] : 999;

        const info: TextureInfo = {
            id: i,
            groupId: groupId,
            width: w,
            height: h,
            valid: w > 0 && h > 0, 
            isReference: isReference,
            fileIndex: -1,
            fileOffset: -1,
            dataLength: 0,
            category: this.getCategory(groupId),
            bounds: bounds
        };

        if (isReference) {
            info.parentId = rawVal & 0x7FFF;
        } else {
            const size = (rawVal & 0x3FFF) + 1;
            info.fileIndex = currentFileIndex;
            info.fileOffset = currentFileOffset;
            info.dataLength = size;
            currentAccum += size;
            currentFileOffset += size;
            if (currentAccum > TEXELS_PER_FILE) {
                currentFileIndex++;
                currentAccum = 0;
                currentFileOffset = 0;
            }
        }
        this.textureLocations.push(info);
    }

    // Resolve reference chains to their physical texel buffer. Dimensions and
    // bounds deliberately remain those of the referencing frame, matching
    // Render.setupTexture().
    const resolutionState = new Uint8Array(1024); // 0 = new, 1 = visiting, 2 = resolved, 3 = invalid
    const resolveReference = (id: number): TextureInfo | undefined => {
        const info = this.textureLocations[id];
        if (!info) return undefined;
        if (!info.isReference) return info;
        if (resolutionState[id] === 2) return info;
        if (resolutionState[id] === 1 || resolutionState[id] === 3) {
            resolutionState[id] = 3;
            info.valid = false;
            return undefined;
        }

        resolutionState[id] = 1;
        const parentId = info.parentId;
        const parent = parentId !== undefined && parentId >= 0 && parentId < 1024
            ? resolveReference(parentId)
            : undefined;

        if (!parent || resolutionState[parentId!] === 3 || parent.fileIndex === -1) {
            resolutionState[id] = 3;
            info.valid = false;
            return undefined;
        }

        info.fileIndex = parent.fileIndex;
        info.fileOffset = parent.fileOffset;
        info.dataLength = parent.dataLength;
        resolutionState[id] = 2;
        return info;
    };

    for (let i = 0; i < 1024; i++) {
        resolveReference(i);
    }

    // Populate Group Map
    for (let i = 0; i < 1024; i++) {
        const info = this.textureLocations[i];
        if (info.groupId !== 999 && !this.groupToTextureMap.has(info.groupId) && (info.valid)) {
            this.groupToTextureMap.set(info.groupId, info);
        }
    }
  }

  private getCategory(groupId: number): TextureCategory {
      if (groupId <= 50) return 'UI';
      if (groupId <= 256) return 'Sprites';
      if (groupId <= 449) return 'Walls';
      if (groupId <= 512) return 'Flats';
      if (groupId >= 513) return 'Editor';
      return 'Unknown';
  }
}
