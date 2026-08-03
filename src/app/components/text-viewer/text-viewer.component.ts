import { Component, inject, signal, computed, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DoomFileService } from '../../services/doom-file.service';
import { DoomTextService } from '../../services/doom-text.service';
import { StringsListComponent } from './strings-list/strings-list.component';
import { FontAtlasComponent } from './font-atlas/font-atlas.component';
import { EditorService } from '../../services/editor.service';
import { SidebarPanelComponent } from '../../shared/components/sidebar-panel/sidebar-panel.component';

@Component({
  selector: 'app-text-viewer',
  standalone: true,
  imports: [CommonModule, FormsModule, StringsListComponent, FontAtlasComponent, SidebarPanelComponent],
  template: `
    <div class="flex h-full w-full">
      <!-- Left Sidebar (Settings) -->
      <app-sidebar-panel widthClass="w-64">
        <div class="p-4 border-b border-neutral-800">
            <h2 class="text-white font-bold mb-4">Text Resources</h2>
            
            @if (!fileService.isLoaded()) {
                <div class="text-xs text-neutral-500 italic p-2 border border-neutral-800 rounded bg-neutral-900/50">
                    Load a JAR file via the top toolbar to view resources.
                </div>
            }

            <!-- Filters -->
             @if (hasIndex()) {
                <div class="space-y-4 animate-fade-in">
                    <div class="text-xs font-bold text-neutral-500 uppercase">Filters</div>
                    
                    <div>
                        <label class="text-xs text-neutral-400 block mb-1">Language</label>
                        <select 
                            [ngModel]="selectedLang()" 
                            (ngModelChange)="selectedLang.set(+$event)"
                            class="w-full bg-neutral-800 text-white text-xs p-2 rounded border border-neutral-700 outline-none focus:border-red-600">
                            <option [value]="0">English</option>
                            <option [value]="1">French</option>
                            <option [value]="2">German</option>
                            <option [value]="3">Italian</option>
                            <option [value]="4">Spanish</option>
                        </select>
                    </div>

                    <div>
                        <label class="text-xs text-neutral-400 block mb-1">Encoding</label>
                        <select 
                            [ngModel]="selectedEncoding()" 
                            (ngModelChange)="selectedEncoding.set($event)"
                            class="w-full bg-neutral-800 text-white text-xs p-2 rounded border border-neutral-700 outline-none focus:border-red-600">
                            <option value="windows-1252">Western (Windows-1252)</option>
                            <option value="windows-1251">Cyrillic (Windows-1251)</option>
                            <option value="utf-8">UTF-8</option>
                        </select>
                        <p class="text-[10px] text-neutral-500 mt-1">Use 'Cyrillic' for Russian mods.</p>
                    </div>

                    <div>
                        <label class="text-xs text-neutral-400 block mb-1">Chunk ID (0-14)</label>
                         <select 
                            [ngModel]="selectedChunk()" 
                            (ngModelChange)="selectedChunk.set(+$event)"
                            class="w-full bg-neutral-800 text-white text-xs p-2 rounded border border-neutral-700 outline-none focus:border-red-600">
                            @for (chunk of chunks; track chunk.id) {
                                <option [value]="chunk.id">{{ chunk.name }} ({{ chunk.id }})</option>
                            }
                        </select>
                    </div>
                </div>
            }
        </div>
      </app-sidebar-panel>

      <!-- Main Content -->
      <div class="flex-1 flex flex-col overflow-hidden bg-[#1a1a1a]">
        <!-- Sub-tabs -->
        <div class="flex border-b border-neutral-800 bg-neutral-900 px-4">
            <button 
                (click)="activeSubTab.set('strings')"
                [class.border-b-2]="activeSubTab() === 'strings'"
                [class.border-red-600]="activeSubTab() === 'strings'"
                [class.text-white]="activeSubTab() === 'strings'"
                class="px-4 py-3 text-xs font-bold text-neutral-400 hover:text-white transition-colors uppercase tracking-wide">
                Strings
            </button>
            <button 
                (click)="activeSubTab.set('atlases')"
                [class.border-b-2]="activeSubTab() === 'atlases'"
                [class.border-red-600]="activeSubTab() === 'atlases'"
                [class.text-white]="activeSubTab() === 'atlases'"
                class="px-4 py-3 text-xs font-bold text-neutral-400 hover:text-white transition-colors uppercase tracking-wide">
                Atlases (Font)
            </button>
        </div>

        <!-- Content Area -->
        <div class="flex-1 overflow-hidden relative">
            @if (activeSubTab() === 'strings') {
                @if (hasIndex()) {
                    <app-strings-list 
                        [strings]="currentStrings()" 
                        [scrollToId]="targetStringId"
                        (onSave)="onSaveCurrentChunk()" />
                } @else {
                     <div class="flex flex-col items-center justify-center h-full text-neutral-500">
                        <p class="mb-2">Load 'doom2rpg.jar' to view text.</p>
                     </div>
                }
            } @else {
                <app-font-atlas />
            }
        </div>
      </div>
    </div>
  `
})
export class TextViewerComponent {
    fileService = inject(DoomFileService);
    textService = inject(DoomTextService);
    editorService = inject(EditorService);

