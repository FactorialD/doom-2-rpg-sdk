import { Component, ElementRef, inject, computed, signal, output, input, OnChanges, SimpleChanges, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DoomTextureService, TextureInfo } from '../../../services/doom-texture.service';
import { DoomFileService } from '../../../services/doom-file.service';
import { TextureThumbnailComponent } from '../texture-thumbnail/texture-thumbnail.component';
import { EditorService } from '../../../services/editor.service';
import { SidebarPanelComponent } from '../../../shared/components/sidebar-panel/sidebar-panel.component';
import { SearchInputComponent } from '../../../shared/components/search-input/search-input.component';
import { NavigationHighlightService } from '../../../shared/services/navigation-highlight.service';

interface TextureGroup {
    parent: TextureInfo;
    children: TextureInfo[];
    isExpanded: boolean;
    isVisible: boolean; // For filtering
}

@Component({
  selector: 'app-texture-list',
  standalone: true,
  imports: [CommonModule, FormsModule, TextureThumbnailComponent, SidebarPanelComponent, SearchInputComponent],
  template: `
      <!-- Sidebar List -->
      <app-sidebar-panel widthClass="w-80">
        <!-- Header / Controls -->
        <div class="p-4 border-b border-neutral-800 space-y-3">
          <div class="flex items-center justify-between">
              <h2 class="text-white font-bold flex items-center gap-2">
                 <span>Textures</span>
                 <span class="text-xs font-normal text-neutral-500 bg-neutral-800 px-2 py-0.5 rounded-full">{{ textureList().length }}</span>
              </h2>
          </div>
          
          @if (!fileService.isLoaded()) {
             <div class="text-xs text-neutral-500 italic p-2 border border-neutral-800 rounded bg-neutral-900/50">
                 Please load a JAR file using the button in the top toolbar.
             </div>
          } @else if (textureList().length === 0) {
              <div class="text-xs text-neutral-500 italic">No textures found or parsing...</div>
          } @else {
             <!-- Filter Controls -->
             <div class="flex gap-2">
                 <select 
                    [ngModel]="selectedCategory()" 
                    (ngModelChange)="selectedCategory.set($event)"
                    class="flex-1 bg-neutral-800 border border-neutral-700 rounded px-2 py-1 text-xs text-white focus:border-red-600 outline-none">
                    <option value="All">All Categories</option>
                    <option value="UI">UI (0-50)</option>
                    <option value="Sprites">Sprites (51-256)</option>
                    <option value="Walls">Walls (257-449)</option>
                    <option value="Flats">Flats (450-512)</option>
                    <option value="Editor">Editor/Other</option>
                 </select>
             </div>
             
             <app-search-input placeholder="Search ID..." [(query)]="searchQuery" />
          }
        </div>

        <!-- Virtual List (Native scroll) -->
        <div class="flex-1 overflow-y-auto custom-scrollbar">
            @for (group of groupedList(); track group.parent.id) {
                @if (group.isVisible) {
                    <div class="border-b border-neutral-800" [id]="'tex-group-' + group.parent.id">
                        <!-- Parent Item -->
                        <div 
                            class="w-full text-left px-3 py-2 hover:bg-neutral-800 flex items-center gap-3 group transition-colors relative cursor-pointer"
                            [class.bg-red-900_20]="selectedId() === group.parent.id"
                            [class.border-l-2]="selectedId() === group.parent.id"
                            [class.border-l-red-600]="selectedId() === group.parent.id"
                            [class.border-l-transparent]="selectedId() !== group.parent.id"
                            (click)="onSelect(group.parent)"
                        >
                            <!-- Expand/Collapse for groups -->
                            @if (group.children.length > 0) {
                                <button 
                                    (click)="toggleGroup(group); $event.stopPropagation()"
                                    class="absolute left-1 top-1/2 -translate-y-1/2 w-4 h-4 flex items-center justify-center text-neutral-500 hover:text-white z-10"
                                >
                                    <span class="text-[10px] transform transition-transform duration-200" [class.rotate-90]="group.isExpanded">▶</span>
                                </button>
                            }

                            <!-- Thumbnail -->
                            <div class="w-10 h-10 shrink-0 bg-neutral-950 border border-neutral-800 rounded flex items-center justify-center overflow-hidden ml-3">
                                 @if(group.parent.valid) {
                                     <app-texture-thumbnail 
                                        [id]="group.parent.id" 
                                        [width]="group.parent.width" 
                                        [height]="group.parent.height" 
                                        [forceRefresh]="saveCounter()" />
                                 }
                            </div>
    
                            <!-- Info -->
                            <div class="flex flex-col w-full min-w-0">
                                <div class="flex items-center justify-between">
                                    <span class="font-mono text-xs text-neutral-400 group-hover:text-white truncate">#{{ group.parent.id }}</span>
                                    <span class="text-[9px] px-1 rounded text-neutral-500 bg-neutral-950 whitespace-nowrap">{{ group.parent.category }}</span>
                                </div>
                                <div class="flex justify-between items-center mt-1">
                                    <div class="flex items-center gap-2">
                                        <span class="text-[9px] text-neutral-600 truncate">Grp: {{ group.parent.groupId }}</span>
                                        @if(group.children.length > 0) {
                                            <span class="text-[9px] bg-blue-900/50 text-blue-300 px-1 rounded">{{ group.children.length }} Refs</span>
                                        }
                                    </div>
                                    <span class="text-[9px] text-neutral-500 whitespace-nowrap">{{ group.parent.width }}x{{ group.parent.height }}</span>
                                </div>
                                @if (requestedChildFor(group.parent.id); as requestedId) {
                                    <span class="mt-1 text-[10px] font-bold text-amber-300">Requested texture #{{ requestedId }}</span>
                                }
                            </div>
                        </div>

                        <!-- Children Items -->
                        @if (group.isExpanded) {
                            <div class="bg-neutral-900/50 border-t border-neutral-800 shadow-inner">
                                @for (child of group.children; track $index) {
                                    <div 
                                        [id]="'tex-child-' + child.id"
                                        (click)="onSelect(child)"
                                        class="pl-12 pr-3 py-1.5 flex items-center gap-3 cursor-pointer hover:bg-neutral-800 transition-colors border-l-4"
                                        [class.border-l-blue-500]="selectedId() === child.id"
                                        [class.bg-blue-900_10]="selectedId() === child.id"
                                        [class.border-l-transparent]="selectedId() !== child.id"
                                    >
                                        <div class="w-8 h-8 shrink-0 opacity-50 grayscale">
                                             <app-texture-thumbnail [id]="child.id" />
                                        </div>
                                        <div class="flex flex-col min-w-0">
                                            <div class="flex items-center gap-2">
                                                <span class="text-xs font-mono text-neutral-500" [class.text-blue-300]="selectedId() === child.id">#{{ child.id }}</span>
                                                <span class="text-[9px] text-neutral-600">REF</span>
                                            </div>
                                            <span class="text-[9px] text-neutral-600">Grp: {{ child.groupId }}</span>
                                        </div>
                                    </div>
                                }
                            </div>
                        }
                    </div>
                }
            } @empty {
                <div class="p-4 text-center text-xs text-neutral-600">
                    No matching textures.
                </div>
            }
        </div>
      </app-sidebar-panel>
  `,
  styles: [`
    .custom-scrollbar::-webkit-scrollbar { width: 8px; height: 8px; }
    .custom-scrollbar::-webkit-scrollbar-track { background: #111; }
    .custom-scrollbar::-webkit-scrollbar-thumb { background: #333; border-radius: 4px; border: 2px solid #111; }
    .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #555; }
  `]
})
export class TextureListComponent implements OnChanges {
    textureService = inject(DoomTextureService);
    fileService = inject(DoomFileService);
    editorService = inject(EditorService);
    private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
    private readonly navigationHighlight = inject(NavigationHighlightService);

