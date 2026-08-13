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

test('default scheduler keeps the browser receiver for play, frames, completion, and stop', () => {
  const originalSchedule = globalThis.setTimeout;
  const originalCancel = globalThis.clearTimeout;
  const callbacks = new Map<number, () => void>();
  const cancelled: number[] = [];
  let nextId = 0;
  const receiver = globalThis;

  globalThis.setTimeout = function (callback: TimerHandler) {
    assert.equal(this, receiver);
    callbacks.set(++nextId, callback as () => void);
    return nextId as unknown as ReturnType<typeof globalThis.setTimeout>;
  } as typeof globalThis.setTimeout;
  globalThis.clearTimeout = function (handle?: ReturnType<typeof globalThis.setTimeout>) {
    assert.equal(this, receiver);
    cancelled.push(handle as unknown as number);
  } as typeof globalThis.clearTimeout;

  try {
    const frames: number[] = [];
    let completed = false;
    const timer = new TypewriterTimer();
    timer.start(3, 10, position => frames.push(position), () => { completed = true; });
    callbacks.get(1)!();
    callbacks.get(2)!();
    assert.deepEqual(frames, [1, 2]);
    assert.equal(completed, false);
    callbacks.get(3)!();
    assert.deepEqual(frames, [1, 2, 3]);
    assert.equal(completed, true);

    timer.start(2, 10, position => frames.push(position), () => {});
    timer.stop();
    assert.deepEqual(cancelled, [4]);
  } finally {
    globalThis.setTimeout = originalSchedule;
    globalThis.clearTimeout = originalCancel;
  }
});
