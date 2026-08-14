export enum DialogStyle {
    Normal = 0,
    NPC = 1,
    Help = 2,
    Scroll = 3,
    Chest = 4,
    Monster = 5,
    Ghost = 6,
    Yell = 7,
    Player = 8,
    Terminal = 9,
    Elevator = 10,
    Vios = 11,
    SelfDestruct = 12,
    ArmorRepair = 13,
    CommLink = 14,
    Sal = 15,
    Special = 16
}

export enum DialogFlag {
    None = 0,
    YesNo = 1,
    Interrogate = 2,
    Game = 4,
    Vios = 8
}

export const DIALOG_STYLE_OPTIONS = [
  [DialogStyle.Normal, 'Normal'], [DialogStyle.NPC, 'NPC'], [DialogStyle.Help, 'Help'],
  [DialogStyle.Scroll, 'Scroll'], [DialogStyle.Chest, 'Chest'], [DialogStyle.Monster, 'Monster'],
  [DialogStyle.Ghost, 'Ghost'], [DialogStyle.Yell, 'Yell'], [DialogStyle.Player, 'Player'],
  [DialogStyle.Terminal, 'Terminal'], [DialogStyle.Elevator, 'Elevator'], [DialogStyle.Vios, 'Vios'],
  [DialogStyle.SelfDestruct, 'Self destruct'], [DialogStyle.ArmorRepair, 'Armor repair'],
  [DialogStyle.CommLink, 'Comm link'], [DialogStyle.Sal, 'Sal']
] as const;

export const TILE_EVENT_FLAG_OPTIONS = [
  { value: 0xff1, label: 'Enter' }, { value: 0xff2, label: 'Leave' },
  { value: 0xff4, label: 'Use / trigger' }, { value: 0xff8, label: 'Attack' }
] as const;

/**
 * Monster Flag Indices (0-14).
 * Used in EV_MONSTERFLAGOP instruction which takes a bit index (0-63).
 */
export const MONSTER_FLAGS = [
    { id: 0, name: 'ABILITY', desc: 'Can use special ability' },
    { id: 1, name: 'TRIGGER_ON_ACTIVATE', desc: 'Triggers script when activated' },
    { id: 2, name: 'NO_KILL', desc: 'Cannot be killed' },
    { id: 3, name: 'NO_ACTIVATE', desc: 'Cannot be activated' },
    { id: 4, name: 'NO_RESPAWN', desc: 'Will not respawn' },
    { id: 5, name: 'NO_THINK', desc: 'AI Disabled' },
    { id: 6, name: 'NO_RAISE', desc: 'Cannot be resurrected' },
    { id: 7, name: 'NO_TRACK', desc: 'Will not chase player' },
    { id: 8, name: 'WEAPON_ALT', desc: 'Uses alternate attack' },
    { id: 9, name: 'SCALED', desc: 'Sprite is scaled' },
    { id: 10, name: 'ATTACKING', desc: 'Currently attacking' },
    { id: 11, name: 'LOOTED', desc: 'Loot has been dropped' },
    { id: 12, name: 'KNOCKBACK', desc: 'Affected by knockback' },
    { id: 13, name: 'NPC_CHAT', desc: 'Can talk (NPC)' },
    { id: 14, name: 'LERP_SHADOW', desc: 'Shadow interpolation' }
];

export enum ScriptOperation {
    Add = 0,
    Remove = 1,
    Set = 2
}
