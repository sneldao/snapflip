// Synthesized Web Audio layer — no assets, no dependencies.
// Room tone per chapter + event accents (pod ticks, gavel, paper slide, whoosh).

const ROOM_FREQ: Record<string, number> = { discover: 190, inspect: 300, auction: 140 };
const STORE_KEY = "sf-audio";

export function createAudio() {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let roomGain: GainNode | null = null;
  let roomFilter: BiquadFilterNode | null = null;
  let noiseBuf: AudioBuffer | null = null;
  let armed = false;
  let muted = (() => {
    try {
      return localStorage.getItem(STORE_KEY) === "0";
    } catch {
      return false;
    }
  })();

  function ensure(): AudioContext | null {
    if (muted || !armed) return null;
    if (!ctx) {
      try {
        ctx = new AudioContext();
      } catch {
        return null;
      }
      master = ctx.createGain();
      master.gain.value = 0.9;
      master.connect(ctx.destination);
      const len = ctx.sampleRate * 2;
      noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      let b = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        b = (b + 0.02 * w) / 1.02; // pinkish
        d[i] = b * 3.2;
      }
      const src = ctx.createBufferSource();
      src.buffer = noiseBuf;
      src.loop = true;
      roomFilter = ctx.createBiquadFilter();
      roomFilter.type = "bandpass";
      roomFilter.frequency.value = ROOM_FREQ.discover;
      roomFilter.Q.value = 0.6;
      roomGain = ctx.createGain();
      roomGain.gain.value = 0;
      src.connect(roomFilter).connect(roomGain).connect(master);
      src.start();
      roomGain.gain.linearRampToValueAtTime(0.016, ctx.currentTime + 2.5);
    }
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  }

  function noiseHit(dur: number, freq: number, gain: number, type: BiquadFilterType = "bandpass", sweepTo?: number) {
    const c = ensure();
    if (!c || !noiseBuf || !master) return;
    const src = c.createBufferSource();
    src.buffer = noiseBuf;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, c.currentTime + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(gain, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0004, c.currentTime + dur);
    src.connect(f).connect(g).connect(master);
    src.start();
    src.stop(c.currentTime + dur);
  }

  function tone(freq: number, dur: number, gain: number, type: OscillatorType = "sine", drop?: number) {
    const c = ensure();
    if (!c || !master) return;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, c.currentTime);
    if (drop) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq - drop), c.currentTime + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(gain, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0004, c.currentTime + dur);
    o.connect(g).connect(master);
    o.start();
    o.stop(c.currentTime + dur);
  }

  window.addEventListener(
    "pointerdown",
    () => {
      armed = true;
      ensure();
    },
    { once: true },
  );

  return {
    setChapter(id: string) {
      const c = ensure();
      if (!c || !roomFilter || !roomGain) return;
      const t = c.currentTime;
      roomFilter.frequency.cancelScheduledValues(t);
      roomFilter.frequency.linearRampToValueAtTime(ROOM_FREQ[id] ?? 200, t + 1.2);
    },
    tick(i: number) {
      tone(1150 + i * 140, 0.055, 0.045, "square", 500);
    },
    gavel() {
      noiseHit(0.09, 700, 0.5, "lowpass");
      tone(95, 0.22, 0.32, "sine", 55);
    },
    click() {
      tone(880, 0.035, 0.05, "sine", 300);
    },
    slide() {
      noiseHit(0.16, 1600, 0.12, "highpass");
    },
    whoosh() {
      noiseHit(0.9, 240, 0.11, "bandpass", 1600);
    },
    thud() {
      noiseHit(0.13, 260, 0.34, "lowpass");
      tone(72, 0.2, 0.22, "sine", 34);
    },
    toggle() {
      muted = !muted;
      try {
        localStorage.setItem(STORE_KEY, muted ? "0" : "1");
      } catch {
        /* ignore */
      }
      if (muted && roomGain && ctx) {
        roomGain.gain.cancelScheduledValues(ctx.currentTime);
        roomGain.gain.value = 0;
      } else if (!muted) {
        ensure();
      }
      return !muted;
    },
    enabled() {
      return !muted;
    },
  };
}

export type StudioAudio = ReturnType<typeof createAudio>;
