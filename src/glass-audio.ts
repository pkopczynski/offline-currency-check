// A fingernail tapping on glass, synthesized with Web Audio (no asset, no dependency).
// A tap is a ~10 ms band-passed noise click (the nail) plus a few quickly decaying sine
// partials with the inharmonic spacing of a struck glass (the ring). Peak level is low and
// everything above ~6.5 kHz is filtered out, so it stays soft. The AudioContext is created
// on the first tap, which always happens inside a user gesture (autoplay policy).
// Every tap uses one of six voices, chosen at random but never the same one twice in a row.
// Without Web Audio the taps are silent no-ops. There is no sound setting: the app had none.

// The subset of the Web Audio API used here, so tests can pass a fake and the module stays DOM-free.
interface ParamLike {
  value: number;
  setValueAtTime(value: number, time: number): unknown;
  linearRampToValueAtTime(value: number, time: number): unknown;
  exponentialRampToValueAtTime(value: number, time: number): unknown;
  cancelScheduledValues(time: number): unknown;
}
interface NodeLike { connect(destination: unknown): unknown; disconnect(): void }
interface SourceLike extends NodeLike { start(when?: number): void; stop(when?: number): void; onended: (() => void) | null }
interface BufferLike { getChannelData(channel: number): Float32Array }
export interface AudioContextLike {
  readonly currentTime: number;
  readonly sampleRate: number;
  readonly state: string;
  readonly destination: unknown;
  resume(): Promise<void>;
  createGain(): NodeLike & { gain: ParamLike };
  createBiquadFilter(): NodeLike & { type: string; frequency: ParamLike; Q: ParamLike };
  createOscillator(): SourceLike & { type: string; frequency: ParamLike };
  createBuffer(channels: number, length: number, sampleRate: number): BufferLike;
  createBufferSource(): SourceLike & { buffer: BufferLike | null };
}

interface Voice {
  fundamental: number; // Hz
  clickHz: number; // centre of the band-passed noise click (the nail)
  // [frequency ratio, relative level, decay in seconds]
  partials: ReadonlyArray<readonly [number, number, number]>;
}

// The first two are the original "toggle" and "select" taps, unchanged. The others differ in
// pitch, partial spacing, decay and click brightness. Relative levels sum to about the same
// (2.1) and decays stay within 0.09-0.17 s, so they sound equally loud and just as short; the
// tests check this. Partials top out near 8 kHz (the original select tap) and the output is low-passed at 6.5 kHz.
export const VOICES: readonly Voice[] = [
  { fundamental: 1500, clickHz: 3200, partials: [[1, 1, 0.16], [1.004, 0.5, 0.16], [2.32, 0.45, 0.09], [4.25, 0.2, 0.05]] },
  { fundamental: 1900, clickHz: 3200, partials: [[1, 1, 0.11], [1.004, 0.5, 0.11], [2.32, 0.4, 0.06], [4.25, 0.15, 0.035]] },
  { fundamental: 1250, clickHz: 2800, partials: [[1, 1, 0.17], [1.006, 0.5, 0.17], [2.41, 0.4, 0.1], [3.9, 0.2, 0.055]] },
  { fundamental: 1700, clickHz: 3000, partials: [[1, 1, 0.13], [1.003, 0.5, 0.13], [2.18, 0.45, 0.08], [4.6, 0.15, 0.04]] },
  { fundamental: 2150, clickHz: 3600, partials: [[1, 1, 0.1], [1.005, 0.5, 0.1], [2.55, 0.4, 0.055], [3.7, 0.2, 0.03]] },
  { fundamental: 2400, clickHz: 3400, partials: [[1, 1, 0.09], [1.007, 0.45, 0.09], [2.1, 0.5, 0.05], [3.2, 0.15, 0.03]] },
];

