import assert from 'node:assert/strict';
import test from 'node:test';
import { TextSmartReplaceService, type SmartReplaceSource } from './text-smart-replace.service.ts';

const service = new TextSmartReplaceService();
const source = (raw: string): SmartReplaceSource => ({ langId: 0, chunkId: 2, stringId: 7, raw });
const options = (overrides = {}) => ({ mode: 'exact' as const, caseSensitive: false, normalizeHyphens: true, ...overrides });

test('exact smart replacement honors case-sensitive and insensitive searches', () => {
  assert.equal(service.buildCandidates([source('Doom doom')], 'doom', 'Quake', options()).length, 2);
  assert.equal(service.buildCandidates([source('Doom doom')], 'doom', 'Quake', options({ caseSensitive: true })).length, 1);
});

test('single technical hyphens disappear while doubled hyphens map to one literal hyphen', () => {
  const technical = service.buildCandidates([source('de-hy-phen')], 'dehyphen', 'word', options())[0];
  assert.deepEqual([technical.rawStart, technical.rawEnd, technical.before], [0, 10, 'de-hy-phen']);
  const literal = service.buildCandidates([source('Doom--RPG')], 'Doom--RPG', 'X', options({ caseSensitive: true }))[0];
  assert.deepEqual([literal.rawStart, literal.rawEnd, literal.before], [0, 9, 'Doom--RPG']);
});

test('similar matching finds a close word but not unrelated text', () => {
  const matches = service.buildCandidates([source('marine maroon demon')], 'marin', 'soldier', options({ mode: 'similar' }));
  assert.deepEqual(matches.map(match => match.before), ['marine']);
});

test('normalized positions map replacements back to exact raw ranges without touching neighbours', () => {
  const candidate = service.buildCandidates([source('A de-hy B')], 'dehy', 'word', options())[0];
  assert.equal(service.apply('A de-hy B', [candidate]), 'A word B');
});

test('disabled results are excluded and stale or overlapping candidates are rejected', () => {
  const candidates = service.buildCandidates([source('doom doom')], 'doom', 'x', options());
  candidates[1].enabled = false;
  assert.equal(service.apply('doom doom', candidates), 'x doom');
  assert.match(service.validate(candidates, () => 'changed')!, /changed/);
  candidates[1].enabled = true;
  candidates[1].rawStart = 2;
  candidates[1].before = 'om doom';
  assert.match(service.validate(candidates, () => 'doom doom')!, /overlap/);
});
