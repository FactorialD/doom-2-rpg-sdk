import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DoomFileService } from '../../services/doom-file.service';
import { DoomScriptService, ItemReference } from '../../services/doom-script.service';
import { EditorService } from '../../services/editor.service';
import { getVariableMetadata } from '../../services/doom-variables';
import { SidebarPanelComponent } from '../../shared/components/sidebar-panel/sidebar-panel.component';
import { SearchInputComponent } from '../../shared/components/search-input/search-input.component';

interface VariableData {
    id: number;
    name: string;
    isSystem: boolean;
    storage: string;
}

@Component({
  selector: 'app-variables-viewer',
  standalone: true,
  imports: [CommonModule, FormsModule, SidebarPanelComponent, SearchInputComponent],
  template: `
    <div class="flex h-full w-full bg-[#1a1a1a] text-sm text-neutral-300">
        <!-- Sidebar: List of Variables -->
        <app-sidebar-panel widthClass="w-72">
            <div class="p-4 border-b border-neutral-800">
                <h2 class="text-white font-bold mb-4 flex items-center gap-2">
                    <span>Variables</span>
                    <span class="text-[10px] font-normal text-neutral-500 bg-neutral-800 px-2 py-0.5 rounded-full">128</span>
                </h2>
                
                @if (!fileService.isLoaded()) {
                    <div class="text-xs text-neutral-500 italic p-2 border border-neutral-800 rounded bg-neutral-900/50">
                        Load a JAR file to view variables.
                    </div>
                } @else {
                     <app-search-input placeholder="Search ID or Name..." [(query)]="searchQuery" />
                }
            </div>
            
            <div class="flex-1 overflow-y-auto custom-scrollbar">
                @for (v of filteredVariables(); track v.id) {
                    <div 
                        (click)="selectVariable(v)"
                        class="flex items-center gap-3 px-4 py-2 border-b border-neutral-800 cursor-pointer hover:bg-neutral-800 transition-colors border-l-4"
                        [class.border-l-transparent]="selectedVariable()?.id !== v.id"
                        [class.border-l-red-600]="selectedVariable()?.id === v.id"
                        [class.bg-red-900_20]="selectedVariable()?.id === v.id"
                    >
                        <span class="font-mono text-xs text-neutral-500 w-8">#{{ v.id }}</span>
                        <div class="flex flex-col">
                            <span class="text-xs font-bold" [class.text-amber-500]="v.isSystem" [class.text-white]="!v.isSystem">{{ v.name }}</span>
                            @if(v.isSystem) {
                                <span class="text-[9px] text-neutral-600">System Reserved</span>
                            } @else {
                                <span class="text-[9px] text-neutral-600">User Variable</span>
                            }
                        </div>
                    </div>
                }
            </div>
        </app-sidebar-panel>

        <!-- Main Content: Inspector -->
        <div class="flex-1 flex flex-col overflow-hidden bg-neutral-950">
             @if (selectedVariable(); as v) {
                 <div class="p-6 h-full flex flex-col">
                     <!-- Header -->
                     <div class="flex items-center gap-4 mb-6 pb-6 border-b border-neutral-800">
                         <div class="w-12 h-12 bg-neutral-900 rounded flex items-center justify-center font-bold text-xl text-neutral-600 font-mono">
                             {{ v.id }}
                         </div>
                         <div>
                             <h1 class="text-xl font-bold text-white mb-1">{{ v.name }}</h1>
                             <span class="px-2 py-0.5 rounded text-[10px] uppercase font-bold" 
                                [class.bg-amber-900_20]="v.isSystem" 
                                [class.text-amber-500]="v.isSystem"
                                [class.bg-blue-900_20]="!v.isSystem" 
                                [class.text-blue-500]="!v.isSystem">
                                {{ v.isSystem ? 'System Variable' : 'User Variable' }}
                             </span>
                             <p class="mt-3 max-w-2xl text-xs text-neutral-500">The label is SDK reference metadata and is never written to the JAR. Values live in the 128-entry runtime array; only literal values in Java-confirmed <code>EV_SETSTATE</code> instructions can be saved here.</p>
                             @if (saveMessage(); as message) { <p class="mt-2 text-xs text-emerald-400" role="status">{{ message }}</p> }
                         </div>
                     </div>
                     
                     <!-- Script References -->
                     <div class="flex-1 overflow-hidden flex flex-col">
                         <div class="flex items-center justify-between mb-3">
                             <h3 class="font-bold text-sm text-neutral-400 uppercase tracking-wider">Script References</h3>
                             @if(loadingReferences()) {
                                 <span class="text-xs text-amber-500 animate-pulse">Scanning...</span>
                             }
                         </div>
                         
                         <div class="flex-1 overflow-y-auto custom-scrollbar bg-[#111] border border-neutral-800 rounded">
                             @if (!loadingReferences() && references().length === 0) {
                                 <div class="flex items-center justify-center h-full text-neutral-600 italic">
                                     No references found in map scripts.
                                 </div>
                             } @else {
                                 <table class="w-full text-xs text-left">
                                     <thead class="bg-neutral-900 text-neutral-500 font-mono sticky top-0">
                                         <tr>
                                             <th class="p-2 border-b border-neutral-800">Map</th>
                                             <th class="p-2 border-b border-neutral-800">Offset</th>
                                             <th class="p-2 border-b border-neutral-800">Instruction</th>
                                             <th class="p-2 border-b border-neutral-800">Action</th>
                                         </tr>
                                     </thead>
                                     <tbody>
                                         @for (ref of references(); track $index) {
                                             <tr class="hover:bg-neutral-800 border-b border-neutral-800/50 group">
                                                 <td class="p-2 font-bold text-neutral-400">Map {{ ref.mapId }}</td>
                                                 <td class="p-2 font-mono text-neutral-500">0x{{ ref.instruction.offset.toString(16).toUpperCase().padStart(4,'0') }}</td>
                                                 <td class="p-2 text-white font-mono">{{ ref.instruction.readableDetails }}</td>
                                                 <td class="p-2">
                                                     @if (ref.instruction.opcode === 6) {
                                                         <div class="mb-2 flex gap-2">
                                                             <input type="number" min="-32768" max="32767" step="1" [ngModel]="assignmentDraft(ref)" (ngModelChange)="setAssignmentDraft(ref, $event)" class="w-24 rounded border border-neutral-700 bg-neutral-950 px-2 py-1 font-mono text-white" />
                                                             <button (click)="saveAssignment(ref)" class="rounded bg-red-800 px-2 py-1 text-[10px] font-bold text-white hover:bg-red-700">Save value</button>
                                                         </div>
                                                     } @else {
                                                         <div class="mb-2 text-[9px] text-neutral-600">Runtime read/write; no literal value to serialize</div>
                                                     }
                                                     <button (click)="goToScript(ref)" class="px-2 py-1 bg-blue-900/30 hover:bg-blue-800 text-blue-400 hover:text-white rounded transition-colors text-[10px]">
                                                         Jump to Code
                                                     </button>
                                                 </td>
                                             </tr>
                                         }
                                     </tbody>
                                 </table>
                             }
                         </div>
                     </div>
                 </div>
             } @else {
                 <div class="flex flex-col items-center justify-center h-full text-neutral-600 select-none">
                     <span class="text-4xl mb-4 opacity-20">📊</span>
                     <p>Select a variable to view details.</p>
                 </div>
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
export class VariablesViewerComponent {
    fileService = inject(DoomFileService);
    scriptService = inject(DoomScriptService);
    editorService = inject(EditorService);

    variables = computed(() => {
        const list: VariableData[] = [];
        for(let i=0; i<128; i++) {
            const isSystem = i <= 16;
            const metadata = getVariableMetadata(i);
            list.push({ id: i, name: metadata.sdkName, isSystem, storage: metadata.storage });
        }
        return list;
    });
    
    searchQuery = signal('');
    
    filteredVariables = computed(() => {
        const q = this.searchQuery().toLowerCase();
        return this.variables().filter(v => 
            v.id.toString().includes(q) || v.name.toLowerCase().includes(q)
        );
    });
    
    selectedVariable = signal<VariableData | null>(null);
    references = signal<ItemReference[]>([]);
    loadingReferences = signal(false);
    saveMessage = signal<string | null>(null);
    private assignmentDrafts = new Map<string, number>();

    async selectVariable(v: VariableData) {
        this.selectedVariable.set(v);
        this.references.set([]);
        
        if (!this.fileService.isLoaded()) return;
        
        this.loadingReferences.set(true);
        try {
            const refs = await this.scriptService.findReferencesToVariable(v.id);
            this.references.set(refs);
        } catch (e) {
            console.error("Error scanning variables", e);
        } finally {
            this.loadingReferences.set(false);
        }
    }
    
    goToScript(ref: ItemReference) {
        this.editorService.goToScript(ref.mapId, ref.instruction.offset);
    }

    assignmentDraft(ref: ItemReference) { return this.assignmentDrafts.get(ref.instruction.uid) ?? Number(ref.instruction.params[1]); }
    setAssignmentDraft(ref: ItemReference, raw: unknown) { this.assignmentDrafts.set(ref.instruction.uid, Number(raw)); }
    async saveAssignment(ref: ItemReference) {
        const value = this.assignmentDraft(ref);
        if (!Number.isInteger(value) || value < -32768 || value > 32767) { this.saveMessage.set('Value must be an integer from -32768 to 32767.'); return; }
        const saved = await this.scriptService.saveVariableAssignment(ref.mapId, ref.instruction.uid, value);
        this.saveMessage.set(saved ? `Saved EV_SETSTATE in map ${ref.mapId}.` : 'This reference is not a writable EV_SETSTATE instruction.');
    }
}
