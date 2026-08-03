
import { Component, Input, OnChanges, SimpleChanges, inject, effect, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DoomTextService, TextEntry } from '../../../services/doom-text.service';
import { DoomFileService } from '../../../services/doom-file.service';

@Component({
  selector: 'app-strings-list',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="h-full flex flex-col">
        <!-- Header & Toolbar -->
        <div class="flex items-center justify-between p-2 bg-neutral-900 border-b border-neutral-700 sticky top-0 z-20">
            <div class="grid grid-cols-[60px_1fr_1fr] gap-4 w-full font-bold text-xs text-neutral-400 uppercase tracking-wider">
                <div>ID</div>
                <div>Editor</div>
                <div>Preview</div>
            </div>
            
            <div class="flex items-center gap-2 ml-4">
                <button 
                    (click)="addString()" 
                    class="px-3 py-1 bg-neutral-700 hover:bg-neutral-600 text-white text-xs font-bold rounded transition-colors flex items-center gap-2 border border-neutral-600">
                    <span>➕</span> Add
                </button>
                
                <button 
                    (click)="saveChanges()" 
                    [disabled]="!hasChanges"
                    class="px-4 py-1 bg-red-700 hover:bg-red-600 disabled:bg-neutral-800 disabled:text-neutral-600 text-white text-xs font-bold rounded transition-colors flex items-center gap-2">
                    <span>💾</span> SAVE CHUNK
                </button>
            </div>
        </div>

        <!-- List -->
        <div class="flex-1 overflow-y-auto scrollbar-hide pb-20" #scrollContainer>
            @for (entry of strings; track entry.id) {
                <div [id]="'string-' + entry.id" 
                     class="grid grid-cols-[60px_1fr_1fr] gap-4 p-2 border-b border-neutral-800 hover:bg-neutral-800/50 transition-colors items-start text-sm group"
                     [class.bg-neutral-800]="scrollToId === entry.id">
                    <!-- ID -->
                    <div class="text-neutral-500 font-mono mt-2">#{{ entry.id }}</div>
                    
                    <!-- Editor -->
                    <div class="relative">
                        <textarea 
                            [(ngModel)]="entry.raw" 
                            (ngModelChange)="onTextChange(entry)"
                            class="w-full bg-neutral-950/50 text-amber-500 font-mono text-sm p-2 rounded border border-transparent focus:border-red-600 focus:bg-black outline-none min-h-[40px] resize-y custom-scrollbar"
                            rows="2"
                        ></textarea>
                        <!-- Helper info for new strings -->
                         @if (isNewString(entry)) {
                             <div class="absolute top-0 right-0 -mt-2 -mr-2">
                                 <span class="bg-green-700 text-white text-[9px] px-1 rounded shadow">NEW</span>
                             </div>
                         }
                    </div>
                    
                    <!-- Preview Container with Y-scroll -->
                    <div class="w-full max-h-32 overflow-y-auto overflow-x-auto bg-black/20 rounded border border-white/5 p-2 custom-scrollbar flex items-center justify-center">
                        <canvas #canvas [attr.data-text]="entry.renderKey" class="image-pixelated block"></canvas>
                    </div>
                </div>
            } @empty {
                <div class="p-8 text-center text-neutral-500">
                    No strings found in this chunk.
                    @if (!fontLoaded) {
                        <div class="text-red-400 text-xs mt-2">Warning: font.png not loaded. Previews disabled.</div>
                    }
                    <button (click)="addString()" class="mt-4 text-blue-400 hover:underline">Create First String</button>
                </div>
            }
        </div>
    </div>
  `,
   styles: [`
    .image-pixelated {
        image-rendering: pixelated;
    }
    .custom-scrollbar::-webkit-scrollbar {
        width: 8px;
        height: 8px;
    }
    .custom-scrollbar::-webkit-scrollbar-track {
        background: #111; 
    }
    .custom-scrollbar::-webkit-scrollbar-thumb {
        background: #444; 
        border-radius: 4px;
        border: 2px solid #111;
    }
    .custom-scrollbar::-webkit-scrollbar-thumb:hover {
        background: #666; 
    }
  `]
})
export class StringsListComponent implements OnChanges {
    @Input() strings: TextEntry[] = [];
    @Input() scrollToId: number = -1;
    onSave = output<void>(); 
    
    textService = inject(DoomTextService);
    fileService = inject(DoomFileService);
    
    fontImage: HTMLImageElement | null = null;
    fontLoaded = false;
    hasChanges = false;
    
    // Track newly added IDs to highlight them
    newIds = new Set<number>();

    constructor() {
        effect(() => {
            const src = this.fileService.fontImageSrc();
            if (src) {
                this.loadFont(src);
            }
        });
    }

    ngOnChanges(changes: SimpleChanges): void {
        if (changes['strings']) {
            this.hasChanges = false; 
            this.newIds.clear();
            setTimeout(() => this.renderAll(), 0);
        }

        if (changes['scrollToId'] || changes['strings']) {
            if (this.scrollToId !== -1) {
                setTimeout(() => {
                    this.scrollToItem(this.scrollToId);
                }, 100);
            }
        }
    }

    scrollToItem(id: number) {
        const el = document.getElementById(`string-${id}`);
        if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            el.classList.add('bg-neutral-800');
            setTimeout(() => el.classList.remove('bg-neutral-800'), 1000);
        }
    }

    onTextChange(entry: TextEntry) {
        this.hasChanges = true;
        entry.renderKey = entry.raw; 
        setTimeout(() => this.renderSingle(entry), 0);
    }
    
    addString() {
        const newId = this.strings.length > 0 
            ? Math.max(...this.strings.map(s => s.id)) + 1 
            : 0;
            
        const newEntry: TextEntry = {
            id: newId,
            raw: 'New Text',
            renderKey: 'New Text'
        };
        
        this.strings.push(newEntry);
        this.newIds.add(newId);
        this.hasChanges = true;
        
        setTimeout(() => {
            this.renderSingle(newEntry);
            this.scrollToItem(newId);
        }, 50);
    }
    
    isNewString(entry: TextEntry): boolean {
        return this.newIds.has(entry.id);
    }

    saveChanges() {
        this.onSave.emit();
        this.hasChanges = false;
        this.newIds.clear();
    }

    loadFont(src: string) {
        this.fontImage = new Image();
        this.fontImage.onload = () => {
            this.fontLoaded = true;
            this.renderAll();
        };
        this.fontImage.src = src;
    }

    renderAll() {
        if (!this.fontImage || !this.fontLoaded) return;
        const canvases = document.querySelectorAll('canvas');
        canvases.forEach((canvas: any) => { 
            const text = canvas.getAttribute('data-text');
            if (text !== null) {
                this.textService.renderTextToCanvas(text, canvas, this.fontImage!);
            }
        });
    }

    renderSingle(entry: TextEntry) {
        if (!this.fontImage || !this.fontLoaded) return;
        // Optimization: Find canvas within the specific ID row
        const row = document.getElementById(`string-${entry.id}`);
        if (row) {
            const canvas = row.querySelector('canvas');
            if (canvas) {
                this.textService.renderTextToCanvas(entry.renderKey, canvas, this.fontImage);
            }
        }
    }
}
