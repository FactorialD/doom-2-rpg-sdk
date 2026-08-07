import { Component, input, output, signal, effect, inject, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ScriptData, ScriptInstruction, DoomScriptService } from '../../../services/doom-script.service';
import { TextureThumbnailComponent } from '../../texture-viewer/texture-thumbnail/texture-thumbnail.component';
import { ScriptInstructionEditorComponent } from '../script-instruction-editor/script-instruction-editor.component';

export interface ScriptBlock {
    title: string;
    offset: number;
    instructions: ScriptInstruction[];
    isOpen: boolean;
}

type InsertMode = 'before' | 'after' | null;

@Component({
  selector: 'app-script-code-view',
  standalone: true,
  imports: [CommonModule, FormsModule, TextureThumbnailComponent, ScriptInstructionEditorComponent],
  template: `
    <div class="flex flex-col h-full bg-[#1e1e1e]">
        <!-- Toolbar -->
         <div class="h-10 border-b border-neutral-800 bg-neutral-900 flex items-center px-4 justify-between shrink-0">
             <div class="flex items-center gap-4">
                 <span class="font-bold text-white">Disassembly</span>
                 @if(scriptData(); as data) {
                     <span class="text-xs text-neutral-500">{{ data.instructions.length }} instructions, {{ data.rawSize }} bytes</span>
                 }
             </div>
             
             <div class="flex items-center gap-2">
                 <button 
                    (click)="saveScript()"
                    [disabled]="!hasChanges()"
                    class="px-3 py-1 text-xs font-bold text-white bg-green-700 hover:bg-green-600 disabled:bg-neutral-800 disabled:text-neutral-500 rounded transition-colors flex items-center gap-2">
                    <span>💾</span> Apply Changes
                 </button>
                 <div class="h-4 w-px bg-neutral-700 mx-1"></div>
                 <button 
                    (click)="toggleHex()"
                    class="px-2 py-1 text-xs rounded border border-neutral-700 hover:bg-neutral-800 transition-colors"
                    [class.bg-neutral-800]="showHex()"
                    [class.text-white]="showHex()">
                    {{ showHex() ? 'Hide Hex' : 'Show Hex' }}
                 </button>
             </div>
         </div>

         <!-- Scrollable Code Area -->
         <div class="flex-1 overflow-y-auto custom-scrollbar p-0" id="codeContainer">
            @if (error(); as err) {
                <div class="p-4 text-red-400 font-mono text-xs whitespace-pre-wrap bg-red-900/10 border border-red-900/30 rounded m-4">{{ err }}</div>
            } @else if (isLoading()) {
                <div class="text-neutral-500 italic p-4">Disassembling...</div>
            } @else if (scriptBlocks().length > 0) {
                
                <!-- Grouped Blocks -->
                <div class="font-mono text-xs pb-20">
                    <!-- CRITICAL: Use unique instruction UID as track key to prevent NG0955 loops -->
                    @for (block of scriptBlocks(); track block.instructions[0].uid) {
                         <div [id]="'block-' + block.offset" class="border-b border-neutral-800">
                             <!-- Header -->
                             <div 
                                (click)="toggleBlock(block)"
                                class="bg-neutral-900 px-4 py-2 flex items-center gap-2 cursor-pointer hover:bg-neutral-800 sticky top-0 z-10 select-none border-b border-neutral-800">
                                <span class="text-neutral-500 transform transition-transform duration-200" [class.rotate-90]="block.isOpen">▶</span>
                                <span class="text-amber-500 font-bold">{{ block.title }}</span>
                                <span class="text-neutral-600 text-[10px] ml-auto">0x{{ padHex(block.offset, 4) }}</span>
                             </div>
                             
                             <!-- Content -->
                             @if (block.isOpen) {
                                 <div class="block-content">
                                    @for (inst of block.instructions; track inst.uid) {
                                        
                                        <!-- Insert Before Point -->
                                        @if (insertTargetOffset === inst.offset && insertMode === 'before') {
                                            <app-script-instruction-editor
                                                [scriptData]="scriptData()"
                                                [instruction]="null"
                                                [insertMode]="'before'"
                                                [mapId]="scriptData()!.mapId"
                                                (save)="onSaveEditor($event)"
                                                (cancel)="cancelEdit()"
                                            />
                                        }

                                        <!-- Instruction Row -->
                                        <div 
                                            class="grid grid-cols-[24px_60px_1fr] border-b border-white/5 group relative" 
                                            [id]="'inst-' + inst.offset"
                                            [class.bg-blue-900_20]="editIndex === inst.offset"
                                            [class.border-t-2]="dragOverId === inst.uid && dragPosition === 'before'"
                                            [class.border-t-blue-500]="dragOverId === inst.uid && dragPosition === 'before'"
                                            [class.border-b-2]="dragOverId === inst.uid && dragPosition === 'after'"
                                            [class.border-b-blue-500]="dragOverId === inst.uid && dragPosition === 'after'"
                                            (dragover)="onDragOver($event, inst)"
                                            (dragleave)="onDragLeave($event)"
                                            (drop)="onDrop($event, inst)"
                                        >
                                            <!-- Column 1: Drag Handle -->
                                            <div 
                                                class="flex items-center justify-center cursor-grab active:cursor-grabbing text-neutral-600 hover:text-neutral-300 hover:bg-neutral-800 border-r border-white/5 bg-neutral-900/30"
                                                draggable="true"
                                                (dragstart)="onDragStart($event, inst)"
                                                title="Drag to move line"
                                            >
                                                ⋮
                                            </div>

                                            <!-- Column 2: Offset & Actions -->
                                            <div class="px-2 py-1 text-neutral-600 select-none border-r border-white/5 bg-neutral-900/30 text-right flex flex-col justify-center relative">
                                                {{ padHex(inst.offset, 4) }}
                                                
                                                <!-- Action Buttons (Hover) -->
                                                <div class="absolute inset-0 bg-neutral-800 flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                                                    <button (click)="startInsert(inst.offset, 'before')" class="text-green-400 hover:text-white px-0.5" title="Insert Before">⬆</button>
                                                    <button (click)="startEdit(inst)" class="text-blue-400 hover:text-white px-0.5" title="Edit">✎</button>
                                                    <button (click)="startInsert(inst.offset, 'after')" class="text-green-400 hover:text-white px-0.5" title="Insert After">⬇</button>
                                                </div>
                                            </div>
                                            
                                            <!-- Column 3: Code Content -->
                                            <div class="col-span-1 min-w-0">
                                                @if (editIndex === inst.offset) {
                                                    <!-- IN-PLACE EDIT MODE -->
                                                     <app-script-instruction-editor
                                                        [scriptData]="scriptData()"
                                                        [instruction]="inst"
                                                        [insertMode]="null"
                                                        [mapId]="scriptData()!.mapId"
                                                        (save)="onSaveEditor($event)"
                                                        (cancel)="cancelEdit()"
                                                        (delete)="deleteLine(inst)"
                                                    />
                                                } @else {
                                                    <!-- VIEW MODE -->
                                                    <div class="flex gap-2 p-0 h-full">
                                                        <!-- Raw/Hex -->
                                                        <div class="w-[180px] px-2 py-1 border-r border-white/5 overflow-hidden shrink-0 flex flex-col justify-center">
                                                            <div class="text-blue-400 font-bold mb-0.5 truncate">{{ inst.name }}</div>
                                                            @if(showHex()) {
                                                                <div class="text-[10px] text-neutral-600 tracking-tighter">{{ getHexDump(inst.originalBytes) }}</div>
                                                            }
                                                            <div class="text-amber-700/70 truncate">{{ inst.formattedArgs }}</div>
                                                        </div>

                                                        <!-- Readable -->
                                                        <div class="px-2 py-1 flex-1 min-w-0 flex flex-col justify-center">
                                                            <div class="font-bold truncate" [class.text-green-400]="inst.isLogic" [class.text-neutral-300]="!inst.isLogic">
                                                                {{ inst.readableName }}
                                                            </div>
                                                            <div class="text-neutral-400 text-[11px] truncate">{{ inst.readableDetails }}</div>

                                                            <!-- Schema-driven semantic reference previews. -->
                                                            @for (preview of referencePreviews(inst); track preview.argumentIndex) {
                                                                <div class="mt-1 flex items-center gap-1.5 text-[10px] min-w-0"
                                                                     [class.text-red-300]="preview.status === 'invalid'"
                                                                     [class.text-amber-300]="preview.status === 'missing'"
                                                                     [class.text-cyan-300]="preview.status === 'valid'"
                                                                     [title]="preview.warning || preview.label">
                                                                    <span class="text-neutral-500">{{ preview.name }}={{ preview.rawValue }}</span>
                                                                    <span aria-hidden="true">→</span>
                                                                    @if (preview.warning) { <span aria-label="Reference warning">⚠</span> }
                                                                    @if (preview.textureId !== undefined) {
                                                                        <button (click)="showTexture.emit(preview.textureId!)" class="w-6 h-6 bg-black border border-neutral-700 hover:border-white shrink-0" title="Open texture #{{ preview.textureId }}">
                                                                            <app-texture-thumbnail [id]="preview.textureId" />
                                                                        </button>
                                                                    }
                                                                    <span class="truncate">{{ preview.label }}</span>
                                                                    @if (preview.reference === 'entity-index' && preview.status !== 'invalid') {
                                                                        <button (click)="showEntity.emit(preview.value)" class="text-blue-300 hover:text-white" title="Show entity on map">🎯</button>
                                                                    }
                                                                    @if (preview.reference === 'sound-index' && preview.status === 'valid') {
                                                                        <button (click)="playSound.emit(preview.value)" class="text-green-300 hover:text-white" title="Play sound">🔊</button>
                                                                    }
                                                                    @if (preview.reference === 'string-index' && preview.stringChunk !== undefined) {
                                                                        <button (click)="showText.emit({chunk: preview.stringChunk!, id: preview.value})" class="text-amber-300 hover:text-white" title="Open string editor">📝</button>
                                                                    }
                                                                    @if (preview.targetOffset !== undefined && preview.status === 'valid') {
                                                                        <button (click)="scrollToOffset(preview.targetOffset)" class="text-white hover:text-cyan-200" title="Go to instruction">⤵</button>
                                                                    }
                                                                </div>
                                                            }
                                                            
                                                            <!-- Interactive Buttons -->
                                                            <div class="flex flex-wrap gap-2 mt-1">
                                                                @if (inst.jumpTarget !== undefined) {
                                                                    <button (click)="scrollToOffset(inst.jumpTarget)" class="text-[10px] bg-neutral-700 hover:bg-neutral-600 text-white px-2 py-0.5 rounded flex items-center gap-1">
                                                                        <span>⤵</span> {{ padHex(inst.jumpTarget, 4) }}
                                                                    </button>
                                                                }
                                                                @if (inst.referencedEntityId !== undefined) {
                                                                    <button (click)="showEntity.emit(inst.referencedEntityId!)" class="text-[10px] bg-blue-900/40 hover:bg-blue-800 text-blue-300 px-2 py-0.5 rounded border border-blue-800">
                                                                        <span>🎯</span> #{{ inst.referencedEntityId }}
                                                                    </button>
                                                                }
                                                                @if (inst.soundId !== undefined) {
                                                                    <button (click)="playSound.emit(inst.soundId!)" class="text-[10px] bg-green-900/40 hover:bg-green-800 text-green-300 px-2 py-0.5 rounded border border-green-800">
                                                                        <span>🔊</span> #{{ inst.soundId }}
                                                                    </button>
                                                                }
                                                                @if (inst.referencedStringId !== undefined) {
                                                                    <button (click)="showText.emit({chunk: inst.referencedChunkId || 0, id: inst.referencedStringId!})" class="text-[10px] bg-amber-900/40 hover:bg-amber-800 text-amber-300 px-2 py-0.5 rounded border border-amber-800">
                                                                        <span>📝</span> #{{ inst.referencedStringId }}
                                                                    </button>
                                                                }
                                                                @if (inst.iconId !== undefined && inst.iconId !== -1) {
                                                                    <div 
                                                                    (click)="showTexture.emit(inst.iconId!)"
                                                                    class="w-6 h-6 bg-black border border-neutral-700 hover:border-white cursor-pointer ml-auto" 
                                                                    title="Go to Texture #{{inst.iconId}}">
                                                                        <app-texture-thumbnail [id]="inst.iconId" />
                                                                    </div>
                                                                }
                                                            </div>
                                                        </div>
                                                    </div>
                                                }
                                            </div>
                                        </div>
                                        
                                        <!-- Insert After Point -->
                                        @if (insertTargetOffset === inst.offset && insertMode === 'after') {
                                            <app-script-instruction-editor
                                                [scriptData]="scriptData()"
                                                [instruction]="null"
                                                [insertMode]="'after'"
                                                [mapId]="scriptData()!.mapId"
                                                (save)="onSaveEditor($event)"
                                                (cancel)="cancelEdit()"
                                            />
                                        }
                                    }
                                 </div>
                             }
                         </div>
                    }
                </div>
            } @else {
                 <div class="p-4 text-neutral-500 italic">No instructions found.</div>
            }
         </div>
    </div>
  `,
  styles: [`
    .custom-scrollbar::-webkit-scrollbar { width: 10px; height: 10px; }
    .custom-scrollbar::-webkit-scrollbar-track { background: #1a1a1a; }
    .custom-scrollbar::-webkit-scrollbar-thumb { background: #333; border: 2px solid #1a1a1a; border-radius: 5px; }
    .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #444; }
  `],
  // Optimization: OnPush to prevent constant change detection during drag events
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ScriptCodeViewComponent {
    scriptData = input<ScriptData | null>(null);
    scriptBlocks = input<ScriptBlock[]>([]);
    isLoading = input<boolean>(false);
    error = input<string | null>(null);
    targetOffset = input<number | null>(null); 

    showEntity = output<number>();
    showTexture = output<number>();
    playSound = output<number>();
    showText = output<{chunk: number, id: number}>();
    dataChanged = output<void>(); 
    
    scriptService = inject(DoomScriptService);
    
    showHex = signal(false);
    hasChanges = signal(false);

    editIndex: number | null = null;
    insertTargetOffset: number | null = null;
    insertMode: InsertMode = null;
    
    // Drag & Drop State
    dragOverId: string | null = null;
    dragPosition: 'before' | 'after' | null = null;
    
    constructor() {
        effect(() => {
            const offset = this.targetOffset();
            if (offset !== null) {
                this.scrollToOffset(offset);
            }
        });
        
        effect(() => {
             if (this.scriptData()) {
                 this.hasChanges.set(false);
                 this.cancelEdit();
             }
        });
    }

    toggleHex() {
        this.showHex.update(v => !v);
    }
    
    toggleBlock(block: ScriptBlock) {
        block.isOpen = !block.isOpen;
    }

    padHex(val: number, pad: number): string {
        return val.toString(16).toUpperCase().padStart(pad, '0');
    }

    getHexDump(bytes: number[]): string {
        if (!bytes) return '';
        return bytes.map(b => '0x' + b.toString(16).toUpperCase().padStart(2, '0')).join(' ');
    }

    referencePreviews(inst: ScriptInstruction) {
        const data = this.scriptData();
        return data ? this.scriptService.resolveReferenceArguments(data, inst) : [];
    }

    scrollToOffset(offset: number) {
        const blocks = this.scriptBlocks();
        const targetBlock = blocks.find(b => 
            offset >= b.offset && 
            (b.instructions.length > 0 && offset <= b.instructions[b.instructions.length-1].offset)
        );
        
        if (targetBlock) {
            targetBlock.isOpen = true;
            setTimeout(() => {
                const el = document.getElementById(`inst-${offset}`);
                if (el) {
                    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    el.classList.add('bg-neutral-700');
                    setTimeout(() => el.classList.remove('bg-neutral-700'), 1000);
                }
            }, 100);
        }
    }
    
    // --- Editing Methods ---

    startEdit(inst: ScriptInstruction) {
        this.cancelEdit();
        this.editIndex = inst.offset;
    }
    
    startInsert(offset: number, mode: InsertMode) {
        this.cancelEdit();
        this.insertTargetOffset = offset;
        this.insertMode = mode;
    }
    
    cancelEdit() {
        this.editIndex = null;
        this.insertTargetOffset = null;
        this.insertMode = null;
    }
    
    onSaveEditor(event: {opcodeName: string, args: string, bytes: number[]}) {
        if (!this.scriptData()) return;

        if (this.insertMode) {
             // Insert
             if (this.insertTargetOffset === null) return;
             this.scriptService.insertInstruction(this.scriptData()!, this.insertTargetOffset, event.bytes, this.insertMode);
        } else {
            // Edit
            if (this.editIndex === null) return;
            const inst = this.scriptData()!.instructions.find(i => i.offset === this.editIndex);
            if (inst) {
                this.scriptService.updateInstruction(this.scriptData()!, inst, event.bytes);
            }
        }

        this.hasChanges.set(true);
        this.cancelEdit();
        this.dataChanged.emit();
    }

    deleteLine(inst: ScriptInstruction) {
        if (inst && confirm(`Delete instruction at 0x${this.padHex(inst.offset, 4)}?`)) {
            if (this.scriptData()) {
                this.scriptService.deleteInstruction(this.scriptData()!, inst);
                this.hasChanges.set(true);
                this.cancelEdit();
                this.dataChanged.emit();
            }
        }
    }
    
    saveScript() {
        if (!this.scriptData()) return;
        this.scriptService.saveScriptChanges(this.scriptData()!);
        this.hasChanges.set(false);
        alert('Script compiled and updated in memory! Offsets have been smartly relocated.');
    }
    
    // --- Drag & Drop ---
    
    onDragStart(event: DragEvent, inst: ScriptInstruction) {
        if (event.dataTransfer) {
            event.dataTransfer.setData('text/plain', inst.uid);
            event.dataTransfer.effectAllowed = 'move';
        }
    }
    
    onDragOver(event: DragEvent, inst: ScriptInstruction) {
        event.preventDefault(); // Essential to allow drop
        if (!event.currentTarget) return;
        
        const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        
        const newPos = event.clientY < midY ? 'before' : 'after';

        // Optimized: Only update if changed to avoid layout thrashing loop
        if (this.dragOverId !== inst.uid || this.dragPosition !== newPos) {
            this.dragOverId = inst.uid;
            this.dragPosition = newPos;
        }
    }
    
    onDragLeave(event: DragEvent) {
        // Debounce clearing to prevent flicker when moving between rows
        // this.dragOverId = null;
        // this.dragPosition = null;
    }
    
    onDrop(event: DragEvent, targetInst: ScriptInstruction) {
        event.preventDefault();
        
        // Capture state before reset
        const dropPos = this.dragPosition;
        
        this.dragOverId = null;
        this.dragPosition = null;
        
        const draggedUid = event.dataTransfer?.getData('text/plain');
        if (!draggedUid || !dropPos) return;
        
        if (draggedUid === targetInst.uid) return; // Dropped on self
        
        const data = this.scriptData();
        if (data) {
            this.scriptService.moveInstruction(data, draggedUid, targetInst.uid, dropPos);
            this.hasChanges.set(true);
            this.dataChanged.emit();
        }
    }
}
