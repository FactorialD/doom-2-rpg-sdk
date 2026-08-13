import assert from 'node:assert/strict';
import test from 'node:test';
import { TypewriterTimer } from './typewriter-timer.ts';

test('starting typewriter again cancels the previous scheduled callback', () => {
  const callbacks = new Map<number, () => void>();
  const cancelled: number[] = [];
  let nextId = 0;
  const timer = new TypewriterTimer(((callback: () => void) => { callbacks.set(++nextId, callback); return nextId; }) as typeof setTimeout, ((id: number) => cancelled.push(id)) as typeof clearTimeout);
  const frames: string[] = [];
  timer.start(3, 10, position => frames.push(`old:${position}`), () => {});
  const old = callbacks.get(1)!;
  timer.start(1, 10, position => frames.push(`new:${position}`), () => frames.push('done'));
  old();
  callbacks.get(2)!();
  assert.deepEqual(cancelled, [1]);
  assert.deepEqual(frames, ['new:1', 'done']);
});
