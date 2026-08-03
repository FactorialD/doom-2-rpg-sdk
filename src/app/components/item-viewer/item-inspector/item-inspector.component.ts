
import { Component, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TextureThumbnailComponent } from '../../texture-viewer/texture-thumbnail/texture-thumbnail.component';
import { EntityDef } from '../../../services/doom-entities.service';
import { MapEntityLocation } from '../../../services/doom-map.service';
import { ItemReference } from '../../../services/doom-script.service';

export interface ItemViewData {
    def: EntityDef;
    name: string;
}

@Component({
  selector: 'app-item-inspector',
  standalone: true,
  imports: [CommonModule],
  template: `
    <aside class="w-72 bg-neutral-900 border-l border-neutral-800 flex flex-col flex-none overflow-hidden animate-slide-in">
        @if (item(); as i) {
            <div class="p-4 border-b border-neutral-800 bg-neutral-900 sticky top-0 z-10">
                <div class="text-[10px] font-bold text-neutral-500 uppercase tracking-wider mb-1">Item Inspector</div>
                <h3 class="text-lg font-bold text-white leading-tight">{{ i.name }}</h3>
                <div class="flex items-center gap-2 mt-2 text-xs font-mono text-neutral-400">
                    <span class="bg-neutral-800 px-2 py-0.5 rounded">Type: {{ i.def.eSubType }}</span>
                    <span class="bg-neutral-800 px-2 py-0.5 rounded">ID: {{ i.def.parm }}</span>
                </div>
            </div>

            <div class="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-6">
                <!-- Entity Def Details -->
                <div>
                    <div class="text-[10px] font-bold text-neutral-500 uppercase tracking-wider mb-2">Definition</div>
                    <div class="bg-black/40 border border-neutral-800 rounded p-2 text-xs font-mono space-y-1">
                        <div class="flex justify-between"><span>Tile Idx:</span> <span class="text-white">{{ i.def.tileIndex }}</span></div>
                        <div class="flex justify-between"><span>Name ID:</span> <span class="text-white">{{ i.def.nameId }}</span></div>
                        <div class="flex justify-between"><span>Type (Main):</span> <span class="text-white">{{ i.def.eType }}</span></div>
                    </div>
                </div>

                <!-- Map Locations -->
                 <div>
                    <div class="flex items-center justify-between mb-2">
                        <div class="text-[10px] font-bold text-neutral-500 uppercase tracking-wider">Map Locations</div>
                        @if(loadingLocations()) {
                            <span class="text-[9px] text-amber-500 animate-pulse">Scanning...</span>
                        }
                    </div>
                    
                     @if (!loadingLocations() && locations().length === 0) {
                        <div class="text-xs text-neutral-600 italic">No instances found on maps.</div>
                    } @else {
                        <div class="space-y-1">
                            @for (loc of locations(); track $index) {
                                <div class="bg-neutral-800/50 flex items-center justify-between p-2 rounded border border-neutral-800 hover:border-neutral-700 transition-colors">
                                    <div>
                                        <div class="text-xs font-bold text-white">Map {{ loc.mapId }}</div>
                                        <div class="text-[10px] text-neutral-500 font-mono">
                                            Idx: {{ loc.spriteIndex }} | {{ (loc.x / 16).toFixed(0) }}, {{ (loc.z / 16).toFixed(0) }}
                                        </div>
                                    </div>
                                    <button 
                                        (click)="showOnMap.emit(loc)"
                                        class="px-2 py-1 bg-blue-900/40 hover:bg-blue-800 text-blue-300 text-[10px] rounded border border-blue-800 transition-colors">
                                        ➔
                                    </button>
                                </div>
                            }
                        </div>
                    }
                </div>

                <!-- Usage in Scripts -->
                <div>
                    <div class="flex items-center justify-between mb-2">
                        <div class="text-[10px] font-bold text-neutral-500 uppercase tracking-wider">Script References</div>
                        @if(loadingReferences()) {
                            <span class="text-[9px] text-amber-500 animate-pulse">Scanning...</span>
                        }
                    </div>

                    @if (!loadingReferences() && references().length === 0) {
                        <div class="text-xs text-neutral-600 italic">No script references found.</div>
                    } @else {
                        <div class="space-y-2">
                            @for (ref of references(); track $index) {
                                <div 
                                    class="bg-neutral-800/50 hover:bg-neutral-800 border border-neutral-700/50 hover:border-neutral-600 rounded p-2 transition-colors cursor-pointer group"
                                    (click)="goToScript.emit(ref)"
                                >
                                    <div class="flex justify-between items-center mb-1">
                                        <span class="text-xs font-bold text-blue-400">Map {{ ref.mapId }}</span>
                                        <span class="text-[9px] font-mono text-neutral-500 group-hover:text-white">0x{{ ref.instruction.offset.toString(16).toUpperCase() }}</span>
                                    </div>
                                    <div class="text-[10px] text-neutral-300 font-mono break-all leading-tight">
                                        {{ ref.instruction.readableDetails }}
                                    </div>
                                    <div class="text-[9px] text-neutral-500 mt-1 uppercase tracking-wider">{{ ref.instruction.name }}</div>
                                </div>
                            }
                        </div>
                    }
                </div>
            </div>
        }
    </aside>
  `,
  styles: [`
    .custom-scrollbar::-webkit-scrollbar { width: 8px; height: 8px; }
    .custom-scrollbar::-webkit-scrollbar-track { background: #1a1a1a; }
    .custom-scrollbar::-webkit-scrollbar-thumb { background: #333; border-radius: 4px; border: 2px solid #1a1a1a; }
    .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #555; }
    .animate-slide-in { animation: slideIn 0.2s ease-out; }
    @keyframes slideIn { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
  `]
})
export class ItemInspectorComponent {
    item = input<ItemViewData | null>(null);
    locations = input<MapEntityLocation[]>([]);
    references = input<ItemReference[]>([]);
    loadingLocations = input<boolean>(false);
    loadingReferences = input<boolean>(false);
    
    showOnMap = output<MapEntityLocation>();
    goToScript = output<ItemReference>();
}
