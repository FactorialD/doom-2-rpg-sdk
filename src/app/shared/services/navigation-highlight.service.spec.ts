import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NavigationHighlightService } from './navigation-highlight.service';

function element() {
  const style: Record<string, string> = { outline: '', outlineOffset: '', backgroundColor: '', boxShadow: '' };
  return { style, scrollIntoView: () => undefined } as unknown as HTMLElement;
}

test('reveal waits for expansion, scrolls, highlights, then preserves ordinary styles', async () => {
  const service = new NavigationHighlightService();
  const target = element();
  target.style.backgroundColor = 'red';
  let expanded = false;
  let scrolled = false;
  target.scrollIntoView = options => { scrolled = options?.block === 'center'; };
  const found = await service.reveal({ expand: () => { expanded = true; }, find: () => expanded ? target : null, durationMs: 5 });
  assert.equal(found, true);
  assert.equal(scrolled, true);
  assert.notEqual(target.style.backgroundColor, 'red');
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(target.style.backgroundColor, 'red');
});

test('a rapid second reveal cancels only the first temporary effect', async () => {
  const service = new NavigationHighlightService();
  const first = element();
  const second = element();
  await service.reveal({ find: () => first, durationMs: 100 });
  await service.reveal({ find: () => second, durationMs: 5 });
  assert.equal(first.style.outline, '');
  assert.notEqual(second.style.outline, '');
});

test('string navigation waits for Text, Strings, and the target chunk before acknowledgement', async () => {
  const service = new NavigationHighlightService();
  const target = element();
  const events: string[] = [];
  let activeTab = 'scripts';
  let activeSubTab = 'atlases';
  let chunk = 0;
  target.id = 'string-7';
  target.scrollIntoView = options => events.push(`scroll:${target.id}:${options?.block}`);

  const reveal = service.reveal({
    find: () => activeTab === 'text' && activeSubTab === 'strings' && chunk === 4 ? target : null,
    durationMs: 5,
  }).then(found => {
    if (found) events.push('acknowledge');
    return found;
  });

  await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepEqual(events, []);
  activeTab = 'text';
  activeSubTab = 'strings';
  chunk = 4;

  assert.equal(await reveal, true);
  assert.deepEqual(events, ['scroll:string-7:center', 'acknowledge']);
});
