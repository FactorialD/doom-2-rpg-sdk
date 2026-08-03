import { Component, input, output, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { EntityDetails } from './map-inspector.component';
import { ScriptData, TileEventRef } from '../../../services/doom-script.service';

@Component({
  selector: 'app-map-script-linker',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (data(); as info) {
        <div class="mb-4 bg-blue-900/20 border border-blue-900/50 rounded p-2">
            <div class="flex justify-between items-center mb-2">
                <span class="text-[10px] font-bold text-blue-300 uppercase">Interaction</span>
            </div>

            <div class="text-[10px] text-neutral-400 mb-2">
                Script triggers on Tile: <span class="font-mono text-white">{{ getTileIndex(info) }}</span>
            </div>

             @if (getAttachedScript(info); as scriptRef) {
                 <div class="text-[10px] text-neutral-400 mb-2">
                     Linked to Script at <span class="font-mono text-white">0x{{ getScriptOffsetHex(scriptRef) }}</span>
                     <span class="ml-1 text-[9px] bg-neutral-900 px-1 rounded">{{ getFlagName(scriptRef.flags) }}</span>
                 </div>
                 <button (click)="jumpToScript.emit(scriptRef.targetUid)" class="w-full bg-blue-700 hover:bg-blue-600 text-white text-xs py-1 rounded font-bold transition-colors">
                     Go to Dialogue Script
                 </button>
             } @else {
                 <div class="text-[10px] text-neutral-500 mb-2 italic">
                     No script attached to this tile.
                 </div>
             }
        </div>
    }
  `
})
export class MapScriptLinkerComponent {
    data = input<EntityDetails | null>(null);
    scriptData = input<ScriptData | null>(null);
    
    jumpToScript = output<string>();

    getTileIndex(info: EntityDetails): number {
        const gridX = Math.round(info.raw.x) >> 6;
        const gridY = Math.round(info.raw.z) >> 6;
        return gridY * 32 + gridX;
    }

    getAttachedScript(info: EntityDetails): TileEventRef | undefined {
        const scripts = this.scriptData();
        if (!scripts) return undefined;
        
        const tileIndex = this.getTileIndex(info);
        
        return scripts.tileEventRefs.find(r => r.tileIndex === tileIndex);
    }

    getScriptOffsetHex(ref: TileEventRef): string {
        const data = this.scriptData();
        if (!data || !ref.targetUid) return '????';
        const inst = data.instructions.find(i => i.uid === ref.targetUid);
        return inst ? inst.offset.toString(16).toUpperCase().padStart(4, '0') : '????';
    }
    
    getFlagName(flags: number): string {
        if (flags & 4) return 'TRIGGER';
        if (flags & 1) return 'ENTER';
        return 'UNK';
    }
}