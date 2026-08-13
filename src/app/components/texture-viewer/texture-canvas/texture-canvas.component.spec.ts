import test from 'node:test';
import assert from 'node:assert/strict';
import { firstClipboardImage, isPointerButtonPressed, moveSelectionPixels } from './texture-canvas-interaction';

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
