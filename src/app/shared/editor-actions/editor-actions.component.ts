import { Component, EventEmitter, Input, Output } from '@angular/core';

@Component({
  selector: 'app-editor-actions',
  standalone: true,
  template: `
    <div class="flex items-center gap-2">
      <button type="button" (click)="save.emit()" [disabled]="!dirty" class="flex items-center gap-2 rounded bg-red-700 px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-red-600 disabled:bg-neutral-800 disabled:text-neutral-600"><span>💾</span><span>Save</span></button>
      <button type="button" (click)="discard.emit()" [disabled]="!dirty" class="flex items-center gap-2 rounded border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-xs font-bold text-neutral-200 transition-colors hover:bg-neutral-700 disabled:text-neutral-600"><span>↩</span><span>Discard</span></button>
    </div>
  `
})
export class EditorActionsComponent {
  @Input() dirty = false;
  @Output() save = new EventEmitter<void>();
  @Output() discard = new EventEmitter<void>();
}
