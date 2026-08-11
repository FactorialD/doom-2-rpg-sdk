import { Component, inject, signal, computed, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DoomEntitiesService, EditableEntityDef } from '../../services/doom-entities.service';
import { DoomTextService } from '../../services/doom-text.service';
import { DoomFileService } from '../../services/doom-file.service';
import { ItemCardComponent } from './item-card/item-card.component';
import { DoomTextureService } from '../../services/doom-texture.service';
import { DoomScriptService, ItemReference } from '../../services/doom-script.service';
import { DoomMapService, MapEntityLocation } from '../../services/doom-map.service';
import { EditorService } from '../../services/editor.service';
import { ItemInspectorComponent, ItemViewData } from './item-inspector/item-inspector.component';
import { SidebarPanelComponent } from '../../shared/components/sidebar-panel/sidebar-panel.component';

@Component({
  selector: 'app-item-viewer',
  standalone: true,
  imports: [CommonModule, FormsModule, ItemCardComponent, ItemInspectorComponent, SidebarPanelComponent],
  template: `
    <div class="flex h-full w-full bg-[#1a1a1a] text-sm text-neutral-300">
        <!-- Sidebar -->
        <app-sidebar-panel widthClass="w-64">
            <div class="p-4 border-b border-neutral-800">
                <h2 class="text-white font-bold mb-4 flex items-center gap-2">
                    <span>Items Database</span>
                    <span class="text-[10px] font-normal text-neutral-500 bg-neutral-800 px-2 py-0.5 rounded-full">{{ sortedItems().length }}</span>
                </h2>
                
                @if (!fileService.isLoaded()) {
                    <div class="text-xs text-neutral-500 italic p-2 border border-neutral-800 rounded bg-neutral-900/50">
                        Load a JAR file to view items.
                    </div>
                } @else {
                     <div class="space-y-1">
                        <button (click)="setCategory('inventory')" 
                            class="w-full text-left px-3 py-2 rounded text-xs font-bold uppercase tracking-wider transition-colors"
                            [class.bg-red-900_20]="category() === 'inventory'"
                            [class.text-red-400]="category() === 'inventory'"
                            [class.text-neutral-500]="category() !== 'inventory'"
                            [class.hover:bg-neutral-800]="category() !== 'inventory'">
                            Inventory
                        </button>
                        <button (click)="setCategory('weapons')" 
                            class="w-full text-left px-3 py-2 rounded text-xs font-bold uppercase tracking-wider transition-colors"
                            [class.bg-red-900_20]="category() === 'weapons'"
                            [class.text-red-400]="category() === 'weapons'"
                            [class.text-neutral-500]="category() !== 'weapons'"
                            [class.hover:bg-neutral-800]="category() !== 'weapons'">
                            Weapons
                        </button>
                        <button (click)="setCategory('ammo')" 
                            class="w-full text-left px-3 py-2 rounded text-xs font-bold uppercase tracking-wider transition-colors"
                            [class.bg-red-900_20]="category() === 'ammo'"
                            [class.text-red-400]="category() === 'ammo'"
                            [class.text-neutral-500]="category() !== 'ammo'"
                            [class.hover:bg-neutral-800]="category() !== 'ammo'">
                            Ammo
                        </button>
                     </div>
                     
                     <div class="mt-4 pt-4 border-t border-neutral-800">
                        <label class="text-xs text-neutral-500 font-bold uppercase mb-2 block">Sort By</label>
                        <select [ngModel]="sortBy()" (ngModelChange)="sortBy.set($event)" class="w-full bg-neutral-800 text-white text-xs p-2 rounded border border-neutral-700 outline-none">
                            <option value="id">ID (Parameter)</option>
                            <option value="name">Name</option>
                        </select>
                     </div>
                }
            </div>
        </app-sidebar-panel>

        <!-- Main Content (Split Grid / Inspector) -->
        <div class="flex-1 flex overflow-hidden">
            <!-- Grid -->
            <div class="flex-1 overflow-y-auto custom-scrollbar p-6 bg-neutral-950">
                @if (sortedItems().length > 0) {
                    <div class="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-4">
                        @for (item of sortedItems(); track $index) {
                            <app-item-card 
                                [def]="item.def" 
                                [itemName]="item.name" 
                                [selected]="selectedItem() === item"
                                (onClick)="selectItem(item)"
                            />
                        }
                    </div>
                } @else if (fileService.isLoaded()) {
                    <div class="flex flex-col items-center justify-center h-full text-neutral-500">
                        <p>No items found in this category.</p>
                    </div>
                }
            </div>

            <!-- Right Inspector Component -->
            @if (selectedItem(); as item) {
                <app-item-inspector 
                    [item]="item"
                    [locations]="locations()"
                    [references]="references()"
                    [loadingLocations]="loadingLocations()"
                    [loadingReferences]="loadingReferences()"
                    (showOnMap)="showOnMap($event)"
                    (goToScript)="goToScript($event)"
                    (saveItem)="saveItem(item.def.index, $event)"
                />
            }
        </div>
    </div>
  `,
  styles: [`
    .custom-scrollbar::-webkit-scrollbar { width: 8px; height: 8px; }
    .custom-scrollbar::-webkit-scrollbar-track { background: #1a1a1a; }
    .custom-scrollbar::-webkit-scrollbar-thumb { background: #333; border-radius: 4px; border: 2px solid #1a1a1a; }
    .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #555; }
  `]
})
export class ItemViewerComponent {
    fileService = inject(DoomFileService);
    entitiesService = inject(DoomEntitiesService);
    textService = inject(DoomTextService);
    textureService = inject(DoomTextureService);
    scriptService = inject(DoomScriptService);
    mapService = inject(DoomMapService);
    editorService = inject(EditorService);

