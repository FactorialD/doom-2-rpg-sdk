
import { Component, inject, computed, signal, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DoomTextureService, TextureInfo } from '../../services/doom-texture.service';
import { TexturePaletteService } from '../../services/textures/texture-palette.service';
import { DoomFileService } from '../../services/doom-file.service';
import { TextureListComponent } from './texture-list/texture-list.component';
import { TextureCanvasComponent } from './texture-canvas/texture-canvas.component';
import { TexturePaletteComponent } from './texture-palette/texture-palette.component';
import { EditorService } from '../../services/editor.service';
import { TextureCompositeComponent } from './texture-composite/texture-composite.component';
import { TextureThumbnailComponent } from './texture-thumbnail/texture-thumbnail.component';

@Component({
  selector: 'app-texture-viewer',
  standalone: true,
  imports: [CommonModule, TextureListComponent, TextureCanvasComponent, TexturePaletteComponent, TextureCompositeComponent, TextureThumbnailComponent],
  template: `
    <div class="flex h-full w-full bg-[#1a1a1a] text-sm text-neutral-300">
      
      <!-- List (Sidebar) -->
      <app-texture-list 
         [selectedId]="selectedId()"
         [saveCounter]="saveCounter()" 
         (selectTexture)="onTextureSelected($event)"
      />

      <!-- Main Viewer Area -->
      <main class="flex-1 flex flex-col relative overflow-hidden bg-neutral-950">
        @if (selectedTexture(); as tex) {
            <div class="flex h-full">
                <!-- Left: Editor Canvas -->
                <div class="flex-1 flex flex-col min-w-0 border-r border-neutral-800">
                    @if (tex.isReference) {
                        <div class="m-3 mb-0 rounded border border-amber-700/70 bg-amber-950/50 p-3 text-amber-100" role="status">
                            <strong>Referenced texture:</strong> #{{ tex.id }} has no texels of its own.
                            It displays the texels owned by root texture #{{ rootTextureId(tex) }} and cannot be saved as an independent texture.
                            <button type="button" class="ml-2 rounded bg-amber-700 px-2 py-1 font-semibold text-white hover:bg-amber-600"
                                (click)="goToRootTexture(tex)">Go to root texture</button>
                        </div>
                    }
                    <app-texture-canvas
                        [texture]="tex"
                        [zoom]="zoom()"
                        [bgColor]="bgColor()"
                        [canEdit]="canEdit()"
                        [hasChanges]="hasChanges()"
                        [rawData]="localRawData"
                        [paletteColors]="currentPalette()"
                        [paletteRaw]="currentPaletteRaw"
                        [selectedColorIndex]="selectedColorIndex()"
                        [isCompressed]="isCompressed()"
                        [paletteVersion]="paletteVersion()"
                        (zoomChange)="zoom.set($event)"
                        (bgColorChange)="bgColor.set($event)"
                        (saveChanges)="saveChanges()"
                        (pixelChanged)="onPixelChange($event)"
                    />
                    
                    <app-texture-palette
                        [colors]="currentPalette()"
                        [texture]="tex"
                        [selectedIndex]="selectedColorIndex()"
                        [isCompressed]="isCompressed()"
                        (colorSelected)="selectedColorIndex.set($event)"
                    />
                </div>

                <!-- Right: Composite Info (if NPC/Monster) -->
                @if (siblings().length > 1) {
                    <div class="w-64 bg-neutral-900 border-l border-neutral-800 flex flex-col p-4 overflow-y-auto custom-scrollbar">
                         <div class="mb-4">
                             <h3 class="text-xs font-bold text-neutral-400 uppercase mb-2">Composite Entity</h3>
                             <app-texture-composite 
                                [textures]="siblings()" 
                                [selectedTextureId]="tex.id"
                                [selectedRawData]="localRawData"
                                [selectedPalette]="currentPaletteRaw"
                                [checkerColor]="bgColor()"
                                [forceRefresh]="saveCounter()" 
                             />
                         </div>

                         <div>
                             <h3 class="text-xs font-bold text-neutral-400 uppercase mb-2">Parts ({{ siblings().length }})</h3>
                             <div class="grid grid-cols-3 gap-2">
                                 @for (sib of siblings(); track sib.id) {
                                     <div 
                                        (click)="onTextureSelected(sib)"
                                        class="aspect-square bg-black border rounded cursor-pointer hover:border-white transition-all relative group"
                                        [class.border-red-500]="sib.id === tex.id"
                                        [class.border-neutral-700]="sib.id !== tex.id"
                                     >
                                         <div class="absolute inset-0 flex items-center justify-center p-1">
                                             <app-texture-thumbnail [id]="sib.id" [forceRefresh]="saveCounter()" />
                                         </div>
                                         <div class="absolute bottom-0 right-0 bg-black/70 text-[9px] px-1 text-white font-mono rounded-tl">#{{sib.id}}</div>
                                     </div>
                                 }
                             </div>
                         </div>
                         
                         <div class="mt-4 text-[10px] text-neutral-500">
                             <p>This texture is part of Group #{{ tex.groupId }}.</p>
                             <p>Monsters/NPCs are assembled from multiple frames (Legs, Torso, Head).</p>
                         </div>
                    </div>
                }
            </div>

        } @else {
            <div class="flex-1 flex flex-col items-center justify-center text-neutral-600 select-none">
                <span class="text-6xl mb-4 opacity-20">🖼️</span>
                <p>Select a texture to inspect</p>
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
  `]
})
export class TextureViewerComponent {
    textureService = inject(DoomTextureService);
    paletteService = inject(TexturePaletteService);
    fileService = inject(DoomFileService);
    editorService = inject(EditorService);

