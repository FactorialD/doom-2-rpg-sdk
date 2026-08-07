
import { Component, inject } from '@angular/core';
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
import { EditorService } from './app/services/editor.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, ToolbarComponent, Map3DComponent, TextureViewerComponent, TextViewerComponent, ScriptViewerComponent, PaletteViewerComponent, ItemViewerComponent, VariablesViewerComponent, SoundViewerComponent],
  template: `
    <div class="flex flex-col h-screen w-screen overflow-hidden bg-neutral-950 text-white font-sans">
      
      <!-- Top Toolbar -->
      <app-toolbar class="flex-none z-10" />

      <!-- Main Workspace -->
      <main class="flex-1 min-h-0 overflow-hidden relative">
           
           <!-- Use hidden classes instead of @if/@switch to keep components alive (preserving scroll/state) -->
           
           <div class="w-full h-full p-0" [class.hidden]="service.activeTab() !== 'map'">
                <app-map-3d />
           </div>

           <div class="w-full h-full bg-[#222]" [class.hidden]="service.activeTab() !== 'textures'">
                <app-texture-viewer />
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
}
