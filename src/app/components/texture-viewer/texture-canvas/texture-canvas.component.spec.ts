import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TextureCanvasComponent } from './texture-canvas.component';
import { firstClipboardImage, floodFillPixels, isPointerButtonPressed, moveSelectionPixels, paintBrush, rasterizeLine } from '../../../shared/canvas/canvas-interaction';

const canvasSource = readFileSync(new URL('./texture-canvas.component.ts', import.meta.url), 'utf8');

test('rasterizes horizontal, vertical, and diagonal lines inclusively', () => {
  assert.deepEqual(rasterizeLine({ x: 1, y: 2 }, { x: 4, y: 2 }), [
    { x: 1, y: 2 }, { x: 2, y: 2 }, { x: 3, y: 2 }, { x: 4, y: 2 }
  ]);
  assert.deepEqual(rasterizeLine({ x: 3, y: 1 }, { x: 3, y: 4 }), [
    { x: 3, y: 1 }, { x: 3, y: 2 }, { x: 3, y: 3 }, { x: 3, y: 4 }
  ]);
  assert.deepEqual(rasterizeLine({ x: 1, y: 1 }, { x: 4, y: 4 }), [
    { x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }, { x: 4, y: 4 }
  ]);
});

test('rasterizes fast multi-pixel movement without gaps', () => {
  const points = rasterizeLine({ x: 0, y: 0 }, { x: 9, y: 4 });
  assert.equal(points.length, 10);
  for (let index = 1; index < points.length; index++) {
    assert.ok(Math.abs(points[index].x - points[index - 1].x) <= 1);
    assert.ok(Math.abs(points[index].y - points[index - 1].y) <= 1);
  }
});

function drawingHarness(tool: 'pencil' | 'brush') {
  const component = Object.create(TextureCanvasComponent.prototype) as TextureCanvasComponent;
  const canvas = {
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 12, height: 3 }),
    setPointerCapture: () => {}, releasePointerCapture: () => {}, hasPointerCapture: () => true
  };
  Object.assign(component, {
    texture: { id: 1, width: 12, height: 3 }, rawData: new Uint8Array(36),
    canEdit: true, selectedColorIndex: 7, activeTool: tool, brushSize: 1,
    importState: { active: false }, selectionDrag: null,
    dragState: { isDragging: false, mode: 'none' },
    canvasRef: { nativeElement: canvas }, scrollContainerRef: null,
    pixelChanged: { emit: () => {} }, render: () => {}
  });
  const pointer = (type: 'down' | 'move' | 'up', x: number, pointerId = 1) => ({
    pointerId, button: 0, buttons: type === 'up' ? 0 : 1, clientX: x + .1, clientY: 1.1,
    currentTarget: canvas
  } as unknown as PointerEvent);
  return { component, pointer };
}

for (const tool of ['pencil', 'brush'] as const) {
  test(`${tool} strokes interpolate movement and do not join completed strokes`, () => {
    const { component, pointer } = drawingHarness(tool);
    component.startDrawing(pointer('down', 0));
    component.draw(pointer('move', 5));
    component.stopDrawing(pointer('up', 5));
    component.startDrawing(pointer('down', 10, 2));

    for (let x = 0; x <= 5; x++) assert.equal(component.rawData![12 + x], 7);
    for (let x = 6; x < 10; x++) assert.equal(component.rawData![12 + x], 0);
    assert.equal(component.rawData![22], 7);
  });
}

test('clips a moved selection at negative and overflowing destinations', () => {
  const source = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  const moved = moveSelectionPixels(source, 3, 3, { x: 1, y: 1, width: 2, height: 2 }, -1, 1);
  assert.deepEqual([...moved], [1, 2, 3, 6, 0, 0, 9, 0, 0]);
  assert.equal(Object.hasOwn(moved, '-1'), false);
  assert.equal(Object.hasOwn(moved, '9'), false);
});

test('shared pencil, brush, and fill pixel algorithms preserve texture behavior', () => {
  const pixels = Uint8Array.from([0, 0, 2, 0, 2, 2, 0, 0, 2]);
  assert.deepEqual([...paintBrush(pixels, 3, 3, { x: 0, y: 0 }, [7], 1)], [7, 0, 2, 0, 2, 2, 0, 0, 2]);
  assert.deepEqual([...paintBrush(pixels, 3, 3, { x: 0, y: 0 }, [7], 3)], [7, 7, 2, 7, 7, 2, 0, 0, 2]);
  assert.deepEqual([...floodFillPixels(pixels, 3, 3, { x: 0, y: 0 }, [5])], [5, 5, 2, 5, 2, 2, 5, 5, 2]);
});

