import assert from 'node:assert/strict';
import test from 'node:test';
import { MidiSynthService } from './midi-synth.service.ts';

class FakeAudioParam {
  cancelScheduledValues() {}
  exponentialRampToValueAtTime() {}
  setTargetAtTime() {}
  setValueAtTime() {}
}

class FakeNode {
  connect() { return this; }
  disconnect() {}
}

class FakeOscillator extends FakeNode {
  readonly detune = new FakeAudioParam();
  readonly frequency = new FakeAudioParam();
  readonly stopTimes: number[] = [];
  onended: (() => void) | null = null;
  type = 'sine';
  start() {}
  stop(at: number) { this.stopTimes.push(at); }
}

class FakeAudioContext {
  readonly destination = new FakeNode();
  readonly oscillators: FakeOscillator[] = [];
  currentTime = 0;
  state = 'running';
  createBiquadFilter() { return Object.assign(new FakeNode(), { type: 'lowpass', frequency: new FakeAudioParam() }); }
  createGain() { return Object.assign(new FakeNode(), { gain: new FakeAudioParam() }); }
  createOscillator() { const oscillator = new FakeOscillator(); this.oscillators.push(oscillator); return oscillator; }
  createStereoPanner() { return Object.assign(new FakeNode(), { pan: new FakeAudioParam() }); }
  async resume() {}
}

function createSynth(maxVoices = 48) {
  const context = new FakeAudioContext();
  const synth = new MidiSynthService() as any;
  synth.context = context;
  synth.master = context.createGain();
  synth.maxVoices = maxVoices;
  return { context, synth };
}

function finishOscillators(context: FakeAudioContext) { for (const oscillator of context.oscillators) oscillator.onended?.(); }

test('repeated notes are released in note-on FIFO order', () => {
  const { context, synth } = createSynth();
  synth.noteOn(0, 60, 100, 0);
  synth.noteOn(0, 60, 100, 0.01);

  synth.noteOff(0, 60, 1);
  assert.deepEqual(context.oscillators.map(oscillator => oscillator.stopTimes.length), [1, 0]);
  synth.noteOff(0, 60, 2);
  assert.deepEqual(context.oscillators.map(oscillator => oscillator.stopTimes.length), [1, 1]);

  finishOscillators(context);
  assert.equal(synth.voices.size, 0);
  assert.equal(synth.activeVoices.size, 0);
});

test('voice stealing removes one voice before allocating its replacement', () => {
  const { context, synth } = createSynth(1);
  synth.noteOn(0, 60, 100, 0);
  synth.noteOff(0, 60, 0.05);
  synth.noteOn(0, 62, 100, 0.1);
  assert.equal(context.oscillators[0].stopTimes.length, 2);

  synth.noteOff(0, 62, 1);
  assert.deepEqual(context.oscillators.map(oscillator => oscillator.stopTimes.length), [2, 1]);
  finishOscillators(context);
  assert.equal(synth.voices.size, 0);
});

test('controller 123 releases every active channel voice only once', () => {
  const { context, synth } = createSynth();
  synth.noteOn(2, 60, 100, 0);
  synth.noteOn(2, 60, 100, 0.1);
  synth.applyState({ type: 'controlChange', channel: 2, controller: 123, value: 0, tick: 0, timeSeconds: 0 }, 1);
  synth.applyState({ type: 'controlChange', channel: 2, controller: 123, value: 0, tick: 0, timeSeconds: 0 }, 2);

  assert.deepEqual(context.oscillators.map(oscillator => oscillator.stopTimes.length), [1, 1]);
  finishOscillators(context);
  assert.equal(synth.activeVoices.size, 0);
});
