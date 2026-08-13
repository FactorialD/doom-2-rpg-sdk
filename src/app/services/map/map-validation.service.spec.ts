import assert from 'node:assert/strict';
import test from 'node:test';
import type { MapData } from '../doom-map.service.ts';
import { PolyFlag } from '../../core/constants/geometry.ts';
import { TextureMappingService } from '../textures/texture-mapping.service.ts';
import { MapValidationService } from './map-validation.service.ts';
import { packPolygonTextureId, unpackPolygonTextureId } from './map-texture-id.ts';

function mappingFixture(): TextureMappingService {
  const mappings = new Int16Array(512);
  // Empty groups are real groups too. Group 301 contains reference frame 7.
  mappings.fill(7);
  mappings[302] = 8;
  mappings.fill(8, 303);
  const texelSizes = new Int16Array(1024);
  texelSizes[7] = 0x8000 | 6;
  const service = Object.create(TextureMappingService.prototype) as TextureMappingService;
  Object.assign(service, { mediaMappings: mappings, mediaTexelSizes: texelSizes });
  return service;
}

function mapWithGroups(groups: number[]): MapData {
  return {
    geometry: { textureIds: groups, flags: groups.map(() => PolyFlag.WallTexture) },
    sprites: []
  } as unknown as MapData;
}

function validator(mapping: TextureMappingService): MapValidationService {
  const service = Object.create(MapValidationService.prototype) as MapValidationService;
  Object.assign(service, { mappings: mapping, coordinates: {} });
  return service;
}

test('group 301 validates at several polygon indices before and after repaint and packed round trip', () => {
  const service = validator(mappingFixture());
  const original = mapWithGroups([301, 301, 301, 301, 301, 301, 301, 301, 301, 301, 301, 301, 301]);
  assert.deepEqual(service.validate(original), []);
  for (const polygonIndex of [3, 8, 12]) original.geometry.textureIds[polygonIndex] = 301;
  assert.deepEqual(service.validate(original), []);

  for (const polygonIndex of [3, 8, 12]) {
    const packed = packPolygonTextureId(original.geometry.textureIds[polygonIndex], original.geometry.flags[polygonIndex]);
    assert.equal(packed.packedId, 44);
    assert.equal(unpackPolygonTextureId(packed.packedId, packed.flags), 301);
  }
  assert.match(service.validate(mapWithGroups([511]))[0], /texture group 511 does not exist/);
});

test('empty mapping groups exist while broken reference chains receive precise errors', () => {
  const mapping = mappingFixture();
  const service = validator(mapping);
  assert.deepEqual(service.validate(mapWithGroups([299])), []);

  mapping.mediaTexelSizes![7] = 0x8000 | 7;
  assert.match(service.validate(mapWithGroups([301]))[0], /cyclic texture reference/);
  mapping.mediaTexelSizes![7] = 0x8000 | 2047;
  assert.match(service.validate(mapWithGroups([301]))[0], /parent 2047 outside the mapping range/);
});
