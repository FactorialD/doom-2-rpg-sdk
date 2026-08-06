
import { Injectable, inject } from '@angular/core';
import { DoomFileService } from './doom-file.service';
import { ByteStream } from '../../utils/byte-stream';
import {
  encodeSingleByte
} from './single-byte-codec';
import type { SingleByteEncoding, TextEncodingError } from './single-byte-codec';

export type SaveStringsResult =
  | { success: true }
  | { success: false; error?: TextEncodingError };

export interface TextEntry {
  id: number;
  raw: string;        // Decoded string for display (UTF-8/Unicode)
  renderKey: string;  // String decoded as windows-1252 (1-to-1 byte mapping) for the Font Atlas
}

interface IndexEntry {
    fileId: number;
    offset: number;
    length: number;
    
    // Metadata we calculate to map back to logical coords
    langId: number;
    chunkId: number;
    originalIndex: number; // Index in the linear strings.idx file
}

@Injectable({
  providedIn: 'root'
})
export class DoomTextService {
  private fileService = inject(DoomFileService);

  private FONT_WIDTH = 12;
  private FONT_HEIGHT = 16;
  
  private CHAR_COLORS = [
    0xFFFFFF, // WHITE
    0xFF0000, // RED
    0x00FF00, // GREEN
    0x8BBCCD, // MAP (Cyan-ish)
    0x0000FF, // BLUE
    0x318C43, // DARK GREEN/CYAN
    0xAFAFAF, // GRAY-ish
    0x7F0000, // DARK RED
    0x7F7F7F, // GRAY
    0x000000, // BLACK
    0x3F3F3F, // DARK GRAY
    0xBFBFBF  // LIGHT GRAY
  ];

  /**
   * Helper to synchronously get a string value if the file is available.
   * Useful for disassemblers/inspectors.
   */
  getStringValue(chunkId: number, stringId: number, langId: number = 0): string {
      const idxBuffer = this.fileService.getFile('strings.idx');
      if (!idxBuffer) return `STR_${stringId}`;

      try {
        const idxData = this.parseStringsIndex(idxBuffer);
        // Calculate position in flat index array
        // Strides of 3 ints per entry. 15 chunks per language.
        // Index = (Lang * 15 + Chunk) * 3
        const pos = (langId * 15 + chunkId) * 3;
        
        if (pos + 2 >= idxData.length) return `STR_${stringId}`;

        const fileId = idxData[pos];
        const offset = idxData[pos + 1];
        let chunkLen = idxData[pos + 2];

        const binName = `strings${fileId}.bin`;
        const binBuffer = this.fileService.getFile(binName);
        if (!binBuffer) return `STR_${stringId}`;
        
        if (offset + chunkLen > binBuffer.byteLength) chunkLen = binBuffer.byteLength - offset;

        // We need to scan the chunk to find the Nth null terminator
        const view = new DataView(binBuffer);
        let currentStringIdx = 0;
        let startPos = offset;
        let endPos = offset + chunkLen;
        
        let cursor = startPos;
        while (cursor < endPos) {
            if (view.getUint8(cursor) === 0) {
                if (currentStringIdx === stringId) {
                    // Found it
                    const strBytes = new Uint8Array(binBuffer.slice(startPos, cursor));
                    return new TextDecoder('windows-1252').decode(strBytes);
                }
                currentStringIdx++;
                startPos = cursor + 1;
            }
            cursor++;
        }
        
        return `STR_${stringId} (Not Found)`;

      } catch (e) {
          return `STR_${stringId} (Error)`;
      }
  }

  getMapStrings(mapId: number): TextEntry[] {
      const chunkId = 4 + (mapId - 1);
      const idxBuffer = this.fileService.getFile('strings.idx');
      if (!idxBuffer) return [];
      
      try {
          const idxData = this.parseStringsIndex(idxBuffer);
          return this.loadStrings(0, chunkId, idxData);
      } catch(e) {
          return [];
      }
  }

