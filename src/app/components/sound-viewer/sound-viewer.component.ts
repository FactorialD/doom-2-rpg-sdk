import { CommonModule } from '@angular/common';
import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DoomFileService } from '../../services/doom-file.service';
import { DoomSoundService } from '../../services/doom-sound.service';
import { EditorService } from '../../services/editor.service';

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
            <span class="rounded bg-emerald-900/30 border border-emerald-800/50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-400">Import enabled</span>
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
                (click)="selectSound(id)"
                [attr.aria-label]="'Inspect sound ' + id"
                [class.bg-red-950]="selectedId() === id"
                [class.text-red-300]="selectedId() === id"
                class="grid w-full grid-cols-[1fr_auto] gap-3 rounded px-3 py-2 text-left text-sm hover:bg-neutral-800">
                <span>Sound #{{ id }}</span>
                <span class="tabular-nums text-neutral-500">{{ metadataDuration(id) }}</span>
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
            <p class="mt-2 text-sm text-neutral-500">Playback supports detected MIDI/WAV/AU; replacement import is limited to MIDI because the Java runtime requests audio/midi.</p>
            @if (soundService.loading()) {
              <p class="mt-4 text-sm text-amber-300" role="status">Loading and parsing sound…</p>
            }
            @if (soundService.format(); as format) {
              <dl class="mt-4 grid grid-cols-2 gap-2 rounded border border-neutral-800 bg-neutral-950/60 p-3 text-sm">
                <dt class="text-neutral-500">Format</dt><dd class="text-right uppercase text-white">{{ format }}</dd>
                @if (soundService.midiInfo(); as midi) {
                  <dt class="text-neutral-500">MIDI format</dt><dd class="text-right text-white">{{ midi.header.format }}</dd>
                  <dt class="text-neutral-500">Tracks</dt><dd class="text-right text-white">{{ midi.header.trackCount }}</dd>
                  @if (trackNames(midi).length) { <dt class="text-neutral-500">Track name</dt><dd class="text-right text-white">{{ trackNames(midi).join(', ') }}</dd> }
                }
              </dl>
            }
            <div class="mt-6 flex gap-3">
              <button type="button" aria-label="Play or pause selected sound" (click)="togglePlayback(id)" [disabled]="soundService.loading() || soundService.format() === 'unknown'" class="rounded bg-red-800 px-4 py-2 text-sm font-bold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-40">{{ soundService.playingSoundId() === id ? '⏸ Pause' : '▶ Play' }}</button>
              <button type="button" aria-label="Stop selected sound" (click)="soundService.stopSound()" [disabled]="soundService.playingSoundId() === null && soundService.positionSeconds() === 0" class="rounded border border-neutral-700 bg-neutral-800 px-4 py-2 text-sm font-bold text-neutral-200 hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-40">■ Stop</button>
            </div>
            <label class="mt-4 block rounded border border-neutral-700 bg-neutral-900 p-3 text-sm font-bold text-neutral-300">Replace resource
              <input type="file" accept=".mid,.midi,audio/midi" (change)="importSound(id, $event)" class="mt-2 block w-full text-xs font-normal text-neutral-500 file:mr-3 file:rounded file:border-0 file:bg-red-800 file:px-3 file:py-2 file:text-white" />
            </label>
            <div class="mt-5">
              <div class="mb-1 flex justify-between text-xs tabular-nums text-neutral-400"><span>{{ formatTime(soundService.positionSeconds()) }}</span><span>{{ formatTime(soundService.durationSeconds()) }}</span></div>
              <input type="range" aria-label="Playback position" min="0" [max]="soundService.durationSeconds() || 0" step="0.01" [ngModel]="soundService.positionSeconds()" (ngModelChange)="soundService.seek(+$event)" [disabled]="soundService.durationSeconds() <= 0" class="w-full accent-red-700" />
            </div>
            <label class="mt-4 flex items-center gap-3 text-sm text-neutral-400"><span>Volume</span><input type="range" aria-label="Playback volume" min="0" max="1" step="0.01" [ngModel]="soundService.volume()" (ngModelChange)="soundService.setVolume(+$event)" class="flex-1 accent-red-700" /></label>
            @if (soundService.playbackError(); as error) {
              <p role="alert" class="mt-4 rounded border border-red-900/60 bg-red-950/40 p-3 text-sm text-red-300">{{ error }}</p>
            }
          </div>
        } @else {
          <div class="text-center text-neutral-500">
            <div class="mb-3 text-4xl">🔊</div>
            <p>Select a sound ID to preview it.</p>
            <p class="mt-2 text-xs uppercase tracking-wider text-emerald-500">Validated import available</p>
          </div>
        }
      </section>
    </div>
  `
})
export class SoundViewerComponent {
  readonly fileService = inject(DoomFileService);
  readonly soundService = inject(DoomSoundService);
  private readonly editorService = inject(EditorService);
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
    effect(() => { if (this.editorService.activeTab() !== 'sounds') this.soundService.stopSound(); });
  }

  selectSound(id: number) { this.selectedId.set(id); this.soundService.loadSound(id); }
  togglePlayback(id: number) { if (this.soundService.playingSoundId() === id) this.soundService.pauseSound(); else void this.soundService.playSound(id); }
  formatTime(seconds: number) { if (!Number.isFinite(seconds)) return '0:00'; const whole = Math.max(0, Math.floor(seconds)); return `${Math.floor(whole / 60)}:${(whole % 60).toString().padStart(2, '0')}`; }
  metadataDuration(id: number) { const duration = this.soundService.soundMetadata.get(id)?.durationSeconds; return duration === null || duration === undefined ? '—' : this.formatTime(duration); }
  trackNames(midi: import('../../services/midi/midi-types').ParsedMidi) { return midi.tracks.map(track => track.name).filter((name): name is string => !!name); }
  async importSound(id: number, event: Event) {
    const input = event.target as HTMLInputElement; const file = input.files?.[0]; if (!file) return;
    try { this.soundService.importSound(id, await file.arrayBuffer()); }
    catch (error) { this.soundService.playbackError.set(error instanceof Error ? error.message : String(error)); }
    finally { input.value = ''; }
  }
}
