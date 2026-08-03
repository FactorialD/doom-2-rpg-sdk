
import { Component, Input, OnChanges, inject, signal, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { EntityDef } from '../../../services/doom-entities.service';
import { DoomTextureService } from '../../../services/doom-texture.service';
import { TextureThumbnailComponent } from '../../texture-viewer/texture-thumbnail/texture-thumbnail.component';

@Component({
  selector: 'app-item-card',
  standalone: true,
  imports: [CommonModule, TextureThumbnailComponent],
  template: `
    <div 
        (click)="onClick.emit()"
        class="flex flex-col bg-neutral-900 border rounded p-2 hover:bg-neutral-800 transition-colors h-full cursor-pointer group"
        [class.border-neutral-800]="!selected"
        [class.border-red-600]="selected"
        [class.bg-red-900_10]="selected"
    >
        <div class="flex items-center justify-center bg-black/50 aspect-square rounded mb-2 border border-neutral-800 p-2 group-hover:border-neutral-600 transition-colors">
             @if (resolvedTextureId() !== -1) {
                 <app-texture-thumbnail [id]="resolvedTextureId()" />
             } @else {
                 <div class="text-[10px] text-neutral-600">No Sprite</div>
             }
        </div>
        
        <div class="mt-auto">
            <div class="flex justify-between items-start mb-1">
                <span class="text-xs font-bold text-white leading-tight line-clamp-2" [title]="itemName">{{ itemName }}</span>
            </div>
            <div class="flex justify-between items-center text-[10px] text-neutral-500 font-mono">
                <span>ID: {{ def.parm }}</span>
                <span>Type: {{ def.eSubType }}</span>
            </div>
        </div>
    </div>
  `,
  styles: [`
    .bg-red-900_10 { background-color: rgba(127, 29, 29, 0.1); }
  `]
})
export class ItemCardComponent implements OnChanges {
    @Input() def!: EntityDef;
    @Input() itemName: string = 'Unknown';
    @Input() selected: boolean = false;
    @Output() onClick = new EventEmitter<void>();
    
    private textureService = inject(DoomTextureService);
    
    resolvedTextureId = signal(-1);

    ngOnChanges() {
        if (this.def) {
            // The tileIndex in EntityDef is the Texture Group ID
            const tex = this.textureService.getTextureByGroup(this.def.tileIndex);
            this.resolvedTextureId.set(tex ? tex.id : -1);
        }
    }
}
