
import { Injectable } from '@angular/core';

export type ImageScalingMode = 'nearest' | 'bilinear' | 'high-quality';

interface RGB {
    r: number;
    g: number;
    b: number;
}

@Injectable({
  providedIn: 'root'
})
export class ImageProcessingService {

  static readonly MAX_SCALE_DIMENSION = 4096;

  constructor() { }

  /** Resizes a canvas-compatible image source and returns its RGBA pixels. */
  scaleImage(source: CanvasImageSource, width: number, height: number, filter: ImageScalingMode): ImageData {
      const targetWidth = this.normalizeScaleDimension(width);
      const targetHeight = this.normalizeScaleDimension(height);
      const canvas = document.createElement('canvas');
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Could not get canvas context');

      ctx.imageSmoothingEnabled = filter !== 'nearest';
      if (filter === 'high-quality') ctx.imageSmoothingQuality = 'high';
      else if (filter === 'bilinear') ctx.imageSmoothingQuality = 'medium';
      ctx.drawImage(source, 0, 0, targetWidth, targetHeight);
      return ctx.getImageData(0, 0, targetWidth, targetHeight);
  }

  normalizeScaleDimension(value: number): number {
      if (!Number.isFinite(value)) return 1;
      return Math.min(ImageProcessingService.MAX_SCALE_DIMENSION, Math.max(1, Math.round(value)));
  }

  /**
   * Reads an image file, resizes it to target dimensions, and converts colors
   * to palette indices based on luminance (grayscale).
   */
  async processImportImage(file: File, width: number, height: number, paletteSize: number): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        
        if (!ctx) {
          reject(new Error('Could not get canvas context'));
          return;
        }

        // Draw and Resize
        ctx.drawImage(img, 0, 0, width, height);
        
