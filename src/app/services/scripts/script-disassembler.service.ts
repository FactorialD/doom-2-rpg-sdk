import { Injectable, inject } from '@angular/core';
import { DoomEntitiesService } from '../doom-entities.service';
import { DoomTextService } from '../doom-text.service';
import { ByteStream } from '../../utils/byte-stream';
import { SCRIPT_OPCODE_SCHEMA } from './script-opcode-schema';
import { decodeInstruction } from './script-instruction-codec';
import { ScriptInstruction } from './script-types';
import { ScriptUtils } from './script-utils';
import { getVariableName } from '../doom-variables';
import { MONSTER_FLAGS, ScriptOperation, DialogStyle } from '../../core/constants/scripting';

@Injectable({ providedIn: 'root' })
export class ScriptDisassemblerService {
  private entityService = inject(DoomEntitiesService);
  private textService = inject(DoomTextService);
  private readonly MONSTER_FLAG_NAMES = MONSTER_FLAGS.reduce((acc, f) => { acc[f.id]=f.name; return acc; }, {} as {[key:number]:string});
  private readonly DIALOG_STYLE_NAMES: {[key:number]:string} = {
    [DialogStyle.Normal]:'Normal',[DialogStyle.NPC]:'NPC',[DialogStyle.Help]:'Help',[DialogStyle.Scroll]:'Scroll',[DialogStyle.Chest]:'Chest',
    [DialogStyle.Monster]:'Monster',[DialogStyle.Ghost]:'Ghost',[DialogStyle.Yell]:'Yell',[DialogStyle.Player]:'Player',[DialogStyle.Terminal]:'Terminal',
    [DialogStyle.Elevator]:'Elevator',[DialogStyle.Vios]:'Vios',[DialogStyle.SelfDestruct]:'Self Destruct',[DialogStyle.ArmorRepair]:'Armor Repair',
    [DialogStyle.CommLink]:'Comm Link',[DialogStyle.Sal]:'Sal',[DialogStyle.Special]:'Special'
  };

  disassemble(code: Uint8Array, mapId: number): ScriptInstruction[] {
    const instructions: ScriptInstruction[]=[];
    const stream=new ByteStream(new Uint8Array(code).buffer,false);
    const offsetToUid=new Map<number,string>();
    const mapStringChunkId=4+(mapId-1);
    while(stream.position<code.length) {
      const offset=stream.position;
      const decoded=decodeInstruction(stream,{offset});
      const definition=SCRIPT_OPCODE_SCHEMA[decoded.opcode];
      const uid=ScriptUtils.generateUUID(); offsetToUid.set(offset,uid);
      const formattedArgs=decoded.params.join(' ');
      const inst: ScriptInstruction={uid,offset,opcode:decoded.opcode,name:definition.name,params:decoded.params,formattedArgs,isJump:false,size:decoded.size,
        originalBytes:Array.from(code.subarray(offset,stream.position)),readableName:definition.name,readableDetails:formattedArgs,
        description:definition.description,isLogic:definition.ui?.logic??false};
      this.enrichInstruction(inst,mapStringChunkId); instructions.push(inst);
    }
    for(const inst of instructions) {
      for(const relocation of SCRIPT_OPCODE_SCHEMA[inst.opcode].relocations??[]) {
        if(relocation.reference!=='instruction-relative'&&relocation.reference!=='instruction-absolute') continue;
        const index=relocation.argumentIndex==='last'?inst.params.length-1:relocation.argumentIndex;
        const value=inst.params[index]; if(value===relocation.allowMissingValue) continue;
        const target=relocation.reference==='instruction-relative'?inst.offset+inst.size+value:value;
        inst.jumpTarget=target; inst.jumpTargetUid=offsetToUid.get(target); inst.isJump=true;
      }
    }
    return instructions;
  }

