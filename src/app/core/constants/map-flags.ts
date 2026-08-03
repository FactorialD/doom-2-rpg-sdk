export enum SpriteFlag {
  Wall = 64,         // 1 << 6 (WALL_TEX)
  North = 1 << 8,    // 256
  South = 1 << 9,    // 512
  East = 1 << 10,    // 1024
  West = 1 << 11,    // 2048
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