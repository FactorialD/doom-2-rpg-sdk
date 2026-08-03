
import { Injectable, inject, signal } from '@angular/core';
import { DoomFileService } from './doom-file.service';
import { ByteStream } from '../../utils/byte-stream';

export interface EntityDef {
    tileIndex: number;
    eType: number;
    eSubType: number;
    parm: number;
    nameId: number;
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

        const stream = new ByteStream(buffer);
        
        // Header: Just the count (Short)
        // EntityDef.java: Resource.read(var0, 2); numDefs = Resource.shiftShort();
        const numDefs = stream.readShort();
        
        this.entityDefs = [];
        this.tileIndexToDefMap.clear();

        console.log(`Parsing entities.bin: Found ${numDefs} definitions.`);

        for (let i = 0; i < numDefs; i++) {
            // Structure from EntityDef.java
            // var2.tileIndex = Resource.shiftShort();
            // var2.eType = Resource.shiftByte();
            // var2.eSubType = Resource.shiftByte();
            // var2.parm = Resource.shiftByte();
            // var2.name = Resource.shiftUByte();
            // var2.longName = Resource.shiftUByte();
            // var2.description = Resource.shiftUByte();

            const tileIndex = stream.readShort();
            const eType = stream.readByte();    // Java uses signed byte
            const eSubType = stream.readByte(); // Java uses signed byte
            const parm = stream.readByte();     // Java uses signed byte
            const nameId = stream.readUByte();
            const longName = stream.readUByte();
            const desc = stream.readUByte();
            
            const def: EntityDef = {
                tileIndex,
                eType,
                eSubType,
                parm,
                nameId
            };
            
            this.entityDefs.push(def);
            
            // Map the base tile index to this definition.
            if (!this.tileIndexToDefMap.has(tileIndex)) {
                this.tileIndexToDefMap.set(tileIndex, def);
            }
        }
        
        this.isLoaded.set(true);
    }
     
    getDef(index: number): EntityDef | undefined {
         return this.entityDefs[index];
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
