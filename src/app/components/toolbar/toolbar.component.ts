
import { Component, inject } from '@angular/core';
import { EditorService } from '../../services/editor.service';
import { DoomFileService } from '../../services/doom-file.service';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-toolbar',
  standalone: true,
  imports: [CommonModule],
  template: `
    <header class="h-12 bg-neutral-900 border-b border-neutral-800 flex items-center px-4 justify-between select-none">
      <div class="flex items-center gap-4">
        <div class="flex items-center gap-2">
            <span class="text-red-600 font-bold text-lg tracking-wider">DOOM II RPG</span>
            <span class="text-neutral-500 text-xs uppercase tracking-widest">Editor</span>
        </div>
        
        <div class="h-6 w-px bg-neutral-700 mx-2"></div>
        
        <label class="flex items-center gap-2 cursor-pointer bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-xs px-3 py-1.5 rounded transition-colors border border-neutral-700">
            <span>📂</span>
            <span class="font-medium">Load JAR</span>
            <input type="file" accept=".jar,.zip" class="hidden" (change)="onFileSelected($event)" />
        </label>
        @if (service.hasUnsavedChanges()) { <span class="text-xs text-amber-400" title="Unsaved changes">● Unsaved</span> }
        
        @if (fileService.isLoaded()) {
             <span class="text-xs text-green-500 flex items-center gap-1">
                <span class="w-1.5 h-1.5 rounded-full bg-green-500"></span>
                {{ fileService.loadedFileName() }}
             </span>
             
             <button (click)="downloadModdedJar()" class="flex items-center gap-2 cursor-pointer bg-blue-900/30 hover:bg-blue-900/50 text-blue-400 text-xs px-3 py-1.5 rounded transition-colors border border-blue-900/50 ml-4">
                <span>💾</span>
                <span class="font-bold">Download Modded JAR</span>
             </button>
        }
      </div>

      <nav class="flex gap-1">
        <button
          (click)="service.selectTab('map')"
          [class.bg-neutral-800]="service.activeTab() === 'map'"
          [class.text-white]="service.activeTab() === 'map'"
          class="px-3 py-1.5 rounded text-sm font-medium text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors">
          Map @if(service.dirtyResources().maps.dirty) { <span class="text-amber-400">●</span> }
        </button>
        <button 
          (click)="service.selectTab('textures')"
          [class.bg-neutral-800]="service.activeTab() === 'textures'"
          [class.text-white]="service.activeTab() === 'textures'"
          class="px-3 py-1.5 rounded text-sm font-medium text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors">
          Textures @if(service.dirtyResources().textures.dirty) { <span class="text-amber-400">●</span> }
        </button>
        <button (click)="service.selectTab('images')" [class.bg-neutral-800]="service.activeTab() === 'images'" [class.text-white]="service.activeTab() === 'images'" class="px-3 py-1.5 rounded text-sm font-medium text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors">
          Images @if(service.dirtyResources().images.dirty) { <span class="text-amber-400">●</span> }
        </button>
        <button 
          (click)="service.selectTab('items')"
          [class.bg-neutral-800]="service.activeTab() === 'items'"
          [class.text-white]="service.activeTab() === 'items'"
          class="px-3 py-1.5 rounded text-sm font-medium text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors">
          Items
        </button>
        <button 
          (click)="service.selectTab('palettes')"
          [class.bg-neutral-800]="service.activeTab() === 'palettes'"
          [class.text-white]="service.activeTab() === 'palettes'"
          class="px-3 py-1.5 rounded text-sm font-medium text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors">
          Palettes @if(service.dirtyResources().palettes.dirty) { <span class="text-amber-400">●</span> }
        </button>
        <button 
          (click)="service.selectTab('text')"
          [class.bg-neutral-800]="service.activeTab() === 'text'"
          [class.text-white]="service.activeTab() === 'text'"
          class="px-3 py-1.5 rounded text-sm font-medium text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors">
          Texts @if(service.dirtyResources().strings.dirty) { <span class="text-amber-400">●</span> }
        </button>
        <button 
          (click)="service.selectTab('variables')"
          [class.bg-neutral-800]="service.activeTab() === 'variables'"
          [class.text-white]="service.activeTab() === 'variables'"
          class="px-3 py-1.5 rounded text-sm font-medium text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors">
          Vars
        </button>
        <button
          (click)="service.selectTab('sounds')"
          [class.bg-neutral-800]="service.activeTab() === 'sounds'"
          [class.text-white]="service.activeTab() === 'sounds'"
          class="px-3 py-1.5 rounded text-sm font-medium text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors">
          Sounds
        </button>
        <button
          (click)="service.selectTab('scripts')"
          [class.bg-neutral-800]="service.activeTab() === 'scripts'"
          [class.text-white]="service.activeTab() === 'scripts'"
          class="px-3 py-1.5 rounded text-sm font-medium text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors">
          Scripts @if(service.dirtyResources().scripts.dirty) { <span class="text-amber-400">●</span> }
        </button>
      </nav>
    </header>
  `
})
export class ToolbarComponent {
  service = inject(EditorService);
  fileService = inject(DoomFileService);

  async downloadModdedJar() {
    if (this.service.hasUnsavedChanges()
      && !confirm('Some editor changes have not been saved and will not be included in the downloaded JAR. Download anyway?')) {
      return;
    }

    await this.fileService.downloadModdedJar();
  }

  async onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
        if (this.service.hasUnsavedChanges() && !confirm('Loading another JAR will discard all unsaved editor changes. Continue?')) {
          input.value = '';
          return;
        }
        const file = input.files[0];
        try {
          await this.fileService.loadJar(file);
          this.service.clearAllDirty();
          this.service.notify('success', `Loaded ${file.name}.`);
        } catch (error) {
          this.service.notify('error', `Failed to load JAR: ${(error as Error).message}`);
        }
    }
    input.value = ''; // Reset so we can reload the same file if needed
  }
}
