
import { AfterViewInit, Component, ElementRef, Input, Injector, OnChanges, OnDestroy, QueryList, SimpleChanges, ViewChildren, afterNextRender, inject, effect, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DoomTextService, TextEntry } from '../../../services/doom-text.service';
import { DoomFileService } from '../../../services/doom-file.service';
import { EditorService } from '../../../services/editor.service';
import { TypewriterTimer } from '../../../services/typewriter-timer';
import { NavigationHighlightService } from '../../../shared/services/navigation-highlight.service';

export interface TextSelectionEvent { id: number; selectionStart: number; selectionEnd: number; text: string; }

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
                <label class="text-[10px] text-neutral-400 whitespace-nowrap">Type delay
                    <input type="number" min="10" max="1000" step="10" [(ngModel)]="typeDelay" class="w-16 ml-1 bg-neutral-800 p-1 rounded">
                </label>
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
                     >
                    <!-- ID -->
                    <div class="text-neutral-500 font-mono mt-2">#{{ entry.id }}</div>
                    
                    <!-- Editor -->
                    <div class="relative">
                        <textarea 
                            [(ngModel)]="entry.raw" 
                            (ngModelChange)="onTextChange(entry)"
                            (select)="emitSelection(entry, $event)"
                            (keyup)="emitSelection(entry, $event)"
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
                    
                    <div #preview class="w-full overflow-x-hidden bg-black/20 rounded border border-white/5 p-2 flex flex-col items-start justify-start">
                        <button (click)="toggleTypewriter(entry)" class="mb-1 px-2 py-0.5 text-[10px] rounded bg-neutral-700 hover:bg-neutral-600 text-white">
                            {{ activeEntryId === entry.id ? '■ Stop' : '▶ Play' }}
                        </button>
                        <canvas #canvas [attr.data-entry-id]="entry.id" class="image-pixelated block max-w-full"></canvas>
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
export class StringsListComponent implements OnChanges, AfterViewInit, OnDestroy {
    @Input() strings: TextEntry[] = [];
    @Input() scrollToId: number = -1;
    private readonly resourceIdValue = signal('');
    private readonly navigationVisibleValue = signal(false);
    @Input() set resourceId(value: string) { this.resourceIdValue.set(value); }
    get resourceId() { return this.resourceIdValue(); }
    @Input() set navigationVisible(value: boolean) { this.navigationVisibleValue.set(value); }
    onSave = output<void>(); 
    selectionChange = output<TextSelectionEvent>();
    @ViewChildren('canvas') private canvases!: QueryList<ElementRef<HTMLCanvasElement>>;
    @ViewChildren('preview') private previews!: QueryList<ElementRef<HTMLElement>>;
    
    textService = inject(DoomTextService);
    fileService = inject(DoomFileService);
    editorService = inject(EditorService);
    private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
    private readonly injector = inject(Injector);
    private readonly navigationHighlight = inject(NavigationHighlightService);
    
    fontImage: HTMLImageElement | null = null;
    fontLoaded = false;
    get hasChanges() { return this.editorService.isDirty('strings', this.resourceId); }
    
    // Track newly added IDs to highlight them
    newIds = new Set<number>();
    typeDelay = 45;
    activeEntryId: number | null = null;
    typePosition = 0;
    private readonly typeTimer = new TypewriterTimer();
    private resizeObserver: ResizeObserver | null = null;
    private viewChanges?: { unsubscribe(): void };

    constructor() {
        effect(() => {
            const src = this.fileService.fontImageSrc();
            if (src) {
                this.loadFont(src);
            }
        });
        effect(() => {
            const request = this.editorService.requestedTextNavigation();
            const chunk = Number(this.resourceIdValue().split(':')[1]);
            if (!request || !this.navigationVisibleValue() || request.chunkId !== chunk) return;
            afterNextRender(() => {
                if (this.editorService.requestedTextNavigation()?.requestId === request.requestId) {
                    void this.revealExternal(request.requestId, request.stringId);
                }
            }, { injector: this.injector });
        });
    }

    ngOnChanges(changes: SimpleChanges): void {
        if (changes['strings'] || changes['resourceId']) {
            this.stopTypewriter();
            this.newIds.clear();
            setTimeout(() => this.renderAll(), 0);
        }

    }

