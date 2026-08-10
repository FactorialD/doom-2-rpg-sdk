import { Component, computed, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ReferenceType } from '../../../services/scripts/script-opcode-schema';
import { ScriptArgumentValue, setScriptArgumentValue } from './script-argument-value';

export interface ScriptReferenceOption { value: number; label: string; }
export type ScriptReferenceOptions = Partial<Record<ReferenceType, readonly ScriptReferenceOption[]>>;

@Component({
  selector: 'app-script-argument-control',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="min-w-40">
      <label class="block text-[9px] text-neutral-400 uppercase font-bold">{{ control().descriptor.name }}</label>
      @if (control().descriptor.description) {
        <div class="text-[9px] text-neutral-500">{{ control().descriptor.description }}</div>
      } @else { <div class="text-[9px] text-neutral-500">{{ description() }}</div> }
      @if (isReference()) {
        <input type="number" [ngModel]="control().value" (ngModelChange)="change($event)"
          [attr.list]="listId()" class="w-full bg-neutral-950 border border-neutral-600 text-amber-500 px-2 py-1 rounded outline-none focus:border-blue-500">
        <datalist [id]="listId()">
          @for (option of referenceOptions(); track option.value) {
            <option [value]="option.value">{{ option.label }}</option>
          }
        </datalist>
      } @else if (isPrimitive()) {
        <input type="number" [ngModel]="control().value" (ngModelChange)="change($event)"
          [min]="minimum()" [max]="maximum()"
          class="w-full bg-neutral-950 border border-neutral-600 text-amber-500 px-2 py-1 rounded outline-none focus:border-blue-500">
      } @else {
        <input type="text" [ngModel]="control().rawValues.join(' ')" (ngModelChange)="changeSequence($event)"
          class="w-full bg-neutral-950 border border-neutral-600 text-amber-500 px-2 py-1 rounded outline-none focus:border-blue-500 font-mono">
      }
      <div class="text-[9px] text-neutral-500">Range: {{ rangeLabel() }}</div>
      @if (control().error) { <div class="text-[10px] text-red-400">{{ control().error }}</div> }
    </div>
  `
})
export class ScriptArgumentControlComponent {
  control = input.required<ScriptArgumentValue>();
  options = input<ScriptReferenceOptions>({});
  changed = output<ScriptArgumentValue>();

  private readonly primitiveRanges: Record<string, readonly [number, number]> = {
    u8: [0,255], s8: [-128,127], u16be: [0,65535], s16be: [-32768,32767],
    u32be: [0,0xffffffff], s32be: [-0x80000000,0x7fffffff]
  };
  isPrimitive = computed(() => !!this.primitiveRanges[this.control().descriptor.kind]);
  isReference = computed(() => !!this.control().descriptor.reference);
  referenceOptions = computed(() => this.options()[this.control().descriptor.reference!] ?? []);
  description = computed(() => this.control().descriptor.reference
    ? `${this.control().descriptor.reference} reference` : `${this.control().descriptor.kind} value`);
  minimum = computed(() => this.control().descriptor.min ?? this.control().descriptor.packedReference?.min ?? this.primitiveRanges[this.control().descriptor.kind]?.[0]);
  maximum = computed(() => this.control().descriptor.max ?? this.control().descriptor.packedReference?.max ?? this.primitiveRanges[this.control().descriptor.kind]?.[1]);
  rangeLabel = computed(() => this.minimum() === undefined ? 'codec-defined' : `${this.minimum()}…${this.maximum()}`);
  listId = computed(() => `script-ref-${this.control().descriptor.reference}-${this.control().descriptor.name}`);

  change(value: number | string) { this.changed.emit(setScriptArgumentValue(this.control(), Number(value))); }
  changeSequence(value: string) {
    const rawValues = value.trim() ? value.trim().split(/\s+/).map(Number) : [];
    const first = rawValues[0] ?? Number.NaN;
    this.changed.emit({ ...setScriptArgumentValue(this.control(), first), rawValues });
  }
}
