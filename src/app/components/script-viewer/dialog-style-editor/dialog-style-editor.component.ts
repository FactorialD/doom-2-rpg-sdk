import { Component, input, output, computed, effect, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DoomTextService, TextEntry } from '../../../services/doom-text.service';
import { DialogStyle, DialogFlag } from '../../../core/constants/scripting';

@Component({
  selector: 'app-dialog-style-editor',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="bg-black/30 border border-neutral-700 rounded p-2 text-xs font-mono relative">
        <!-- String ID & Preview -->
        <div class="mb-3 bg-neutral-900 p-2 rounded border border-neutral-800">
            <div class="flex justify-between items-center mb-1">
                <label class="text-[10px] text-neutral-500 uppercase font-bold">Text (ID {{ stringId() }})</label>
                <button (click)="showPicker.set(true)" class="text-[10px] text-blue-400 hover:text-white px-2 py-0.5 border border-blue-900 bg-blue-900/20 rounded">
                    Change Text...
                </button>
            </div>
            
            <div class="text-white italic text-xs leading-tight min-h-[1.5em]">
                "{{ currentStringPreview() }}"
            </div>
        </div>

        <div class="grid grid-cols-2 gap-2">
            <!-- Style -->
            <div>
                <label class="block text-[10px] text-neutral-500 uppercase font-bold mb-1">Style</label>
                <select 
                    [ngModel]="style()" 
                    (ngModelChange)="updateStyle($event)"
                    class="w-full bg-neutral-900 border border-neutral-600 text-white px-2 py-1 rounded outline-none focus:border-blue-500">
                    <option [value]="0">Normal (0)</option>
                    <option [value]="1">NPC (1)</option>
                    <option [value]="2">Help (2)</option>
                    <option [value]="3">Scroll (3)</option>
                    <option [value]="4">Chest (4)</option>
                    <option [value]="5">Monster (5)</option>
                    <option [value]="6">Ghost (6)</option>
                    <option [value]="7">Yell (7)</option>
                    <option [value]="8">Player (8)</option>
                    <option [value]="9">Terminal (9)</option>
                    <option [value]="10">Elevator (10)</option>
                    <option [value]="11">Vios (11)</option>
                    <option [value]="12">Self Destruct (12)</option>
                    <option [value]="13">Armor Repair (13)</option>
                    <option [value]="14">Comm Link (14)</option>
                    <option [value]="15">Sal (15)</option>
                    <option [value]="16">Special (16)</option>
                </select>
            </div>
            
            <!-- Flags -->
            <div>
                <label class="block text-[10px] text-neutral-500 uppercase font-bold mb-1">Flags</label>
                <div class="flex flex-col gap-1">
                    <label class="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" [ngModel]="hasFlag(dialogFlags.YesNo)" (change)="toggleFlag(dialogFlags.YesNo)" class="accent-blue-500">
                        <span>YES/NO (1)</span>
                    </label>
                    <label class="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" [ngModel]="hasFlag(dialogFlags.Interrogate)" (change)="toggleFlag(dialogFlags.Interrogate)" class="accent-blue-500">
                        <span>INTERROGATE (2)</span>
                    </label>
                    <label class="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" [ngModel]="hasFlag(dialogFlags.Game)" (change)="toggleFlag(dialogFlags.Game)" class="accent-blue-500">
                        <span>GAME (4)</span>
                    </label>
                     <label class="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" [ngModel]="hasFlag(dialogFlags.Vios)" (change)="toggleFlag(dialogFlags.Vios)" class="accent-blue-500">
                        <span>VIOS (8)</span>
                    </label>
                </div>
            </div>
        </div>
        
        <!-- STRING PICKER OVERLAY -->
        @if (showPicker()) {
            <div class="absolute inset-0 bg-neutral-900 border border-neutral-600 rounded shadow-xl z-10 flex flex-col p-2">
                 <div class="flex gap-2 mb-2">
                    <input 
                        type="text" 
                        placeholder="Search text..." 
                        class="flex-1 bg-black border border-neutral-700 rounded px-2 py-1 text-xs text-white"
                        [ngModel]="searchQuery()" 
                        (ngModelChange)="searchQuery.set($event)"
                        autofocus
                    >
                    <button (click)="showPicker.set(false)" class="text-red-400 font-bold px-2">X</button>
                 </div>
                 
                 <div class="flex-1 overflow-y-auto custom-scrollbar border border-neutral-800 rounded bg-black/50">
                     @for (str of filteredStrings(); track str.id) {
                         <div 
                            (click)="selectString(str.id)"
                            class="px-2 py-1.5 border-b border-neutral-800 hover:bg-blue-900/50 cursor-pointer flex gap-2">
                             <span class="text-neutral-500 font-bold w-8 shrink-0">#{{str.id}}</span>
                             <span class="text-white truncate">{{str.raw}}</span>
                         </div>
                     } @empty {
                         <div class="p-4 text-center text-neutral-500 italic">No strings found.</div>
                     }
                 </div>
            </div>
        }
    </div>
  `,
  styles: [`
     .custom-scrollbar::-webkit-scrollbar { width: 8px; height: 8px; }
    .custom-scrollbar::-webkit-scrollbar-track { background: #111; }
    .custom-scrollbar::-webkit-scrollbar-thumb { background: #333; border-radius: 4px; border: 2px solid #111; }
    .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #555; }
  `]
})
export class DialogStyleEditorComponent {
    args = input<string>('');
    mapId = input<number>(1);
    argsChange = output<string>();
    
    textService = inject(DoomTextService);

    stringId = signal(0);
    style = signal(DialogStyle.Normal);
    flags = signal(DialogFlag.None);
    
    // Picker State
    showPicker = signal(false);
    searchQuery = signal('');
    mapStrings = signal<TextEntry[]>([]);
    
    dialogFlags = DialogFlag; // Make enum available to template

    rawPackedValue = computed(() => {
        return (this.flags() << 4) | (this.style() & 15);
    });
    
    currentStringPreview = computed(() => {
        const id = this.stringId();
        const found = this.mapStrings().find(s => s.id === id);
        return found ? found.raw : `(String #${id})`;
    });
    
    filteredStrings = computed(() => {
        const q = this.searchQuery().toLowerCase();
        return this.mapStrings().filter(s => 
            s.raw.toLowerCase().includes(q) || s.id.toString().includes(q)
        );
    });

    constructor() {
        // Parse incoming args
        effect(() => {
            const raw = this.args();
            const parts = raw.trim().split(/\s+/).map(n => parseInt(n, 10));
            
            if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
                const sId = parts[0];
                const packed = parts[1];
                
                const s = packed & 15;
                const f = packed >> 4;

                this.stringId.set(sId);
                this.style.set(s);
                this.flags.set(f);
            }
        }, { allowSignalWrites: true });
        
        // Load strings for current map
        effect(() => {
            const mid = this.mapId();
            // Load asynchronously to not block UI
            setTimeout(() => {
                this.mapStrings.set(this.textService.getMapStrings(mid));
            }, 100);
        });
    }
    
    selectString(id: number) {
        this.stringId.set(id);
        this.showPicker.set(false);
        this.emitArgs();
    }
    
    updateStringId(val: number) {
        this.stringId.set(val);
        this.emitArgs();
    }

    updateStyle(val: number) {
        this.style.set(+val);
        this.emitArgs();
    }
    
    hasFlag(bit: number): boolean {
        return (this.flags() & bit) !== 0;
    }
    
    toggleFlag(bit: number) {
        this.flags.update(f => f ^ bit);
        this.emitArgs();
    }

    private emitArgs() {
        const packed = (this.flags() << 4) | (this.style() & 15);
        const str = `${this.stringId()} ${packed}`;
        this.argsChange.emit(str);
    }
}