    category = signal<'inventory' | 'weapons' | 'ammo'>('inventory');
    sortBy = signal<'id' | 'name'>('id');
    
    selectedItem = signal<ItemViewData | null>(null);
    references = signal<ItemReference[]>([]);
    loadingReferences = signal(false);
    
    locations = signal<MapEntityLocation[]>([]);
    loadingLocations = signal(false);

    // Cache for names
    private nameCache = new Map<number, string>();
    private entityStringsLoaded = false;

    items = computed(() => {
        if (!this.fileService.isLoaded() || !this.entitiesService.isLoaded()) return [];
        
        let type = 6; // ET_ITEM
        let subType = 0;
        
        switch(this.category()) {
            case 'inventory': subType = 0; break;
            case 'weapons': subType = 1; break;
            case 'ammo': subType = 2; break;
        }

        const defs = this.entitiesService.getDefsByType(type, subType);
        
        // Resolve names eagerly
        this.ensureNamesLoaded();
        
        return defs.map(def => ({
            def,
            name: this.resolveName(def.nameId)
        }));
    });
    
    sortedItems = computed(() => {
        const list = [...this.items()];
        if (this.sortBy() === 'id') {
            return list.sort((a,b) => a.def.parm - b.def.parm);
        } else {
            return list.sort((a,b) => a.name.localeCompare(b.name));
        }
    });

    constructor() {
        effect(() => {
            if (this.fileService.isLoaded()) {
                if (!this.entitiesService.isLoaded()) this.entitiesService.loadEntities();
                if (!this.textureService.texturesLoaded()) this.textureService.loadTextures();
            }
        });
    }
    
    setCategory(cat: 'inventory' | 'weapons' | 'ammo') {
        this.category.set(cat);
        this.selectedItem.set(null); // Clear selection on category change
    }

    async selectItem(item: ItemViewData) {
        this.selectedItem.set(item);
        
        // 1. Script Refs
        this.references.set([]);
        this.loadingReferences.set(true);
        const type = item.def.eSubType;
        const id = item.def.parm;
        
        try {
            const refs = await this.scriptService.findReferencesToItem(type, id);
            this.references.set(refs);
        } catch (e) {
            console.error("Error scanning scripts", e);
        } finally {
            this.loadingReferences.set(false);
        }
        
        // 2. Map Locations
        this.locations.set([]);
        this.loadingLocations.set(true);
        try {
            // Find by Tile Index (visual ID)
            const tileIndex = item.def.tileIndex;
            const locs = await this.mapService.findSpriteLocations(tileIndex);
            this.locations.set(locs);
        } catch (e) {
            console.error("Error scanning maps", e);
        } finally {
            this.loadingLocations.set(false);
        }
    }
    
    goToScript(ref: ItemReference) {
        this.editorService.goToScript(ref.mapId, ref.instruction.offset);
    }
    
    showOnMap(loc: MapEntityLocation) {
        // Pass 'true' to indicate we want to isolate/view only this entity (hiding walls)
        this.editorService.selectMapEntity(loc.mapId, loc.spriteIndex, true);
    }

    saveItem(index: number, edited: EditableEntityDef) {
        const def = this.entitiesService.saveDefinition(index, edited);
        this.selectedItem.update(item => item ? { ...item, def, name: this.resolveName(def.nameId) } : null);
    }

    private ensureNamesLoaded() {
        if (this.entityStringsLoaded) return;
        
        const idxBuffer = this.fileService.getFile('strings.idx');
        if (!idxBuffer) return;
        
        const idxData = this.textService.parseStringsIndex(idxBuffer);
        // Entity Strings are usually Chunk 1 (based on Strings.java)
        const entries = this.textService.loadStrings(0, 1, idxData);
        
        entries.forEach(e => this.nameCache.set(e.id, e.raw));
        this.entityStringsLoaded = true;
    }
    
    private resolveName(id: number): string {
        return this.nameCache.get(id) || `Unknown #${id}`;
    }
}
