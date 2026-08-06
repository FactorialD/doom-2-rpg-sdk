import { Component, input, output, signal, inject, ViewChild, ElementRef, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ScriptInstruction } from '../../../services/doom-script.service';
import { SCRIPT_OPCODE_SCHEMA } from '../../../services/scripts/script-opcode-schema';
import { ScriptAssemblerService, AssemblyResult } from '../../../services/scripts/script-assembler.service';
import { MonsterFlagEditorComponent } from '../monster-flag-editor/monster-flag-editor.component';
import { DialogStyleEditorComponent } from '../dialog-style-editor/dialog-style-editor.component';
import { OpcodeAutocompleteComponent, OpcodeItem } from '../opcode-autocomplete/opcode-autocomplete.component';

@Component({
  selector: 'app-script-instruction-editor',
  standalone: true,
  imports: [
    CommonModule, 
    FormsModule, 
    MonsterFlagEditorComponent, 
    DialogStyleEditorComponent, 
    OpcodeAutocompleteComponent
  ],
  template: `
    <div class="p-2 bg-neutral-800 border-l-4" [class.border-green-500]="isInsertMode()" [class.border-blue-500]="!isInsertMode()">
        <div class="text-[10px] font-bold mb-2 uppercase" [class.text-green-400]="isInsertMode()" [class.text-blue-400]="!isInsertMode()">
            {{ isInsertMode() ? 'Insert ' + (insertMode() === 'before' ? 'Before' : 'After') : 'Edit Instruction' }}
        </div>
        
         <div class="flex items-start gap-2 mb-2">
            <div class="flex-1 relative">
                <label class="block text-[9px] text-neutral-500 uppercase font-bold">Opcode</label>
                <input 
                    #opcodeInput
                    type="text" 
                    [(ngModel)]="editOpName" 
                    (input)="onOpcodeInput()"
                    (keydown)="onOpcodeKeydown($event)"
                    (blur)="onOpcodeBlur()"
                    class="w-full bg-neutral-950 border border-neutral-600 text-white px-2 py-1 rounded focus:border-blue-500 outline-none font-bold placeholder-neutral-600"
                    placeholder="Type to search..."
                    autocomplete="off"
                >
                
                <app-opcode-autocomplete
                    [items]="opcodeList"
                    [query]="editOpName"
                    [visible]="showAutocomplete()"
                    (selected)="onAutocompleteSelect($event)"
                />
            </div>

            <div class="flex-[2]">
                 @if (editOpName === 'EV_MONSTERFLAGOP') {
                     <app-monster-flag-editor 
                        [(args)]="editArgs"
                        (argsChange)="validateEdit()">
                     </app-monster-flag-editor>
                 } @else if (editOpName === 'EV_DIALOG') {
                     <app-dialog-style-editor
                        [(args)]="editArgs"
                        [mapId]="mapId()"
                        (argsChange)="validateEdit()">
                     </app-dialog-style-editor>
                 } @else {
                    <label class="block text-[9px] text-neutral-500 uppercase font-bold">Arguments ({{ editOpFormat }})</label>
                    <input 
                        type="text" 
                        [(ngModel)]="editArgs"
                        (input)="validateEdit()"
                        class="w-full bg-neutral-950 border border-neutral-600 text-amber-500 px-2 py-1 rounded focus:border-blue-500 outline-none font-mono"
                        placeholder="e.g. 10 255"
                    >
                 }
            </div>
        </div>

        @if (editError) {
            <div class="text-red-400 mb-2 text-xs flex items-center gap-1"><span>⚠</span> {{ editError }}</div>
        }

        <div class="flex justify-end gap-2 items-center">
            @if (!isInsertMode()) {
                <button (click)="delete.emit()" class="px-3 py-1 bg-red-900/50 text-red-200 hover:bg-red-800 rounded text-xs mr-auto">Delete</button>
            }
            <button (click)="cancel.emit()" class="px-3 py-1 text-neutral-400 hover:text-white text-xs">Cancel</button>
            <button (click)="commitChange()" [disabled]="!!editError" class="px-3 py-1 bg-blue-700 hover:bg-blue-600 text-white rounded text-xs font-bold disabled:opacity-50">
                {{ isInsertMode() ? 'Insert' : 'Update' }}
            </button>
        </div>
    </div>
  `
})
export class ScriptInstructionEditorComponent {
    instruction = input<ScriptInstruction | null>(null);
    insertMode = input<'before' | 'after' | null>(null);
    mapId = input<number>(1);
    
    save = output<{opcodeName: string, args: string, bytes: number[]}>();
    cancel = output<void>();
    delete = output<void>();
    
    assembler = inject(ScriptAssemblerService);
    
    editOpName = '';
    editArgs = '';
    editOpFormat = '';
    editError = '';
    
    showAutocomplete = signal(false);
    opcodeList: OpcodeItem[] = Object.entries(SCRIPT_OPCODE_SCHEMA).map(([k, v]) => ({
        id: +k, name: v.name, desc: v.description, format: v.arguments.map(argument => argument.kind).join(' ')
    }));
    
    @ViewChild('opcodeInput') opcodeInput!: ElementRef;
    @ViewChild(OpcodeAutocompleteComponent) autocomplete!: OpcodeAutocompleteComponent;

    constructor() {
        effect(() => {
            const inst = this.instruction();
            const mode = this.insertMode();
            
            if (mode) {
                // Insert Defaults
                this.editOpName = 'EV_WAIT';
                this.editArgs = '0';
            } else if (inst) {
                // Edit existing
                this.editOpName = inst.name;
                this.editArgs = inst.formattedArgs;
            }
            
            this.updateOpFormat();
            this.validateEdit();
            
            // Focus input on init
            setTimeout(() => {
                if (this.opcodeInput) this.opcodeInput.nativeElement.focus();
            }, 50);
        });
    }

    isInsertMode() {
        return this.insertMode() !== null;
    }

    onOpcodeInput() {
        this.showAutocomplete.set(true);
        this.updateOpFormat();
        this.validateEdit();
    }
    
    onOpcodeKeydown(event: KeyboardEvent) {
        if (this.autocomplete && this.showAutocomplete()) {
            if (this.autocomplete.handleKey(event)) {
                return;
            }
        }
        if (event.key === 'Escape') {
            this.showAutocomplete.set(false);
        }
    }
    
    onOpcodeBlur() {
        // Delay to allow click to register
        setTimeout(() => this.showAutocomplete.set(false), 200);
    }
    
    onAutocompleteSelect(item: OpcodeItem) {
        this.editOpName = item.name;
        this.showAutocomplete.set(false);
        this.updateOpFormat();
        this.validateEdit();
    }
    
    updateOpFormat() {
        const op = this.opcodeList.find(o => o.name === this.editOpName);
        this.editOpFormat = op ? op.format || 'none' : 'Unknown';
    }
    
    validateEdit() {
        const op = this.opcodeList.find(o => o.name === this.editOpName);
        if (!op) {
            this.editError = 'Invalid Opcode Name';
            return;
        }
        
        const result = this.assembler.assemble(op.id, this.editArgs);
        if (result.error) {
            this.editError = result.error;
        } else {
            this.editError = '';
        }
    }
    
    commitChange() {
        this.validateEdit();
        if (this.editError) return;
        
        const op = this.opcodeList.find(o => o.name === this.editOpName)!;
        const result = this.assembler.assemble(op.id, this.editArgs);
        
        this.save.emit({
            opcodeName: this.editOpName,
            args: this.editArgs,
            bytes: result.bytes
        });
    }
}
