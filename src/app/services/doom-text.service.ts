
import { Injectable, inject } from '@angular/core';
import { DoomFileService } from './doom-file.service';
import { ByteStream } from '../utils/byte-stream';
import { flattenResourceFileIndex, parseResourceFileIndex } from '../core/resource-file-index';
import { encodeSingleByte } from './single-byte-codec';
import type { SingleByteEncoding, TextEncodingError } from './single-byte-codec';
import { TextResourceSettingsService } from './text-resource-settings.service';

export type SaveStringsResult =
  | { success: true }
  | { success: false; error?: TextEncodingError };

export type CreateStringResult =
  | { success: true; entry: TextEntry }
  | { success: false; error?: TextEncodingError };

export interface TextEntry {
  id: number;
  raw: string;        // Decoded string for display (UTF-8/Unicode)
  renderKey: string;  // String decoded as windows-1252 (1-to-1 byte mapping) for the Font Atlas
}

export interface DoomTextLayoutLine {
  text: string;
  /** Stable visible-character range in the prepared preview. */
  start: number;
  end: number;
}

export interface DoomTextLayout {
  lines: readonly DoomTextLayoutLine[];
  lineWidths: readonly number[];
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
  private textSettings = inject(TextResourceSettingsService);

  private FONT_WIDTH = 12;
  private FONT_HEIGHT = 16;
  private readonly FONT_COLUMNS = 16;
  private readonly FONT_GLYPH_COUNT = 144;
  private readonly FONT_ADVANCE = 9;
  private readonly FONT_SPACE_ADVANCE = 7;
  private readonly MISSING_GLYPH_INDEX = 30;
  private readonly glyphRects = Array.from({ length: this.FONT_GLYPH_COUNT }, (_, index) => ({
      x: (index % this.FONT_COLUMNS) * this.FONT_WIDTH,
      y: Math.floor(index / this.FONT_COLUMNS) * this.FONT_HEIGHT,
      w: this.FONT_WIDTH,
      h: this.FONT_HEIGHT
  }));