// A random voice index that differs from `last` (when `last` is a valid index).
export function pickVoice(count: number, last: number, random: () => number = Math.random): number {
  if (count < 2 || !Number.isInteger(last) || last < 0 || last >= count) return Math.floor(random() * count) % count;
  const n = Math.floor(random() * (count - 1)) % (count - 1);
  return n >= last ? n + 1 : n;
}

const PEAK = 0.1;
const LOWPASS_HZ = 6500;
const CLICK_SECONDS = 0.01;
const FADE_OUT_SECONDS = 0.015;

export function defaultContext(): AudioContextLike | null {
  const g = globalThis as unknown as {
    AudioContext?: new () => AudioContextLike;
    webkitAudioContext?: new () => AudioContextLike;
  };
  const Ctor = g.AudioContext ?? g.webkitAudioContext;
  return Ctor ? new Ctor() : null;
}

export function createGlassAudio(
  createContext: () => AudioContextLike | null = defaultContext,
  random: () => number = Math.random,
) {
  let ctx: AudioContextLike | null = null;
  let disabled = false;
  let noise: BufferLike | null = null;
  let lastVoice = -1;
  // Output of the tap that is still ringing; cut short by the next one so taps never pile up.
  let current: (NodeLike & { gain: ParamLike }) | null = null;

  function getContext(): AudioContextLike | null {
    if (disabled) return null;
    if (!ctx) {
      try { ctx = createContext(); } catch { ctx = null; }
      if (!ctx) { disabled = true; return null; }
    }
    return ctx;
  }

  function clickBuffer(c: AudioContextLike): BufferLike {
    if (noise) return noise;
    const length = Math.max(1, Math.round(c.sampleRate * CLICK_SECONDS));
    noise = c.createBuffer(1, length, c.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.exp((-5 * i) / length);
    return noise;
  }

  function play(c: AudioContextLike) {
    lastVoice = pickVoice(VOICES.length, lastVoice, random);
    const voice = VOICES[lastVoice]!;
    const start = c.currentTime + 0.002;

    if (current) {
      try {
        current.gain.cancelScheduledValues(start);
        current.gain.setValueAtTime(current.gain.value, start);
        current.gain.linearRampToValueAtTime(0, start + FADE_OUT_SECONDS);
      } catch { /* the old tap just rings out */ }
    }

    const out = c.createGain();
    out.gain.value = 1;
    const lowpass = c.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = LOWPASS_HZ;
    out.connect(lowpass);
    lowpass.connect(c.destination);
    current = out;

    let longest = 0;
    let last: SourceLike | null = null;
    for (const [ratio, level, decay] of voice.partials) {
      const osc = c.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = voice.fundamental * ratio;
      const env = c.createGain();
      env.gain.setValueAtTime(0, start);
      env.gain.linearRampToValueAtTime(PEAK * level * 0.5, start + 0.001);
      env.gain.exponentialRampToValueAtTime(0.0001, start + decay);
      osc.connect(env);
      env.connect(out);
      osc.start(start);
      osc.stop(start + decay + 0.02);
      if (decay > longest) { longest = decay; last = osc; }
    }

    const click = c.createBufferSource();
    click.buffer = clickBuffer(c);
    const band = c.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = voice.clickHz;
    band.Q.value = 0.8;
    const clickGain = c.createGain();
    clickGain.gain.value = PEAK * 0.9;
    click.connect(band);
    band.connect(clickGain);
    clickGain.connect(out);
    click.start(start);

    if (last) {
      last.onended = () => {
        out.disconnect();
        lowpass.disconnect();
        if (current === out) current = null;
      };
    }
  }

  return {
    tap() {
      const c = getContext();
      if (!c) return;
      try {
        // Autoplay policy: the context starts suspended until a gesture has resumed it.
        if (c.state === 'suspended') c.resume().catch(() => {});
        play(c);
      } catch {
        disabled = true; // Broken audio stack: stay silent rather than throw on every click.
      }
    },
  };
}