    ngAfterViewInit(): void {
        this.observePreviews();
        this.viewChanges = this.previews.changes.subscribe(() => this.observePreviews());
        queueMicrotask(() => this.renderAll());
    }

    ngOnDestroy(): void {
        this.stopTypewriter();
        this.resizeObserver?.disconnect();
        this.viewChanges?.unsubscribe();
    }

    scrollToItem(id: number) {
        this.host.nativeElement.querySelector<HTMLElement>(`#string-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    private async revealExternal(requestId: number, id: number) {
        const found = await this.navigationHighlight.reveal({
            find: () => this.host.nativeElement.querySelector<HTMLElement>(`#string-${id}`),
        });
        if (found) this.editorService.acknowledgeNavigation(this.editorService.requestedTextNavigation, requestId);
        else if (this.editorService.requestedTextNavigation()?.requestId === requestId) {
            this.editorService.notify('error', `String #${id} was not found.`);
        }
    }

    onTextChange(entry: TextEntry) {
        if (this.activeEntryId === entry.id) this.stopTypewriter();
        this.editorService.markDirty('strings', this.resourceId);
        entry.renderKey = entry.raw; 
        setTimeout(() => this.renderSingle(entry), 0);
    }

    emitSelection(entry: TextEntry, event: Event) {
        const textarea = event.target as HTMLTextAreaElement;
        const selectionStart = textarea.selectionStart ?? 0;
        const selectionEnd = textarea.selectionEnd ?? selectionStart;
        this.selectionChange.emit({ id: entry.id, selectionStart, selectionEnd, text: entry.raw.slice(selectionStart, selectionEnd) });
    }

    toggleTypewriter(entry: TextEntry) {
        if (this.activeEntryId === entry.id) { this.stopTypewriter(); this.renderSingle(entry); return; }
        this.stopTypewriter();
        this.activeEntryId = entry.id;
        this.typePosition = 0;
        const chars = Array.from(entry.renderKey);
        this.renderSingle(entry, '');
        this.typeTimer.start(chars.length, Math.max(10, this.typeDelay), position => {
            if (this.activeEntryId !== entry.id) return;
            this.typePosition = position;
            this.renderSingle(entry, chars.slice(0, position).join(''));
        }, () => {
            if (this.activeEntryId === entry.id) {
                this.stopTypewriter();
                this.renderSingle(entry);
            }
        });
    }

    stopTypewriter() {
        this.typeTimer.stop();
        this.activeEntryId = null;
        this.typePosition = 0;
    }
    
    addString() {
        const newId = this.textService.getNextStringId(this.strings);
            
        const newEntry: TextEntry = {
            id: newId,
            raw: 'New Text',
            renderKey: 'New Text'
        };
        
        this.strings.push(newEntry);
        this.newIds.add(newId);
        this.editorService.markDirty('strings', this.resourceId);
        
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
        this.strings.forEach(entry => this.renderSingle(entry));
    }

    renderSingle(entry: TextEntry, previewText = entry.renderKey) {
        if (!this.fontImage || !this.fontLoaded) return;
        const canvas = this.canvases?.find(item => Number(item.nativeElement.dataset['entryId']) === entry.id)?.nativeElement;
        if (!canvas) return;
        const width = Math.max(1, canvas.parentElement!.clientWidth - 16);
        this.textService.renderTextToCanvas(previewText, canvas, this.fontImage, width);
    }

    private observePreviews() {
        this.resizeObserver?.disconnect();
        if (typeof ResizeObserver === 'undefined') return;
        this.resizeObserver = new ResizeObserver(entries => {
            for (const observed of entries) {
                const canvas = observed.target.querySelector<HTMLCanvasElement>('canvas');
                const id = Number(canvas?.dataset['entryId']);
                const entry = this.strings.find(item => item.id === id);
                if (entry) this.renderSingle(entry, this.activeEntryId === id ? Array.from(entry.renderKey).slice(0, this.typePosition).join('') : entry.renderKey);
            }
        });
        this.previews.forEach(item => this.resizeObserver!.observe(item.nativeElement));
    }
}