  /**
   * Helper to synchronously get a string value if the file is available.
   * Useful for disassemblers/inspectors.
   */
  getStringValue(chunkId: number, stringId: number, langId = this.textSettings?.langId() ?? 0, encoding = this.textSettings?.encoding() ?? 'windows-1252'): string {
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
                    return new TextDecoder(encoding).decode(strBytes);
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
          return this.loadStrings(this.textSettings?.langId() ?? 0, chunkId, idxData, this.textSettings?.encoding() ?? 'windows-1252');
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

  /** Returns the first ID after the highest existing ID in a chunk. */
  getNextStringId(entries: readonly TextEntry[]): number {
      return entries.length ? Math.max(...entries.map(entry => entry.id)) + 1 : 0;
  }

  validateString(value: string, encoding: string): TextEncodingError | null {
      if (encoding === 'utf-8') return null;
      const result = encodeSingleByte(value, encoding as SingleByteEncoding, 1);
      return result.ok === true ? null : result.error;
  }

  /**
   * Appends and persists one string in one explicitly selected language/chunk.
   * Other language chunks are intentionally left untouched.
   */
  async createString(langId: number, chunkId: number, value: string, encoding: string): Promise<CreateStringResult> {
      const validationError = this.validateString(value, encoding);
      if (validationError) return { success: false, error: validationError };
      const idxBuffer = this.fileService.getFile('strings.idx');
      if (!idxBuffer) return { success: false };
      const entries = this.loadStrings(langId, chunkId, this.parseStringsIndex(idxBuffer), encoding);
      const entry: TextEntry = { id: this.getNextStringId(entries), raw: value, renderKey: value };
      const saved = await this.saveStringsChunk(langId, chunkId, [...entries, entry], encoding);
      if (saved.success === true) return { success: true, entry };
      return saved.error ? { success: false, error: saved.error } : { success: false };
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
          if (encoded.ok === false) return { success: false, error: encoded.error };
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

      const newIdxBuffer = this.rebuildIndexBuffer(fullIndex);
      this.fileService.saveBuffersAtomically(new Map([
          [`strings${targetFileId}.bin`, newFileBuffer.buffer],
          ['strings.idx', newIdxBuffer]
      ]));
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
    return parseResourceFileIndex(buffer).map((entry, originalIndex) => ({
        ...entry,
        originalIndex,
        langId: Math.floor(originalIndex / 15),
        chunkId: originalIndex % 15
    }));
  }
  
  getCharRect(charCode: number): {x: number, y: number, w: number, h: number} {
      // Most atlas entries are sequential from '!' (33). These exceptions are
      // the non-sequential glyphs used by the original game's Text class.
      const specialGlyphs: Record<number, number> = {
          0x0085: 94, // ellipsis in the game's single-byte text representation
          0x008b: 101,
          0x008c: 142,
          0x008d: 100,
          0x0099: 107,
          0x009c: 143,
          0x00a1: 120,
          0x00a2: 127,
          0x00a6: 124,
          0x00a9: 106,
          0x00aa: 135,
          0x00b0: 126,
          0x00ba: 63,
          0x00bc: 108,
          0x00bd: 109,
          0x00be: 110,
          0x00bf: 119,
          0x00df: 117,
          0x00e7: 116,
          0x00f0: 118,
          0x0152: 142, // Windows-1252 0x8c
          0x0153: 143, // Windows-1252 0x9c
          0x2026: 94   // Windows-1252 0x85
      };
      const glyphIndex = specialGlyphs[charCode] ?? charCode - 33;
      return this.glyphRects[glyphIndex] ?? this.glyphRects[this.MISSING_GLYPH_INDEX];
  }

  /**
   * Produces the text shown by the font preview without changing the source.
   *
   * The game's Text.dehyphenate() treats a single ASCII hyphen as a soft,
   * syllable-break marker. A doubled hyphen escapes a punctuation hyphen, so
   * it must be collapsed rather than removed.
   */
  getPreviewText(text: string): string {
      return text.replace(/--|-/g, hyphen => hyphen === '--' ? '-' : '');
  }

  preparePreviewLayout(text: string, availableWidth = Number.POSITIVE_INFINITY): DoomTextLayout {
      const previewText = this.getPreviewText(text).replace(/\r\n?/g, '\n');
      const texts = previewText.split(/[\n|]/).flatMap(line => this.wrapPreviewLine(line, availableWidth));
      let offset = 0;
      const lines = texts.map(text => {
          const start = offset;
          offset += Array.from(text).length;
          return { text, start, end: offset };
      });
      const lineWidths = texts.map(line => Array.from(line).reduce((width, char) => {
          return width + (char === ' ' || char === '\u00a0' ? this.FONT_SPACE_ADVANCE : this.FONT_ADVANCE);
      }, 0));
      return { lines, lineWidths };
  }

  renderTextToCanvas(text: string, canvas: HTMLCanvasElement, fontImage: HTMLImageElement, availableWidth = Number.POSITIVE_INFINITY) {
      this.renderPreviewLayout(this.preparePreviewLayout(text, availableWidth), canvas, fontImage);
  }

  renderPreviewLayout(layout: DoomTextLayout, canvas: HTMLCanvasElement, fontImage: HTMLImageElement, activeLine = layout.lines.length, characterCount = 0) {
      const { lines, lineWidths } = layout;

      canvas.width = Math.max(1, ...lineWidths);
      canvas.height = Math.max(1, lines.length * this.FONT_HEIGHT);

      const context = canvas.getContext('2d');
      if (!context) return;

      context.clearRect(0, 0, canvas.width, canvas.height);
      context.imageSmoothingEnabled = false;

      lines.forEach((line, lineIndex) => {
          let x = 0;
          const visibleText = lineIndex < activeLine ? line.text : lineIndex === activeLine ? Array.from(line.text).slice(0, characterCount) : [];
          for (const char of typeof visibleText === 'string' ? Array.from(visibleText) : visibleText) {
              if (char === ' ' || char === '\u00a0') {
                  x += this.FONT_SPACE_ADVANCE;
                  continue;
              }

              const rect = this.getCharRect(char.codePointAt(0)!);
              context.drawImage(
                  fontImage,
                  rect.x, rect.y, rect.w, rect.h,
                  x, lineIndex * this.FONT_HEIGHT, rect.w, rect.h
              );
              x += this.FONT_ADVANCE;
          }
      });
  }

  private wrapPreviewLine(line: string, availableWidth: number): string[] {
      const maxWidth = Number.isFinite(availableWidth) ? Math.max(this.FONT_ADVANCE, Math.floor(availableWidth)) : Number.POSITIVE_INFINITY;
      const width = (value: string) => Array.from(value).reduce((sum, char) => sum + (char === ' ' || char === '\u00a0' ? this.FONT_SPACE_ADVANCE : this.FONT_ADVANCE), 0);
      if (width(line) <= maxWidth) return [line];
      const result: string[] = [];
      let current = '';
      for (const word of line.split(/([ \u00a0]+)/).filter(Boolean)) {
          if (width(current + word) <= maxWidth) { current += word; continue; }
          if (current.trim()) result.push(current.trimEnd());
          current = word.trimStart();
          while (width(current) > maxWidth) {
              let count = 1;
              while (count < current.length && width(current.slice(0, count + 1)) <= maxWidth) count++;
              result.push(current.slice(0, count));
              current = current.slice(count);
          }
      }
      result.push(current);
      return result.length ? result : [''];
  }
}