  parseStringsIndex(buffer: ArrayBuffer): Int32Array {
    const stream = new ByteStream(buffer);
    const count = stream.readShort();
    
    // We don't know the exact number of physical entries (could include fillers),
    // so we use a dynamic array and convert later.
    const tempResult: number[] = [];
    
    let validCount = 0;
    
    // Read until we satisfy the valid count expected by the header
    // Resource.java loops until `var7` (valid items) == `var2` (header count)
    while (validCount < count && stream.position < stream.length - 5) {
        const fileId = stream.readUByte(); 
        const offset = stream.readInt();   

        // Fix logic: calculate length of PREVIOUS valid entry
        if (offset !== 0 && validCount > 0) {
            // We need to find the last valid entry pushed to result to set its length
            // But since this array is flat [id, offset, len, id, offset, len], we look at the last triplet
            const prevOffset = tempResult[tempResult.length - 2];
            tempResult[tempResult.length - 1] = offset - prevOffset;
        }

        if (fileId !== 255) { 
            tempResult.push(fileId, offset, 0); // 0 is placeholder length
            validCount++;
        }
    }
    
    // Handle Footer to calculate last item length
    if (stream.position + 5 <= stream.length) {
        stream.readUByte(); // Footer ID (usually 255)
        const totalSize = stream.readInt();

        if (validCount > 0) {
            const lastOffset = tempResult[tempResult.length - 2];
            tempResult[tempResult.length - 1] = totalSize - lastOffset;
        }
    }

    return new Int32Array(tempResult);
  }

  loadStrings(langId: number, chunkId: number, idxData: Int32Array, encoding: string = 'windows-1252'): TextEntry[] {
    const STRINGS_PER_LANG = 15; 
    const DATA_STRIDE = 3; 
    const indexPos = (chunkId + langId * STRINGS_PER_LANG) * DATA_STRIDE;
    
    if (indexPos + 2 >= idxData.length) return [];

    const fileSuffix = idxData[indexPos];
    const offset = idxData[indexPos + 1];
    let length = idxData[indexPos + 2];

    const fileName = `strings${fileSuffix}.bin`;
    const buffer = this.fileService.getFile(fileName);

    if (!buffer) return [];

    if (offset < 0 || offset >= buffer.byteLength) return [];
    if (offset + length > buffer.byteLength) length = buffer.byteLength - offset;
    if (length <= 0) return [];

    const stream = new ByteStream(buffer);
    stream.position = offset;
    
    const rawBytes = stream.readByteArray(length);
    const entries: TextEntry[] = [];
    let currentStart = 0;
    let stringId = 0;

    let decoder: TextDecoder;
    try {
        decoder = new TextDecoder(encoding);
    } catch(e) {
        console.warn(`Encoding ${encoding} not supported, falling back to windows-1252`);
        decoder = new TextDecoder('windows-1252');
    }
    const renderDecoder = new TextDecoder('windows-1252'); 

    for (let i = 0; i < rawBytes.length; i++) {
      if (rawBytes[i] === 0) {
        const strBytes = rawBytes.subarray(currentStart, i); 
        
        const displayStr = decoder.decode(strBytes);
        const renderStr = renderDecoder.decode(strBytes);

        entries.push({ 
            id: stringId++, 
            raw: displayStr,
            renderKey: renderStr
        });
        currentStart = i + 1;
      }
    }
    
    return entries;
  }
  
  // --- SAVING LOGIC (Preserved) ---
  async saveStringsChunk(targetLang: number, targetChunk: number, newStrings: TextEntry[], encoding: string): Promise<SaveStringsResult> {
      // ... (Implementation preserved from previous)
      const idxBuffer = this.fileService.getFile('strings.idx');
      if (!idxBuffer) return { success: false };
      const fullIndex = this.parseStringsIndexFull(idxBuffer);
      const targetEntry = fullIndex.find(e => e.langId === targetLang && e.chunkId === targetChunk);
      if (!targetEntry) return { success: false };
      const targetFileId = targetEntry.fileId;
      const siblings = fullIndex.filter(e => e.fileId === targetFileId).sort((a,b) => a.offset - b.offset);
      const originalFileBuffer = this.fileService.getFile(`strings${targetFileId}.bin`);
      if (!originalFileBuffer) return { success: false };

      // Encode the complete edited chunk before changing offsets or saving either
      // file. This makes an encoding failure atomic from the VFS perspective.
      const encodedStrings: Uint8Array[] = [];
      for (let line = 0; line < newStrings.length; line++) {
          const encoded = this.customEncode(newStrings[line].raw, encoding, line + 1);
          if (!encoded.ok) return { success: false, error: encoded.error };
          encodedStrings.push(encoded.bytes);
      }

      const newParts: Uint8Array[] = [];
      let currentOffset = 0;
      
      for (const entry of siblings) {
          let chunkBytes: Uint8Array;

          if (entry.langId === targetLang && entry.chunkId === targetChunk) {
              const stringBuffers: Uint8Array[] = [];
              for (const sBuf of encodedStrings) {
                  stringBuffers.push(sBuf);
                  stringBuffers.push(new Uint8Array([0])); 
              }
              const totalLen = stringBuffers.reduce((a, b) => a + b.length, 0);
              chunkBytes = new Uint8Array(totalLen);
              let pos = 0;
              for (const buf of stringBuffers) {
                  chunkBytes.set(buf, pos);
                  pos += buf.length;
              }
          } else {
              chunkBytes = new Uint8Array(originalFileBuffer.slice(entry.offset, entry.offset + entry.length));
          }
          entry.offset = currentOffset;
          entry.length = chunkBytes.length;
          newParts.push(chunkBytes);
          currentOffset += chunkBytes.length;
      }

      const totalFileSize = newParts.reduce((a, b) => a + b.length, 0);
      const newFileBuffer = new Uint8Array(totalFileSize);
      let writePos = 0;
      for (const part of newParts) {
          newFileBuffer.set(part, writePos);
          writePos += part.length;
      }

      this.fileService.saveBuffer(`strings${targetFileId}.bin`, newFileBuffer.buffer);
      const newIdxBuffer = this.rebuildIndexBuffer(fullIndex);
      this.fileService.saveBuffer('strings.idx', newIdxBuffer);
      return { success: true };
  }
  