test('texture canvas retains selection movement and zoom bindings after sharing interactions', () => {
  assert.match(canvasSource, /from '\.\.\/\.\.\/\.\.\/shared\/canvas\/canvas-interaction'/);
  assert.match(canvasSource, /\[style\.width\.px\]="texture\.width \* zoom"/);
  assert.match(canvasSource, /\[style\.height\.px\]="texture\.height \* zoom"/);
  assert.match(canvasSource, /activeTool: DrawingTool = 'pencil'/);
  assert.match(canvasSource, /moveSelectionPixels\(/);
});

test('continues a captured pointer stroke only while its initiating button is held', () => {
  assert.equal(isPointerButtonPressed({ buttons: 1 }, 0), true);
  assert.equal(isPointerButtonPressed({ buttons: 0 }, 0), false);
  assert.equal(isPointerButtonPressed({ buttons: 2 }, 2), false);
});

test('selects the first clipboard image for the shared import pipeline', () => {
  const image = new File(['png'], 'paste.png', { type: 'image/png' });
  const items = [
    { type: 'text/plain', getAsFile: () => null },
    { type: 'image/png', getAsFile: () => image }
  ];
  assert.equal(firstClipboardImage(items), image);
});

test('scaling mode changes rebuild preview immediately and Apply uses its palette indices', () => {
  const originalImageData = globalThis.ImageData;
  const originalDocument = globalThis.document;
  globalThis.ImageData = class {
    data: Uint8ClampedArray;
    constructor(public width: number, public height: number) { this.data = new Uint8ClampedArray(width * height * 4); }
  } as unknown as typeof ImageData;

  const tempContexts: any[] = [];
  globalThis.document = {
    createElement: () => {
      const context = { putImageData: (data: ImageData) => { context.preview = data; }, preview: null as ImageData | null };
      tempContexts.push(context);
      return { width: 0, height: 0, getContext: () => context };
    }
  } as unknown as Document;

  try {
    const modes: string[] = [];
    const component = Object.create(TextureCanvasComponent.prototype) as any;
    const mainContext = {
      globalAlpha: 1, fillStyle: '', strokeStyle: '', lineWidth: 1, imageSmoothingEnabled: true,
      clearRect() {}, putImageData() {}, drawImage() {}, strokeRect() {}, setLineDash() {}, fillRect() {}
    };
    Object.assign(component, {
      texture: { id: 7, width: 2, height: 1 }, rawData: Uint8Array.from([0, 0]),
      paletteRaw: Uint32Array.from([0xff000000, 0xff0000ff, 0xff00ff00]),
      importState: { active: true, img: {}, x: 0, y: 0, width: 2, height: 1, bgOpacity: .5, imgOpacity: .8, scalingMode: 'nearest' },
      canvasRef: { nativeElement: { width: 2, height: 1, getContext: () => mainContext } },
      imgProcessor: {
        scaleImage: (_img: unknown, width: number, height: number, mode: string) => {
          modes.push(mode);
          const result = new ImageData(width, height);
          result.data[0] = mode === 'nearest' ? 1 : 2;
          return result;
        },
        mapImageToPalette: (data: ImageData) => Uint8Array.from([data.data[0], data.data[0]])
      },
      textureService: { isIndex0Transparent: () => false },
      pixelChanged: { emit() {} }, dragState: { isDragging: false }, selection: null
    });

    component.render();
    component.importState.scalingMode = 'bilinear';
    component.render(); // the toolbar's stateChange binding calls render directly
    assert.deepEqual(modes, ['nearest', 'bilinear']);
    const previewPixels = new Uint32Array(tempContexts.at(-1).preview.data.buffer);
    assert.deepEqual([...previewPixels], [component.paletteRaw[2], component.paletteRaw[2]]);

    component.applyImport();
    assert.deepEqual([...component.rawData], [2, 2]);
    assert.equal(modes.at(-1), 'bilinear');
  } finally {
    globalThis.document = originalDocument;
    globalThis.ImageData = originalImageData;
  }
});
