/**
 * All sound is generated in the browser: no audio files.
 * Starts only after a user gesture; if anything fails, the scene runs silently.
 */
export interface Sound {
  readonly started: boolean;
  start(): Promise<void>;
  setMuted(m: boolean): void;
  setFire(level: number): void;
  /** The shared wind, 0 still to 1 storm: the wind bed follows it. */
  setWind(level: number): void;
  /** Daylight 0 to 1: birds now and then in fair daylight. */
  setDaylight(level: number): void;
  setWalking(on: boolean): void;
  step(): void;
  tick(): void;
  rustle(): void;
  thud(): void;
  whoosh(): void;
  /** Water from the flask: three swallows. */
  gulp(): void;
  /** The long breath out after drinking. */
  sigh(): void;
  /** A page turned or a book opened. */
  page(): void;
  /** Pencil on paper, briefly. */
  scribble(): void;
  /** A soft bell for each beat of a day's replay. */
  chime(step: number): void;
  /** Rain on the meadow and the tarp, 0 to 1. */
  setRain(level: number): void;
  /** Thunder after `delay` seconds (light travels faster than sound), `power` 0 to 1. */
  thunder(delay: number, power: number): void;
  /** Crickets on warm nights, 0 to 1. */
  setCrickets(level: number): void;
}

