import { Component, inject, computed, signal, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DoomFileService } from '../../services/doom-file.service';
import { TexturePaletteService, PaletteEntry } from '../../services/textures/texture-palette.service';
import { DoomTextureService } from '../../services/doom-texture.service';
import { TextureThumbnailComponent } from '../texture-viewer/texture-thumbnail/texture-thumbnail.component';
import { EditorService } from '../../services/editor.service';
import { ImageProcessingService } from '../../services/image-processing.service';
import { SidebarPanelComponent } from '../../shared/components/sidebar-panel/sidebar-panel.component';
import { SearchInputComponent } from '../../shared/components/search-input/search-input.component';

@Component({
  selector: 'app-palette-viewer',
  standalone: true,
  imports: [CommonModule, FormsModule, TextureThumbnailComponent, SidebarPanelComponent, SearchInputComponent],
  template: `
    <div class="flex h-full w-full bg-[#1a1a1a] text-sm text-neutral-300">
      
      <!-- Sidebar List -->
      <app-sidebar-panel widthClass="w-72">
        <div class="p-4 border-b border-neutral-800 space-y-3">
          <div class="flex items-center justify-between">
              <h2 class="text-white font-bold flex items-center gap-2">
                 <span>Palettes</span>
                 @if(paletteService.isLoaded()) {
                     <span class="text-xs font-normal text-neutral-500 bg-neutral-800 px-2 py-0.5 rounded-full">{{ filteredList().length }}</span>
                 }
              </h2>
              @if(fileService.isLoaded()) {
                  <button (click)="createNewPalette()" class="text-xs bg-green-800 hover:bg-green-700 text-white px-2 py-1 rounded transition-colors font-bold">+ New</button>
              }
          </div>
          
          @if (!fileService.isLoaded()) {
             <div class="text-xs text-neutral-500 italic p-2 border border-neutral-800 rounded bg-neutral-900/50">
                 Load a JAR file first.
             </div>
          } @else {
             <app-search-input placeholder="Search ID..." [(query)]="searchQuery" />
             
             <div class="flex items-center gap-2 text-xs">
                <label class="flex items-center gap-1 cursor-pointer">
                    <input type="checkbox" [ngModel]="showReferences()" (ngModelChange)="showReferences.set($event)" class="accent-red-600"> Show Refs
                </label>
             </div>
          }
        </div>

        <div class="flex-1 overflow-y-auto custom-scrollbar">
            @for (pal of filteredList(); track pal.id) {
                <div 
                    class="w-full text-left px-3 py-2 hover:bg-neutral-800 flex items-center gap-3 cursor-pointer transition-colors border-l-4"
                    [class.border-l-red-600]="selectedId() === pal.id"
                    [class.bg-red-900_20]="selectedId() === pal.id"
                    [class.border-l-transparent]="selectedId() !== pal.id"
                    (click)="selectedId.set(pal.id)"
                >
                    <div class="flex flex-col min-w-0 flex-1">
                        <div class="flex items-center justify-between">
                            <span class="font-mono text-xs text-neutral-300 font-bold">#{{ pal.id }}</span>
                            @if(pal.isReference) {
                                <span class="text-[9px] bg-blue-900/50 text-blue-300 px-1 rounded">REF -> {{ pal.parentId }}</span>
                            } @else {
                                <span class="text-[9px] bg-neutral-800 text-neutral-500 px-1 rounded">ROOT</span>
                            }
                        </div>
                        <div class="flex items-center gap-2 mt-1">
                            <div class="h-2 flex-1 flex rounded-sm overflow-hidden bg-black max-w-[100px]">
                                <!-- Tiny preview strip of first 10 colors -->
                                @for (col of getPreviewColors(pal); track $index) {
                                    <div class="h-full flex-1" [style.background-color]="col"></div>
                                }
                            </div>
                            <span class="text-[10px] text-neutral-500">{{ pal.colors.length }} cols</span>
                        </div>
                    </div>
                </div>
            } @empty {
                <div class="p-4 text-center text-xs text-neutral-600">
                    @if(fileService.isLoaded() && !paletteService.isLoaded()) {
                         <span class="flex items-center justify-center gap-2 text-amber-500">
                            <span class="animate-spin h-3 w-3 border-2 border-current border-t-transparent rounded-full"></span>
                            Loading data...
                         </span>
                    } @else {
                        No matching palettes.
                    }
                </div>
            }
        </div>
      </app-sidebar-panel>

      <!-- Main Content -->
      <main class="flex-1 flex flex-col relative overflow-hidden bg-neutral-950 p-6">
        @if (selectedPalette(); as pal) {
            <!-- Toolbar -->
            <div class="flex items-center justify-between mb-6 pb-4 border-b border-neutral-800">
                <div>
                    <h1 class="text-xl font-bold text-white mb-1">Palette #{{ pal.id }}</h1>
                    <div class="text-xs text-neutral-500">
                        @if(pal.isReference) {
                            Is Reference to Palette #{{ pal.parentId }}. Editing this edits the parent.
                        } @else {
                            Root Definition. {{ pal.colors.length }} Colors.
                        }
                    </div>
                </div>
                
                <div class="flex gap-2">
                    <label class="flex items-center gap-2 px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-xs font-bold rounded transition-colors cursor-pointer border border-neutral-700">
                        <span>📤</span> Import
                        <input type="file" accept="image/*" class="hidden" (change)="onImportImage($event, pal.id)" />
                    </label>

                    <button 
                        (click)="savePalettes()" 
                        [disabled]="!hasChanges()"
                        class="flex items-center gap-2 px-4 py-2 bg-red-700 hover:bg-red-600 disabled:bg-neutral-800 disabled:text-neutral-600 text-white text-xs font-bold rounded transition-colors"
                    >
                        <span>💾</span> Save All
                    </button>
                </div>
            </div>
            
            <!-- Import Settings (only if importing) -->
            <div class="mb-4 bg-blue-900/20 border border-blue-900/50 p-3 rounded flex items-center gap-4" *ngIf="false">
                <!-- Placeholder for future more advanced settings if needed -->
            </div>

            <!-- Colors Grid -->
            <div class="mb-6">
                <div class="flex justify-between items-end mb-3">
                    <h3 class="text-xs font-bold text-neutral-500 uppercase">Colors</h3>
                    
                    <!-- Color Count (Only relevant for Import basically, but nice to show) -->
                    <div class="flex items-center gap-2">
                         <span class="text-[10px] text-neutral-400">Import Target Count:</span>
                         <input type="number" [(ngModel)]="targetColorCount" class="w-12 bg-neutral-900 border border-neutral-700 rounded text-xs text-white px-1 text-center" min="1" max="256">
                    </div>
                </div>

                <div class="flex flex-wrap gap-1 content-start bg-neutral-900 p-4 rounded border border-neutral-800 max-h-60 overflow-y-auto custom-scrollbar">
                    @for (color of getHexColors(pal); track $index) {
                        <div class="relative group w-8 h-8">
                             <div class="w-full h-full border border-white/10 cursor-pointer" [style.background-color]="color"></div>
                             
                             <!-- Color Picker Overlay -->
                             <input type="color" 
                                [value]="color" 
                                (input)="updateColor(pal, $index, $event)"
                                class="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                                title="Index {{ $index }}: {{ color }}"
                             />
                             
                             <!-- Index Label -->
                             <span class="absolute bottom-0 right-0 text-[8px] font-mono font-bold px-0.5 leading-none bg-black/50 text-white backdrop-blur-[1px] rounded-tl-sm pointer-events-none">{{ $index }}</span>
                        </div>
                    }
                </div>
                @if(hasChanges()) {
                    <p class="text-xs text-amber-500 mt-2 italic">* Unsaved changes in memory.</p>
                }
            </div>
            
            <!-- Usage / Cross Reference -->
            <div class="flex-1 flex flex-col min-h-0">
                <h3 class="text-xs font-bold text-neutral-500 uppercase mb-3 flex items-center gap-2">
                    Used By Textures
                    <span class="bg-neutral-800 px-1.5 py-0.5 rounded text-neutral-400">{{ getUsageList(pal.id).length }}</span>
                </h3>
                
                <div class="flex-1 overflow-y-auto custom-scrollbar bg-neutral-900 border border-neutral-800 rounded p-2">
                    <div class="grid grid-cols-[repeat(auto-fill,minmax(80px,1fr))] gap-2">
                        @for (texId of getUsageList(pal.id); track texId) {
                            <div 
                                (click)="goToTexture(texId)"
                                class="bg-black border border-neutral-800 p-2 rounded hover:border-white transition-colors cursor-pointer group flex flex-col items-center gap-2"
                            >
                                <div class="w-12 h-12 flex items-center justify-center">
                                    <app-texture-thumbnail [id]="texId" />
                                </div>
                                <div class="text-[10px] font-mono text-neutral-400 group-hover:text-white">Tex #{{ texId }}</div>
                            </div>
                        }
                    </div>
                </div>
            </div>

        } @else {
            <div class="flex-1 flex flex-col items-center justify-center text-neutral-600 select-none">
                <span class="text-6xl mb-4 opacity-20">🎨</span>
                <p>Select a palette to edit</p>
                <button (click)="createNewPalette()" class="mt-4 text-xs bg-neutral-800 hover:bg-neutral-700 text-neutral-300 px-4 py-2 rounded transition-colors border border-neutral-700">
                    Create New Palette
                </button>
            </div>
        }
      </main>
    </div>
  `,
  styles: [`
    .custom-scrollbar::-webkit-scrollbar { width: 8px; height: 8px; }
    .custom-scrollbar::-webkit-scrollbar-track { background: #111; }
    .custom-scrollbar::-webkit-scrollbar-thumb { background: #333; border-radius: 4px; border: 2px solid #111; }
    .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #555; }
    input[type=number]::-webkit-inner-spin-button { opacity: 1; }
  `]
})
export class PaletteViewerComponent {
    fileService = inject(DoomFileService);
    paletteService = inject(TexturePaletteService);
    textureService = inject(DoomTextureService);
    editorService = inject(EditorService);
    imageProcessor = inject(ImageProcessingService);