  private enrichInstruction(inst: ScriptInstruction, mapStringChunkId: number) {
      const p = inst.params;
      if (!p) return;

      switch (inst.opcode) {
          case 3: // EV_MESSAGE (String ID)
             if (p.length > 0) {
                 inst.referencedStringId = p[0] & 0x7FFF;
                 inst.referencedChunkId = mapStringChunkId;
                 const msgText = this.textService.getStringValue(mapStringChunkId, inst.referencedStringId);
                 inst.readableDetails = `"${msgText}"`;
             }
             break;
             
          case 4: // EV_LERPSPRITE
             if (p.length >= 3) {
                 const b1 = p[0];
                 const b2 = p[1];
                 const b3 = p[2];
                 const combined = b1 | (b2 << 8) | (b3 << 16);
                 const entId = (combined >> 14) & 255;
                 
                 if (entId !== 255) {
                     inst.referencedEntityId = entId;
                     inst.entityArgIndex = 0; // Special packing
                 }
                 inst.readableDetails = `Lerp Sprite #${entId === 255 ? 'SELF' : entId}`;
             }
             break;

          case 6: // EV_SETSTATE
             if (p.length >= 2) inst.readableDetails = `${getVariableName(p[0])} = ${p[1]}`;
             break;
          
          case 7: // EV_CALL_FUNC (Handled in Pass 2, placeholder here)
             if (p.length > 0) inst.readableDetails = `Call Func at 0x${p[0].toString(16).toUpperCase()}`;
             break;

          case 11: // EV_CHANGE_MAP
             if (p.length >= 2) inst.readableDetails = `Load Map ${ (p[0] & 0xF) + 1 } (Spawn: ${p[1]})`;
             break;

          case 12: // EV_CAMERA_STR
             if (p.length >= 2) {
                 inst.referencedChunkId = mapStringChunkId;
                 inst.referencedStringId = p[0] & 0x3fff;
                 const camText = this.textService.getStringValue(mapStringChunkId, inst.referencedStringId);
                 inst.readableDetails = `"${camText}"`;
             }
             break;

          case 13: // EV_DIALOG
             if (p.length >= 2) {
                 inst.referencedStringId = p[0];
                 inst.referencedChunkId = mapStringChunkId;
                 const diagText = this.textService.getStringValue(mapStringChunkId, p[0]);
                 const packed = p[1];
                 const style = packed & 15;
                 const flags = packed >> 4;
                 const styleName = this.DIALOG_STYLE_NAMES[style] || style;
                 inst.readableDetails = `Dialog: "${diagText}" (Style: ${styleName}, Flags: ${flags})`;
             }
             break;
             
          case 15: // EV_GOTO (Map Tile)
             if (p.length > 0) inst.readableDetails = `Goto Map Tile (${p[0] >> 5 & 31}, ${p[0] & 31})`;
             break;

          case 19: // EV_DAMAGEMONSTER
             if (p.length >= 2) {
                 if (p[0] !== 255) {
                     inst.referencedEntityId = p[0];
                     inst.entityArgIndex = 0;
                 }
                 inst.readableDetails = `Damage Monster #${p[0] === 255 ? 'SELF' : p[0]} by ${p[1]}`;
             }
             break;

          case 22: // EV_MONSTERFLAGOP
             if (p.length >= 2) {
                 const entityId = p[0];
                 const packed = p[1];
                 const op = (packed >> 6) & 3; 
                 const flagIdx = packed & 63;
                 
                 let opName = 'UNKNOWN';
                 if (op === ScriptOperation.Add) opName = 'ADD';
                 if (op === ScriptOperation.Remove) opName = 'REMOVE';
                 if (op === ScriptOperation.Set) opName = 'SET';
                 
                 const flagName = this.MONSTER_FLAG_NAMES[flagIdx] || `FLAG_${flagIdx}`;
                 
                 if (entityId !== 255) {
                     inst.referencedEntityId = entityId;
                     inst.entityArgIndex = 0;
                 }
                 inst.readableDetails = `Monster #${entityId === 255 ? 'SELF' : entityId}: ${opName} Flag ${flagName} (Bit ${flagIdx})`;
             }
             break;

          case 24: // EV_HIDE
             if (p.length > 0) {
                 if (p[0] !== 255) {
                     inst.referencedEntityId = p[0];
                     inst.entityArgIndex = 0;
                 }
                 inst.readableDetails = `Hide/Show Entity #${p[0] === 255 ? 'SELF' : p[0]}`;
             }
             break;

          case 32: // EV_CHANGETEXTURE
             if (p.length >= 2) {
                 if (p[0] !== 255) {
                     inst.referencedEntityId = p[0];
                     inst.entityArgIndex = 0;
                 }
                 inst.readableDetails = `Change Texture Ent #${p[0] === 255 ? 'SELF' : p[0]} to ${p[1]}`;
             }
             break;

          case 33: // EV_GIVEITEM
             if (p.length >= 3) {
                 const itemDef = this.entityService.findItemDef(p[0], p[1]);
                 if (itemDef) {
                     const name = this.textService.getStringValue(1, itemDef.nameId);
                     inst.readableDetails = `Give ${name} x${p[2]}`;
                     inst.iconId = this.entityService.getDefByTileIndex(itemDef.tileIndex)?.tileIndex; 
                 } else {
                     inst.readableDetails = `Give Item(T:${p[0]}, ID:${p[1]}) x${p[2]}`;
                 }
             }
             break;

          case 34: // EV_NAMEENTITY
             if (p.length >= 2) {
                 if (p[0] !== 255) {
                     inst.referencedEntityId = p[0];
                     inst.entityArgIndex = 0;
                 }
                 inst.referencedStringId = p[1];
                 inst.referencedChunkId = mapStringChunkId;
                 const entName = this.textService.getStringValue(mapStringChunkId, p[1]);
                 inst.readableDetails = `Rename Ent #${p[0] === 255 ? 'SELF' : p[0]} to "${entName}"`;
             }
             break;

          case 36: // EV_SETDEATHFUNC
             if (p.length >= 2) {
                 if (p[0] !== 255) {
                     inst.referencedEntityId = p[0];
                     inst.entityArgIndex = 0;
                 }
                 // jumpTarget is handled in Pass 1
             }
             break;

          case 37: // EV_PLAYSOUND
             if (p.length >= 2) {
                 inst.soundId = p[0];
                 inst.readableDetails = `Play Sound #${p[0]} (Vol: ${p[1]})`;
             }
             break;
          
          case 38: // EV_NPCCHAT
             if (p.length >= 1) {
                 const val = p[0]; // u16
                 const state = (val >> 14) & 3;
                 const entId = val & 16383;
                 
                 inst.referencedEntityId = entId;
                 inst.entityArgIndex = 0; // Note: packed value, needs special handling on relink
                 inst.readableDetails = `Set NPC #${entId} Chat State to ${state}`;
             }
             break;

          case 42: // EV_MARKTILE
             if (p.length > 0) inst.readableDetails = `Mark Tile (${p[0] >> 5 & 31}, ${p[0] & 31}) on Automap`;
             break;

          case 49: // EV_SPEECHBUBBLE
             if (p.length >= 2) {
                 inst.referencedStringId = p[0];
                 inst.referencedChunkId = mapStringChunkId;
                 const bubbleText = this.textService.getStringValue(mapStringChunkId, p[0]);
                 inst.readableDetails = `Bubble: "${bubbleText}" (Color: ${p[1]})`;
             }
             break;

          case 51: // EV_AIGOAL
             if (p.length >= 2) {
                 const entId = p[0] & 4095;
                 if (entId !== 4095) {
                     inst.referencedEntityId = entId;
                     inst.entityArgIndex = 0;
                 }
                 inst.readableDetails = `Set AI Goal Ent #${entId === 4095 ? 'SELF' : entId} to ${p[1]}`;
             }
             break;

          case 59: // EV_LERPSPRITEOFFSET
             if (p.length >= 3) {
                 if (p[0] !== 255) {
                     inst.referencedEntityId = p[0];
                     inst.entityArgIndex = 0;
                 }
                 inst.readableDetails = `Lerp Offset Ent #${p[0] === 255 ? 'SELF' : p[0]} over ${p[1]*100}ms`;
             }
             break;

          case 61: // EV_LERPSCALE
             if (p.length >= 3) {
                 const entId = p[0] >> 4;
                 if (entId !== 255) {
                     inst.referencedEntityId = entId;
                     inst.entityArgIndex = 0;
                 }
                 inst.readableDetails = `Scale Ent #${entId === 255 ? 'SELF' : entId} over ${p[1]}ms`;
             }
             break;
             
          case 66: // EV_DEBUGPRINT
             if (p.length > 0) {
                 if (p[0] === 0) {
                     const str = String.fromCharCode(...p.slice(1, -1));
                     inst.readableDetails = `Print: "${str}"`;
                 } else {
                     if (p.length > 1) inst.readableDetails = `Print Var ${getVariableName(p[1])}`;
                 }
             }
             break;
             
          case 79: // EV_SET_MM_RENDER_HACK
          case 96: // EV_SET_CALDEX_RENDER_HACK
          case 98: // EV_SET_CYBER_RENDER_HACK
          case 104: // EV_CLEAR_RENDER_HACK
             if (p.length >= 1) {
                 inst.readableDetails = `${inst.opcode === 104 ? 'Clear' : 'Set'} Render Hack (Enabled: ${p[0] !== 0})`;
             }
             break;

          case 97: // EV_FACEDIR
          case 103: // EV_SET_ENTITY_DIR
          case 115: // EV_SET_ENTITY_DIR_2
          case 123: // EV_SET_ENTITY_DIR_3
          case 127: // EV_SET_ENTITY_DIR_4
             if (p.length >= 2) {
                 if (p[0] !== 255) {
                     inst.referencedEntityId = p[0];
                     inst.entityArgIndex = 0;
                 }
                 inst.readableDetails = `Face Dir Ent #${p[0] === 255 ? 'SELF' : p[0]} to ${p[1]}`;
             }
             break;

          case 100: // EV_SET_ENTITY_STATE
          case 101: // EV_SET_ENTITY_TYPE
          case 102: // EV_SET_ENTITY_Z
          case 105: // EV_SET_ENTITY_INFO
             if (p.length >= 2) {
                 if (p[0] !== 255) {
                     inst.referencedEntityId = p[0];
                     inst.entityArgIndex = 0;
                 }
                 const prop = inst.opcode === 100 ? 'State' : inst.opcode === 101 ? 'Type' : inst.opcode === 102 ? 'Z' : 'Info';
                 inst.readableDetails = `Set ${prop} Ent #${p[0] === 255 ? 'SELF' : p[0]} to ${p[1]}`;
             }
             break;

          case 106: // EV_PLAY_ANIMATION
          case 122: // EV_PLAY_ANIMATION_2
          case 126: // EV_PLAY_ANIMATION_3
             if (p.length >= 3) {
                 if (p[0] !== 255) {
                     inst.referencedEntityId = p[0];
                     inst.entityArgIndex = 0;
                 }
                 inst.readableDetails = `Play Anim Ent #${p[0] === 255 ? 'SELF' : p[0]} anim ${p[1]} frames ${p[2]}`;
             }
             break;

          case 107: // EV_SET_ENTITY_POS
          case 108: // EV_SET_ENTITY_POS_Z
             if (p.length >= 3) {
                 if (p[0] !== 255) {
                     inst.referencedEntityId = p[0];
                     inst.entityArgIndex = 0;
                 }
                 inst.readableDetails = `Set Pos Ent #${p[0] === 255 ? 'SELF' : p[0]} to (${p[1]}, ${p[2]}${inst.opcode === 108 ? `, ${p[3]}` : ''})`;
             }
             break;

          case 112: // EV_FLUSHSOUNDS
             if (p.length >= 1) {
                 if (p[0] !== 255) {
                     inst.referencedEntityId = p[0];
                     inst.entityArgIndex = 0;
                 }
                 inst.readableDetails = `Flush Sounds Ent #${p[0] === 255 ? 'SELF' : p[0]}`;
             }
             break;

          case 113: // EV_PLAYSOUND_ENT
             if (p.length >= 2) {
                 if (p[0] !== 255) {
                     inst.referencedEntityId = p[0];
                     inst.entityArgIndex = 0;
                 }
                 inst.readableDetails = `Play Sound ${p[1]} on Ent #${p[0] === 255 ? 'SELF' : p[0]}`;
             }
             break;

          case 114: // EV_SET_ENTITY_FLAGS
             if (p.length >= 2) {
                 if (p[0] !== 255) {
                     inst.referencedEntityId = p[0];
                     inst.entityArgIndex = 0;
                 }
                 inst.readableDetails = `Set Flags Ent #${p[0] === 255 ? 'SELF' : p[0]} to ${p[1]}`;
             }
             break;

          case 116: // EV_SET_ENTITY_VAR
          case 117: // EV_ADD_ENTITY_VAR
          case 118: // EV_SET_ENTITY_VAR_2
          case 119: // EV_ADD_ENTITY_VAR_2
          case 120: // EV_SET_ENTITY_VAR_3
          case 121: // EV_ADD_ENTITY_VAR_3
          case 124: // EV_SET_ENTITY_VAR_4
          case 125: // EV_ADD_ENTITY_VAR_4
          case 128: // EV_SET_ENTITY_VAR_5
          case 129: // EV_ADD_ENTITY_VAR_5
          case 130: // EV_SET_ENTITY_VAR_6
          case 131: // EV_ADD_ENTITY_VAR_6
          case 132: // EV_SET_ENTITY_VAR_7
          case 133: // EV_ADD_ENTITY_VAR_7
          case 134: // EV_SET_ENTITY_VAR_8
          case 135: // EV_ADD_ENTITY_VAR_8
          case 136: // EV_SET_ENTITY_VAR_9
          case 137: // EV_ADD_ENTITY_VAR_9
          case 138: // EV_SET_ENTITY_VAR_10
          case 139: // EV_ADD_ENTITY_VAR_10
          case 140: // EV_SET_ENTITY_VAR_11
          case 141: // EV_ADD_ENTITY_VAR_11
          case 142: // EV_SET_ENTITY_VAR_12
          case 143: // EV_ADD_ENTITY_VAR_12
          case 144: // EV_SET_ENTITY_VAR_13
          case 145: // EV_ADD_ENTITY_VAR_13
          case 146: // EV_SET_ENTITY_VAR_14
          case 147: // EV_ADD_ENTITY_VAR_14
          case 148: // EV_SET_ENTITY_VAR_15
          case 149: // EV_ADD_ENTITY_VAR_15
          case 150: // EV_SET_ENTITY_VAR_16
             if (p.length >= 3) {
                 if (p[0] !== 255) {
                     inst.referencedEntityId = p[0];
                     inst.entityArgIndex = 0;
                 }
                 const isAdd = inst.opcode === 117 || inst.opcode === 119 || inst.opcode === 121 || inst.opcode === 125 || inst.opcode === 129 || inst.opcode === 131 || inst.opcode === 133 || inst.opcode === 135 || inst.opcode === 137 || inst.opcode === 139 || inst.opcode === 141 || inst.opcode === 143 || inst.opcode === 145 || inst.opcode === 147 || inst.opcode === 149;
                 inst.readableDetails = `${isAdd ? 'Add' : 'Set'} Var[${p[1]}] of Ent #${p[0] === 255 ? 'SELF' : p[0]} to ${p[2]}`;
             }
             break;

          case 26: // EV_PREVSTATE
             if (p.length > 0) inst.readableDetails = `Dec ${getVariableName(p[0])}`;
             break;

          case 27: // EV_NEXTSTATE
             if (p.length > 0) inst.readableDetails = `Inc ${getVariableName(p[0])}`;
             break;
             
          case 72: // EV_MAKE_CORPSE
             if (p.length >= 3) {
                 if (p[0] !== 65535) {
                     inst.referencedEntityId = p[0];
                     inst.entityArgIndex = 0;
                 }
                 inst.readableDetails = `Make Corpse Ent #${p[0] === 65535 ? 'SELF' : p[0]} at (${p[1]}, ${p[2]})`;
             }
             break;

          case 75: // EV_LERPSPRITEPARABOLA
          case 95: // EV_LERPSPRITEPARABOLA_SCALE
             if (p.length >= 1) {
                 const entId = (p[0] >> 22) & 1023;
                 if (entId !== 255) {
                     inst.referencedEntityId = entId;
                     inst.entityArgIndex = 0;
                 }
                 inst.readableDetails = `Parabola Ent #${entId === 255 ? 'SELF' : entId}`;
             }
             break;

          case 82: // EV_UNMARKTILE
             if (p.length > 0) inst.readableDetails = `Unmark Tile (${p[0] >> 5 & 31}, ${p[0] & 31}) on Automap`;
             break;

          case 83: // EV_ASSIGN_LOOTSET
             if (p.length >= 2) {
                 const entId = p[0] & 4095;
                 if (entId !== 4095) {
                     inst.referencedEntityId = entId;
                     inst.entityArgIndex = 0;
                 }
                 inst.readableDetails = `Assign Loot to Ent #${entId === 4095 ? 'SELF' : entId} (${p[1]} items)`;
             }
             break;

          case 92: // EV_ENTITY_BREATHES
             if (p.length >= 2) {
                 if (p[0] !== 255) {
                     inst.referencedEntityId = p[0];
                     inst.entityArgIndex = 0;
                 }
                 inst.readableDetails = `Set Ent #${p[0] === 255 ? 'SELF' : p[0]} breathes ${p[1]}`;
             }
             break;

          case 28: // EV_WAKEMONSTER
              if (p.length > 0) {
                  if (p[0] !== 255) {
                      inst.referencedEntityId = p[0];
                      inst.entityArgIndex = 0;
                  }
                  inst.readableDetails = `Wake Monster #${p[0] === 255 ? 'SELF' : p[0]}`;
              }
              break;

          case 30: // EV_MONSTER_PARTICLES
              if (p.length > 0) {
                  if (p[0] !== 255) {
                      inst.referencedEntityId = p[0];
                      inst.entityArgIndex = 0;
                  }
                  inst.readableDetails = `Monster Particles Ent #${p[0] === 255 ? 'SELF' : p[0]}`;
              }
              break;
      }
  }
}
