/** Declarative description of the ScriptThread bytecode (java/ScriptThread.txt). */
export type ArgumentKind = 'u8' | 's8' | 'u16be' | 's16be' | 'u32be' | 's32be' |
  'eval' | 'lerpSprite' | 'lootList' | 'dropMonsterItem' | 'debugString';

export type ReferenceType = 'instruction-relative' | 'instruction-absolute' | 'tile-event-index' |
  'entity-index' | 'string-index' | 'sound-index' | 'map-index' | 'texture-index' | 'tile-coordinate';

export interface PackedReferenceCodec {
  readonly min: number;
  readonly max: number;
  decode(value: number): number;
  encode(reference: number, previousValue: number): number;
  replaceReference(params: number[], argumentIndex: number, reference: number): number[];
}

export interface ScriptArgumentDescriptor {
  readonly name: string;
  readonly kind: ArgumentKind;
  readonly description?: string;
  readonly min?: number;
  readonly max?: number;
  readonly reference?: ReferenceType;
  readonly packedReference?: PackedReferenceCodec;
}

export interface RelocationDescriptor {
  readonly argumentIndex: number | 'last';
  readonly reference: 'instruction-relative' | 'instruction-absolute' | 'tile-event-index' | 'entity-index';
  readonly relativeTo?: 'instruction-end';
  readonly allowMissingValue?: number;
}

export interface ScriptOpcodeDefinition {
  readonly opcode: number;
  readonly name: string;
  readonly description: string;
  readonly arguments: readonly ScriptArgumentDescriptor[];
  readonly relocations?: readonly RelocationDescriptor[];
  readonly ui?: { readonly category?: string; readonly logic?: boolean; readonly detail?: string };
  readonly status?: 'supported' | 'reserved' | 'unsupported';
}

const packed = (mask: number, shift = 0): PackedReferenceCodec => ({
  min: 0,
  max: mask,
  decode: value => (value >>> shift) & mask,
  encode: (reference, previous) => (previous & ~(mask << shift)) | ((reference & mask) << shift),
  replaceReference: (params, index, reference) => {
    const result = [...params];
    result[index] = (result[index] & ~(mask << shift)) | ((reference & mask) << shift);
    return result;
  }
});

const primitive = (kind: ArgumentKind, name: string, reference?: ReferenceType, packedReference?: PackedReferenceCodec): ScriptArgumentDescriptor =>
  ({ kind, name, reference, packedReference });
