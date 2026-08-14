import assert from 'node:assert/strict';
import test from 'node:test';
import { MapCoordinateService } from './map-coordinate.service.ts';
import type { MapData, MapSprite } from '../doom-map.service.ts';

const service = new MapCoordinateService();
const map = (height: number): MapData => ({ heightMap: new Int8Array(1024), sprites: [], geometry: {} as any, header: {} as any, bspTree: {} as any, remainderOffset: 0 });
const sprite = (y: number, type: 'normal' | 'z'): MapSprite => ({ uuid: 's', x: 64, y, z: 64, textureId: 1, flatIndex: 0, flags: 0, type, extraInfo: 0 });

test('signed floor heights produce the exact normal sprite height', () => {
  for (const stored of [5, -5]) {
    const data = map(stored); data.heightMap[33] = stored;
    const floor = service.getFloorHeight(data, 64, 64);
    const entity = sprite(floor + 32, 'normal');
    assert.equal(entity.y, floor + 32);
    assert.deepEqual(service.analyzeSpriteType(data, entity), { type: 'normal', fileZ: 0 });
  }
});

test('z sprite serializer formula round trips and rejects byte overflow', () => {
  const data = map(-3); data.heightMap[33] = -3;
  const entity = sprite(100, 'z');
  const packed = service.analyzeSpriteType(data, entity);
  assert.equal(packed.fileZ + service.getFloorHeight(data, 64, 64) - 32, entity.y);
  assert.throws(() => service.analyzeSpriteType(data, sprite(1000, 'z')), /unsigned byte/);
});