    selectTexture = output<TextureInfo>();
    
    // Inputs from parent for sync
    selectedId = input<number | null>(null);
    saveCounter = input(0);

    textureList = this.textureService.textureList;
    
    searchQuery = signal('');
    selectedCategory = signal<string>('All');
    
    // Maintain expansion state via a map of ParentID -> Boolean
    expandedGroups = new Map<number, boolean>();
    private expansionVersion = signal(0);

    groupedList = computed(() => {
        this.expansionVersion();
        const allTextures = this.textureList();
        const q = this.searchQuery().toLowerCase();
        const cat = this.selectedCategory();
        
        // 1. Group textures
        const groups = new Map<number, TextureGroup>();
        
        // First pass: Create groups for Parents
        for (const tex of allTextures) {
            if (!tex.isReference) {
                groups.set(tex.id, {
                    parent: tex,
                    children: [],
                    isExpanded: this.expandedGroups.get(tex.id) || false,
                    isVisible: true
                });
            }
        }

        // Second pass: Add children
        for (const tex of allTextures) {
            if (tex.isReference && tex.parentId !== undefined) {
                const parentGroup = groups.get(tex.parentId);
                if (parentGroup) {
                    parentGroup.children.push(tex);
                }
            }
        }

        const result: TextureGroup[] = Array.from(groups.values());

        // 2. Filter
        for (const group of result) {
            let matchesCategory = (cat === 'All' || group.parent.category === cat);
            let matchesQuery = true;
            
            if (q) {
                const parentMatches = group.parent.id.toString().includes(q) || group.parent.groupId.toString().includes(q);
                const childrenMatch = group.children.some(c => c.id.toString().includes(q) || c.groupId.toString().includes(q));
                
                matchesQuery = parentMatches || childrenMatch;

                // Auto-expand if searching and child matches
                if (q.length > 0 && childrenMatch) {
                    group.isExpanded = true;
                }
            }

            group.isVisible = matchesCategory && matchesQuery;
        }

        return result;
    });

