import assert from 'node:assert/strict';
import test from 'node:test';
import { MS_PER_CHAR, TypewriterTimer, type TypewriterState } from './typewriter-timer.ts';

function fakeTimer() {
  const callbacks = new Map<number, () => void>();
  const delays: number[] = [];
  const cancelled: number[] = [];
  let nextId = 0;
  const timer = new TypewriterTimer(((callback: () => void, delay: number) => {
    callbacks.set(++nextId, callback);
    delays.push(delay);
    return nextId;
  }) as typeof setTimeout, ((id: number) => cancelled.push(id)) as typeof clearTimeout);
  return { timer, callbacks, delays, cancelled };
}

test('uses the Java dialog speed and starts a new 25 ms interval for each line', () => {
  const fake = fakeTimer();
  const frames: TypewriterState[] = [];
  fake.timer.start([1, 2], state => frames.push(state), () => frames.push({ lineIndex: 9, characterCount: 9 }));
  fake.callbacks.get(1)!();
  assert.deepEqual(frames, [{ lineIndex: 0, characterCount: 1 }]);
  fake.callbacks.get(2)!();
  fake.callbacks.get(3)!();
  assert.deepEqual(frames, [
    { lineIndex: 0, characterCount: 1 },
    { lineIndex: 1, characterCount: 1 },
    { lineIndex: 1, characterCount: 2 },
    { lineIndex: 9, characterCount: 9 },
  ]);
  assert.deepEqual(fake.delays, [MS_PER_CHAR, MS_PER_CHAR, MS_PER_CHAR]);
});

test('skips empty lines without spending a tick and completes empty input', () => {
  const fake = fakeTimer();
  const frames: TypewriterState[] = [];
  let completions = 0;
  fake.timer.start([0, 1, 0], state => frames.push(state), () => completions++);
  fake.callbacks.get(1)!();
  assert.deepEqual(frames, [{ lineIndex: 1, characterCount: 1 }]);
  assert.equal(completions, 1);
  fake.timer.start([], state => frames.push(state), () => completions++);
  assert.equal(completions, 2);
});

test('starting again and Stop cancel the previous run', () => {
  const fake = fakeTimer();
  const frames: string[] = [];
  fake.timer.start([2], state => frames.push(`old:${state.characterCount}`), () => {});
  const old = fake.callbacks.get(1)!;
  fake.timer.start([1], state => frames.push(`new:${state.characterCount}`), () => frames.push('done'));
  old();
  fake.callbacks.get(2)!();
  assert.deepEqual(fake.cancelled, [1]);
  assert.deepEqual(frames, ['new:1', 'done']);
  fake.timer.start([2], () => {}, () => {});
  fake.timer.stop();
  assert.deepEqual(fake.cancelled, [1, 3]);
});

test('default scheduler keeps the browser receiver', () => {
  const originalSchedule = globalThis.setTimeout;
  const originalCancel = globalThis.clearTimeout;
  const callbacks = new Map<number, () => void>();
  const cancelled: number[] = [];
  let nextId = 0;
  globalThis.setTimeout = function (callback: TimerHandler) {
    assert.equal(this, globalThis);
    callbacks.set(++nextId, callback as () => void);
    return nextId as unknown as ReturnType<typeof globalThis.setTimeout>;
  } as typeof globalThis.setTimeout;
  globalThis.clearTimeout = function (handle?: ReturnType<typeof globalThis.setTimeout>) {
    assert.equal(this, globalThis);
    cancelled.push(handle as unknown as number);
  } as typeof globalThis.clearTimeout;
  try {
    const timer = new TypewriterTimer();
    timer.start([2], () => {}, () => {});
    callbacks.get(1)!();
    timer.stop();
    assert.deepEqual(cancelled, [2]);
  } finally {
    globalThis.setTimeout = originalSchedule;
    globalThis.clearTimeout = originalCancel;
  }
});
