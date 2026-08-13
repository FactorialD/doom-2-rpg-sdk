import assert from 'node:assert/strict';
import test from 'node:test';
import { StringsListComponent } from './strings-list.component.ts';
import { DoomTextService, type DoomTextLayout } from '../../../services/doom-text.service.ts';
import type { TypewriterState } from '../../../services/typewriter-timer.ts';

test('A|BC types the first line and then the second without timing the separator', () => {
  const component = Object.create(StringsListComponent.prototype) as StringsListComponent;
  const textService = Object.create(DoomTextService.prototype) as DoomTextService;
  const frames: Array<{ activeLine?: number; characterCount?: number }> = [];
  let lengths: readonly number[] = [];
  let frameCallback: (state: TypewriterState) => void = () => {};
  const canvas = { parentElement: { clientWidth: 216 } } as unknown as HTMLCanvasElement;

  Object.assign(component as unknown as Record<string, unknown>, {
    activeEntryId: null,
    fontImage: {},
    fontLoaded: true,
    canvases: { find: (predicate: (item: { nativeElement: HTMLCanvasElement }) => boolean) => {
      const item = { nativeElement: Object.assign(canvas, { dataset: { entryId: '7' } }) };
      return predicate(item) ? item : undefined;
    } },
    textService: {
      preparePreviewLayout: (text: string, width: number) => textService.preparePreviewLayout(text, width),
      renderPreviewLayout: (_layout: DoomTextLayout, _canvas: HTMLCanvasElement, _font: HTMLImageElement, activeLine?: number, characterCount?: number) => {
        frames.push({ activeLine, characterCount });
      },
    },
    typeTimer: {
      stop() {},
      start: (value: readonly number[], frame: (state: TypewriterState) => void) => { lengths = value; frameCallback = frame; },
    },
  });

  component.toggleTypewriter({ id: 7, raw: 'A|BC', renderKey: 'A|BC' });
  frameCallback({ lineIndex: 0, characterCount: 1 });
  frameCallback({ lineIndex: 1, characterCount: 1 });
  frameCallback({ lineIndex: 1, characterCount: 2 });

  assert.deepEqual(lengths, [1, 2]);
  assert.deepEqual(frames, [
    { activeLine: 0, characterCount: 0 },
    { activeLine: 0, characterCount: 1 },
    { activeLine: 1, characterCount: 1 },
    { activeLine: 1, characterCount: 2 },
  ]);
});