        const imgData = ctx.getImageData(0, 0, width, height);
        resolve(this.quantizeImageData(imgData, paletteSize));
      };
      
      img.onerror = (e) => reject(e);
      img.src = URL.createObjectURL(file);
    });
  }

  /**
   * Generates a Uint32Array (ABGR) palette from an image file using Median Cut quantization.
   */
  async generatePaletteFromImage(file: File, maxColors: number): Promise<Uint32Array> {
      return new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => {
              const canvas = document.createElement('canvas');
              // Limit size for performance, we only need colors
              const scale = Math.min(1, 256 / Math.max(img.width, img.height));
              canvas.width = Math.floor(img.width * scale);
              canvas.height = Math.floor(img.height * scale);
              
              const ctx = canvas.getContext('2d');
              if (!ctx) {
                  reject(new Error('No context'));
                  return;
              }
              
              ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
              const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
              const pixels = this.getRGBPixels(imgData);
              
              const paletteRGB = this.medianCut(pixels, maxColors);
              
              // Convert RGB to Uint32 ABGR (Little Endian)
              const finalPalette = new Uint32Array(paletteRGB.length);
              for(let i=0; i<paletteRGB.length; i++) {
                  const c = paletteRGB[i];
                  // A B G R
                  finalPalette[i] = (255 << 24) | (c.b << 16) | (c.g << 8) | c.r;
              }
              
              resolve(finalPalette);
          };
          img.onerror = (e) => reject(e);
          img.src = URL.createObjectURL(file);
      });
  }

  private getRGBPixels(imgData: ImageData): RGB[] {
      const pixels: RGB[] = [];
      const data = imgData.data;
      for (let i = 0; i < data.length; i += 4) {
          // Ignore fully transparent pixels
          if (data[i + 3] < 128) continue;
          pixels.push({ r: data[i], g: data[i+1], b: data[i+2] });
      }
      return pixels;
  }

  // Simple Median Cut Algorithm
  private medianCut(pixels: RGB[], maxColors: number): RGB[] {
      if (pixels.length === 0) return [{r:0, g:0, b:0}];
      
      let buckets: RGB[][] = [pixels];
      
      while (buckets.length < maxColors) {
          let newBuckets: RGB[][] = [];
          let splitHappened = false;
          
          for (const bucket of buckets) {
              if (bucket.length > 1 && newBuckets.length + (buckets.length - newBuckets.length) < maxColors + 1) {
                  // Find channel with greatest range
                  let minR = 255, maxR = 0, minG = 255, maxG = 0, minB = 255, maxB = 0;
                  for (const p of bucket) {
                      if(p.r < minR) minR = p.r; if(p.r > maxR) maxR = p.r;
                      if(p.g < minG) minG = p.g; if(p.g > maxG) maxG = p.g;
                      if(p.b < minB) minB = p.b; if(p.b > maxB) maxB = p.b;
                  }
                  
                  const rangeR = maxR - minR;
                  const rangeG = maxG - minG;
                  const rangeB = maxB - minB;
                  const maxRange = Math.max(rangeR, rangeG, rangeB);
                  
                  // Sort
                  if (maxRange === rangeR) bucket.sort((a,b) => a.r - b.r);
                  else if (maxRange === rangeG) bucket.sort((a,b) => a.g - b.g);
                  else bucket.sort((a,b) => a.b - b.b);
                  
                  const mid = Math.floor(bucket.length / 2);
                  newBuckets.push(bucket.slice(0, mid));
                  newBuckets.push(bucket.slice(mid));
                  splitHappened = true;
              } else {
                  newBuckets.push(bucket);
              }
          }
          
          buckets = newBuckets;
          if (!splitHappened && buckets.length < maxColors) break; // Cannot split further
      }
      
      // Average colors in buckets
      return buckets.map(bucket => {
          let r=0, g=0, b=0;
          for(const p of bucket) { r+=p.r; g+=p.g; b+=p.b; }
          return {
              r: Math.round(r / bucket.length),
              g: Math.round(g / bucket.length),
              b: Math.round(b / bucket.length)
          };
      });
  }

  /**
   * Converts RGBA ImageData to a Uint8Array of palette indices based on Luminance.
   * Deprecated for general use, prefer mapImageToPalette for color accuracy.
   */
  quantizeImageData(imgData: ImageData, paletteSize: number): Uint8Array {
      const data = imgData.data;
      const width = imgData.width;
      const height = imgData.height;
      const indices = new Uint8Array(width * height);
      
      for (let i = 0; i < data.length; i += 4) {
         const r = data[i];
         const g = data[i+1];
         const b = data[i+2];
         
         const luma = 0.299 * r + 0.587 * g + 0.114 * b;
         let index = Math.floor((luma / 255) * (paletteSize - 1));
         
         if (index < 0) index = 0;
         if (index >= paletteSize) index = paletteSize - 1;

         indices[i / 4] = index;
      }
      return indices;
  }
  
  /**
   * Maps an RGBA image to a palette using Nearest Neighbor (Euclidean Distance).
   * returns Uint8Array of indices.
   */
  mapImageToPalette(imgData: ImageData, palette: Uint32Array): Uint8Array {
      const data = imgData.data;
      const length = data.length;
      const indices = new Uint8Array(length / 4);
      
      // Pre-process palette to RGB for faster distance calc
      const palRGB = new Array(palette.length);
      for(let i=0; i<palette.length; i++) {
          const c = palette[i];
          // ABGR in memory
          palRGB[i] = {
              r: c & 0xFF,
              g: (c >> 8) & 0xFF,
              b: (c >> 16) & 0xFF,
              a: (c >>> 24) & 0xFF
          };
      }
      
      for (let i = 0; i < length; i += 4) {
          const r = data[i];
          const g = data[i+1];
          const b = data[i+2];
          const a = data[i+3];
          
          if (a < 128) {
              indices[i/4] = 0; // Transparent
              continue;
          }
          
          let minDist = Number.MAX_VALUE;
          let bestIdx = 0;
          
          // Start from 1 usually to skip transparent index 0 if it's reserved
          // But check if index 0 is actually a color?
          // For Doom RPG, usually index 0 is transparent.
          for (let j = 0; j < palRGB.length; j++) {
              // If palette color is transparent, and source is opaque, skip
              if (palRGB[j].a < 128) continue; 
              
              const pr = palRGB[j].r;
              const pg = palRGB[j].g;
              const pb = palRGB[j].b;
              
              const dist = (r - pr)*(r - pr) + (g - pg)*(g - pg) + (b - pb)*(b - pb);
              if (dist < minDist) {
                  minDist = dist;
                  bestIdx = j;
                  if (dist === 0) break; // Exact match
              }
          }
          indices[i/4] = bestIdx;
      }
      return indices;
  }

  /**
   * Downloads raw pixel data (RGBA) as a PNG
   */
  downloadImageData(imageData: ImageData, filename: string) {
    const canvas = document.createElement('canvas');
    canvas.width = imageData.width;
    canvas.height = imageData.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    ctx.putImageData(imageData, 0, 0);
    
    this.triggerDownload(canvas.toDataURL('image/png'), filename);
  }

  /**
   * Creates a grayscale representation of the raw indices and downloads it.
   */
  downloadRawIndices(indices: Uint8Array, width: number, height: number, filename: string) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    const imgData = ctx.createImageData(width, height);
    const data = imgData.data;
    
    for (let i = 0; i < indices.length; i++) {
        const val = indices[i];
        data[i * 4 + 0] = val;
        data[i * 4 + 1] = val;
        data[i * 4 + 2] = val;
        data[i * 4 + 3] = 255; // Alpha full
    }
    
    ctx.putImageData(imgData, 0, 0);
    this.triggerDownload(canvas.toDataURL('image/png'), filename);
  }

  triggerDownload(url: string, filename: string) {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}
