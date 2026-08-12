import { Component, computed, inject, input, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ScriptData } from '../../../services/doom-script.service';
import { SidebarPanelComponent } from '../../../shared/components/sidebar-panel/sidebar-panel.component';
import { ScriptEntryNameService } from '../../../services/scripts/script-entry-name.service';

@Component({
  selector: 'app-script-sidebar',
  standalone: true,
  imports: [CommonModule, FormsModule, SidebarPanelComponent],
  template: `
    <app-sidebar-panel widthClass="w-64">
      <div class="p-4 border-b border-neutral-800 flex-1 overflow-hidden flex flex-col">
          <h2 class="text-white font-bold mb-4">Scripts Inspector</h2>
          
           @if (!fileLoaded()) {
              <div class="text-xs text-neutral-500 italic p-2 border border-neutral-800 rounded bg-neutral-900/50">
                  Load a JAR file to view scripts.
              </div>
          } @else {
              <label class="text-xs text-neutral-400 block mb-1">Select Map</label>
              <select 
                  [ngModel]="selectedMapId()" 
                  (ngModelChange)="mapSelected.emit(+$event)"
                  class="w-full bg-neutral-800 text-white text-xs p-2 rounded border border-neutral-700 outline-none focus:border-red-600 shrink-0">
                  <option [value]="1">Map 01</option>
                  <option [value]="2">Map 02</option>
                  <option [value]="3">Map 03</option>
                  <option [value]="4">Map 04</option>
                  <option [value]="5">Map 05</option>
                  <option [value]="6">Map 06</option>
                  <option [value]="7">Map 07</option>
                  <option [value]="8">Map 08</option>
                  <option [value]="9">Map 09</option>
              </select>
              
              <!-- Tabs -->
              <div class="flex mt-4 border-b border-neutral-700">
                  <button (click)="activeTab.set('funcs')" class="flex-1 pb-2 text-xs font-bold text-center" [class.text-white]="activeTab() === 'funcs'" [class.border-b-2]="activeTab() === 'funcs'" [class.border-red-600]="activeTab() === 'funcs'" [class.text-neutral-500]="activeTab() !== 'funcs'">
                      Functions
                  </button>
                  <button (click)="activeTab.set('events')" class="flex-1 pb-2 text-xs font-bold text-center" [class.text-white]="activeTab() === 'events'" [class.border-b-2]="activeTab() === 'events'" [class.border-red-600]="activeTab() === 'events'" [class.text-neutral-500]="activeTab() !== 'events'">
                      Map Events
                  </button>
              </div>
              
              <div class="mt-2 flex-1 flex flex-col min-h-0">
                  <input [ngModel]="query()" (ngModelChange)="query.set($event)" placeholder="Name, Func #, offset or event"
                    class="mb-2 w-full bg-neutral-950 border border-neutral-700 rounded px-2 py-1 text-xs">
                  <div class="flex flex-col gap-1 overflow-y-auto custom-scrollbar flex-1">
                      @if (scriptData(); as data) {
                          @if (activeTab() === 'funcs') {
                              @for (entry of functionEntries(); track entry.index) {
                                  <button 
                                      (click)="scrollToOffset.emit(entry.offset)"
                                      class="text-left px-2 py-1 text-xs hover:bg-neutral-800 rounded border border-transparent hover:border-neutral-700 font-mono transition-colors"
                                      [class.text-amber-500]="entry.offset !== 65535"
                                      [class.opacity-50]="entry.offset === 65535"
                                      [disabled]="entry.offset === 65535">
                                      <span>{{ entry.name || 'Unnamed function' }}</span>
                                      <span class="block text-[9px] text-neutral-500">Func #{{entry.index}} · {{ entry.offset === 65535 ? 'Unused' : '0x' + entry.offset.toString(16).toUpperCase() }}</span>
                                      @if (entry.uid) { <input [ngModel]="entry.name" (click)="$event.stopPropagation()" (ngModelChange)="functionRenamed.emit({uid: entry.uid!, name: $event})" placeholder="Rename…" class="mt-1 w-full bg-neutral-950 border border-neutral-700 px-1 rounded"> }
                                  </button>
                              }
                          } @else {
                              @for (evt of data.tileEventRefs; track $index) {
                                  <button 
                                      (click)="jumpToTileEvent(evt.targetUid, data)"
                                      class="text-left px-2 py-1 text-xs hover:bg-neutral-800 rounded border border-transparent hover:border-neutral-700 font-mono transition-colors group">
                                      <div class="flex justify-between items-center">
                                          <span class="text-blue-400 font-bold">Tile ({{evt.tileIndex % 32}}, {{Math.floor(evt.tileIndex / 32)}})</span>
                                          <span class="text-[9px] text-neutral-500 bg-neutral-900 px-1 rounded">{{ getFlagName(evt.flags) }}</span>
                                      </div>
                                  </button>
                              } @empty {
                                  <div class="text-xs text-neutral-500 italic p-2">No tile events found.</div>
                              }
                          }
                      }
                  </div>
                  
                  <div class="mt-4 pt-2 border-t border-neutral-800 shrink-0">
                      <button (click)="expandAll.emit()" class="text-xs text-blue-400 hover:text-white mr-4">Expand All</button>
                      <button (click)="collapseAll.emit()" class="text-xs text-blue-400 hover:text-white">Collapse All</button>
                  </div>
              </div>
          }
      </div>
    </app-sidebar-panel>
  `,
  styles: [`
    .custom-scrollbar::-webkit-scrollbar { width: 8px; height: 8px; }
    .custom-scrollbar::-webkit-scrollbar-track { background: #111; }
    .custom-scrollbar::-webkit-scrollbar-thumb { background: #333; border-radius: 4px; border: 2px solid #111; }
    .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #555; }
  `]
})
export class ScriptSidebarComponent {
    fileLoaded = input<boolean>(false);
    selectedMapId = input<number>(1);
    scriptData = input<ScriptData | null>(null);

    mapSelected = output<number>();
    scrollToOffset = output<number>();
    expandAll = output<void>();
    collapseAll = output<void>();
    functionRenamed = output<{ uid: string; name: string }>();
    
    activeTab = signal<'funcs' | 'events'>('funcs');
    query = signal('');
    private names = inject(ScriptEntryNameService);
    Math = Math; // Template access

    functionEntries = computed(() => {
        this.names.revision();
        const data = this.scriptData();
        if (!data) return [];
        const q = this.query().trim().toLocaleLowerCase();
        return data.staticFuncOffsets.map((offset, index) => {
            const uid = data.staticFuncs[index];
            const name = uid ? this.names.get(data.mapId, uid) ?? '' : '';
            const events = uid ? data.tileEventRefs.filter(event => event.targetUid === uid).map(event => `${event.tileIndex & 31},${event.tileIndex >> 5 & 31}`).join(' ') : '';
            return { index, offset, uid, name, search: `${name} func #${index} ${index} 0x${offset.toString(16)} ${events}`.toLocaleLowerCase() };
        }).filter(entry => !q || entry.search.includes(q));
    });

    jumpToTileEvent(uid: string, data: ScriptData) {
        const inst = data.instructions.find(i => i.uid === uid);
        if (inst) {
            this.scrollToOffset.emit(inst.offset);
        }
    }
    
    getFlagName(flags: number): string {
        if (flags & 1) return 'ENTER';
        if (flags & 2) return 'EXIT';
        if (flags & 4) return 'TRIG';
        if (flags & 8) return 'SIGHT';
        return 'UNK';
    }
}
