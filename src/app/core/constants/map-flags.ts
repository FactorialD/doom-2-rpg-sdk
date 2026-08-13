export enum SpriteFlag {
  Wall = 64,         // 1 << 6 (WALL_TEX)
  // Independent bits in the uint16 stored in the map. Render shifts that
  // complete field into mapSpriteInfo[31:16] and tests these bits in priority
  // order; it does not validate them as a mutually exclusive direction enum.
  OrientationNorthBit = 1 << 8, // mapSpriteInfo bit 24 after loading
  OrientationSouthBit = 1 << 9, // mapSpriteInfo bit 25 after loading
  OrientationEastBit = 1 << 10, // mapSpriteInfo bit 26 after loading
  OrientationWestBit = 1 << 11, // mapSpriteInfo bit 27 after loading
  Flat = 1 << 13,    // 8192 (Oriented flat)
  
  // Context-dependent flags
  NpcChat = 8192,     // Same bit as Flat, used for NPC Interaction
  
  // Flags for Wall Textures in MapData
  WallTextureOffset = 32 // POLY_FLAG_WALL_TEXTURE
}

export enum MapFlag {
  Wall = 1,
  Secret = 2,
  SecretDoor = 4,
  NoAutomap = 8,
  DeployBotClip = 16,
  DiscardBotClip = 32,
  Events = 64,
  Visited = 128
}