    activeSubTab = signal<'strings' | 'languages' | 'atlases'>('strings');
    
    hasIndex = this.fileService.stringsIndexLoaded;
    
    selectedLang = signal(0);
    selectedChunk = signal(0);
    selectedEncoding = signal('windows-1252');
    
    // For auto-scrolling
    targetStringId: number = -1;
    
    chunks = [
        { id: 0, name: 'Code Strings' },
        { id: 1, name: 'Entity Strings' },
        { id: 2, name: 'File Strings' },
        { id: 3, name: 'Menu Strings' },
        { id: 4, name: 'Map 01 (Intro/Lab)' },
        { id: 5, name: 'Map 02' },
        { id: 6, name: 'Map 03' },
        { id: 7, name: 'Map 04' },
        { id: 8, name: 'Map 05' },
        { id: 9, name: 'Map 06' },
        { id: 10, name: 'Map 07' },
        { id: 11, name: 'Map 08' },
        { id: 12, name: 'Map 09' },
        { id: 13, name: 'Map Test' },
        { id: 14, name: 'Translations' },
    ];

    currentStrings = computed(() => {
        // IMPORTANT: We depend on both hasIndex AND isLoaded.
        // hasIndex might trigger early when strings.idx loads, but stringsX.bin files might not be ready.
        // isLoaded ensures the full JAR load is complete.
        if (!this.hasIndex() || !this.fileService.isLoaded()) return [];
        
        const idxBuffer = this.fileService.getFile('strings.idx');
        if (!idxBuffer) return [];

        try {
            const idxData = this.textService.parseStringsIndex(idxBuffer);
            return this.textService.loadStrings(this.selectedLang(), this.selectedChunk(), idxData, this.selectedEncoding());
        } catch (e) {
            console.error("Error loading strings:", e);
            return [];
        }
    });

    constructor() {
        effect(() => {
            const req = this.editorService.requestedTextNavigation();
            if (req) {
                this.activeSubTab.set('strings');
                this.selectedChunk.set(req.chunkId);
                // Trigger scroll
                this.targetStringId = req.stringId;
                
                // Clear the target ID after a moment so it doesn't re-scroll on other changes
                setTimeout(() => {
                   this.targetStringId = -1;
                }, 500);

                this.editorService.requestedTextNavigation.set(null);
            }
        });
    }

    async onSaveCurrentChunk() {
        const strings = this.currentStrings();
        if (!strings.length) return;
        
        console.log("Saving chunk...");
        const success = await this.textService.saveStringsChunk(
            this.selectedLang(), 
            this.selectedChunk(), 
            strings, 
            this.selectedEncoding()
        );
        
        if (success) {
            alert('Strings saved to memory! You can now download the modded JAR.');
        } else {
            alert('Failed to save strings. Check console.');
        }
    }
}