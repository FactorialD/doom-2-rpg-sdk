import { Injectable, signal } from '@angular/core';
import { MidiChannelEvent, ParsedMidi } from './midi-types';

export type MidiPlaybackState = 'idle' | 'ready' | 'playing' | 'paused' | 'ended';

interface Voice { oscillator: OscillatorNode; gain: GainNode; filter: BiquadFilterNode; channel: number; note: number; stopAt: number; }
interface ChannelState { program: number; volume: number; pan: number; bend: number; }

@Injectable({ providedIn: 'root' })
export class MidiSynthService {
  readonly state = signal<MidiPlaybackState>('idle');
  readonly positionSeconds = signal(0);
  readonly durationSeconds = signal(0);
  readonly volume = signal(0.8);
  readonly error = signal<string | null>(null);

  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private midi: ParsedMidi | null = null;
  private events: MidiChannelEvent[] = [];
  private voices = new Set<Voice>();
  private channels: ChannelState[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private startedAt = 0;
  private offset = 0;
  private nextEvent = 0;
  private readonly lookAhead = 0.12;
  private readonly maxVoices = 48;

  load(midi: ParsedMidi) {
    this.stop(); this.midi = midi;
    this.events = midi.tracks.flatMap(track => track.events).filter((event): event is MidiChannelEvent => ['noteOn', 'noteOff', 'programChange', 'controlChange', 'pitchBend'].includes(event.type)).sort((a, b) => a.timeSeconds - b.timeSeconds);
    this.durationSeconds.set(midi.durationSeconds); this.positionSeconds.set(0); this.error.set(null); this.state.set('ready');
  }

  async play() { this.seek(0); await this.start(); }
  async resume() { if (this.state() !== 'playing') await this.start(); }
  pause() { if (this.state() !== 'playing') return; this.offset = this.currentPosition(); this.stopScheduler(); this.stopVoices(); this.positionSeconds.set(this.offset); this.state.set('paused'); }
  seek(seconds: number) {
    const wasPlaying = this.state() === 'playing'; this.stopScheduler(); this.stopVoices();
    this.offset = Math.max(0, Math.min(Number.isFinite(seconds) ? seconds : 0, this.durationSeconds()));
    this.positionSeconds.set(this.offset); this.resetChannels(); this.nextEvent = 0;
    while (this.nextEvent < this.events.length && this.events[this.nextEvent].timeSeconds < this.offset) this.applyState(this.events[this.nextEvent++]);
    this.state.set(this.offset >= this.durationSeconds() ? 'ended' : wasPlaying ? 'paused' : this.midi ? 'paused' : 'idle');
    if (wasPlaying) void this.start();
  }
  stop() { this.stopScheduler(); this.stopVoices(); this.offset = 0; this.nextEvent = 0; this.positionSeconds.set(0); this.durationSeconds.set(this.midi?.durationSeconds ?? 0); this.state.set(this.midi ? 'ready' : 'idle'); }
  clear() { this.stop(); this.midi = null; this.events = []; this.durationSeconds.set(0); this.state.set('idle'); this.error.set(null); }
  setVolume(value: number) { const volume = Math.max(0, Math.min(1, value)); this.volume.set(volume); if (this.master && this.context) this.master.gain.setValueAtTime(volume, this.context.currentTime); }

  private async start() {
    if (!this.midi || this.offset >= this.durationSeconds()) return;
    try {
      if (!this.context) { this.context = new AudioContext(); this.master = this.context.createGain(); this.master.connect(this.context.destination); }
      if (this.context.state === 'suspended') await this.context.resume();
      this.master!.gain.setValueAtTime(this.volume(), this.context.currentTime); this.startedAt = this.context.currentTime - this.offset; this.state.set('playing');
      this.schedule(); this.timer = setInterval(() => this.schedule(), 25);
    } catch (error) { this.error.set(`Could not start Web Audio: ${error instanceof Error ? error.message : String(error)}`); this.state.set('paused'); }
  }
  private currentPosition() { return this.context ? Math.min(this.durationSeconds(), Math.max(0, this.context.currentTime - this.startedAt)) : this.offset; }
  private schedule() {
    if (!this.context || this.state() !== 'playing') return;
    const position = this.currentPosition(); this.positionSeconds.set(position); const until = position + this.lookAhead;
    while (this.nextEvent < this.events.length && this.events[this.nextEvent].timeSeconds <= until) { const event = this.events[this.nextEvent++]; this.scheduleEvent(event, this.startedAt + event.timeSeconds); }
    if (position >= this.durationSeconds()) { this.stopScheduler(); this.stopVoices(); this.offset = this.durationSeconds(); this.positionSeconds.set(this.offset); this.state.set('ended'); }
  }
  private scheduleEvent(event: MidiChannelEvent, at: number) { if (event.type === 'noteOn') this.noteOn(event.channel, event.note, event.velocity, at); else if (event.type === 'noteOff') this.noteOff(event.channel, event.note, at); else this.applyState(event, at); }
  private applyState(event: MidiChannelEvent, at = this.context?.currentTime ?? 0) {
    const channel = this.channels[event.channel] ?? (this.channels[event.channel] = this.defaultChannel());
    if (event.type === 'programChange') channel.program = event.program;
    else if (event.type === 'pitchBend') { channel.bend = (event.value - 8192) / 8192 * 2; for (const voice of this.voices) if (voice.channel === event.channel) voice.oscillator.detune.setValueAtTime(channel.bend * 100, at); }
    else if (event.type === 'controlChange') { if (event.controller === 7) channel.volume = event.value / 127; else if (event.controller === 10) channel.pan = (event.value - 64) / 64; else if (event.controller === 120 || event.controller === 123) for (const voice of [...this.voices]) if (voice.channel === event.channel) this.release(voice, at); }
  }
  private noteOn(channelIndex: number, note: number, velocity: number, at: number) {
    if (!this.context || !this.master) return; while (this.voices.size >= this.maxVoices) this.release([...this.voices].sort((a, b) => a.stopAt - b.stopAt)[0], at);
    const channel = this.channels[channelIndex] ?? (this.channels[channelIndex] = this.defaultChannel()); const oscillator = this.context.createOscillator(); const gain = this.context.createGain(); const filter = this.context.createBiquadFilter(); const pan = this.context.createStereoPanner();
    const percussion = channelIndex === 9; const family = channel.program >> 3; oscillator.type = percussion || family === 3 ? 'square' : family === 2 || family === 5 ? 'sawtooth' : family === 1 ? 'triangle' : 'sine'; oscillator.frequency.setValueAtTime(percussion ? 70 + note * 4 : 440 * Math.pow(2, (note - 69) / 12), at); oscillator.detune.setValueAtTime(channel.bend * 100, at);
    filter.type = 'lowpass'; filter.frequency.setValueAtTime(percussion ? 900 : 1200 + (7 - Math.min(7, family)) * 500, at); pan.pan.setValueAtTime(channel.pan, at); const level = velocity / 127 * channel.volume * 0.22;
    gain.gain.setValueAtTime(0.0001, at); gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, level), at + (percussion ? 0.002 : 0.015)); if (percussion) gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.18);
    oscillator.connect(filter); filter.connect(gain); gain.connect(pan); pan.connect(this.master); const voice: Voice = { oscillator, gain, filter, channel: channelIndex, note, stopAt: at }; this.voices.add(voice);
    oscillator.onended = () => { oscillator.disconnect(); filter.disconnect(); gain.disconnect(); pan.disconnect(); this.voices.delete(voice); }; oscillator.start(at); if (percussion) { voice.stopAt = at + 0.2; oscillator.stop(voice.stopAt); }
  }
  private noteOff(channel: number, note: number, at: number) { const voice = [...this.voices].find(candidate => candidate.channel === channel && candidate.note === note); if (voice) this.release(voice, at); }
  private release(voice: Voice, at: number) { if (!this.context || voice.stopAt > at) return; voice.stopAt = at + 0.08; voice.gain.gain.cancelScheduledValues(at); voice.gain.gain.setTargetAtTime(0.0001, at, 0.02); try { voice.oscillator.stop(voice.stopAt); } catch { /* already stopped */ } }
  private stopVoices() { const now = this.context?.currentTime ?? 0; for (const voice of this.voices) { voice.oscillator.onended = null; try { voice.oscillator.stop(now); } catch { /* already stopped */ } voice.oscillator.disconnect(); voice.filter.disconnect(); voice.gain.disconnect(); } this.voices.clear(); }
  private stopScheduler() { if (this.timer) clearInterval(this.timer); this.timer = null; }
  private defaultChannel(): ChannelState { return { program: 0, volume: 1, pan: 0, bend: 0 }; }
  private resetChannels() { this.channels = Array.from({ length: 16 }, () => this.defaultChannel()); }
}