    searchQuery = signal('');
    showReferences = signal(false);
    selectedId = signal<number | null>(null);
    hasChanges = computed(() => this.editorService.dirtyResources().palettes.dirty);
    
    targetColorCount = 16; // Default for import

    filteredList = computed(() => {
        if (!this.paletteService.isLoaded()) return [];
        
        const q = this.searchQuery().toLowerCase();
        const showRef = this.showReferences();
        
        return this.paletteService.getAllPalettes().filter(p => {
            if (!showRef && p.isReference) return false;
            // Hide empty palettes (size 0) usually, UNLESS it's the selected one (user just created it)
            if (p.colors.length === 0 && !p.isReference && p.id !== this.selectedId()) return false; 
            
            if (q && !p.id.toString().includes(q)) return false;
            
            return true;
        });
    });

    selectedPalette = computed(() => {
        const id = this.selectedId();
        if (id === null) return null;
        return this.paletteService.getAllPalettes()[id];
    });

    constructor() {
        // Init lazy loading
        effect(() => {
             if (this.fileService.isLoaded() && !this.paletteService.isLoaded()) {
                 this.textureService.loadTextures();
             }
        });

        // Listen for requests
        effect(() => {
            const req = this.editorService.requestedPaletteSelection();
            if (req !== null) {
                this.selectedId.set(req);
                this.editorService.requestedPaletteSelection.set(null);
            }
        });
    }
    
