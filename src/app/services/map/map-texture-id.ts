import { PolyFlag } from '../../core/constants/geometry';
import { SpriteFlag } from '../../core/constants/map-flags';
import { SpecialTextureIds } from '../../core/constants/texture-groups';

/** Map files store a group in one byte and select the wall bank with a flag. */
export function unpackMapTextureId(packedId: number, wall: boolean): number {
  return packedId + (wall ? SpecialTextureIds.WALL_OFFSET : 0);
}

export function packMapTextureId(groupId: number): { packedId: number; wall: boolean } {
  const wall = groupId >= SpecialTextureIds.WALL_OFFSET;
  return { packedId: wall ? groupId - SpecialTextureIds.WALL_OFFSET : groupId, wall };
}

export function unpackPolygonTextureId(packedId: number, flags: number): number {
  return unpackMapTextureId(packedId, (flags & PolyFlag.WallTexture) !== 0);
}

export function packPolygonTextureId(groupId: number, flags: number): { packedId: number; flags: number } {
  const packed = packMapTextureId(groupId);
  return { ...packed, flags: packed.wall ? flags | PolyFlag.WallTexture : flags & ~PolyFlag.WallTexture };
}

export function unpackSpriteTextureId(packedId: number, flags: number): number {
  return unpackMapTextureId(packedId, (flags & SpriteFlag.Wall) !== 0);
}

export function packSpriteTextureId(groupId: number, flags: number): { packedId: number; flags: number } {
  const packed = packMapTextureId(groupId);
  return { ...packed, flags: packed.wall ? flags | SpriteFlag.Wall : flags & ~SpriteFlag.Wall };
}
