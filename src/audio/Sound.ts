// All sounds are synthesised with WebAudio, so there are no asset files to load.
type Sfx = 'dice' | 'coinIn' | 'coinOut' | 'build' | 'hotel' | 'buy' | 'card' | 'step' | 'victory' | 'bankrupt' | 'click' | 'jail' | 'error';

export class Sound {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private musicGain!: GainNode;
  private musicTimer: number | null = null;
  sfxOn = true;
  musicOn = false;
  volume = 0.7;

  unlock() {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain(); this.master.gain.value = this.volume; this.master.connect(this.ctx.destination);
      this.musicGain = this.ctx.createGain(); this.musicGain.gain.value = 0.18; this.musicGain.connect(this.master);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    if (this.musicOn) this.startMusic();
  }
  setVolume(v: number) { this.volume = v; if (this.master) this.master.gain.value = v; }

  private tone(freq: number, dur: number, type: OscillatorType = 'sine', gain = 0.3, at = 0, slide?: number, dest?: AudioNode) {
    const c = this.ctx!; const t = c.currentTime + at;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest ?? this.master); o.start(t); o.stop(t + dur + 0.05);
  }
  private noise(dur: number, gain = 0.2, at = 0, freq = 2000) {
    const c = this.ctx!; const t = c.currentTime + at;
    const buf = c.createBuffer(1, Math.floor(c.sampleRate * dur), c.sampleRate);
    const d = buf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const s = c.createBufferSource(); s.buffer = buf;
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = 1.2;
    const g = c.createGain(); g.gain.value = gain;
    s.connect(f); f.connect(g); g.connect(this.master); s.start(t);
  }

  play(name: Sfx) {
    if (!this.sfxOn || !this.ctx) return;
    switch (name) {
      case 'dice': for (let i = 0; i < 9; i++) this.noise(0.05, 0.35 * (1 - i / 10), i * 0.09 + Math.random() * 0.04, 2500 + Math.random() * 1500); break;
      case 'coinIn': this.tone(1568, 0.12, 'triangle', 0.18); this.tone(2093, 0.25, 'triangle', 0.16, 0.07); break;
      case 'coinOut': this.tone(1318, 0.1, 'triangle', 0.16); this.tone(988, 0.22, 'triangle', 0.14, 0.07); break;
      case 'build': this.noise(0.08, 0.4, 0, 500); this.tone(180, 0.12, 'square', 0.12, 0.02); this.noise(0.06, 0.3, 0.14, 700); break;
      case 'hotel': [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.4, 'triangle', 0.16, i * 0.09)); this.noise(0.1, 0.3, 0, 400); break;
      case 'buy': [784, 988, 1175, 1568].forEach((f, i) => this.tone(f, 0.18, 'square', 0.07, i * 0.06)); this.tone(2093, 0.4, 'triangle', 0.12, 0.26); break;
      case 'card': this.noise(0.18, 0.25, 0, 3500); this.noise(0.12, 0.18, 0.12, 5000); break;
      case 'step': this.tone(420 + Math.random() * 60, 0.05, 'sine', 0.08); break;
      case 'click': this.tone(880, 0.04, 'sine', 0.06); break;
      case 'jail': this.tone(220, 0.25, 'sawtooth', 0.1); this.tone(165, 0.4, 'sawtooth', 0.1, 0.22); this.noise(0.15, 0.3, 0.4, 300); break;
      case 'error': this.tone(200, 0.18, 'square', 0.07); break;
      case 'victory': [523, 659, 784, 1046, 784, 1046, 1318].forEach((f, i) => this.tone(f, 0.35, 'triangle', 0.16, i * 0.14)); break;
      case 'bankrupt': [392, 330, 262, 196].forEach((f, i) => this.tone(f, 0.45, 'sawtooth', 0.08, i * 0.22)); break;
    }
  }

  setMusic(on: boolean) { this.musicOn = on; if (on) this.startMusic(); else this.stopMusic(); }
  private startMusic() {
    if (!this.ctx || this.musicTimer !== null) return;
    // gentle lounge loop: I–vi–IV–V with a soft arpeggio
    const chords = [[262, 330, 392], [220, 262, 330], [175, 220, 262], [196, 247, 294]];
    let bar = 0;
    const play = () => {
      const ch = chords[bar % 4];
      ch.forEach(f => this.tone(f / 2, 2.2, 'sine', 0.12, 0, undefined, this.musicGain));
      ch.concat([ch[0] * 2]).forEach((f, i) => this.tone(f * 2, 0.5, 'triangle', 0.05, i * 0.5, undefined, this.musicGain));
      bar++;
    };
    play();
    this.musicTimer = window.setInterval(play, 2000);
  }
  private stopMusic() { if (this.musicTimer !== null) { clearInterval(this.musicTimer); this.musicTimer = null; } }
}

export const sound = new Sound();