    createNewPalette() {
        const freeId = this.paletteService.findNextFreeId();
        if (freeId === -1) {
            alert('No free palette slots available (Max 1024). Overwrite existing ones.');
            return;
        }
        
        if (confirm(`Create new palette at ID #${freeId}?`)) {
            this.paletteService.createPalette(freeId, 16); // Default 16 black colors
            this.editorService.markDirty('palettes', 'newPalettes.bin');
            this.selectedId.set(freeId);
        }
    }

    async onImportImage(event: Event, paletteId: number) {
        const input = event.target as HTMLInputElement;
        if (input.files && input.files.length > 0) {
            const file = input.files[0];
            try {
                // Generate palette
                const newColors = await this.imageProcessor.generatePaletteFromImage(file, this.targetColorCount);
                
                // Update service
                this.paletteService.replacePaletteData(paletteId, newColors);
                this.editorService.markDirty('palettes', 'newPalettes.bin');
                
                // Reset input
                input.value = '';
            } catch (e) {
                console.error("Import failed", e);
                alert("Failed to import image.");
            }
        }
    }

    getPreviewColors(pal: PaletteEntry): string[] {
        if (!pal.colors) return [];
        const res: string[] = [];
        const limit = Math.min(pal.colors.length, 10);
        for(let i=0; i<limit; i++) {
            res.push(this.intToHex(pal.colors[i]));
        }
        return res;
    }

    getHexColors(pal: PaletteEntry): string[] {
        if (!pal.colors) return [];
        const res: string[] = [];
        for(let i=0; i<pal.colors.length; i++) {
            res.push(this.intToHex(pal.colors[i]));
        }
        return res;
    }

    intToHex(c: number): string {
        const r = c & 0xFF;
        const g = (c >> 8) & 0xFF;
        const b = (c >> 16) & 0xFF;
        const toHex = (n: number) => n.toString(16).padStart(2, '0');
        return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
    }

    updateColor(pal: PaletteEntry, index: number, event: Event) {
        const input = event.target as HTMLInputElement;
        const hex = input.value; // #RRGGBB
        
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        
        // Update Actual Palette (This updates all references due to shared Uint32Array)
        this.paletteService.updateColor(pal.isReference ? pal.parentId! : pal.id, index, r, g, b);
        this.editorService.markDirty('palettes', 'newPalettes.bin');
    }
    
    savePalettes() {
        if (this.paletteService.savePalettes()) {
            this.editorService.clearDirty('palettes');
            this.editorService.notify('success', 'Palettes saved to memory.');
        } else {
            this.editorService.notify('error', 'Failed to save palettes.');
        }
    }

    getUsageList(palId: number): number[] {
        return this.paletteService.getUsage(palId);
    }
    
    goToTexture(texId: number) {
        this.editorService.selectTexture(texId);
    }
}
