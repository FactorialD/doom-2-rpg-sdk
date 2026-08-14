import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';

import type { DrawingTool } from './drawing-tool';

@Component({
  selector: 'app-drawing-tools',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="flex items-center gap-2">
      <div class="flex rounded border border-neutral-700 bg-neutral-950 p-0.5">
        <button type="button" (click)="toolChange.emit('pencil')" [class.bg-neutral-700]="tool === 'pencil'" class="rounded p-1.5 text-white transition-colors hover:bg-neutral-800" title="Pencil (1px)">✏️</button>
        <button type="button" (click)="toolChange.emit('brush')" [class.bg-neutral-700]="tool === 'brush'" class="rounded p-1.5 text-white transition-colors hover:bg-neutral-800" title="Brush">🖌️</button>
        <button type="button" (click)="toolChange.emit('fill')" [class.bg-neutral-700]="tool === 'fill'" class="rounded p-1.5 text-white transition-colors hover:bg-neutral-800" title="Flood Fill">🪣</button>
        <button type="button" (click)="toolChange.emit('select')" [class.bg-neutral-700]="tool === 'select'" class="rounded p-1.5 text-white transition-colors hover:bg-neutral-800" title="Select an area, then drag it to move its pixels">⬚</button>
      </div>
      @if (tool === 'brush') {
        <div class="flex items-center gap-2 rounded border border-neutral-700 bg-neutral-800 px-2 py-1">
          <span class="text-[10px] font-bold text-neutral-400">Size</span>
          <input type="range" [min]="brushMin" [max]="brushMax" step="1" [ngModel]="brushSize" (ngModelChange)="brushSizeChange.emit(+$event)" class="h-1 w-16 accent-red-600">
          <span class="w-5 text-[10px] text-white">{{ brushSize }}</span>
        </div>
      }
    </div>
  `
})
export class DrawingToolsComponent {
  @Input({ required: true }) tool!: DrawingTool;
  @Input() brushSize = 3;
  @Input() brushMin = 1;
  @Input() brushMax = 16;
  @Output() toolChange = new EventEmitter<DrawingTool>();
  @Output() brushSizeChange = new EventEmitter<number>();
}
