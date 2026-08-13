import test from 'node:test';
import assert from 'node:assert/strict';
import { TextureCanvasComponent } from './texture-canvas.component';
import { firstClipboardImage, isPointerButtonPressed, moveSelectionPixels, rasterizeLine } from './texture-canvas-interaction';

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
