export enum EntityType {
  World = 0,
  Player = 1,
  Monster = 2,
  Npc = 3,
  PlayerClip = 4,
  Door = 5,
  Item = 6,
  Decor = 7,
  EnvDamage = 8,
  Corpse = 9,
  Destroyable = 10, // ET_ATTACK_INTERACTIVE
  MonsterBlock = 11,
  SpriteWall = 12,
  NonObstructingSpriteWall = 13,
  DecorNoClip = 14
}

export const MAX_SAFE_ENTITY_ID = 255; // IDs > 255 are valid but cannot be referenced by scripts easily