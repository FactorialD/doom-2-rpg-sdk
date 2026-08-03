
import { Component, inject, signal, computed, effect, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DoomScriptService, ScriptData } from '../../services/doom-script.service';
import { DoomFileService } from '../../services/doom-file.service';
import { DoomSoundService } from '../../services/doom-sound.service';
import { EditorService } from '../../services/editor.service';
import { ScriptSidebarComponent } from './script-sidebar/script-sidebar.component';
import { ScriptCodeViewComponent, ScriptBlock } from './script-code-view/script-code-view.component';

@Component({
  selector: 'app-script-viewer',
  standalone: true,
  imports: [CommonModule, ScriptSidebarComponent, ScriptCodeViewComponent],
  template: `
    <div class="flex h-full w-full bg-[#1a1a1a] text-sm text-neutral-300">
      
      <!-- Left Sidebar -->
      <app-script-sidebar
        [fileLoaded]="fileLoaded()"
        [selectedMapId]="selectedMapId()"
        [scriptData]="scriptData()"
        (mapSelected)="onMapSelect($event)"
        (scrollToOffset)="onScrollToOffset($event)"
        (expandAll)="expandAll()"
        (collapseAll)="collapseAll()"
      />

      <!-- Main Content -->
      <main class="flex-1 min-w-0">
          <app-script-code-view
            [scriptData]="scriptData()"
            [scriptBlocks]="scriptBlocks()"
            [isLoading]="isLoading()"
            [error]="error()"
            [targetOffset]="scrollTarget()"
            (showEntity)="showOnMap($event)"
            (showTexture)="showTexture($event)"
            (playSound)="playSound($event)"
            (showText)="showText($event)"
            (dataChanged)="refreshBlocks()"
          />
      </main>
    </div>
  `
})
export class ScriptViewerComponent {
  scriptService = inject(DoomScriptService);
  fileService = inject(DoomFileService);
  editorService = inject(EditorService);
  soundService = inject(DoomSoundService);

  fileLoaded = this.fileService.isLoaded;
  selectedMapId = signal(1);
  scriptData = signal<ScriptData | null>(null);
  
  // Stores the computed blocks to pass to the view
  scriptBlocks = signal<ScriptBlock[]>([]);
  
  isLoading = signal(false);
  error = signal<string | null>(null);
  
  // Signal to trigger scroll in child
  scrollTarget = signal<number | null>(null);
  
  private pendingOffset: number | null = null;

  constructor() {
      effect(() => {
          if (this.fileLoaded() && !this.scriptData()) {
              untracked(() => {
                  this.onMapSelect(1);
              });
          }
      });
      
      // React to external updates (e.g. from Map3D)
      effect(() => {
          this.editorService.scriptsUpdated(); // Subscribe to signal
          
          untracked(() => {
              if (this.fileLoaded() && !this.isLoading()) {
                   // Reload current map to reflect changes
                   this.onMapSelect(this.selectedMapId());
              }
          });
      });

      effect(() => {
          const req = this.editorService.requestedScriptNavigation();
          if (req) {
              untracked(() => {
                  this.pendingOffset = req.offset;
                  if (this.selectedMapId() !== req.mapId) {
                      this.onMapSelect(req.mapId);
                  } else if (!this.isLoading() && this.scriptData()) {
                       setTimeout(() => this.processPendingJump(), 150);
                  }
                  this.editorService.requestedScriptNavigation.set(null);
              });
          }
      });
  }

  async onMapSelect(id: number) {
      this.selectedMapId.set(id);
      this.isLoading.set(true);
      this.error.set(null);
      this.scriptData.set(null);
      this.scriptBlocks.set([]);
      
      try {
          const data = await this.scriptService.loadAndDisassemble(id);
          if (!data) {
             this.error.set("Failed to load map data. The file might be missing or invalid.");
          } else {
             this.scriptData.set(data);
             // Group instructions immediately
             this.scriptBlocks.set(this.groupInstructions(data));
             
             if (this.pendingOffset !== null) {
                 setTimeout(() => this.processPendingJump(), 200);
             }
          }
      } catch (e: any) {
          console.error(e);
          this.error.set("Error parsing scripts: " + e.message + "\nCheck console for details.");
      } finally {
          this.isLoading.set(false);
      }
  }

  refreshBlocks() {
      const data = this.scriptData();
      if (data) {
          this.scriptBlocks.set(this.groupInstructions(data));
      }
  }
  
  private groupInstructions(data: ScriptData): ScriptBlock[] {
      const blocks: ScriptBlock[] = [];
      // Map offset -> List of Labels/Titles for that offset
      const entryPointMap = new Map<number, string[]>();
      
      const addLabel = (offset: number, label: string) => {
          if (!entryPointMap.has(offset)) entryPointMap.set(offset, []);
          entryPointMap.get(offset)!.push(label);
      };

      // 1. Map Static Functions using UIDs
      for (const [key, uid] of Object.entries(data.staticFuncs)) {
          const funcIdx = parseInt(key, 10);
          const inst = data.instructions.find(i => i.uid === uid);
          if (inst) {
              addLabel(inst.offset, `Static Func ${funcIdx}`);
          }
      }

      // 2. Map Tile Events
      for (const ref of data.tileEventRefs) {
          const inst = data.instructions.find(i => i.uid === ref.targetUid);
          if (inst) {
              const x = ref.tileIndex % 32;
              const y = Math.floor(ref.tileIndex / 32);
              
              let triggerType = 'Exec';
              if (ref.flags & 1) triggerType = 'Enter';
              else if (ref.flags & 2) triggerType = 'Exit';
              else if (ref.flags & 4) triggerType = 'Trigger';
              else if (ref.flags & 8) triggerType = 'Sight';
              
              addLabel(inst.offset, `Tile (${x},${y}) ${triggerType}`);
          }
      }

      // 3. Mark Init/Main
      if (!entryPointMap.has(0)) {
          addLabel(0, 'Init / Main');
      } else {
          addLabel(0, '(Init)');
      }

      let currentBlock: ScriptBlock | null = null;
      
      for (const inst of data.instructions) {
          if (entryPointMap.has(inst.offset)) {
              if (currentBlock) blocks.push(currentBlock);
              
              const titles = entryPointMap.get(inst.offset)!;
              
              currentBlock = {
                  title: titles.join(' / '),
                  offset: inst.offset,
                  instructions: [],
                  isOpen: true // Default to open
              };
          }
          
          if (!currentBlock) {
               currentBlock = { title: 'Orphaned Code', offset: inst.offset, instructions: [], isOpen: true };
          }
          
          currentBlock.instructions.push(inst);
      }
      
      if (currentBlock) blocks.push(currentBlock);
      return blocks;
  }
  
  onScrollToOffset(offset: number) {
      this.scrollTarget.set(offset);
      setTimeout(() => this.scrollTarget.set(null), 100);
  }
  
  expandAll() {
      this.scriptBlocks().forEach(b => b.isOpen = true);
  }
  
  collapseAll() {
      this.scriptBlocks().forEach(b => b.isOpen = false);
  }
  
  processPendingJump() {
      if (this.pendingOffset !== null) {
          this.onScrollToOffset(this.pendingOffset);
          this.pendingOffset = null;
      }
  }

  showOnMap(entityId: number) {
      this.editorService.selectMapEntity(this.selectedMapId(), entityId, true);
  }

  showTexture(textureId: number) {
      this.editorService.selectTexture(textureId);
  }
  
  playSound(id: number) {
      this.soundService.playSound(id);
  }

  showText(evt: {chunk: number, id: number}) {
      this.editorService.goToString(evt.chunk, evt.id);
  }
}
