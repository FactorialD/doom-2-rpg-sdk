import { Component, input, output, computed, effect, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MONSTER_FLAGS, ScriptOperation } from '../../../core/constants/scripting';

@Component({
  selector: 'app-monster-flag-editor',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="bg-black/30 border border-neutral-700 rounded p-2 text-xs font-mono">
        <div class="grid grid-cols-2 gap-2 mb-2">
            <!-- Entity ID -->
            <div>
                <label class="block text-[10px] text-neutral-500 uppercase font-bold mb-1">Entity ID</label>
                <input 
                    type="number" 
                    [ngModel]="entityId()" 
                    (ngModelChange)="updateEntityId($event)"
                    class="w-full bg-neutral-900 border border-neutral-600 text-white px-2 py-1 rounded outline-none focus:border-blue-500"
                />
            </div>
            
            <!-- Operation -->
            <div>
                <label class="block text-[10px] text-neutral-500 uppercase font-bold mb-1">Operation</label>
                <select 
                    [ngModel]="operation()" 
                    (ngModelChange)="updateOperation($event)"
                    class="w-full bg-neutral-900 border border-neutral-600 text-white px-2 py-1 rounded outline-none focus:border-blue-500">
                    <option [value]="0">ADD Flag</option>
                    <option [value]="1">REMOVE Flag</option>
                    <option [value]="2">SET Flags</option>
                </select>
            </div>
        </div>

        <!-- Flag Selection -->
        <div>
            <label class="block text-[10px] text-neutral-500 uppercase font-bold mb-1">Flag</label>
            <select 
                [ngModel]="flagIndex()" 
                (ngModelChange)="updateFlag($event)"
                class="w-full bg-neutral-900 border border-neutral-600 text-amber-500 px-2 py-1 rounded outline-none focus:border-blue-500 font-bold">
                @for (f of flags; track f.id) {
                    <option [value]="f.id">{{ f.name }} (Bit {{ f.id }}) - {{ f.desc }}</option>
                }
            </select>
            <div class="mt-1 text-[9px] text-neutral-500">
                Raw Value: {{ rawPackedValue() }} (Op: {{operation()}} | Flag: {{flagIndex()}})
            </div>
        </div>
    </div>
  `
})
export class MonsterFlagEditorComponent {
    // Current raw args string (e.g., "5 64")
    args = input<string>('');
    argsChange = output<string>();

    entityId = signal(0);
    operation = signal(ScriptOperation.Add); 
    flagIndex = signal(0);

    readonly flags = MONSTER_FLAGS;

    rawPackedValue = computed(() => {
        return (this.operation() << 6) | (this.flagIndex() & 63);
    });

    constructor() {
        // Parse incoming string to state
        effect(() => {
            const raw = this.args();
            const parts = raw.trim().split(/\s+/).map(n => parseInt(n, 10));
            
            // Only update signals if we aren't the ones who triggered the change
            // (Simple check: compare logic)
            if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
                const eId = parts[0];
                const packed = parts[1];
                
                const op = (packed >> 6) & 3;
                const flag = packed & 63;

                // Use untracked/conditional setting to avoid loops if needed, 
                // but Signals handle equality checks internally.
                this.entityId.set(eId);
                this.operation.set(op);
                this.flagIndex.set(flag);
            }
        }, { allowSignalWrites: true });
    }

    updateEntityId(val: number) {
        this.entityId.set(val);
        this.emitArgs();
    }

    updateOperation(val: number) {
        this.operation.set(+val);
        this.emitArgs();
    }

    updateFlag(val: number) {
        this.flagIndex.set(+val);
        this.emitArgs();
    }

    private emitArgs() {
        const packed = (this.operation() << 6) | (this.flagIndex() & 63);
        const str = `${this.entityId()} ${packed}`;
        this.argsChange.emit(str);
    }
}