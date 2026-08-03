
export type TextureCategory = 'UI' | 'Sprites' | 'Walls' | 'Flats' | 'Editor' | 'Unknown';

export interface TextureInfo {
  id: number;          // The flat index (0-1023)
  groupId: number;     // The logical game ID
  width: number;       // Power-of-two width
  height: number;      // Power-of-two height
  valid: boolean;
  isReference: boolean;
  parentId?: number;
  fileIndex: number;
  fileOffset: number;
  dataLength: number;
  category: TextureCategory;
  bounds?: { minX: number, maxX: number, minY: number, maxY: number };
}
