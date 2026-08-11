import { ScriptFunctionTable, ScriptInstruction, TileEventRef } from './script-types';

/** Legally redistributable bytecode assembled solely for relocation tests. */
export interface SyntheticScriptFixture {
  bytecode: Uint8Array;
  instructionUids: readonly string[];
  staticFuncs: ScriptFunctionTable;
  tileEvents: readonly { tileIndex: number; targetInstruction: number; flags: number }[];
}

export const SYNTHETIC_SCRIPT_FIXTURE: SyntheticScriptFixture = {
  // jump +6; hide entity #7; variable-length debug string; return;
  // call absolute offset 3 (a backward control-flow edge); message; return
  bytecode: new Uint8Array([1, 0, 6, 24, 7, 66, 1, 65, 2, 7, 0, 3, 3, 0, 42, 2]),
  instructionUids: ['forward', 'entity', 'variable', 'first-return', 'backward-call', 'message', 'last-return'],
  staticFuncs: { 0: 'forward', 1: 'backward-call', 2: 'message' },
  tileEvents: [
    { tileIndex: 33, targetInstruction: 1, flags: 0xff1 },
    { tileIndex: 511, targetInstruction: 5, flags: 0xff4 }
  ]
};

export function applyFixtureUids(instructions: ScriptInstruction[]): ScriptInstruction[] {
  instructions.forEach((instruction, index) => instruction.uid = SYNTHETIC_SCRIPT_FIXTURE.instructionUids[index]);
  const offsetToUid = new Map(instructions.map(instruction => [instruction.offset, instruction.uid]));
  for (const instruction of instructions) {
    if (instruction.jumpTarget !== undefined) instruction.jumpTargetUid = offsetToUid.get(instruction.jumpTarget);
  }
  return instructions;
}

export function fixtureTileEventRefs(instructions: ScriptInstruction[]): TileEventRef[] {
  return SYNTHETIC_SCRIPT_FIXTURE.tileEvents.map((event, index) => ({
    uid: `tile-event-${index}`,
    tileIndex: event.tileIndex,
    targetUid: instructions[event.targetInstruction].uid,
    flags: event.flags
  }));
}
