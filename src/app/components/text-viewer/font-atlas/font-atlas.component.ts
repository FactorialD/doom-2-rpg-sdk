
import { Component, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DoomFileService } from '../../../services/doom-file.service';

@Component({
  selector: 'app-font-atlas',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="p-6 flex flex-col items-center justify-center h-full bg-[#111] overflow-auto">
        @if (fontSrc()) {
            <div class="relative border border-neutral-700 bg-black/50 p-1">
                <img [src]="fontSrc()" class="image-pixelated max-w-full" style="transform: scale(2); transform-origin: top left;" />
                
                <!-- Simple grid overlay visualization (css pattern) -->
                <div class="absolute inset-0 pointer-events-none opacity-30"
                     style="background-size: 24px 32px; background-image: linear-gradient(to right, #444 1px, transparent 1px), linear-gradient(to bottom, #444 1px, transparent 1px); transform: scale(2); transform-origin: top left; width: 50%; height: 50%;">
                </div>
            </div>
            <p class="mt-4 text-neutral-400 text-sm">Font Atlas (Scaled 2x). Grid 12x16px.</p>
        } @else {
            <div class="text-neutral-500 flex flex-col items-center">
                <span class="text-4xl mb-2">🔤</span>
                <p>No font image loaded.</p>
                <p class="text-xs mt-1">Load 'font.png' via sidebar.</p>
            </div>
        }
    </div>
  `,
  styles: [`
    .image-pixelated {
        image-rendering: pixelated;
    }
  `]
})
export class FontAtlasComponent {
    fileService = inject(DoomFileService);
    fontSrc = this.fileService.fontImageSrc;
}
