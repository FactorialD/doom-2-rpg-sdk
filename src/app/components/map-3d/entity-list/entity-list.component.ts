
import { Component, ElementRef, input, output, computed, signal, inject, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MapSprite } from '../../../services/doom-map.service';
import { DoomTextureService } from '../../../services/doom-texture.service';
import { TextureThumbnailComponent } from '../../texture-viewer/texture-thumbnail/texture-thumbnail.component';
import { EditorService } from '../../../services/editor.service';
import { NavigationHighlightService } from '../../../shared/services/navigation-highlight.service';

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
export class EntityListComponent {
    sprites = input<MapSprite[]>([]);
    selectedId = input<number>(-1);
    selectEntity = output<number>();
    
    private textureService = inject(DoomTextureService);
    private editorService = inject(EditorService);
    private host = inject<ElementRef<HTMLElement>>(ElementRef);
    private navigationHighlight = inject(NavigationHighlightService);
    
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

    constructor() {
        effect(() => {
            const request = this.editorService.requestedEntitySelection();
            if (!request || this.selectedId() !== request.entityId || !this.sprites()[request.entityId]) return;
            void this.revealExternal(request.requestId, request.entityId);
        });
    }

    private async revealExternal(requestId: number, id: number) {
        const found = await this.navigationHighlight.reveal({
            find: () => this.host.nativeElement.querySelector<HTMLElement>(`#entity-${id}`),
        });
        if (found) this.editorService.acknowledgeNavigation(this.editorService.requestedEntitySelection, requestId);
        else if (this.editorService.requestedEntitySelection()?.requestId === requestId) this.editorService.notify('error', `Entity #${id} was not found.`);
    }

    onSelect(index: number) {
        this.selectEntity.emit(index);
    }
}
