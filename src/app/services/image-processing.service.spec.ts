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
