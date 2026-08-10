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
        <div class="relative w-full h-32 flex items-center justify-center checkerboard overflow-hidden"
             [style.--checker-color]="checkerColor" [style.--checker-light]="checkerLightColor">
             <!-- Scaled 2x for better visibility -->
             <canvas #canvas class="image-pixelated" style="transform: scale(2);"></canvas>
        </div>
        <div class="text-[10px] text-neutral-500 mt-1">Composite Preview</div>
        @if (previewOptions.length > 1) {
            <div class="flex flex-wrap justify-center gap-1 mt-2">
                @for (option of previewOptions; track option.frame) {
                    <button type="button" (click)="selectPreview(option.frame)"
                        class="px-1.5 py-0.5 rounded border text-[9px] transition-colors"
                        [class.bg-red-800]="previewFrame === option.frame"
                        [class.border-red-500]="previewFrame === option.frame"
                        [class.border-neutral-700]="previewFrame !== option.frame">
                        {{ option.label }}
                    </button>
                }
            </div>
        }
    </div>
  `,
  styles: [`
    .image-pixelated { image-rendering: pixelated; max-width: 100%; height: auto; }
    .checkerboard {
      background-color: var(--checker-color);
      background-image: linear-gradient(45deg, var(--checker-light) 25%, transparent 25%), linear-gradient(-45deg, var(--checker-light) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, var(--checker-light) 75%), linear-gradient(-45deg, transparent 75%, var(--checker-light) 75%);
      background-size: 16px 16px;
      background-position: 0 0, 0 8px, 8px -8px, -8px 0;
    }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class TextureCompositeComponent implements OnChanges {
    @Input() textures: TextureInfo[] = []; 
    @Input() forceRefresh: number = 0;
    @Input() selectedTextureId: number | null = null;
    @Input() selectedRawData: Uint8Array | null = null;
    @Input() selectedPalette: Uint32Array | undefined;
    @Input() checkerColor = '#8a8a8a';

    previewFrame = 0;
    previewOptions: { frame: number; label: string }[] = [];

    get checkerLightColor(): string {
        const value = Number.parseInt(this.checkerColor.slice(1), 16);
        if (!Number.isFinite(value)) return '#d8d8d8';
        const light = (channel: number) => Math.min(255, channel + Math.max(48, Math.round((255 - channel) * .42)));
        return `rgb(${light(value >> 16 & 255)}, ${light(value >> 8 & 255)}, ${light(value & 255)})`;
    }

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
        if (changes['textures']) {
            const candidates = [
                { frame: 0, label: 'Front' }, { frame: 4, label: 'Back' },
                { frame: 8, label: 'Attack 1' }, { frame: 10, label: 'Attack 2' },
                { frame: 12, label: 'Pain / special' }
            ];
            this.previewOptions = candidates.filter(option => option.frame < 0 || option.frame < this.textures.length);
            this.previewFrame = 0;
        }
        this.render();
    }

    selectPreview(frame: number) {
        this.previewFrame = frame;
        this.render();
    }

    render() {
        if (!this.canvasRef || !this.textures || this.textures.length === 0) return;
        const canvas = this.canvasRef.nativeElement;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const groupId = this.textures[0].groupId;
        
        // Find which frame index is currently selected within this group
        let selectedFrameIndex = this.previewFrame;
        if (this.previewOptions.length <= 1 && this.selectedTextureId !== null) {
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
                const imgData = texInfo.id === this.selectedTextureId
                    ? this.getEditedImageData(texInfo)
                    : this.textureService.getTextureImageData(texInfo.id);
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

    private getEditedImageData(texture: TextureInfo): ImageData | null {
        if (!this.selectedRawData || !this.selectedPalette) return this.textureService.getTextureImageData(texture.id);
        const image = new ImageData(texture.width, texture.height);
        const pixels = new Uint32Array(image.data.buffer);
        const transparentZero = this.textureService.isIndex0Transparent(texture.id);
        for (let i = 0; i < pixels.length; i++) {
            const index = this.selectedRawData[i] ?? 0;
            pixels[i] = index === 0 && transparentZero ? 0 : (this.selectedPalette[index] ?? 0xff000000);
        }
        return image;
    }
}
