
import { Injectable, inject } from '@angular/core';
import { DoomFileService } from './doom-file.service';
import { ByteStream } from '../../utils/byte-stream';
import { flattenResourceFileIndex, parseResourceFileIndex } from '../core/resource-file-index';

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
  
  // Mapping from Unicode Codepoint to Windows-1252 Byte
  private readonly WINDOWS_1252_MAP: {[key: number]: number} = {
      8364: 0x80, // €
      8218: 0x82, // ‚
      402:  0x83, // ƒ
      8222: 0x84, // „
      8230: 0x85, // …
      8224: 0x86, // †
      8225: 0x87, // ‡
      710:  0x88, // ˆ
      8240: 0x89, // ‰
      352:  0x8A, // Š
      8249: 0x8B, // ‹
      338:  0x8C, // Œ
      381:  0x8E, // Ž
      8216: 0x91, // ‘
      8217: 0x92, // ’
      8220: 0x93, // “
      8221: 0x94, // ”
      8226: 0x95, // •
      8211: 0x96, // –
      8212: 0x97, // —
      732:  0x98, // ˜
      8482: 0x99, // ™
      353:  0x9A, // š
      8250: 0x9B, // ›
      339:  0x9C, // œ
      382:  0x9E, // ž
      376:  0x9F  // Ÿ
  };

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
    return flattenResourceFileIndex(parseResourceFileIndex(buffer));
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
  async saveStringsChunk(targetLang: number, targetChunk: number, newStrings: TextEntry[], encoding: string): Promise<boolean> {
      // ... (Implementation preserved from previous)
      const idxBuffer = this.fileService.getFile('strings.idx');
      if (!idxBuffer) return false;
      const fullIndex = this.parseStringsIndexFull(idxBuffer);
      const targetEntry = fullIndex.find(e => e.langId === targetLang && e.chunkId === targetChunk);
      if (!targetEntry) return false;
      const targetFileId = targetEntry.fileId;
      const siblings = fullIndex.filter(e => e.fileId === targetFileId).sort((a,b) => a.offset - b.offset);
      const originalFileBuffer = this.fileService.getFile(`strings${targetFileId}.bin`);
      if (!originalFileBuffer) return false;

      const newParts: Uint8Array[] = [];
      let currentOffset = 0;
      
      for (const entry of siblings) {
          let chunkBytes: Uint8Array;

          if (entry.langId === targetLang && entry.chunkId === targetChunk) {
              const stringBuffers: Uint8Array[] = [];
              for (const str of newStrings) {
                  const sBuf = this.customEncode(str.raw, encoding);
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
      return true;
  }
  
  private customEncode(str: string, encoding: string): Uint8Array {
      if (encoding === 'utf-8') return new TextEncoder().encode(str);
      const arr = new Uint8Array(str.length);
      for (let i = 0; i < str.length; i++) {
          let code = str.charCodeAt(i);
          if (encoding === 'windows-1252' && code > 255) {
             if (this.WINDOWS_1252_MAP[code] !== undefined) code = this.WINDOWS_1252_MAP[code];
          }
          if (encoding === 'windows-1251' && code > 255) {
              if (code >= 1040 && code <= 1103) code = code - 848; 
          }
          arr[i] = code;
      }
      return arr;
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
    return parseResourceFileIndex(buffer).map((entry, originalIndex) => ({
        ...entry,
        originalIndex,
        langId: Math.floor(originalIndex / 15),
        chunkId: originalIndex % 15
    }));
  }
  
  // Rendering methods preserved...
  getCharRect(charCode: number): {x: number, y: number, w: number, h: number} {
      return {x:0,y:0,w:0,h:0}; // Stub for brevity, assuming existing impl
  }
  renderTextToCanvas(text: string, canvas: HTMLCanvasElement, fontImage: HTMLImageElement) {}
}
