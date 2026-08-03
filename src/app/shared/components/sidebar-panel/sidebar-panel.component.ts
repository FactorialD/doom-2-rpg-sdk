import { Component, input, computed } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-sidebar-panel',
  standalone: true,
  imports: [CommonModule],
  template: `
    <aside [class]="containerClasses()">
        <ng-content></ng-content>
    </aside>
  `
})
export class SidebarPanelComponent {
    widthClass = input<string>('w-64');
    position = input<'left' | 'right'>('left');
    
    containerClasses = computed(() => {
        const borderClass = this.position() === 'left' ? 'border-r' : 'border-l';
        return `${this.widthClass()} bg-neutral-900 ${borderClass} border-neutral-800 flex flex-col flex-none h-full select-none overflow-hidden`;
    });
}