const formats: Record<string, readonly ScriptArgumentDescriptor[]> = {
  '': [], u8: [primitive('u8', 'value')], s8: [primitive('s8', 'value')], u16: [primitive('u16be', 'value')],
  s16: [primitive('s16be', 'value')], s32: [primitive('s32be', 'value')], eval: [primitive('eval', 'expression')],
  lerp: [primitive('lerpSprite', 'movement', 'entity-index', packed(0xff, 14))], loot: [primitive('lootList', 'loot')],
  drop: [primitive('dropMonsterItem', 'drop')], debug: [primitive('debugString', 'message')]
};
const a = (...kinds: Array<'u8'|'s8'|'u16'|'s16'|'s32'>) => kinds.map((k, i) => primitive(formats[k][0].kind, `arg${i}`));
const rows: Array<[number,string,string,readonly ScriptArgumentDescriptor[]]> = [
  [0,'EV_EVAL','Condition Check',formats.eval],[1,'EV_JUMP','Jump',[primitive('u16be','relativeTarget','instruction-relative')]],[2,'EV_RETURN','Return',[]],
  [3,'EV_MESSAGE','Show Message',[primitive('u16be','string','string-index')]],[4,'EV_LERPSPRITE','Move Sprite',formats.lerp],
  [5,'EV_STARTCINEMATIC','Cinematic',[primitive('u8','cameraId')]],[6,'EV_SETSTATE','Set Game State',[primitive('u8','stateVariable'),primitive('s16be','value')]],[7,'EV_CALL_FUNC','Call Script',[primitive('u16be','functionTarget','instruction-absolute')]],
  [8,'EV_ITEM_COUNT','Check Item Count',[primitive('u16be','packedItem'),primitive('u8','resultVariable')]],[9,'EV_TILE_EMPTY','Check Tile Empty',[primitive('u16be','tile','tile-coordinate'),primitive('u8','resultVariable')]],[10,'EV_WEAPON_EQUIPPED','Check Weapon',[primitive('u8','resultVariable')]],
  [11,'EV_CHANGE_MAP','Change Map',[primitive('u8','mapAndTransition','map-index',packed(0xf)),primitive('u16be','spawn')]],[12,'EV_CAMERA_STR','Camera String',[primitive('u16be','stringAndFlags','string-index',packed(0x3fff)),primitive('u16be','duration')]],
  [13,'EV_DIALOG','Show Dialog',[primitive('u8','string','string-index'),primitive('u8','styleAndFlags')]],[14,'EV_WAIT','Wait',[primitive('u8','ticks')]],[15,'EV_GOTO','Goto',[primitive('u16be','tile','tile-coordinate')]],
  [16,'EV_ABORT_MOVE','Stop Movement',[]],[17,'EV_ENTITY_FRAME','Set Entity Frame',[primitive('u8','entity','entity-index'),primitive('u8','frame'),primitive('u8','duration')]],[18,'EV_ADV_CAMERAKEY','Camera Keyframe',a('u8')],

  [19,'EV_DAMAGEMONSTER','Damage Monster',[primitive('u8','entity','entity-index'),primitive('s8','damage')]],[20,'EV_DAMAGEPLAYER','Damage Player',a('s8','s8','s8')],
  [21,'EV_DOOROP','Door Operation',[primitive('u16be','entityAndOperation','entity-index',packed(0x3ff))]],[22,'EV_MONSTERFLAGOP','Monster Flags',[primitive('u8','entity','entity-index'),primitive('u8','operation')]],
  [23,'EV_EVENTOP','Modify Event',[primitive('u16be','eventAndOperation','tile-event-index',packed(0x7fff))]],[24,'EV_HIDE','Hide/Show Entity',[primitive('u8','entity','entity-index')]],
  [25,'EV_DROPITEM','Spawn/Drop Item',[primitive('u16be','tileAndAmount','tile-coordinate',packed(0x3ff)),primitive('u8','entityDefinition','texture-index')]],[26,'EV_PREVSTATE','Dec State Var',a('u8')],[27,'EV_NEXTSTATE','Inc State Var',a('u8')],
  [28,'EV_WAKEMONSTER','Wake Monster',[primitive('u8','entity','entity-index')]],[29,'EV_SHOW_PLAYERATTACK','Show Weapon Anim',[primitive('u8','weapon')]], [30,'EV_MONSTER_PARTICLES','Bleed Effect',[primitive('u8','entity','entity-index')]],
  [31,'EV_SPAWN_PARTICLES','Spawn Particles',[primitive('u8','particleType'),primitive('u16be','tile','tile-coordinate'),primitive('u8','color')]],[32,'EV_FADEOP','Screen Fade',a('u16')],[33,'EV_GIVEITEM','Give Player Item',a('u8','u8','s8')],
  [34,'EV_NAMEENTITY','Rename Entity',[primitive('u8','entity','entity-index'),primitive('u8','string','string-index')]],[35,'EV_DROPMONSTERITEM','Drop Loot',formats.drop],
  [36,'EV_SETDEATHFUNC','OnDeath Trigger',[primitive('u8','entity','entity-index'),primitive('s16be','function','instruction-absolute')]],
  [37,'EV_PLAYSOUND','Play Sound',[primitive('u8','sound','sound-index'),primitive('u8','volume')]],[38,'EV_NPCCHAT','NPC Chat Bubble',[primitive('u16be','entityState','entity-index',packed(0x3fff))]],
  [39,'EV_STOCKSTATION','Restock Vending',[]],[40,'EV_LERPFLAT','Move Flat',a('u8','u16')],[41,'EV_GIVELOOT','Loot Screen',formats.loot],
  [42,'EV_MARKTILE','Mark AutoMap',[primitive('u16be','tileAndFlags','tile-coordinate',packed(0x3ff))]],[43,'EV_UPDATEJOURNAL','Update Quest',a('u8','u8')],[44,'EV_BRIBE_ENTITY','Bribe',[]],
  [45,'EV_PLAYER_ADD_STAT','Buff Player',a('u8')],[46,'EV_PLAYER_ADD_RECIPE','Add Recipe',a('u16')],[47,'EV_RESPAWN_MONSTER','Respawn',[primitive('u16be','entity','entity-index'),primitive('u8','tileX'),primitive('u8','tileY')]],
  [48,'EV_SCREEN_SHAKE','Shake Screen',a('u16')],[49,'EV_SPEECHBUBBLE','Show Bubble',[primitive('u16be','string','string-index'),primitive('u8','color')]],
  [50,'EV_AWARDSECRET','Secret Found',[]],[51,'EV_AIGOAL','Set AI Goal',[primitive('u16be','entityGoal','entity-index',packed(0xfff)),primitive('u8','goal')]],
  [52,'EV_ADVANCETURN','Next Turn',[]],[53,'EV_MINIGAME','Start Minigame',a('s8','s8','s8','s8')],[54,'EV_ENDMINIGAME','End Minigame',[]],[55,'EV_ENDROUND','End Round',[]],
  [56,'EV_PLAYERATTACK','Force Attack',a('u16')],[57,'EV_SET_FOG_COLOR','Set Fog',a('s32')],[58,'EV_LERP_FOG','Lerp Fog',a('s32')],
  [59,'EV_LERPSPRITEOFFSET','Lerp Offset',[primitive('u8','entity','entity-index'),...a('u8','s32')]], [60,'EV_DISABLED_WEAPONS','Disable Weapons',a('s16')],
  [61,'EV_LERPSCALE','Scale Sprite',[primitive('u16be','entityScale','entity-index',packed(0xfff,4)),...a('u16','u8')]], [62,'EV_GIVEAWARD','Award',[]],
  [65,'EV_STARTMIXING','Mix Items',[]],[66,'EV_DEBUGPRINT','Debug Log',formats.debug],[67,'EV_GOTO_MENU','Open Menu',a('u8')],[68,'EV_START_INTERCINEMATIC','Cinematic',a('u8')],
  [69,'EV_TURN_PLAYER','Turn Player',a('u8')],[70,'EV_STATUS_EFFECT','Status Effect',a('u8','u8')],[71,'EV_JOURNAL_TILE','Quest Tile',a('u8','u8','u8')],
  [72,'EV_MAKE_CORPSE','Create Corpse',[primitive('u16be','entity','entity-index'),primitive('u8','tileX'),primitive('u8','tileY')]],[73,'EV_INVENTORY_OP','Mod Inventory',a('u8')],[74,'EV_END_GAME','Game Over',[]],
  [75,'EV_LERPSPRITEPARABOLA','Jump Sprite',[primitive('s32be','packedEntity','entity-index',packed(0x3ff,22)),primitive('u16be','duration')]],
  [76,'EV_TOGGLE_OVERLAY','Toggle UI',[]],[77,'EV_FOG_AFFECTS_SKYMAP','Fog Sky',a('u8')],[78,'EV_ENABLE_HELP','Enable Help',a('u8')],[79,'EV_SET_MM_RENDER_HACK','Boss Hack',a('u8')],
  [80,'EV_START_ARMORREPAIR','Repair Armor',[]],[81,'EV_FORCE_BOT_RETURN','Recall Bot',[]],[82,'EV_UNMARKTILE','Unmark Map',[primitive('u16be','tileAndFlags','tile-coordinate',packed(0x3ff))]],
  [83,'EV_ASSIGN_LOOTSET','Assign Loot',[primitive('u16be','entity','entity-index',packed(0x3fff)),...formats.loot]],[84,'EV_START_TARGETPRACTICE','Target Practice',a('u16')],
  [85,'EV_GIVE_AUTOMAP','Give Map',[]],[86,'EV_ANGER_VIOS','Anger Boss',a('u8')],[87,'EV_UNHIDE_AUTOMAP','Reveal Map',a('u8','u8','u8','u8')],
  [88,'EV_HIDE_AUTOMAP','Hide Map',a('u8','u8','u8','u8')],[89,'EV_PORTAL_EVENT','Portal FX',a('u8')],[90,'EV_PITCH_CONTROL','Set Pitch',a('u16')],
  [91,'EV_USED_CHAINSAW','Chainsaw Event',[]],[92,'EV_ENTITY_BREATHES','Breathing',[primitive('u8','entity','entity-index'),primitive('u8','enabled')]],
  [93,'EV_DESTROY_PLAYER','Kill Player',a('s8')],[94,'EV_START_TREADMILL','Treadmill',[]],
  [95,'EV_LERPSPRITEPARABOLA_SCALE','Jump Scale',[primitive('s32be','packedEntity','entity-index',packed(0x3ff,22)),primitive('u16be','duration'),primitive('u8','scale')]],
  [96,'EV_SET_CALDEX_RENDER_HACK','Render Hack',a('u8')]
];

