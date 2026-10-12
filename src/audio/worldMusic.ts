import { THEMES, type Theme } from "./score";

const SETTINGS_KEY = "tianma:music";
interface Playing { source: AudioBufferSourceNode; gain: GainNode }

/** Gesture-unlocked, gapless loops with crossfades; only the active theme is decoded. */
export class WorldMusic {
  enabled = true;
  volume = 0.35;
  readonly supported = typeof AudioContext !== "undefined";
  private context?: AudioContext;
  private master?: GainNode;
  private buffers = new Map<Theme, Promise<AudioBuffer>>();
  private playing?: Playing;
  private current?: Theme;
  private desired: Theme = "ranch";
  private active = true;
  private revision = 0;
  private unlocking = false;
  private failed = false;

  constructor(private readonly onError: () => void) {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "null");
      if (saved && typeof saved === "object") {
        const s = saved as Record<string, unknown>;
        if (typeof s.enabled === "boolean") this.enabled = s.enabled;
        if (typeof s.volume === "number" && Number.isFinite(s.volume)) this.volume = Math.min(1, Math.max(0, s.volume));
      }
    } catch { /* Music preferences must never prevent the game from loading. */ }
  }

  get title(): string { return THEMES[this.desired].title; }

  /** Call directly from pointer/key events, including after browser suspension. */
  async unlock(): Promise<void> {
    if (!this.supported || !this.enabled || this.unlocking || this.failed) return;
    this.unlocking = true;
    try {
      if (!this.context) {
        this.context = new AudioContext();
        this.master = this.context.createGain();
        this.master.gain.value = this.volume;
        this.master.connect(this.context.destination);
      }
      if (this.context.state === "suspended") await this.context.resume();
      await this.sync();
    } catch { this.reportError(); }
    finally { this.unlocking = false; }
  }

  update(theme: Theme, active: boolean): void {
    if (theme === this.desired && active === this.active) return;
    this.desired = theme;
    this.active = active;
    void this.sync();
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (enabled) this.failed = false;
    this.save();
    if (enabled) void this.unlock();
    else void this.sync();
  }

  setVolume(volume: number): void {
    if (!Number.isFinite(volume)) return;
    this.volume = Math.min(1, Math.max(0, volume));
    if (this.context && this.master) this.master.gain.setTargetAtTime(this.volume, this.context.currentTime, 0.1);
    this.save();
  }

  private save(): void {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify({ enabled: this.enabled, volume: this.volume })); }
    catch { /* Private browsing/full storage: keep session preferences. */ }
  }

  private fadeOut(): void {
    if (!this.playing || !this.context) return;
    const { source, gain } = this.playing;
    const now = this.context.currentTime;
    gain.gain.cancelAndHoldAtTime(now);
    gain.gain.linearRampToValueAtTime(0, now + 1.5);
    source.stop(now + 1.6);
    this.playing = undefined;
    this.current = undefined;
  }

  private async sync(): Promise<void> {
    const revision = ++this.revision;
    const context = this.context;
    if (!context || !this.master) return;
    if (!this.enabled || !this.active) { this.fadeOut(); return; }
    if (context.state !== "running" || this.current === this.desired || this.failed) return;
    const theme = this.desired;
    try {
      let pending = this.buffers.get(theme);
      if (!pending) {
        const extension = document.createElement("audio").canPlayType('audio/ogg; codecs="vorbis"') ? "ogg" : "mp3";
        pending = fetch(`${import.meta.env.BASE_URL}music/${theme}.${extension}`)
          .then((response) => {
            if (!response.ok) throw new Error("Music asset unavailable");
            return response.arrayBuffer();
          }).then((bytes) => context.decodeAudioData(bytes));
        this.buffers.set(theme, pending);
        void pending.catch(() => this.buffers.delete(theme));
      }
      const buffer = await pending;
      if (revision !== this.revision || context.state !== "running") return;
      this.fadeOut();
      const source = context.createBufferSource();
      const gain = context.createGain();
      source.buffer = buffer;
      source.loop = true;
      source.connect(gain);
      gain.connect(this.master);
      const now = context.currentTime;
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(1, now + 1.5);
      source.onended = () => { source.disconnect(); gain.disconnect(); };
      source.start(now);
      this.playing = { source, gain };
      this.current = theme;
    } catch {
      if (revision === this.revision) this.reportError();
    }
  }

  private reportError(): void {
    if (this.failed) return;
    this.failed = true;
    this.onError();
  }
}
