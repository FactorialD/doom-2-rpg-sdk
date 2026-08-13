
import { Component, HostListener, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ToolbarComponent } from './app/components/toolbar/toolbar.component';
import { Map3DComponent } from './app/components/map-3d/map-3d.component';
import { TextureViewerComponent } from './app/components/texture-viewer/texture-viewer.component';
import { TextViewerComponent } from './app/components/text-viewer/text-viewer.component';
import { ScriptViewerComponent } from './app/components/script-viewer/script-viewer.component';
import { PaletteViewerComponent } from './app/components/palette-viewer/palette-viewer.component';
import { ItemViewerComponent } from './app/components/item-viewer/item-viewer.component';
import { VariablesViewerComponent } from './app/components/variables-viewer/variables-viewer.component';
import { SoundViewerComponent } from './app/components/sound-viewer/sound-viewer.component';
import { ImageViewerComponent } from './app/components/image-viewer/image-viewer.component';
import { EditorService } from './app/services/editor.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, ToolbarComponent, Map3DComponent, TextureViewerComponent, ImageViewerComponent, TextViewerComponent, ScriptViewerComponent, PaletteViewerComponent, ItemViewerComponent, VariablesViewerComponent, SoundViewerComponent],
  template: `
    <div class="flex flex-col h-screen w-screen overflow-hidden bg-neutral-950 text-white font-sans">
      
      <!-- Top Toolbar -->
      <app-toolbar class="flex-none z-10" />
      @if (service.message(); as message) {
        <div role="status" class="fixed right-4 top-14 z-50 max-w-md rounded border px-4 py-2 text-sm shadow-xl"
          [class.bg-green-950]="message.type === 'success'" [class.border-green-700]="message.type === 'success'"
          [class.bg-red-950]="message.type === 'error'" [class.border-red-700]="message.type === 'error'">
          {{ message.text }}
          <button class="ml-3 text-neutral-300" (click)="service.message.set(null)" aria-label="Dismiss message">×</button>
        </div>
      }

      <!-- Main Workspace -->
      <main class="flex-1 min-h-0 overflow-hidden relative">
           
           <!-- Use hidden classes instead of @if/@switch to keep components alive (preserving scroll/state) -->
           
           <div class="w-full h-full p-0" [class.hidden]="service.activeTab() !== 'map'">
                <app-map-3d />
           </div>

           <div class="w-full h-full bg-[#222]" [class.hidden]="service.activeTab() !== 'textures'">
                <app-texture-viewer />
           </div>

           <div data-testid="image-workspace-wrapper" class="w-full h-full bg-[#222]" [class.hidden]="service.activeTab() !== 'images'">
                <app-image-viewer />
           </div>

           <div class="w-full h-full bg-[#222]" [class.hidden]="service.activeTab() !== 'palettes'">
                <app-palette-viewer />
           </div>

           <div class="w-full h-full bg-[#1a1a1a]" [class.hidden]="service.activeTab() !== 'text'">
                <app-text-viewer />
           </div>
           
           <div class="w-full h-full bg-[#1a1a1a]" [class.hidden]="service.activeTab() !== 'items'">
                <app-item-viewer />
           </div>

           <div class="w-full h-full bg-[#1a1a1a]" [class.hidden]="service.activeTab() !== 'variables'">
                <app-variables-viewer />
           </div>

           <div class="w-full h-full bg-[#1a1a1a]" [class.hidden]="service.activeTab() !== 'scripts'">
                <app-script-viewer />
           </div>

           <div class="w-full h-full bg-[#1a1a1a]" [class.hidden]="service.activeTab() !== 'sounds'">
                <app-sound-viewer />
           </div>
           
      </main>
    </div>
  `
})
export class AppComponent {
    service = inject(EditorService);

    @HostListener('window:beforeunload', ['$event'])
    onBeforeUnload(event: BeforeUnloadEvent) {
      if (!this.service.hasUnsavedChanges()) return;
      event.preventDefault();
      event.returnValue = '';
    }
}
