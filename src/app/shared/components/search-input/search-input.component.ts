import { Component, input, model } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-search-input',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="relative group">
        <input 
            type="text" 
            [placeholder]="placeholder()"
            [ngModel]="query()"
            (ngModelChange)="query.set($event)"
            class="w-full bg-neutral-800 border border-neutral-700 rounded px-2 py-1 text-xs text-white focus:border-red-600 outline-none placeholder-neutral-600 transition-colors"
        >
        @if (query().length > 0) {
            <button 
                (click)="query.set('')"
                class="absolute right-1 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-white px-1 text-[10px]"
                title="Clear"
            >✕</button>
        }
    </div>
  `
})
export class SearchInputComponent {
    query = model<string>('');
    placeholder = input<string>('Search...');
}