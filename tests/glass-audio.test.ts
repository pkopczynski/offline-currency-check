import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { VOICES, createGlassAudio, pickVoice } from '../src/glass-audio.ts';
import type { AudioContextLike } from '../src/glass-audio.ts';

// A recording stand-in for the Web Audio API.
function fakeContext(state = 'running') {
  const log = { oscillators: [] as { freq: number; stopAt: number | undefined }[], sources: 0, resumes: 0, disconnects: 0, gains: [] as { rampsToZero: number }[] };
  const param = (initial = 0) => {
    const p = {
      value: initial, ramps: [] as number[],
      setValueAtTime(v: number) { p.value = v; }, cancelScheduledValues() {},
      linearRampToValueAtTime(v: number) { p.ramps.push(v); }, exponentialRampToValueAtTime(v: number) { p.ramps.push(v); },
    };
    return p;
  };
  const node = () => ({ connect() {}, disconnect() { log.disconnects++; } });
  const ctx: AudioContextLike & { state: string } = {
    currentTime: 1, sampleRate: 8000, state, destination: {},
    resume: async () => { log.resumes++; ctx.state = 'running'; },
    createGain() { const g = { ...node(), gain: param() }; log.gains.push({ get rampsToZero() { return g.gain.ramps.filter((r) => r === 0).length; } }); return g; },
    createBiquadFilter: () => ({ ...node(), type: '', frequency: param(), Q: param() }),
    createOscillator() {
      const rec = { freq: 0, stopAt: undefined as number | undefined };
      log.oscillators.push(rec);
      const o = { ...node(), type: '', onended: null as (() => void) | null, frequency: { ...param(), set value(v: number) { rec.freq = v; }, get value() { return rec.freq; } },
        start() {}, stop(when?: number) { rec.stopAt = when; } };
      return o;
    },
    createBuffer: (_c, length) => ({ getChannelData: () => new Float32Array(length) }),
    createBufferSource() { log.sources++; return { ...node(), buffer: null, onended: null, start() {}, stop() {} }; },
  };
  return { ctx, log };
}

describe('glass audio', () => {
  test('does nothing until the first tap (autoplay policy: no context before a gesture)', () => {
    let created = 0;
    createGlassAudio(() => { created++; return null; });
    assert.equal(created, 0);
  });

  test('a tap synthesizes ring partials and a click, resuming a suspended context', () => {
    // Seeded so every voice is checked on every run (the voice is picked at random).
    for (let voice = 0; voice < VOICES.length; voice++) {
      const { ctx, log } = fakeContext('suspended');
      createGlassAudio(() => ctx, () => (voice + 0.5) / VOICES.length).tap();
      assert.equal(log.resumes, 1);
      assert.equal(log.oscillators.length, 4);
      assert.equal(log.sources, 1);
      // The original select tap tops out at ~8.08 kHz, the highest partial in the pool.
      assert.ok(log.oscillators.every((o) => o.freq > 1000 && o.freq < 8100), `voice ${voice}: partials stay below harsh frequencies`);
      assert.ok(log.oscillators.every((o) => o.stopAt! - ctx.currentTime < 0.3), `voice ${voice}: short decay`);
    }
  });

  test('the pool has six voices that differ in pitch and are equally loud and short', () => {
    assert.equal(VOICES.length, 6);
    const pitches = VOICES.map((v) => v.fundamental).sort((x, y) => x - y);
    pitches.slice(1).forEach((p, i) => assert.ok(p / pitches[i]! >= 1.08, 'fundamentals at least ~1.3 semitones apart'));
    const sums = VOICES.map((v) => v.partials.reduce((sum, [, level]) => sum + level, 0));
    assert.ok(Math.max(...sums) / Math.min(...sums) < 1.1, 'similar total level');
    for (const v of VOICES) {
      assert.ok(Math.max(...v.partials.map(([, , decay]) => decay)) <= 0.17, 'short');
      assert.ok(v.partials.every(([ratio]) => v.fundamental * ratio < 8100), 'no partials above the original ones');
    }
  });

  test('pickVoice never repeats the previous voice and can reach every other voice', () => {
    for (let last = 0; last < 6; last++) {
      const seen = new Set<number>();
      for (let i = 0; i < 100; i++) seen.add(pickVoice(6, last, () => i / 100));
      assert.ok(!seen.has(last));
      assert.equal(seen.size, 5);
    }
    assert.ok(pickVoice(6, -1, () => 0.99) < 6);
    assert.equal(pickVoice(1, 0), 0);
  });

  test('consecutive taps use different voices, and the same random numbers repeat a sequence', () => {
    const run = (numbers: number[]) => {
      const { ctx, log } = fakeContext();
      let i = 0;
      const audio = createGlassAudio(() => ctx, () => numbers[i++ % numbers.length]!);
      for (let t = 0; t < 12; t++) audio.tap();
      return log.oscillators.filter((_, n) => n % 4 === 0).map((o) => o.freq);
    };
    const freqs = run([0.1, 0.1, 0.1]); // the lowest random number each time
    freqs.slice(1).forEach((f, i) => assert.notEqual(f, freqs[i]));
    assert.deepEqual(run([0.1, 0.1, 0.1]), freqs);
    assert.ok(new Set(run([0.9, 0.4, 0.7, 0.2, 0.55])).size >= 4);
  });

  test('a new tap fades the previous one out instead of overlapping it', () => {
    const { ctx, log } = fakeContext();
    const audio = createGlassAudio(() => ctx);
    audio.tap();
    const firstOut = log.gains[0]!; // the first tap's output gain is created first
    assert.equal(firstOut.rampsToZero, 0);
    audio.tap();
    assert.equal(firstOut.rampsToZero, 1);
    assert.equal(log.oscillators.length, 8);
  });

  test('reuses one AudioContext for all taps', () => {
    const { ctx } = fakeContext();
    let created = 0;
    const audio = createGlassAudio(() => { created++; return ctx; });
    audio.tap(); audio.tap(); audio.tap();
    assert.equal(created, 1);
  });

  test('without Web Audio it is silent and never throws or retries', () => {
    let created = 0;
    const audio = createGlassAudio(() => { created++; return null; });
    assert.doesNotThrow(() => { audio.tap(); audio.tap(); });
    assert.equal(created, 1);
  });

  test('a throwing AudioContext constructor or a broken context disables sound quietly', () => {
    const audio = createGlassAudio(() => { throw new Error('NotSupportedError'); });
    assert.doesNotThrow(() => audio.tap());

    const { ctx } = fakeContext();
    ctx.createOscillator = () => { throw new Error('boom'); };
    let created = 0;
    const broken = createGlassAudio(() => { created++; return ctx; });
    assert.doesNotThrow(() => { broken.tap(); broken.tap(); });
    assert.equal(created, 1);
  });
});
