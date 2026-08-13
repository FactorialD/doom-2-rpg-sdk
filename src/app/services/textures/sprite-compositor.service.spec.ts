import test from 'node:test';
import assert from 'node:assert/strict';
import { SpriteCompositorService } from './sprite-compositor.service';

const service = new SpriteCompositorService();
const frames = (group: number, frame: number) => service.getCompositeLayers(group, frame).map(layer => layer.frameIndex);

test('composes front and back body parts in game render order', () => {
  assert.deepEqual(frames(23, 0), [0, 2, 3]);
  assert.deepEqual(frames(23, 4), [4, 6, 7]);
});

test('composes both monster attacks with a separately stored head', () => {
  assert.deepEqual(frames(23, 8), [0, 8, 3]);
  assert.deepEqual(frames(23, 10), [0, 10, 3]);
});

test('does not assume attack bodies and heads have the same layout', () => {
  assert.deepEqual(frames(20, 8), [0, 8]); // zombies have no separate attack head
  assert.deepEqual(frames(32, 8), [0, 2, 8]); // pinky retains its torso
  assert.deepEqual(frames(65, 8), [8]); // NPC attack is a full sprite
});
