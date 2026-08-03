
import { Component, input, output, computed, signal, inject, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MapSprite } from '../../../services/doom-map.service';
import { DoomTextureService } from '../../../services/doom-texture.service';
import { TextureThumbnailComponent } from '../../texture-viewer/texture-thumbnail/texture-thumbnail.component';

@Component({
  selector: 'app-entity-list',
  standalone: true,
  imports: [CommonModule, FormsModule, TextureThumbnailComponent],
  template: `
     <div class="h-full flex flex-col bg-neutral-900 border-l border-neutral-800">
         <div class="p-3 border-b border-neutral-800 shrink-0">
             <div class="text-xs font-bold text-neutral-400 uppercase tracking-wider mb-2">Entities</div>
             <input type="text" placeholder="Search ID or Type..." 
                 class="w-full bg-neutral-800 border border-neutral-700 rounded px-2 py-1 text-xs text-white focus:border-red-600 outline-none"
                 [ngModel]="searchQuery()" (ngModelChange)="searchQuery.set($event)">
         </div>
         
         <!-- List -->
         <div class="flex-1 overflow-y-auto custom-scrollbar">
             @for (item of filteredList(); track $index) {
                 <div 
                    [id]="'entity-' + item.index"
                    (click)="onSelect(item.index)"
                    class="flex items-center gap-2 p-2 border-b border-neutral-800 cursor-pointer hover:bg-neutral-800 transition-colors group"
                    [class.bg-red-900_20]="selectedId() === item.index"
                    [class.border-l-2]="selectedId() === item.index"
                    [class.border-l-red-600]="selectedId() === item.index"
                    [class.pl-[6px]]="selectedId() === item.index">
                     
                     <div class="w-8 h-8 bg-black border border-neutral-800 shrink-0 flex items-center justify-center overflow-hidden">
                         @if(item.displayTextureId !== -1) {
                             <app-texture-thumbnail [id]="item.displayTextureId" />
                         }
                     </div>
                     
                     <div class="min-w-0">
                         <div class="text-xs font-bold text-neutral-300 group-hover:text-white">
                             #{{ item.index }}
                             <span class="text-[9px] text-neutral-500 font-normal ml-1">Grp: {{ item.data.textureId }}</span>
                         </div>
                         <div class="text-[10px] text-neutral-500 truncate">
                             Pos: {{ item.data.x.toFixed(0) }}, {{ item.data.z.toFixed(0) }}
                         </div>
                     </div>
                 </div>
             } @empty {
                 <div class="p-4 text-center text-xs text-neutral-600">No entities found</div>
             }
         </div>
     </div>
  `,
  styles: [`
    .custom-scrollbar::-webkit-scrollbar { width: 8px; height: 8px; }
    .custom-scrollbar::-webkit-scrollbar-track { background: #111; }
    .custom-scrollbar::-webkit-scrollbar-thumb { background: #333; border-radius: 4px; border: 2px solid #111; }
    .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #555; }
  `]
})
export class EntityListComponent implements OnChanges {
    sprites = input<MapSprite[]>([]);
    selectedId = input<number>(-1);
    selectEntity = output<number>();
    
    private textureService = inject(DoomTextureService);
    
    searchQuery = signal('');
    
    filteredList = computed(() => {
        const query = this.searchQuery().toLowerCase();
        
        // Map raw sprites to view model with resolved texture ID
        const list = this.sprites().map((s, i) => {
            // The textureId in MapSprite is actually the GroupID (e.g. 15 for a potion).
            // We need to resolve this to the internal TextureID (index in newMappings) to render.
            const texInfo = this.textureService.getTextureByGroup(s.textureId);
            return { 
                index: i, 
                data: s,
                displayTextureId: texInfo ? texInfo.id : -1
            };
        });
        
        if (!query) return list;
        
        return list.filter(item => 
            item.index.toString().includes(query) || 
            item.data.textureId.toString().includes(query)
        );
    });

    ngOnChanges(changes: SimpleChanges) {
        if (changes['selectedId'] && this.selectedId() !== -1) {
            this.scrollToEntity(this.selectedId());
        }
    }

    scrollToEntity(id: number) {
        setTimeout(() => {
            const el = document.getElementById(`entity-${id}`);
            if (el) {
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }, 100);
    }

    onSelect(index: number) {
        this.selectEntity.emit(index);
    }
}