    texturesLoaded = this.textureService.texturesLoaded;
    textureList = this.textureService.textureList;
    paletteVersion = this.paletteService.version;
    
    // UI State
    selectedId = signal<number | null>(null);
    zoom = signal(4);
    bgColor = signal('#8a8a8a');
    currentPalette = signal<string[]>([]);
    currentPaletteRaw: Uint32Array | undefined;
    selectedColorIndex = signal(0);
    saveCounter = signal(0);
    isCompressed = signal(false);
    
    siblings = signal<TextureInfo[]>([]);

    // Editing State
    hasChanges = signal(false);
    localRawData: Uint8Array | null = null;
    
    selectedTexture = computed(() => {
        const id = this.selectedId();
        if (id === null) return null;
        return this.textureList().find(t => t.id === id) || null;
    });
    
    canEdit = computed(() => {
        const tex = this.selectedTexture();
        if (!tex) return false;
        return this.textureService.isTextureEditable(tex.id);
    });

    constructor() {
        effect(() => {
            if (this.fileService.isLoaded() && !!this.fileService.getFile('newMappings.bin') && !this.texturesLoaded()) {
                setTimeout(() => this.textureService.loadTextures(), 0);
            }
        });

        // Listen for external selection request
        effect(() => {
            const reqId = this.editorService.requestedTextureSelection();
            if (reqId !== null && this.texturesLoaded()) {
                const tex = this.textureList().find(t => t.id === reqId);
                if (tex) {
                    this.onTextureSelected(tex);
                }
                this.editorService.requestedTextureSelection.set(null); // Clear request
            }
        });
        
        // Listen for Palette Changes to redraw
        effect(() => {
            const v = this.paletteVersion();
            const tex = this.selectedTexture();
            if (tex && this.texturesLoaded()) {
                this.refreshPalette(tex);
            }
        });
    }

    onTextureSelected(tex: TextureInfo) {
        if (this.hasChanges()) {
            if (!confirm('You have unsaved changes. Discard them?')) {
                return;
            }
        }
        this.selectedId.set(tex.id);
        this.editorService.currentTextureId.set(tex.id);
        
        // Check compression
        this.isCompressed.set(this.textureService.isTextureCompressed(tex.id));

        // Reset state
        this.hasChanges.set(false);
        this.localRawData = null;
        
        // Load Data
        const raw = this.textureService.getTextureRawIndices(tex.id);
        if (raw) {
            this.localRawData = new Uint8Array(raw);
        }
        
        // Fetch Siblings (Composite parts)
        const sibs = this.textureService.getGroupTextures(tex.groupId);
        this.siblings.set(sibs);
        
        this.refreshPalette(tex);

        // Set default color (Index 1 is usually first opaque color)
        this.selectedColorIndex.set(1); 
    }
    
    refreshPalette(tex: TextureInfo) {
        // Load Palette
        const rawPal = this.textureService.getTexturePalette(tex.id);
        this.currentPaletteRaw = rawPal;
        
        if (!rawPal) {
            this.currentPalette.set([]);
        } else {
             const colors: string[] = [];
             for (let i = 0; i < rawPal.length; i++) {
                 const c = rawPal[i];
                 const r = c & 0xFF;
                 const g = (c >> 8) & 0xFF;
                 const b = (c >> 16) & 0xFF;
                 const a = (c >>> 24) & 0xFF;
                 colors.push(`rgba(${r}, ${g}, ${b}, ${a / 255})`);
             }
             this.currentPalette.set(colors);
        }
    }
    
    onPixelChange(event: {index: number, colorIndex: number}) {
        if (!this.localRawData || !this.canEdit()) return;
        this.localRawData[event.index] = event.colorIndex;
        this.hasChanges.set(true);
    }
    
    saveChanges() {
        const tex = this.selectedTexture();
        if (tex && this.localRawData && this.hasChanges()) {
            const success = this.textureService.saveTexture(tex.id, this.localRawData);
            if (success) {
                this.hasChanges.set(false);
                this.saveCounter.update(v => v + 1); // Trigger refresh in list
                alert('Texture saved successfully to memory!');
            } else {
                alert('Failed to save texture.');
            }
        }
    }


    rootTextureId(texture: TextureInfo): number {
        const seen = new Set<number>();
        let current = texture;
        while (current.isReference && current.parentId !== undefined && !seen.has(current.id)) {
            seen.add(current.id);
            const parent = this.textureList().find(candidate => candidate.id === current.parentId);
            if (!parent) break;
            current = parent;
        }
        return current.id;
    }

    goToRootTexture(texture: TextureInfo) {
        const root = this.textureList().find(candidate => candidate.id === this.rootTextureId(texture));
        if (root) this.onTextureSelected(root);
    }
}
