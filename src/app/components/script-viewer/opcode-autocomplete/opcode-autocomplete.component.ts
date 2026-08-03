import { Component, input, output, signal, computed, effect } from '@angular/core';
import { CommonModule } from '@angular/common';

export interface OpcodeItem {
    id: number;
    name: string;
    desc: string;
    format: string;
}

@Component({
  selector: 'app-opcode-autocomplete',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (visible() && filteredItems().length > 0) {
        <ul class="absolute top-full left-0 right-0 bg-neutral-900 border border-neutral-700 shadow-xl max-h-40 overflow-y-auto z-50 rounded-b">
            @for (op of filteredItems(); track op.id; let i = $index) {
                <li 
                    (mousedown)="selectItem(i); $event.preventDefault()"
                    class="px-2 py-1 cursor-pointer text-xs font-mono flex justify-between"
                    [class.bg-blue-600]="i === selectedIndex()"
                    [class.text-white]="i === selectedIndex()"
                    [class.text-neutral-400]="i !== selectedIndex()">
                    <span>{{ op.name }}</span>
                    <span class="opacity-50">({{ op.id }})</span>
                </li>
            }
        </ul>
    }
  `
})
export class OpcodeAutocompleteComponent {
    items = input<OpcodeItem[]>([]);
    query = input<string>('');
    visible = input<boolean>(false);
    
    selected = output<OpcodeItem>();
    
    selectedIndex = signal(0);
    
    filteredItems = computed(() => {
        const q = this.query().toUpperCase();
        return this.items().filter(op => op.name.includes(q) || op.id.toString().includes(q));
    });

    constructor() {
        // Reset selection when query changes
        effect(() => {
            this.query(); // dependency
            this.selectedIndex.set(0);
        });
    }

    handleKey(event: KeyboardEvent) {
        if (!this.visible() || this.filteredItems().length === 0) return false;

        if (event.key === 'ArrowDown') {
            event.preventDefault();
            this.selectedIndex.update(i => (i + 1) % this.filteredItems().length);
            return true;
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            this.selectedIndex.update(i => (i - 1 + this.filteredItems().length) % this.filteredItems().length);
            return true;
        } else if (event.key === 'Tab' || event.key === 'Enter') {
            event.preventDefault();
            this.selectItem(this.selectedIndex());
            return true;
        }
        return false;
    }

    selectItem(index: number) {
        const list = this.filteredItems();
        if (index >= 0 && index < list.length) {
            this.selected.emit(list[index]);
        }
    }
}
