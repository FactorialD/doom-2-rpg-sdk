
export interface ScriptInstruction {
    // Metadata for the Editor
    uid: string;           // Unique ID for tracking references (Labels)
    offset: number;        // Current byte offset (recalculated on save)
    
    // Core Data
    opcode: number;
    name: string;
    params: any[];         // Parsed arguments (numbers, arrays for variable-length args)
    formattedArgs: string; // Human readable args string
    
    // Logic / Jumps
    isJump: boolean;
    jumpTargetUid?: string; // The UID of the instruction this jumps to
    jumpTarget?: number;    // Resolved offset for UI
    
    // Validation
    size: number;          // Size in bytes
    originalBytes: number[]; // For fallback/comparison
    
    // UI Helpers
    readableName: string;
    readableDetails: string;
    description: string;
    isLogic: boolean;
    
    // References (for context menu / linking)
    refType?: 'entity' | 'string' | 'sound' | 'texture' | 'map';
    refId?: number;
    
    // Specific Helpers
    referencedEntityId?: number;
    referencedEntityUuid?: string; // UUID of the referenced entity
    entityArgIndex?: number;       // Index in params array where the entity ID is stored
    referencedStringId?: number;
    referencedChunkId?: number;
    soundId?: number;
    iconId?: number;
}

export interface ScriptFunctionTable {
    // Maps a function index (0-11) to the instruction UID it points to
    [index: number]: string; 
}

export interface TileEventRef {
    uid: string;       // Stable editor identity (the binary format has no event ID)
    tileIndex: number; // 0-1023
    targetUid: string; // The instruction UID this tile triggers
    flags: number;
}
