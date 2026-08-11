
/** SDK-only labels copied from Enums.java. They are never serialized into a JAR. */
export const SYSTEM_VARIABLES: Readonly<Record<number, string>> = {
    0: 'CODEVAR_DRUNK',
    1: 'CODEVAR_HEALTH',
    2: 'CODEVAR_PLAYER_X',
    3: 'CODEVAR_PLAYER_Y',
    4: 'CODEVAR_DIALOG_CHOICE',
    5: 'CODEVAR_DRAW_SKYMAP',
    6: 'CODEVAR_OSCILLATE_FOV',
    7: 'CODEVAR_COMMMAND_RETURN',
    8: 'CODEVAR_PLAYER_GOLD',
    9: 'CODEVAR_PINKINATOR_X',
    10: 'CODEVAR_PINKINATOR_Y',
    11: 'CODEVAR_PICKUP_ITEM_TILE',
    12: 'CODEVAR_DIFFICULTY',
    13: 'CODEVAR_KICKING_TURN',
    14: 'CODEVAR_CHARACTER_CHOICE',
    15: 'CODEVAR_LAST_LEVEL_LOAD',
    16: 'CODEVAR_IS_SENTRY_BOT'
};

export interface DoomVariableMetadata {
    id: number;
    sdkName: string;
    runtimeOwned: boolean;
    storage: 'runtime-state';
}

export interface ScriptVariableAssignment {
    variableId: number;
    value: number;
}

/** EV_SETSTATE (ScriptThread opcode 6) is the confirmed persistent script representation. */
export function encodeSetStateAssignment(assignment: ScriptVariableAssignment): number[] {
    if (!Number.isInteger(assignment.variableId) || assignment.variableId < 0 || assignment.variableId > 127) throw new RangeError('Variable ID must be an integer from 0 to 127');
    if (!Number.isInteger(assignment.value) || assignment.value < -32768 || assignment.value > 32767) throw new RangeError('EV_SETSTATE value must be an integer from -32768 to 32767');
    return [6, assignment.variableId, (assignment.value >> 8) & 0xff, assignment.value & 0xff];
}

export function getVariableMetadata(id: number): DoomVariableMetadata {
    return { id, sdkName: getVariableName(id), runtimeOwned: id <= 16, storage: 'runtime-state' };
}

export const getVariableName = (id: number): string => {
    return SYSTEM_VARIABLES[id] || `VAR[${id}]`;
};
