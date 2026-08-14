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

export const ENTITY_TYPE_NAMES: Readonly<Record<number, string>> = {
  [EntityType.World]: 'World', [EntityType.Player]: 'Player', [EntityType.Monster]: 'Monsters',
  [EntityType.Npc]: 'NPCs', [EntityType.PlayerClip]: 'Player blockers', [EntityType.Door]: 'Doors',
  [EntityType.Item]: 'Items', [EntityType.Decor]: 'Decorations', [EntityType.EnvDamage]: 'Hazards',
  [EntityType.Corpse]: 'Corpses', [EntityType.Destroyable]: 'Destroyables',
  [EntityType.MonsterBlock]: 'Monster blockers', [EntityType.SpriteWall]: 'Sprite walls',
  [EntityType.NonObstructingSpriteWall]: 'Non-obstructing walls', [EntityType.DecorNoClip]: 'Non-blocking decorations'
};

/** Subtypes confirmed by EntityDef usage; unknown values are deliberately rendered as data, not invented names. */
export const ENTITY_SUBTYPE_NAMES: Readonly<Partial<Record<EntityType, Readonly<Record<number, string>>>>> = {
  [EntityType.Item]: { 0: 'Inventory', 1: 'Weapon', 2: 'Ammo', 3: 'Armor' },
  [EntityType.Door]: { 0: 'Door' }, [EntityType.Npc]: { 0: 'Character' },
  [EntityType.Monster]: { 0: 'Monster' }, [EntityType.Decor]: { 0: 'Decoration' }
};

export const MAX_SAFE_ENTITY_ID = 255; // IDs > 255 are valid but cannot be referenced by scripts easily
