import { Component, Input, OnChanges, SimpleChanges, inject, ViewChild, ElementRef, ChangeDetectionStrategy, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DoomTextureService, TextureInfo } from '../../../services/doom-texture.service';
import { TexturePaletteService } from '../../../services/textures/texture-palette.service';
import { SpriteCompositorService } from '../../../services/textures/sprite-compositor.service';

@Component({
  selector: 'app-texture-composite',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="flex flex-col items-center bg-black border border-neutral-800 rounded p-2">
        <!-- Increased dimensions to ~128px and added overflow-hidden -->
        <div class="relative w-full h-32 flex items-center justify-center bg-[url('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAGElEQVQYlWNgYGCQwoKxgqGgcJA5h3yFAAs8BRWVSegaAAAAAElFTkSuQmCC')] overflow-hidden">
             <!-- Scaled 2x for better visibility -->
             <canvas #canvas class="image-pixelated" style="transform: scale(2);"></canvas>
        </div>
        <div class="text-[10px] text-neutral-500 mt-1">Composite Preview</div>
    </div>
  `,
  styles: [`
    .image-pixelated { image-rendering: pixelated; max-width: 100%; height: auto; }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class TextureCompositeComponent implements OnChanges {
    @Input() textures: TextureInfo[] = []; 
    @Input() forceRefresh: number = 0;
    @Input() selectedTextureId: number | null = null;

    @ViewChild('canvas') canvasRef!: ElementRef<HTMLCanvasElement>;
    
    private textureService = inject(DoomTextureService);
    private paletteService = inject(TexturePaletteService);
    private compositor = inject(SpriteCompositorService);

    constructor() {
        // Redraw on palette or texture change
        effect(() => {
            this.paletteService.version();
            this.textureService.textureVersion();
            this.render();
        });
    }

    ngOnChanges(changes: SimpleChanges) {
        this.render();
    }

    render() {
        if (!this.canvasRef || !this.textures || this.textures.length === 0) return;
        const canvas = this.canvasRef.nativeElement;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const groupId = this.textures[0].groupId;
        
        // Find which frame index is currently selected within this group
        let selectedFrameIndex = -1;
        if (this.selectedTextureId !== null) {
            selectedFrameIndex = this.textures.findIndex(t => t.id === this.selectedTextureId);
        }

        // Get layers from service
        const layers = this.compositor.getCompositeLayers(groupId, selectedFrameIndex);
        
        // Collect image data
        let maxWidth = 0;
        let maxHeight = 0;
        const imagesToDraw: { img: ImageData, order: number }[] = [];

        for (const layer of layers) {
            // Find texture info for this frame index (bounds checking handled by array access mostly)
            if (layer.frameIndex < this.textures.length) {
                const texInfo = this.textures[layer.frameIndex];
                const imgData = this.textureService.getTextureImageData(texInfo.id);
                if (imgData) {
                    imagesToDraw.push({ img: imgData, order: layer.renderOrder });
                    maxWidth = Math.max(maxWidth, imgData.width);
                    maxHeight = Math.max(maxHeight, imgData.height);
                }
            }
        }
        
        if (imagesToDraw.length === 0) {
            canvas.width = 64; canvas.height = 64;
            ctx.clearRect(0,0,64,64);
            return;
        }

        canvas.width = maxWidth;
        canvas.height = maxHeight;
        ctx.clearRect(0, 0, maxWidth, maxHeight);
        
        // Sort by render order (ascending)
        imagesToDraw.sort((a, b) => a.order - b.order);

        // Draw layers
        for (const item of imagesToDraw) {
            const img = item.img;
            const tempC = document.createElement('canvas');
            tempC.width = img.width;
            tempC.height = img.height;
            const tCtx = tempC.getContext('2d');
            if (tCtx) {
                tCtx.putImageData(img, 0, 0);
                
                // Center horizontally, align bottom (standard Doom RPG sprite alignment)
                // Actually, most raw sprites are centered in their canvas already or use full canvas size.
                // Centering in the composite canvas is safe.
                const dx = Math.floor((maxWidth - img.width) / 2);
                const dy = Math.floor((maxHeight - img.height) / 2); 
                
                ctx.drawImage(tempC, dx, dy);
            }
        }
    }
}