
import { TextureInfo } from '../services/textures/texture-types';

export class SpriteCodec {

  // Decompresses byte indices (not RGBA)
  static decompressIndices(buffer: Uint8Array, output: Uint8Array, info: TextureInfo) {
      if (!info.bounds || buffer.length < 2) return;
      
      const { minX, maxX, minY, maxY } = info.bounds;
      const len = buffer.length;
      
      // Footer: 2 bytes for Directory Size
      const dirSize = (buffer[len - 1] << 8) | buffer[len - 2];
      
      const dirStart = len - dirSize - 2;
      if (dirStart < 0) return;
      const metaStart = dirStart + ((maxX - minX + 1) >> 1); 
      
      let pixelPtr = 0;
      let metaPtr = metaStart;
      
      const cols = maxX - minX;
      
      for (let col = 0; col < cols; col++) {
          const nibbleByte = buffer[dirStart + (col >> 1)];
          if (nibbleByte === undefined) return;
          const numSpans = (col & 1) ? (nibbleByte >> 4) : (nibbleByte & 0x0F);
          
          const targetX = minX + col;
          
          for (let s = 0; s < numSpans; s++) {
              if (metaPtr + 1 >= len - 2) return;
              const topY = buffer[metaPtr++];
              const height = buffer[metaPtr++];
              
              for (let y = 0; y < height; y++) {
                  const targetY = topY + y;
                  if (targetX < info.width && targetY < info.height) {
                      if (pixelPtr >= dirStart) return;
                      output[targetY * info.width + targetX] = buffer[pixelPtr++];
                  } else {
                      pixelPtr++;
                  }
              }
          }
      }
  }

  static compressSprite(pixels: Uint8Array, width: number, height: number): { data: Uint8Array, bounds: {minX: number, maxX: number, minY: number, maxY: number} } {
      // 1. Calculate Bounds
      let minX = width, maxX = 0, minY = height, maxY = 0;
      let hasPixels = false;
      
      for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
              if (pixels[y * width + x] !== 0) { // Non-transparent
                  if (x < minX) minX = x;
                  if (x > maxX) maxX = x;
                  if (y < minY) minY = y;
                  if (y > maxY) maxY = y;
                  hasPixels = true;
              }
          }
      }
      
      // Handle empty sprite
      if (!hasPixels) {
           minX = 0; maxX = 0; minY = 0; maxY = 0;
           maxX = 1; maxY = 1; // 1x1 placeholder
      } else {
          maxX++; // Inclusive -> Exclusive for width calcs
          maxY++;
      }

      // 2. Build Columns / Spans
      const pixelData: number[] = [];
      const spanMetaData: number[] = []; // topY, height pairs
      const columnSpanCounts: number[] = [];
      
      for (let x = minX; x < maxX; x++) {
          let spanCount = 0;
          let currentSpanY = -1;
          let currentSpanPixels: number[] = [];

          const closeSpan = () => {
              if (currentSpanY === -1 || currentSpanPixels.length === 0) return;
              // Span metadata stores both coordinates in bytes. Split a tall
              // run rather than wrapping a length of 256 to zero.
              let offset = 0;
              while (offset < currentSpanPixels.length) {
                  if (spanCount >= 15) {
                      throw new RangeError(`Column ${x} needs more than 15 sprite spans`);
                  }
                  const length = Math.min(0xFF, currentSpanPixels.length - offset);
                  spanMetaData.push(currentSpanY + offset, length);
                  pixelData.push(...currentSpanPixels.slice(offset, offset + length));
                  spanCount++;
                  offset += length;
              }
          };
          
          for (let y = 0; y < height; y++) { 
              const color = pixels[y * width + x];
              
              if (color !== 0) {
                  if (currentSpanY === -1) {
                      currentSpanY = y;
                  }
                  currentSpanPixels.push(color);
              } else {
                  if (currentSpanY !== -1) {
                      // End span
                      closeSpan();
                      currentSpanY = -1;
                      currentSpanPixels = [];
                  }
              }
          }
          // Close trailing span
          if (currentSpanY !== -1) {
               closeSpan();
          }
          
          columnSpanCounts.push(spanCount);
      }
      
      // 3. Construct Directory (Nibbles)
      const numCols = columnSpanCounts.length;
      const directoryBytes: number[] = [];
      for (let i = 0; i < numCols; i += 2) {
          const lo = columnSpanCounts[i];
          const hi = (i + 1 < numCols) ? columnSpanCounts[i + 1] : 0;
          // Decompress: (col & 1) ? (byte >> 4) : (byte & 0x0F)
          // So even col (0) is low nibble, odd col (1) is high nibble.
          directoryBytes.push((hi << 4) | lo); 
      }
      
      // 4. Assemble Final Buffer
      // Layout based on Decompress:
      // [Pixels...]
      // [Directory Nibbles...] <- dirStart
      // [Meta (Y, H)...]       <- metaStart
      // [DirSize (2 bytes)]    <- Footer
      
      const dirSize = directoryBytes.length + spanMetaData.length;
      
      const totalSize = pixelData.length + dirSize + 2;
      const buffer = new Uint8Array(totalSize);
      
      let pos = 0;
      buffer.set(pixelData, pos); pos += pixelData.length;
      buffer.set(directoryBytes, pos); pos += directoryBytes.length;
      buffer.set(spanMetaData, pos); pos += spanMetaData.length;
      
      // Size (Little Endian)
      buffer[pos++] = dirSize & 0xFF;
      buffer[pos++] = (dirSize >> 8) & 0xFF;
      
      return {
          data: buffer,
          bounds: { minX, maxX, minY, maxY }
      };
  }
}
