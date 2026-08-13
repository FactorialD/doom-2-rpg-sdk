
import { Component, effect, input, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { EditableEntityDef, EntityDef } from '../../../services/doom-entities.service';
import { MapEntityLocation } from '../../../services/doom-map.service';
import { ItemReference } from '../../../services/doom-script.service';
import { TextEntry } from '../../../services/doom-text.service';
import { resolveEntityString } from '../item-string-resolver';

export interface ItemViewData {
    def: EntityDef;
    name: string;
}

@Component({
  selector: 'app-item-inspector',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <aside class="w-72 bg-neutral-900 border-l border-neutral-800 flex flex-col flex-none overflow-hidden animate-slide-in">
        @if (item(); as i) {
            <div class="p-4 border-b border-neutral-800 bg-neutral-900 sticky top-0 z-10">
                <div class="text-[10px] font-bold text-neutral-500 uppercase tracking-wider mb-1">Item Inspector</div>
                <h3 class="text-lg font-bold text-white leading-tight">{{ resolveString(draft().nameId) }}</h3>
                <div class="flex items-center gap-2 mt-2 text-xs font-mono text-neutral-400">
                    <span class="bg-neutral-800 px-2 py-0.5 rounded">Type: {{ i.def.eSubType }}</span>
                    <span class="bg-neutral-800 px-2 py-0.5 rounded">ID: {{ i.def.parm }}</span>
                </div>
            </div>

            <div class="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-6">
                <!-- EntityDef.startup reads exactly these eight bytes from entities.bin. -->
                <div>
                    <div class="text-[10px] font-bold text-neutral-500 uppercase tracking-wider mb-2">entities.bin record</div>
                    <div class="bg-black/40 border border-neutral-800 rounded p-3 text-xs space-y-3">
                        @for (field of numericFields; track field.key) {
                            <label class="block"><span class="mb-1 flex justify-between text-neutral-400"><span>{{ field.label }}</span><span class="font-mono">{{ field.min }}…{{ field.max }}</span></span>
                                <input type="number" [min]="field.min" [max]="field.max" step="1"
                                    [ngModel]="draft()[field.key]" (ngModelChange)="setField(field.key, $event)"
                                    class="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 font-mono text-white outline-none focus:border-red-700" />
                            </label>
                        }
                        <div class="border-t border-neutral-800 pt-3 space-y-4">
                            <div class="text-[10px] font-bold text-neutral-500 uppercase tracking-wider">String references (chunk 1)</div>
                            @for (field of stringFields; track field.key) {
                                <div class="space-y-1.5">
                                    <label class="block text-neutral-400" [for]="field.key">{{ field.label }}</label>
                                    <div class="rounded border border-neutral-800 bg-neutral-950 p-2 text-neutral-200 break-words">
                                        <span class="mr-1 font-mono text-neutral-500">#{{ draft()[field.key] }}</span>
                                        {{ resolveString(draft()[field.key]) }}
                                    </div>
                                    <input type="number" min="0" max="255" step="1" [id]="field.key" [attr.list]="field.key + '-strings'"
                                        [ngModel]="draft()[field.key]" (ngModelChange)="setField(field.key, $event)"
                                        class="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 font-mono text-white outline-none focus:border-red-700" />
                                    <datalist [id]="field.key + '-strings'">
                                        @for (entry of strings(); track entry.id) { <option [value]="entry.id">{{ entry.raw }}</option> }
                                    </datalist>
                                    <button type="button" (click)="editString.emit(draft()[field.key])"
                                        class="text-xs text-blue-400 hover:text-blue-300">Edit current string</button>
                                </div>
                            }
                        </div>
                        @if (validationError(); as error) { <p class="text-red-400" role="alert">{{ error }}</p> }
                        @if (saved()) { <p class="text-emerald-400" role="status">Saved to entities.bin.</p> }
                        <button type="button" (click)="save()" [disabled]="!!validationError() || !dirty()"
                            class="w-full rounded bg-red-800 px-3 py-2 font-bold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-40">Save item definition</button>
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
    strings = input<TextEntry[]>([]);
    
    showOnMap = output<MapEntityLocation>();
    goToScript = output<ItemReference>();
    saveItem = output<EditableEntityDef>();
    editString = output<number>();

    readonly numericFields: Array<{ key: keyof EditableEntityDef; label: string; min: number; max: number }> = [
        { key: 'tileIndex', label: 'Tile index (int16)', min: -32768, max: 32767 },
        { key: 'eType', label: 'Entity type (int8)', min: -128, max: 127 },
        { key: 'eSubType', label: 'Subtype (int8)', min: -128, max: 127 },
        { key: 'parm', label: 'Item parameter (int8)', min: -128, max: 127 }
    ];
    readonly stringFields: Array<{ key: 'nameId' | 'longNameId' | 'descriptionId'; label: string }> = [
        { key: 'nameId', label: 'Name string ID (uint8)' },
        { key: 'longNameId', label: 'Long-name string ID (uint8)' },
        { key: 'descriptionId', label: 'Description string ID (uint8)' }
    ];
    readonly draft = signal<EditableEntityDef>({ tileIndex: 0, eType: 0, eSubType: 0, parm: 0, nameId: 0, longNameId: 0, descriptionId: 0 });
    readonly dirty = signal(false);
    readonly saved = signal(false);
    readonly validationError = signal<string | null>(null);

    constructor() {
        effect(() => {
            const def = this.item()?.def;
            if (!def) return;
            const { index: _index, ...editable } = def;
            this.draft.set(editable); this.dirty.set(false); this.saved.set(false); this.validate();
        });
    }

    setField(key: keyof EditableEntityDef, raw: unknown) {
        this.draft.update(value => ({ ...value, [key]: Number(raw) }));
        this.dirty.set(true); this.saved.set(false); this.validate();
    }
    resolveString(id: number): string {
        return resolveEntityString(id, this.strings());
    }
    save() { if (!this.validationError()) { this.saveItem.emit(this.draft()); this.dirty.set(false); this.saved.set(true); } }
    private validate() {
        const fields = [
            ...this.numericFields,
            ...this.stringFields.map(field => ({ ...field, min: 0, max: 255 }))
        ];
        for (const field of fields) {
            const value = this.draft()[field.key];
            if (!Number.isInteger(value) || value < field.min || value > field.max) {
                this.validationError.set(`${field.label} must be an integer from ${field.min} to ${field.max}.`); return;
            }
        }
        this.validationError.set(null);
    }
}
