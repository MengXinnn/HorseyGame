import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderTheme, score, THEMES, themeFor, type Theme } from "../src/audio/score";
import { WorldMusic } from "../src/audio/worldMusic";

describe("大世界配乐", () => {
  it("夜晚覆盖各区域，白天匹配牧场、城镇和野原", () => {
    expect(themeFor("ranch", 360)).toBe("ranch");
    expect(themeFor(undefined, 800)).toBe("ranch");
    for (const region of ["town", "track", "arena"]) expect(themeFor(region, 800)).toBe("town");
    for (const region of ["lab", "wilds"]) expect(themeFor(region, 800)).toBe("wilds");
    for (const region of [undefined, "ranch", "town", "wilds"]) {
      expect(themeFor(region, 1140)).toBe("night");
      expect(themeFor(region, 359)).toBe("night");
    }
    expect(themeFor("town", 1139)).toBe("town");
  });

  it("四首完整循环包含旋律和伴奏，合成不削波且接缝平滑", () => {
    for (const theme of Object.keys(THEMES) as Theme[]) {
      const notes = score(theme);
      expect(new Set(notes.map((n) => n.voice)).size).toBe(4);
      expect(notes.every((n) => n.beat >= 0 && n.beat < 64 && n.duration > 0)).toBe(true);
      const channels = renderTheme(theme, 8000);
      expect(channels[0].length / 8000).toBeCloseTo(64 * 60 / THEMES[theme].bpm, 3);
      for (const channel of channels) {
        let peak = 0;
        let finite = true;
        for (const value of channel) {
          finite &&= Number.isFinite(value);
          peak = Math.max(peak, Math.abs(value));
        }
        expect(finite).toBe(true);
        expect(peak).toBeGreaterThan(0.1);
        expect(peak).toBeLessThan(0.9);
        expect(Math.abs(channel[0]! - channel[channel.length - 1]!)).toBeLessThan(0.08);
      }
    }
  });
});

class FakeGain {
  gain = { value: 0, cancelAndHoldAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), setValueAtTime: vi.fn(), setTargetAtTime: vi.fn() };
  connect = vi.fn();
  disconnect = vi.fn();
}
class FakeSource {
  buffer = null;
  loop = false;
  connect = vi.fn();
  disconnect = vi.fn();
  start = vi.fn();
  stop = vi.fn();
  onended?: () => void;
}
class FakeContext {
  static instances: FakeContext[] = [];
  state = "suspended";
  currentTime = 0;
  destination = {};
  sources: FakeSource[] = [];
  gains: FakeGain[] = [];
  constructor() { FakeContext.instances.push(this); }
  resume = vi.fn(async () => { this.state = "running"; });
  decodeAudioData = vi.fn(async () => ({}));
  createGain(): FakeGain { const gain = new FakeGain(); this.gains.push(gain); return gain; }
  createBufferSource(): FakeSource { const source = new FakeSource(); this.sources.push(source); return source; }
}
const flush = async (): Promise<void> => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

describe("音乐播放生命周期", () => {
  let preferences: string | null;
  beforeEach(() => {
    preferences = null;
    FakeContext.instances = [];
    vi.stubGlobal("AudioContext", FakeContext);
    vi.stubGlobal("localStorage", {
      getItem: () => preferences,
      setItem: (_key: string, value: string) => { preferences = value; },
    });
    vi.stubGlobal("document", { createElement: () => ({ canPlayType: () => "probably" }) });
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(1) })));
  });
  afterEach(() => vi.unstubAllGlobals());

  it("首次交互前不创建音频，交互后循环；同曲不重启，区域切换淡出旧曲", async () => {
    const music = new WorldMusic(vi.fn());
    music.update("town", true);
    expect(FakeContext.instances).toHaveLength(0);
    await music.unlock();
    const context = FakeContext.instances[0]!;
    expect(context.sources[0]!.loop).toBe(true);
    music.update("town", true);
    expect(context.sources).toHaveLength(1);
    music.update("wilds", true);
    await flush();
    expect(context.sources).toHaveLength(2);
    expect(context.sources[0]!.stop).toHaveBeenCalledWith(1.6);
    expect(context.gains[1]!.gain.linearRampToValueAtTime).toHaveBeenLastCalledWith(0, 1.5);
  });

  it("静音和离开大世界停止音乐，返回复用缓存；保存音量和开关", async () => {
    const music = new WorldMusic(vi.fn());
    await music.unlock();
    const context = FakeContext.instances[0]!;
    music.update("ranch", false);
    expect(context.sources[0]!.stop).toHaveBeenCalled();
    music.update("ranch", true);
    await flush();
    expect(context.sources).toHaveLength(2);
    expect(fetch).toHaveBeenCalledTimes(1);
    music.setEnabled(false);
    expect(context.sources[1]!.stop).toHaveBeenCalled();
    music.setVolume(0.72);
    const restored = new WorldMusic(vi.fn());
    expect(restored.enabled).toBe(false);
    expect(restored.volume).toBe(0.72);
    await restored.unlock();
    expect(FakeContext.instances).toHaveLength(1);
  });

  it("加载期间切到后台不会开始播放，恢复后能播放", async () => {
    let resolve!: (value: ArrayBuffer) => void;
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, arrayBuffer: () => new Promise<ArrayBuffer>((r) => { resolve = r; }) })));
    const music = new WorldMusic(vi.fn());
    const loading = music.unlock();
    await flush();
    music.update("ranch", false);
    resolve(new ArrayBuffer(1));
    await loading;
    expect(FakeContext.instances[0]!.sources).toHaveLength(0);
    music.update("ranch", true);
    await flush();
    expect(FakeContext.instances[0]!.sources).toHaveLength(1);
  });

  it("快速跨区域时只播放最后的区域", async () => {
    const music = new WorldMusic(vi.fn());
    await music.unlock();
    music.update("town", true);
    music.update("wilds", true);
    music.update("night", true);
    await flush();
    expect(FakeContext.instances[0]!.sources).toHaveLength(2);
    expect(music.title).toBe("月落河湾");
  });

  it("加载失败只提示一次，开关重试可以恢复", async () => {
    const error = vi.fn();
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false } as Response);
    const music = new WorldMusic(error);
    await music.unlock();
    await music.unlock();
    expect(error).toHaveBeenCalledTimes(1);
    music.setEnabled(false);
    music.setEnabled(true);
    await flush();
    expect(FakeContext.instances[0]!.sources).toHaveLength(1);
  });
});
