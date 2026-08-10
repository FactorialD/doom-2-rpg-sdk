import { Component, input, output, signal, inject, ViewChild, ElementRef, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ScriptData, ScriptInstruction } from '../../../services/doom-script.service';
import { SCRIPT_OPCODE_SCHEMA } from '../../../services/scripts/script-opcode-schema';
import { ScriptAssemblerService } from '../../../services/scripts/script-assembler.service';
import { OpcodeAutocompleteComponent, OpcodeItem } from '../opcode-autocomplete/opcode-autocomplete.component';
import { StringReferencePickerComponent } from '../string-reference-picker/string-reference-picker.component';
import { ScriptArgumentControlComponent, ScriptReferenceOptions } from '../script-argument-control/script-argument-control.component';
import { ScriptArgumentValue, createScriptArgumentValues, scriptArgumentString, setScriptArgumentValue } from '../script-argument-control/script-argument-value';

@Component({
  selector: 'app-script-instruction-editor',
  standalone: true,
  imports: [
    CommonModule, 
    FormsModule, 
    OpcodeAutocompleteComponent,
    StringReferencePickerComponent,
    ScriptArgumentControlComponent
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
              <label class="block text-[9px] text-neutral-500 uppercase font-bold">Arguments ({{ editOpFormat }})</label>
              <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
                @for (argument of argumentValues; track $index) {
                  <app-script-argument-control [control]="argument" [options]="referenceOptions"
                    (changed)="updateArgument($index, $event)" />
                } @empty {
                  <div class="text-[10px] text-neutral-600 italic">No arguments</div>
                }
              </div>
            </div>
        </div>

        @if (stringArgumentIndex() !== -1) {
          <app-string-reference-picker
            [mapId]="mapId()" [chunkId]="activeStringChunk()" [stringId]="activeStringId()"
            (selected)="selectString($event)" />
        }

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
    scriptData = input<ScriptData | null>(null);
    
    save = output<{opcodeName: string, args: string, bytes: number[]}>();
    cancel = output<void>();
    delete = output<void>();
    
    assembler = inject(ScriptAssemblerService);
    
    editOpName = '';
    argumentValues: ScriptArgumentValue[] = [];
    referenceOptions: ScriptReferenceOptions = {};
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
            } else if (inst) {
                // Edit existing
                this.editOpName = inst.name;
            }
            this.resetArguments(inst?.params ?? []);
            this.buildReferenceOptions();
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
        this.resetArguments([]);
        this.validateEdit();
    }
    
    updateOpFormat() {
        const op = this.opcodeList.find(o => o.name === this.editOpName);
        this.editOpFormat = op ? op.format || 'none' : 'Unknown';
    }

    private resetArguments(params: readonly number[]) {
        const op = this.opcodeList.find(o => o.name === this.editOpName);
        this.argumentValues = op ? createScriptArgumentValues(SCRIPT_OPCODE_SCHEMA[op.id].arguments, params) : [];
    }

    private buildReferenceOptions() {
        const data = this.scriptData();
        const instruction = this.instruction();
        const instructions = data?.instructions ?? [];
        const end = instruction ? instruction.offset + instruction.size : 0;
        const absolute = instructions.map(item => ({ value: item.offset, label: `${item.name} @ 0x${item.offset.toString(16)}` }));
        this.referenceOptions = {
            'instruction-absolute': absolute,
            'instruction-relative': instructions.map(item => ({ value: item.offset - end, label: `${item.name} @ 0x${item.offset.toString(16)}` })),
            'tile-event-index': Array.from({ length: (data?.tileEvents.length ?? 0) / 2 }, (_, value) => ({ value, label: `Tile event ${value}` })),
            'entity-index': this.numericOptions(256, 'Entity'),
            'string-index': this.numericOptions(256, 'String'),
            'sound-index': this.numericOptions(256, 'Sound'),
            'map-index': this.numericOptions(10, 'Map', 1)
        };
    }

    private numericOptions(count: number, label: string, start = 0) {
        return Array.from({ length: count }, (_, index) => ({ value: index + start, label: `${label} ${index + start}` }));
    }

    updateArgument(index: number, value: ScriptArgumentValue) {
        this.argumentValues = this.argumentValues.map((argument, i) => i === index ? value : argument);
        this.validateEdit();
    }
    
    validateEdit() {
        const op = this.opcodeList.find(o => o.name === this.editOpName);
        if (!op) {
            this.editError = 'Invalid Opcode Name';
            return;
        }
        
        const argumentError = this.argumentValues.find(argument => argument.error)?.error;
        if (argumentError) { this.editError = argumentError; return; }
        const result = this.assembler.assemble(op.id, scriptArgumentString(this.argumentValues));
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
        const args = scriptArgumentString(this.argumentValues);
        const result = this.assembler.assemble(op.id, args);
        
        this.save.emit({
            opcodeName: this.editOpName,
            args,
            bytes: result.bytes
        });
    }

    stringArgumentIndex(): number {
        const definition = Object.values(SCRIPT_OPCODE_SCHEMA).find(item => item.name === this.editOpName);
        return definition?.arguments.findIndex(argument => argument.reference === 'string-index') ?? -1;
    }

    activeStringId(): number {
        return this.argumentValues[this.stringArgumentIndex()]?.value ?? 0;
    }

    activeStringChunk(): number {
        // EV_CAMERA_STR has an explicit neighbouring chunk argument in the SDK
        // schema. ScriptThread uses Canvas.loadMapStringID for all implicit refs.
        return this.editOpName === 'EV_CAMERA_STR'
            ? (this.argumentValues[0]?.value ?? 0)
            : this.mapId() + 3;
    }

    selectString(stringId: number) {
        const index = this.stringArgumentIndex();
        if (index < 0) return;
        const argument = this.argumentValues[index];
        if (!argument) return;
        this.argumentValues = this.argumentValues.map((value, argumentIndex) =>
            argumentIndex === index ? setScriptArgumentValue(value, stringId) : value
        );
        this.validateEdit();
    }
}
