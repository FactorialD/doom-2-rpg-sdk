import { Injectable, inject } from '@angular/core';
import { MapData } from '../doom-map.service';
import { SpriteFlag } from '../../core/constants/map-flags';
import { MAX_SAFE_ENTITY_ID } from '../../core/constants/entity-types';
import { MapCoordinateService } from './map-coordinate.service';
import { TextureMappingService } from '../textures/texture-mapping.service';
import { packMapTextureId } from './map-texture-id';

@Injectable({ providedIn: 'root' })
export class MapValidationService {
  private mappings = inject(TextureMappingService);
  private coordinates = inject(MapCoordinateService);

  validate(data: MapData): string[] {
    const errors: string[] = [];
    data.geometry.textureIds.forEach((id, i) => {
      this.validateTextureGroup(errors, `Polygon ${i}`, id);
    });
    data.sprites.forEach((s, i) => {
      this.validateTextureGroup(errors, `Entity ${i}`, s.textureId);
      if (!Number.isInteger(s.flags) || s.flags < 0 || s.flags > 0xffff) errors.push(`Entity ${i}: flags must fit uint16.`);
      const directions = [SpriteFlag.North, SpriteFlag.South, SpriteFlag.East, SpriteFlag.West].filter(f => (s.flags & f) !== 0).length;
      if (directions > 1 || ((s.flags & SpriteFlag.Flat) !== 0 && (s.flags & SpriteFlag.Wall) !== 0)) errors.push(`Entity ${i}: incompatible sprite orientation flags.`);
      if (![s.x, s.z].every(v => Number.isInteger(v) && v >= 0 && v <= 2040 && v % 8 === 0)) errors.push(`Entity ${i}: X/depth must be multiples of 8 in 0…2040.`);
      const floor = this.coordinates.getFloorHeight(data, s.x, s.z);
      const packedHeight = s.y - floor + 32;
      if (!Number.isInteger(s.y) || (s.type === 'z' && (packedHeight < 0 || packedHeight > 255))) errors.push(`Entity ${i}: height is outside the storable range for this tile.`);
      if (!Number.isInteger(s.extraInfo) || s.extraInfo < 0 || s.extraInfo > 255) errors.push(`Entity ${i}: extra data must fit uint8.`);
    });
    const unsafeReferences = data.scripts?.instructions.filter(i => i.referencedEntityId !== undefined && i.referencedEntityId > MAX_SAFE_ENTITY_ID) ?? [];
    if (unsafeReferences.length) errors.push(`Script opcodes reference ${unsafeReferences.length} entity ID(s) above ${MAX_SAFE_ENTITY_ID}; those operands only store one byte.`);
    return [...new Set(errors)];
  }

  private validateTextureGroup(errors: string[], owner: string, groupId: number): void {
    const packed = packMapTextureId(groupId).packedId;
    if (!Number.isInteger(packed) || packed < 0 || packed > 255) {
      errors.push(`${owner}: texture group ${groupId} does not fit the map uint8 field.`);
      return;
    }
    if (!this.mappings.getGroupRange(groupId)) {
      errors.push(`${owner}: texture group ${groupId} does not exist.`);
      return;
    }
    const referenceError = this.mappings.validateGroupReferences(groupId);
    if (referenceError) errors.push(`${owner}: texture group ${groupId} ${referenceError}.`);
  }
}