export function createSound(): Sound {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let fireGain: GainNode | null = null;
  let rumbleGain: GainNode | null = null;
  let droneGain: GainNode | null = null;
  let noise: AudioBuffer | null = null;
  let fireLevel = 0.2;
  let windGain: GainNode | null = null;
  let windLevel = 0.2;
  let daylight = 0;
  let birdTimer = 0;
  let crackleTimer = 0;
  let muted = false;
  let started = false;
  let rainGain: GainNode | null = null;
  let rainLevel = 0;
  let crickets = 0;
  let cricketTimer = 0;

  const now = (): number => ctx?.currentTime ?? 0;

  const makeNoise = (c: AudioContext, seconds: number, brown = false): AudioBuffer => {
    const buf = c.createBuffer(1, Math.floor(c.sampleRate * seconds), c.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) {
      const w = Math.random() * 2 - 1;
      if (brown) {
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      } else d[i] = w;
    }
    return buf;
  };

  const loopNoise = (c: AudioContext, buf: AudioBuffer): AudioBufferSourceNode => {
    const s = c.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    s.start();
    return s;
  };

  const burst = (opts: { freq: number; q: number; gain: number; decay: number; type?: BiquadFilterType; at?: number }): void => {
    if (!ctx || !master || !noise) return;
    const t = opts.at ?? now();
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const f = ctx.createBiquadFilter();
    f.type = opts.type ?? 'bandpass';
    f.frequency.value = opts.freq;
    f.Q.value = opts.q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(opts.gain, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + opts.decay);
    src.connect(f).connect(g).connect(master);
    src.start(t, Math.random() * 1.5);
    src.stop(t + opts.decay + 0.05);
  };

  const tone = (freq: number, at: number, dur: number, gain: number, type: OscillatorType = 'sine'): void => {
    if (!ctx || !master) return;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(gain, at + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g).connect(master);
    o.start(at);
    o.stop(at + dur + 0.05);
  };

  const scheduleCrackles = (): void => {
    if (!ctx) return;
    const rate = 1.5 + fireLevel * 9; // pops per second
    const n = Math.random() < rate / 10 ? 1 + (Math.random() < 0.3 ? 1 : 0) : 0;
    for (let i = 0; i < n; i++) {
      burst({ freq: 1800 + Math.random() * 3000, q: 1.5, gain: 0.05 + fireLevel * 0.12 * Math.random(), decay: 0.03 + Math.random() * 0.05, type: 'highpass', at: now() + Math.random() * 0.1 });
    }
  };

  const sound: Sound = {
    get started() {
      return started;
    },
    async start() {
      if (started) return;
      try {
        const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return;
        ctx = new Ctor();
        await ctx.resume();
        master = ctx.createGain();
        master.gain.value = 0;
        const comp = ctx.createDynamicsCompressor();
        master.connect(comp).connect(ctx.destination);
        master.gain.linearRampToValueAtTime(muted ? 0 : 0.8, now() + 2.0);
        noise = makeNoise(ctx, 3);
        const brown = makeNoise(ctx, 4, true);

        // Wind: band-passed noise with a slow swell.
        const wind = loopNoise(ctx, noise);
        const wf = ctx.createBiquadFilter();
        wf.type = 'bandpass';
        wf.frequency.value = 380;
        wf.Q.value = 0.5;
        const wg = ctx.createGain();
        wg.gain.value = 0.05;
        const lfo = ctx.createOscillator();
        lfo.frequency.value = 0.07;
        const lfoGain = ctx.createGain();
        lfoGain.gain.value = 0.035;
        lfo.connect(lfoGain).connect(wg.gain);
        lfo.start();
        const lfo2 = ctx.createOscillator();
        lfo2.frequency.value = 0.11;
        const lfo2g = ctx.createGain();
        lfo2g.gain.value = 140;
        lfo2.connect(lfo2g).connect(wf.frequency);
        lfo2.start();
        wind.connect(wf).connect(wg).connect(master);
        windGain = wg;
        // Birds: a short falling whistle now and then, only in fair daylight.
        birdTimer = window.setInterval(() => {
          if (!ctx || muted || daylight < 0.6 || windLevel > 0.5 || Math.random() > 0.18) return;
          const t0 = now();
          const n = 2 + Math.floor(Math.random() * 3);
          const f0 = 2600 + Math.random() * 1400;
          for (let i = 0; i < n; i++) {
            const o = ctx.createOscillator();
            const g = ctx.createGain();
            o.type = 'sine';
            const t = t0 + i * (0.09 + Math.random() * 0.05);
            o.frequency.setValueAtTime(f0, t);
            o.frequency.exponentialRampToValueAtTime(f0 * 0.72, t + 0.08);
            g.gain.setValueAtTime(0, t);
            g.gain.linearRampToValueAtTime(0.018, t + 0.01);
            g.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
            o.connect(g).connect(master!);
            o.start(t);
            o.stop(t + 0.12);
          }
        }, 1500);

        // Fire: a low rumble plus crackle pops.
        const rumble = loopNoise(ctx, brown);
        const rf = ctx.createBiquadFilter();
        rf.type = 'lowpass';
        rf.frequency.value = 260;
        rumbleGain = ctx.createGain();
        rumbleGain.gain.value = 0.05;
        rumble.connect(rf).connect(rumbleGain).connect(master);
        fireGain = rumbleGain;

        // A low drone that swells while he walks.
        droneGain = ctx.createGain();
        droneGain.gain.value = 0;
        for (const f of [73.4, 110, 146.8]) {
          const o = ctx.createOscillator();
          o.type = 'sine';
          o.frequency.value = f;
          const og = ctx.createGain();
          og.gain.value = f > 100 ? 0.25 : 0.5;
          o.connect(og).connect(droneGain);
          o.start();
        }
        const df = ctx.createBiquadFilter();
        df.type = 'lowpass';
        df.frequency.value = 600;
        droneGain.connect(df).connect(master);

        crackleTimer = window.setInterval(scheduleCrackles, 100);
        // Rain: a hiss of high noise, with the patter of drops on cloth.
        const rain = loopNoise(ctx, noise);
        const rhp = ctx.createBiquadFilter();
        rhp.type = 'highpass';
        rhp.frequency.value = 1400;
        rainGain = ctx.createGain();
        rainGain.gain.value = 0;
        rain.connect(rhp).connect(rainGain).connect(master);
        sound.setRain(rainLevel);
        // Crickets: two quick chirps now and then, on warm nights only.
        cricketTimer = window.setInterval(() => {
          if (!ctx || muted || crickets < 0.05 || Math.random() > crickets * 0.6) return;
          const t0 = now() + Math.random() * 0.3;
          const f = 4300 + Math.random() * 500;
          for (let i = 0; i < 3; i++) tone(f, t0 + i * 0.05, 0.04, 0.008 * crickets, 'triangle');
        }, 420);
        started = true;
        sound.setFire(fireLevel);
      } catch {
        ctx = null;
        started = false;
      }
    },
    setMuted(m: boolean) {
      muted = m;
      if (ctx && master) master.gain.setTargetAtTime(m ? 0 : 0.8, now(), 0.2);
    },
    setWind(level: number) {
      windLevel = level;
      if (ctx && windGain) windGain.gain.setTargetAtTime(0.025 + level * 0.12, now(), 0.8);
    },
    setDaylight(level: number) {
      daylight = level;
    },
    setFire(level: number) {
      fireLevel = level;
      if (ctx && fireGain) fireGain.gain.setTargetAtTime(0.02 + level * 0.11, now(), 0.4);
    },
    setWalking(on: boolean) {
      if (ctx && droneGain) droneGain.gain.setTargetAtTime(on ? 0.05 : 0, now(), on ? 1.5 : 2.5);
    },
    step() {
      burst({ freq: 700 + Math.random() * 500, q: 0.9, gain: 0.22, decay: 0.12 });
      burst({ freq: 2600, q: 0.7, gain: 0.05, decay: 0.06, at: now() + 0.02 });
    },
    tick() {
      const t = now();
      tone(587.3, t, 0.9, 0.08);
      tone(880, t + 0.11, 1.4, 0.06);
      tone(1174.7, t + 0.11, 1.2, 0.015, 'triangle');
    },
    rustle() {
      for (let i = 0; i < 5; i++) burst({ freq: 2200 + Math.random() * 1500, q: 0.6, gain: 0.05, decay: 0.12, at: now() + i * 0.06 });
    },
    thud() {
      burst({ freq: 140, q: 0.7, gain: 0.3, decay: 0.25, type: 'lowpass' });
    },
    whoosh() {
      if (!ctx || !master || !noise) return;
      const t = now();
      const src = ctx.createBufferSource();
      src.buffer = noise;
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.Q.value = 0.8;
      f.frequency.setValueAtTime(300, t);
      f.frequency.exponentialRampToValueAtTime(1600, t + 1.4);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.12, t + 0.6);
      g.gain.linearRampToValueAtTime(0, t + 2.2);
      src.connect(f).connect(g).connect(master);
      src.start(t);
      src.stop(t + 2.3);
    },
    gulp() {
      const t = now();
      for (let i = 0; i < 3; i++) {
        const at = t + i * 0.42;
        burst({ freq: 260 + Math.random() * 60, q: 4, gain: 0.22, decay: 0.16, at });
        burst({ freq: 900, q: 2, gain: 0.05, decay: 0.08, at: at + 0.05 });
      }
    },
    sigh() {
      if (!ctx || !master || !noise) return;
      const t = now();
      const src = ctx.createBufferSource();
      src.buffer = noise;
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.Q.value = 1.2;
      f.frequency.setValueAtTime(1300, t);
      f.frequency.exponentialRampToValueAtTime(500, t + 1.3);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.11, t + 0.15);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.5);
      src.connect(f).connect(g).connect(master);
      src.start(t);
      src.stop(t + 1.6);
      // A cool, open chord under the breath: relief.
      tone(523.3, t + 0.1, 2.2, 0.035);
      tone(659.3, t + 0.22, 2.2, 0.03);
      tone(987.8, t + 0.34, 2.0, 0.018);
    },
    page() {
      burst({ freq: 3200, q: 0.5, gain: 0.07, decay: 0.18 });
      burst({ freq: 1800, q: 0.7, gain: 0.05, decay: 0.12, at: now() + 0.09 });
    },
    scribble() {
      for (let i = 0; i < 4; i++) burst({ freq: 4200 + Math.random() * 1500, q: 2, gain: 0.025, decay: 0.05, at: now() + i * 0.07 });
    },
    setRain(level: number) {
      rainLevel = level;
      if (ctx && rainGain) rainGain.gain.setTargetAtTime(level * 0.09, now(), 1.2);
      if (ctx && level > 0.05 && Math.random() < level * 0.5) burst({ freq: 2500 + Math.random() * 2500, q: 3, gain: 0.03 * level, decay: 0.03, at: now() + Math.random() * 0.2 });
    },
    setCrickets(level: number) {
      crickets = level;
    },
    thunder(delay: number, power: number) {
      if (!ctx || !master || !noise) return;
      const t = now() + delay;
      const src = ctx.createBufferSource();
      src.buffer = noise;
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(420, t);
      f.frequency.exponentialRampToValueAtTime(90, t + 3.5);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.5 * power, t + 0.08);
      g.gain.setTargetAtTime(0.18 * power, t + 0.3, 0.4);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 4.2);
      src.connect(f).connect(g).connect(master);
      src.start(t, Math.random());
      src.stop(t + 4.3);
    },
    chime(step: number) {
      const scale = [392, 440, 523.3, 587.3, 659.3, 784, 880];
      tone(scale[step % scale.length] ?? 523.3, now(), 1.2, 0.04);
    },
  };
  window.addEventListener('pagehide', () => {
    window.clearInterval(crackleTimer);
    window.clearInterval(birdTimer);
    window.clearInterval(cricketTimer);
  });
  return sound;
}
