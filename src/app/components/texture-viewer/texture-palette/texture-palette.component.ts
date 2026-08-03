
import { Component, Input, output, signal, OnChanges, SimpleChanges, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TextureInfo, DoomTextureService } from '../../../services/doom-texture.service';
import { TexturePaletteService } from '../../../services/textures/texture-palette.service';
import { EditorService } from '../../../services/editor.service';

@Component({
  selector: 'app-texture-palette',
  standalone: true,
  imports: [CommonModule],
  template: `
            @if(colors.length > 0) {
                <div class="h-40 shrink-0 border-t border-neutral-800 bg-neutral-900 p-3 flex flex-col">
                    <div class="flex justify-between items-center mb-2">
                         <h3 class="text-[10px] font-bold text-neutral-500 uppercase tracking-widest flex items-center gap-2">
                            <span>Palette Colors</span>
                            <span class="bg-neutral-800 px-1.5 py-0.5 rounded text-neutral-400">{{ colors.length }} entries</span>
                         </h3>
                         <div class="flex items-center gap-2">
                             @if(texture) {
                                <button (click)="goToPalette(texture.id)" class="text-[9px] text-blue-400 hover:text-white px-2 py-0.5 border border-blue-900 rounded bg-blue-900/20">
                                    Open in Palette Editor
                                </button>
                             }
                            <span class="text-[10px] text-neutral-400">Selected:</span>
                            <div class="flex items-center gap-1 bg-neutral-950 px-2 py-1 rounded border border-neutral-800 relative group">
                                @if (selectedIndex === 0 && hasTransparentIndex()) {
                                   <div class="w-3 h-3 border border-white/20 bg-[url('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAIklEQVQIW2NkQAKrVq36zwjjgzhhYWGMYAEYB8RmROaABADeOQ8CXl/xfgAAAABJRU5ErkJggg==')]"></div>
                                   <span class="text-xs font-mono text-red-400">Trans (0)</span>
                                } @else {
                                   <div class="w-3 h-3 border border-white/20" [style.background-color]="colors[selectedIndex]"></div>
                                   <span class="text-xs font-mono text-white">Idx {{ selectedIndex }}</span>
                                }
                                
                                <!-- Quick Edit Popover (Hidden for 0 if trans) -->
                                @if(texture && !(selectedIndex === 0 && hasTransparentIndex())) {
                                    <input type="color" 
                                        [value]="hexColor(colors[selectedIndex])"
                                        (input)="updateColor($event)"
                                        class="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                                        title="Click to Edit Color"
                                    />
                                }
                            </div>
                         </div>
                    </div>
                    
                    <div class="flex-1 overflow-y-auto custom-scrollbar pr-1">
                        <div class="flex flex-wrap gap-1 content-start">
                            <!-- Special Eraser for Compressed Textures -->
                            @if (hasTransparentIndex()) {
                                <button class="w-6 h-6 border rounded-sm relative bg-[url('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAIklEQVQIW2NkQAKrVq36zwjjgzhhYWGMYAEYB8RmROaABADeOQ8CXl/xfgAAAABJRU5ErkJggg==')] hover:scale-110 transition-transform focus:outline-none group" 
                                    [class.border-red-500]="selectedIndex === 0"
                                    [class.border-white_10]="selectedIndex !== 0"
                                    [class.z-10]="selectedIndex === 0"
                                    [class.shadow-lg]="selectedIndex === 0"
                                    title="Index 0: Transparent (Eraser)"
                                    (click)="selectColor(0)">
                                  <span class="absolute inset-0 flex items-center justify-center text-red-500 font-bold text-xs group-hover:scale-125">×</span>
                                  <span class="absolute bottom-0 right-0 text-[8px] font-mono font-bold px-0.5 leading-none bg-black/50 text-white backdrop-blur-[1px] rounded-tl-sm">0</span>
                               </button>
                            }

                            <!-- Standard Colors -->
                            @for (color of colors; track $index) {
                               @if ($index > 0 || !hasTransparentIndex()) {
                                   <button class="w-6 h-6 border rounded-sm relative bg-[url('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAGElEQVQYlWNgYGCQwoKxgqGgcJA5h3yFAAs8BRWVSegaAAAAAElFTkSuQmCC')] hover:scale-110 transition-transform focus:outline-none" 
                                        [class.border-white]="$index === selectedIndex"
                                        [class.border-white_10]="$index !== selectedIndex"
                                        [class.z-10]="$index === selectedIndex"
                                        [class.shadow-lg]="$index === selectedIndex"
                                        [title]="'Index ' + $index + ': ' + color"
                                        (click)="selectColor($index)">
                                      <div class="absolute inset-0" [style.background-color]="color"></div>
                                      <span class="absolute bottom-0 right-0 text-[8px] font-mono font-bold px-0.5 leading-none bg-black/50 text-white backdrop-blur-[1px] rounded-tl-sm">{{ $index }}</span>
                                   </button>
                               }
                            }
                        </div>
                    </div>
                </div>
            }
  `,
  styles: [`
    .custom-scrollbar::-webkit-scrollbar { width: 8px; height: 8px; }
    .custom-scrollbar::-webkit-scrollbar-track { background: #111; }
    .custom-scrollbar::-webkit-scrollbar-thumb { background: #333; border-radius: 4px; border: 2px solid #111; }
    .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #555; }
  `]
})
export class TexturePaletteComponent {
    @Input() colors: string[] = [];
    @Input() texture: TextureInfo | null = null;
    @Input() selectedIndex: number = 0;
    @Input() isCompressed: boolean = false;
    
    private textureService = inject(DoomTextureService);
    private palService = inject(TexturePaletteService);
    private editorService = inject(EditorService);
    
    colorSelected = output<number>();
    
    selectColor(index: number) {
        this.colorSelected.emit(index);
    }
    
    hasTransparentIndex(): boolean {
        if (!this.texture) return false;
        return this.textureService.isIndex0Transparent(this.texture.id);
    }
    
    hexColor(rgbStr: string): string {
        // convert rgba(r,g,b,a) to #RRGGBB
        if (rgbStr.startsWith('#')) return rgbStr;
        const match = rgbStr.match(/\d+/g);
        if (!match) return '#000000';
        const [r, g, b] = match.map(Number);
        const toHex = (n: number) => n.toString(16).padStart(2, '0');
        return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
    }
    
    updateColor(event: Event) {
        if (!this.texture) return;
        const input = event.target as HTMLInputElement;
        const hex = input.value;
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        
        // This updates the shared palette memory immediately
        this.palService.updateColor(this.texture.id, this.selectedIndex, r, g, b);
        
        // Force refresh local array to show changes immediately in UI
        this.colors[this.selectedIndex] = `rgba(${r}, ${g}, ${b}, 1)`;
        
        // Trigger save to bin
        this.palService.savePalettes();
    }
    
    goToPalette(id: number) {
        this.editorService.selectPalette(id);
    }
}