    constructor() {
        effect(() => {
            const request = this.editorService.requestedTextureSelection();
            if (!request || !this.textureList().some(texture => texture.id === request.textureId)) return;
            void this.revealExternal(request.requestId, request.textureId);
        });
    }

    ngOnChanges(changes: SimpleChanges) {
        if (changes['selectedId'] && this.selectedId() !== null) {
            this.scrollToSelection(this.selectedId()!);
        }
    }
    
    scrollToSelection(id: number) {
        // Expand parent if it's a child reference
        const tex = this.textureList().find(t => t.id === id);
        if (tex && tex.isReference && tex.parentId !== undefined) {
            this.expandedGroups.set(tex.parentId, true);
            this.expansionVersion.update(value => value + 1);
        }

        setTimeout(() => {
            const el = document.getElementById(`tex-group-${id}`) || document.getElementById(`tex-child-${id}`);
            if (el) {
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            } else if (tex && tex.isReference && tex.parentId !== undefined) {
                 const parentEl = document.getElementById(`tex-group-${tex.parentId}`);
                 if (parentEl) parentEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }, 100);
    }

    onSelect(tex: TextureInfo) {
        this.editorService.currentTextureId.set(tex.id); // Update global "Brush"
        this.selectTexture.emit(tex);
    }
    
    toggleGroup(group: TextureGroup) {
        group.isExpanded = !group.isExpanded;
        this.expandedGroups.set(group.parent.id, group.isExpanded);
        this.expansionVersion.update(value => value + 1);
    }

    requestedChildFor(parentId: number): number | null {
        const id = this.editorService.requestedTextureSelection()?.textureId;
        if (id === undefined) return null;
        const texture = this.textureList().find(item => item.id === id);
        return texture?.isReference && texture.parentId === parentId ? id : null;
    }

    private async revealExternal(requestId: number, id: number) {
        const texture = this.textureList().find(item => item.id === id);
        if (!texture) return;
        const parentId = texture.isReference ? texture.parentId : texture.id;
        const found = await this.navigationHighlight.reveal({
            expand: () => {
                if (texture.isReference && parentId !== undefined) {
                    this.expandedGroups.set(parentId, true);
                    this.expansionVersion.update(value => value + 1);
                }
            },
            find: () => this.host.nativeElement.querySelector<HTMLElement>(texture.isReference ? `#tex-child-${id}` : `#tex-group-${id}`)
                ?? (parentId === undefined ? null : this.host.nativeElement.querySelector<HTMLElement>(`#tex-group-${parentId}`)),
        });
        if (found) this.editorService.acknowledgeNavigation(this.editorService.requestedTextureSelection, requestId);
        else if (this.editorService.requestedTextureSelection()?.requestId === requestId) {
            this.editorService.notify('error', `Texture #${id} was not found.`);
        }
    }
}
