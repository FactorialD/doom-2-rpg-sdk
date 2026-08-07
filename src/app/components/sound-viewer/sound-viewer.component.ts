import { CommonModule } from '@angular/common';
import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DoomFileService } from '../../services/doom-file.service';
import { DoomSoundService } from '../../services/doom-sound.service';

@Component({
  selector: 'app-sound-viewer',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="flex h-full w-full bg-neutral-950 text-neutral-300">
      <aside class="w-72 shrink-0 border-r border-neutral-800 bg-[#1a1a1a] flex flex-col">
        <div class="p-4 border-b border-neutral-800">
          <div class="flex items-center justify-between gap-3 mb-4">
            <h2 class="font-bold text-white">Sound Viewer</h2>
            <span class="rounded bg-amber-900/30 border border-amber-800/50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-400">Read-only</span>
          </div>
          <input
            type="search"
            aria-label="Search sound IDs"
            placeholder="Search by ID…"
            [ngModel]="query()"
            (ngModelChange)="query.set($event)"
            class="w-full rounded border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-white outline-none focus:border-red-700"
          />
        </div>

        <div class="flex-1 overflow-y-auto p-2">
          @if (!fileService.isLoaded()) {
            <p class="m-2 rounded border border-neutral-800 bg-neutral-900/50 p-3 text-xs text-neutral-500">Load a JAR file to view sounds.</p>
          } @else if (soundService.soundIds().length === 0) {
            <p class="m-2 rounded border border-neutral-800 bg-neutral-900/50 p-3 text-xs text-neutral-500">No sounds.idx entries were found.</p>
          } @else {
            @for (id of filteredIds(); track id) {
              <button
                type="button"
                (click)="selectedId.set(id)"
                [class.bg-red-950]="selectedId() === id"
                [class.text-red-300]="selectedId() === id"
                class="w-full rounded px-3 py-2 text-left text-sm hover:bg-neutral-800">
                Sound #{{ id }}
              </button>
            } @empty {
              <p class="p-3 text-xs text-neutral-500">No matching sound IDs.</p>
            }
          }
        </div>
      </aside>

      <section class="flex flex-1 items-center justify-center p-8">
        @let id = selectedId();
        @if (id !== null) {
          <div class="w-full max-w-lg rounded-lg border border-neutral-800 bg-[#1a1a1a] p-6 shadow-xl">
            <p class="text-xs font-bold uppercase tracking-widest text-neutral-500">Selected resource</p>
            <h1 class="mt-2 text-2xl font-bold text-white">Sound #{{ id }}</h1>
            <p class="mt-2 text-sm text-neutral-500">Playback preview only. Sound editing and replacement are not supported.</p>
            <div class="mt-6 flex gap-3">
              <button type="button" (click)="soundService.playSound(id)" class="rounded bg-red-800 px-4 py-2 text-sm font-bold text-white hover:bg-red-700">▶ Play</button>
              <button type="button" (click)="soundService.stopSound()" [disabled]="soundService.playingSoundId() === null" class="rounded border border-neutral-700 bg-neutral-800 px-4 py-2 text-sm font-bold text-neutral-200 hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-40">■ Stop</button>
            </div>
            @if (soundService.playingSoundId() === id) {
              <p class="mt-4 text-sm text-green-400">Playing sound #{{ id }}…</p>
            }
            @if (soundService.playbackError(); as error) {
              <p class="mt-4 rounded border border-red-900/60 bg-red-950/40 p-3 text-sm text-red-300">{{ error }}</p>
            }
          </div>
        } @else {
          <div class="text-center text-neutral-500">
            <div class="mb-3 text-4xl">🔊</div>
            <p>Select a sound ID to preview it.</p>
            <p class="mt-2 text-xs uppercase tracking-wider text-amber-500">Read-only viewer</p>
          </div>
        }
      </section>
    </div>
  `
})
export class SoundViewerComponent {
  readonly fileService = inject(DoomFileService);
  readonly soundService = inject(DoomSoundService);
  readonly query = signal('');
  readonly selectedId = signal<number | null>(null);
  readonly filteredIds = computed(() => {
    const query = this.query().trim();
    return query ? this.soundService.soundIds().filter(id => id.toString().includes(query)) : this.soundService.soundIds();
  });

  constructor() {
    effect(() => {
      const ids = this.soundService.soundIds();
      if (this.selectedId() !== null && !ids.includes(this.selectedId()!)) {
        this.selectedId.set(null);
      }
    });
  }
}