const relocationByOpcode: Record<number, readonly RelocationDescriptor[]> = {
  0: [{ argumentIndex: 'last', reference: 'instruction-relative', relativeTo: 'instruction-end' }],
  1: [{ argumentIndex: 0, reference: 'instruction-relative', relativeTo: 'instruction-end' }],
  7: [{ argumentIndex: 0, reference: 'instruction-absolute' }],
  23: [{ argumentIndex: 0, reference: 'tile-event-index' }],
  36: [{ argumentIndex: 1, reference: 'instruction-absolute', allowMissingValue: -1 }]
};

export const SCRIPT_OPCODE_SCHEMA: Readonly<Record<number, ScriptOpcodeDefinition>> = Object.freeze(Object.fromEntries([
  ...rows.map(([opcode,name,description,args]) => [opcode, { opcode,name,description,arguments: args, relocations: relocationByOpcode[opcode], ui: { logic: !!relocationByOpcode[opcode] }, status: 'supported' as const }]),
  [63, { opcode: 63, name: 'EV_RESERVED_63', description: 'Reserved Java opcode', arguments: [], status: 'reserved' as const }],
  [64, { opcode: 64, name: 'EV_RESERVED_64', description: 'Reserved Java opcode', arguments: [], status: 'reserved' as const }]
]));

export function assertScriptOpcodeSchema(): void {
  const seen = new Set<number>();
  for (let opcode = 0; opcode <= 96; opcode++) {
    const definition = SCRIPT_OPCODE_SCHEMA[opcode];
    if (!definition) throw new Error(`Script opcode ${opcode} is neither supported nor reserved`);
    if (definition.opcode !== opcode || seen.has(opcode)) throw new Error(`Invalid/duplicate script opcode ${opcode}`);
    seen.add(opcode);
    for (const argument of definition.arguments) if (!argument.kind) throw new Error(`${definition.name}: argument without codec`);
    for (const relocation of definition.relocations ?? []) {
      if (relocation.argumentIndex !== 'last' && relocation.argumentIndex >= definition.arguments.length) throw new Error(`${definition.name}: invalid relocation argument`);
    }
  }
}
assertScriptOpcodeSchema();
