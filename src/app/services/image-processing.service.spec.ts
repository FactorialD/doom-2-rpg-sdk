import test from 'node:test';
import assert from 'node:assert/strict';
import { ImageProcessingService } from './image-processing.service';

class TestImageData {
  data: Uint8ClampedArray;
  constructor(public width: number, public height: number, data?: Uint8ClampedArray) {
    this.data = data ?? new Uint8ClampedArray(width * height * 4);
  }
}

test('scales to the requested dimensions and distinguishes nearest from smoothed filters', () => {
  const originalDocument = globalThis.document;
  const originalImageData = globalThis.ImageData;
  const source = new TestImageData(2, 1, Uint8ClampedArray.from([0, 0, 0, 255, 255, 255, 255, 255]));
  globalThis.ImageData = TestImageData as unknown as typeof ImageData;
  globalThis.document = {
    createElement: () => {
      const canvas: { width: number; height: number; getContext: () => unknown } = { width: 0, height: 0, getContext: () => context };
      const context = {
        imageSmoothingEnabled: true, imageSmoothingQuality: 'low',
        drawImage: (input: TestImageData) => { (canvas as any).source = input; },
        getImageData: () => {
          const result = new TestImageData(canvas.width, canvas.height);
          for (let x = 0; x < canvas.width; x++) {
            const value = context.imageSmoothingEnabled
              ? Math.round(255 * x / Math.max(1, canvas.width - 1))
              : source.data[(Math.floor(x * source.width / canvas.width) * 4)];
            result.data.set([value, value, value, 255], x * 4);
          }
          return result;
        }
      };
      return canvas;
    }
  } as unknown as Document;

  try {
    const service = new ImageProcessingService();
    const nearest = service.scaleImage(source as unknown as CanvasImageSource, 3, 1, 'nearest');
    const bilinear = service.scaleImage(source as unknown as CanvasImageSource, 3, 1, 'bilinear');
    const high = service.scaleImage(source as unknown as CanvasImageSource, 3, 1, 'high-quality');
    assert.deepEqual([nearest.width, nearest.height], [3, 1]);
    assert.equal(nearest.data[4], 0);
    assert.equal(bilinear.data[4], 128);
    assert.equal(high.data[4], 128);
  } finally {
    globalThis.document = originalDocument;
    globalThis.ImageData = originalImageData;
  }
});

test('normalizes invalid and excessive scaling dimensions before creating a canvas', () => {
  const service = new ImageProcessingService();
  assert.equal(service.normalizeScaleDimension(0), 1);
  assert.equal(service.normalizeScaleDimension(-20), 1);
  assert.equal(service.normalizeScaleDimension(Number.NaN), 1);
  assert.equal(service.normalizeScaleDimension(Number.POSITIVE_INFINITY), 1);
  assert.equal(service.normalizeScaleDimension(12.6), 13);
  assert.equal(service.normalizeScaleDimension(1_000_000), ImageProcessingService.MAX_SCALE_DIMENSION);
});

import { compositeRgba, quantizeRgba, resizeCanvas } from './image-processing.service';

test('composites semi-transparent RGBA with straight alpha', () => {
  assert.deepEqual(compositeRgba([0, 0, 255, 255], [255, 0, 0, 128], 0.5), [64, 0, 191, 255]);
  assert.deepEqual(compositeRgba([10, 20, 30, 0], [200, 100, 50, 0], 1), [0, 0, 0, 0]);
});

test('quantizes an opacity-composited indexed import including palette alpha', () => {
  const palette = Uint8Array.from([0, 0, 255, 128, 0, 191]);
  const transparency = Uint8Array.from([255, 255]);
  const composited = compositeRgba([0, 0, 255, 255], [255, 0, 0, 128], 0.5);
  assert.deepEqual([...quantizeRgba(composited, palette, transparency)], [1]);
});

test('resizes canvas at every supported anchor and preserves pixels', () => {
  const pixels = Uint8Array.from([1, 2, 3, 4]);
  assert.deepEqual([...resizeCanvas(pixels, 2, 2, 4, 4, 1, 'top-left')].slice(0, 6), [1, 2, 0, 0, 3, 4]);
  const center = resizeCanvas(pixels, 2, 2, 4, 4, 1, 'center');
  assert.deepEqual([center[5], center[6], center[9], center[10]], [1, 2, 3, 4]);
  const bottom = resizeCanvas(pixels, 2, 2, 4, 4, 1, 'bottom-right');
  assert.deepEqual([...bottom.slice(10)], [1, 2, 0, 0, 3, 4]);
});
