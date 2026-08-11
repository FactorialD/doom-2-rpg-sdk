
import { Injectable, inject, signal } from '@angular/core';
import { DoomFileService } from './doom-file.service';
import { ByteStream } from '../utils/byte-stream';

export interface EntityDef {
    /** Stable record position in entities.bin; item IDs are not unique across subtypes. */
    index: number;
    tileIndex: number;
    eType: number;
    eSubType: number;
    parm: number;
    nameId: number;
    longNameId: number;
    descriptionId: number;
}

export type EditableEntityDef = Omit<EntityDef, 'index'>;

export function parseEntityDefinitions(buffer: ArrayBuffer): EntityDef[] {
    const stream = new ByteStream(buffer, true, 'entities.bin');
    const count = stream.readShort();
    if (count < 0) throw new RangeError(`entities.bin has a negative definition count: ${count}`);
    stream.ensureAvailable(count * 8, 'entity definitions');
    const definitions: EntityDef[] = [];
    for (let index = 0; index < count; index++) definitions.push({
        index,
        tileIndex: stream.readShort(),
        eType: stream.readByte(),
        eSubType: stream.readByte(),
        parm: stream.readByte(),
        nameId: stream.readUByte(),
        longNameId: stream.readUByte(),
        descriptionId: stream.readUByte()
    });
    return definitions;
}

export function serializeEntityDefinitions(definitions: readonly EntityDef[]): ArrayBuffer {
    if (definitions.length > 0x7fff) throw new RangeError('entities.bin cannot contain more than 32767 definitions');
    const buffer = new ArrayBuffer(2 + definitions.length * 8);
    const view = new DataView(buffer);
    view.setInt16(0, definitions.length, true);
    definitions.forEach((def, index) => {
        const fields: Array<[string, number, number, number]> = [
            ['tileIndex', def.tileIndex, -32768, 32767], ['eType', def.eType, -128, 127],
            ['eSubType', def.eSubType, -128, 127], ['parm', def.parm, -128, 127],
            ['nameId', def.nameId, 0, 255], ['longNameId', def.longNameId, 0, 255],
            ['descriptionId', def.descriptionId, 0, 255]
        ];
        for (const [name, value, min, max] of fields) if (!Number.isInteger(value) || value < min || value > max) {
            throw new RangeError(`Entity #${index} ${name} must be an integer from ${min} to ${max}`);
        }
        const offset = 2 + index * 8;
        view.setInt16(offset, def.tileIndex, true); view.setInt8(offset + 2, def.eType);
        view.setInt8(offset + 3, def.eSubType); view.setInt8(offset + 4, def.parm);
        view.setUint8(offset + 5, def.nameId); view.setUint8(offset + 6, def.longNameId);
        view.setUint8(offset + 7, def.descriptionId);
    });
    return buffer;
}

@Injectable({
    providedIn: 'root'
})
export class DoomEntitiesService {
    private fileService = inject(DoomFileService);
    
    // Maps Entity Definition Index -> EntityDef
    private entityDefs: EntityDef[] = [];
    
    // Quick lookup: TileIndex -> EntityDef (Found by searching definitions)
    private tileIndexToDefMap = new Map<number, EntityDef>();
    
    isLoaded = signal(false);

    async loadEntities() {
        const buffer = this.fileService.getFile('entities.bin');
        if (!buffer) {
            console.warn('entities.bin not found');
            return;
        }

        this.entityDefs = parseEntityDefinitions(buffer);
        this.tileIndexToDefMap.clear();
        for (const def of this.entityDefs) {
            // Map the base tile index to this definition.
            if (!this.tileIndexToDefMap.has(def.tileIndex)) {
                this.tileIndexToDefMap.set(def.tileIndex, def);
            }
        }
        
        this.isLoaded.set(true);
    }

    saveDefinition(index: number, edited: EditableEntityDef): EntityDef {
        const current = this.entityDefs[index];
        if (!current) throw new RangeError(`Unknown entity definition index ${index}`);
        const replacement: EntityDef = { index, ...edited };
        const next = this.entityDefs.map(def => def.index === index ? replacement : def);
        const buffer = serializeEntityDefinitions(next); // validates before mutating the VFS
        this.fileService.saveBuffer('entities.bin', buffer);
        this.entityDefs = next;
        this.tileIndexToDefMap.clear();
        for (const def of next) if (!this.tileIndexToDefMap.has(def.tileIndex)) this.tileIndexToDefMap.set(def.tileIndex, def);
        return replacement;
    }
     
    getDef(index: number): EntityDef | undefined {
         return this.entityDefs[index];
    }

    /** Snapshot used by entity pickers. Definitions remain owned by this service. */
    getAllDefs(): readonly EntityDef[] {
        return this.entityDefs;
    }
    
    /**
     * Finds an Entity Definition that uses this specific texture ID as its base.
     */
    getDefByTileIndex(tileIndex: number): EntityDef | undefined {
        return this.tileIndexToDefMap.get(tileIndex);
    }

    /**
     * Finds a definition matching the logic of EV_GIVEITEM.
     * In Doom RPG, items are eType=6. 
     * The 'type' arg in GiveItem maps to eSubType, and 'id' maps to parm.
     */
    findItemDef(giveType: number, giveId: number): EntityDef | undefined {
        // eType 6 is ITEM
        return this.entityDefs.find(d => d.eType === 6 && d.eSubType === giveType && d.parm === giveId);
    }

    /**
     * Returns all definitions matching a specific type and subtype.
     * Used for listing Inventory (Type 6, Sub 0), Weapons (Type 6, Sub 1), etc.
     */
    getDefsByType(eType: number, eSubType: number): EntityDef[] {
        return this.entityDefs.filter(d => d.eType === eType && d.eSubType === eSubType).sort((a,b) => a.parm - b.parm);
    }
}