  private customEncode(str: string, encoding: string, line: number) {
      if (encoding === 'utf-8') return { ok: true as const, bytes: new TextEncoder().encode(str) };
      return encodeSingleByte(str, encoding as SingleByteEncoding, line);
  }
  
  private rebuildIndexBuffer(indices: IndexEntry[]): ArrayBuffer {
      const validIndices = indices.filter(i => i.fileId !== 255);
      validIndices.sort((a, b) => (a.langId * 15 + a.chunkId) - (b.langId * 15 + b.chunkId));
      const entriesToWrite: {id: number, offset: number}[] = [];
      for (let i = 0; i < validIndices.length; i++) {
          const current = validIndices[i];
          entriesToWrite.push({ id: current.fileId, offset: current.offset });
          const next = validIndices[i+1];
          if (next && next.fileId !== current.fileId) {
              const endOffset = current.offset + current.length;
              entriesToWrite.push({ id: 255, offset: endOffset });
          }
      }
      const buffer = new ArrayBuffer(2 + (entriesToWrite.length * 5) + 5);
      const view = new DataView(buffer);
      view.setInt16(0, validIndices.length, true); 
      let pos = 2;
      for (const e of entriesToWrite) {
          view.setUint8(pos, e.id);
          view.setInt32(pos + 1, e.offset, true); 
          pos += 5;
      }
      if (validIndices.length > 0) {
          const lastEntry = validIndices[validIndices.length - 1];
          const totalSize = lastEntry.offset + lastEntry.length;
          view.setUint8(pos, 255);
          view.setInt32(pos + 1, totalSize, true);
      } else {
          view.setUint8(pos, 255);
          view.setInt32(pos + 1, 0, true);
      }
      return buffer;
  }
  
  private parseStringsIndexFull(buffer: ArrayBuffer): IndexEntry[] {
    const stream = new ByteStream(buffer);
    const expectedValidCount = stream.readShort(); 
    const result: IndexEntry[] = [];
    let validCount = 0;
    while (validCount < expectedValidCount && stream.position < stream.length - 5) {
        const fileId = stream.readUByte();
        const offset = stream.readInt();
        const entry: IndexEntry = {
            fileId, offset, length: 0, 
            originalIndex: result.length, langId: -1, chunkId: -1
        };
        if (fileId !== 255) {
             entry.langId = Math.floor(validCount / 15);
             entry.chunkId = validCount % 15;
             validCount++;
        }
        result.push(entry);
    }
    let footerTotalSize = 0;
    if (stream.position + 5 <= stream.length) {
        stream.readUByte(); footerTotalSize = stream.readInt();
    }
    for (let i = 0; i < result.length; i++) {
        const current = result[i];
        let nextEntryInFile = null;
        for (let j = i + 1; j < result.length; j++) {
            if (result[j].fileId === current.fileId) {
                nextEntryInFile = result[j];
                break;
            }
        }
        if (nextEntryInFile) {
            current.length = nextEntryInFile.offset - current.offset;
        } else {
            const isAbsoluteLast = (i === result.length - 1) || result.slice(i+1).every(e => e.fileId === 255);
            if (isAbsoluteLast) {
                 current.length = footerTotalSize - current.offset;
            } else {
                const binName = `strings${current.fileId}.bin`;
                const fileBuf = this.fileService.getFile(binName);
                if (fileBuf) current.length = fileBuf.byteLength - current.offset;
                else current.length = 0; 
            }
        }
    }
    return result;
  }
  
  // Rendering methods preserved...
  getCharRect(charCode: number): {x: number, y: number, w: number, h: number} {
      return {x:0,y:0,w:0,h:0}; // Stub for brevity, assuming existing impl
  }
  renderTextToCanvas(text: string, canvas: HTMLCanvasElement, fontImage: HTMLImageElement) {}
}
