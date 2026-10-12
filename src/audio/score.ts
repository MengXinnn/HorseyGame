/** Original 16-bar pastoral miniatures. MIDI pitches; all notes are composed here. */
export const THEMES = {
  ranch: { title: "牧场晨风", bpm: 76, root: 60, chords: [0, 5, 9, 7], melody: [4, 7, 9, 7, 4, 2, 0, 2, 5, 9, 12, 9, 7, 5, 4, 2] },
  town: { title: "马蹄小调", bpm: 92, root: 62, chords: [0, 7, 9, 5], melody: [0, 4, 7, 9, 7, 4, 2, 4, 5, 9, 7, 5, 4, 2, 0, 7] },
  wilds: { title: "野原远山", bpm: 68, root: 57, chords: [9, 5, 0, 7], melody: [9, 12, 14, 16, 14, 12, 9, 7, 5, 9, 7, 4, 2, 4, 7, 9] },
  night: { title: "月落河湾", bpm: 60, root: 60, chords: [9, 5, 0, 7], melody: [9, 7, 4, 2, 0, 4, 7, 4, 5, 4, 2, 0, 2, 4, 7, 9] },
} as const;
export type Theme = keyof typeof THEMES;
export type Voice = "pluck" | "flute" | "pad" | "bass";
export interface Note { beat: number; duration: number; pitch: number; voice: Voice; gain: number; pan: number }

export function themeFor(region: string | undefined, clock: number): Theme {
  if (clock >= 19 * 60 || clock < 6 * 60) return "night";
  if (region === "town" || region === "track" || region === "arena") return "town";
  if (region === "wilds" || region === "lab") return "wilds";
  return "ranch";
}

export function score(theme: Theme): Note[] {
  const t = THEMES[theme];
  const notes: Note[] = [];
  const add = (beat: number, duration: number, pitch: number, voice: Voice, gain: number, pan = 0): void => {
    notes.push({ beat, duration, pitch: t.root + pitch, voice, gain, pan });
  };
  for (let bar = 0; bar < 16; bar++) {
    const chord = t.chords[Math.floor(bar / 2) % 4]!;
    const third = chord === 9 ? 3 : 4;
    const tones = [chord, chord + third, chord + 7];
    // The B phrase changes register and answers the opening motif.
    const phrase = bar >= 8 ? 12 : 0;
    add(bar * 4, 3.8, chord - 24, "bass", 0.14);
    tones.forEach((pitch, i) => add(bar * 4, 4.8, pitch - 12, "pad", 0.055, (i - 1) * 0.45));
    for (let step = 0; step < 8; step++) {
      if (theme === "night" && step % 2) continue;
      const pitch = tones[[0, 1, 2, 1, 0, 2, 1, 2][step]!]!;
      add(bar * 4 + step / 2, 1.8, pitch + (step % 4 === 3 ? 12 : 0), "pluck", theme === "town" ? 0.105 : 0.075, step % 2 ? 0.3 : -0.3);
    }
    // Leave breathing room at the end of each four-bar phrase.
    if (bar % 4 !== 3) {
      add(bar * 4 + 0.25, 1.5, t.melody[(bar * 2) % 16]! + phrase, "flute", theme === "night" ? 0.10 : 0.14, -0.1);
      add(bar * 4 + 2.25, 1.35, t.melody[(bar * 2 + 1) % 16]! + phrase, "flute", 0.11, 0.1);
    }
  }
  return notes;
}

/** Deterministic stereo synthesis, with release/reverb tails wrapped into the loop. */
export function renderTheme(theme: Theme, sampleRate = 22050): [Float32Array, Float32Array] {
  const beatSeconds = 60 / THEMES[theme].bpm;
  const length = Math.round(64 * beatSeconds * sampleRate);
  const channels: [Float32Array, Float32Array] = [new Float32Array(length), new Float32Array(length)];
  for (const n of score(theme)) {
    const start = Math.round(n.beat * beatSeconds * sampleRate);
    const duration = n.duration * beatSeconds;
    const count = Math.ceil(duration * sampleRate);
    const hz = 440 * 2 ** ((n.pitch - 69) / 12);
    for (let i = 0; i < count; i++) {
      const time = i / sampleRate;
      const phase = 2 * Math.PI * hz * time;
      let value: number;
      if (n.voice === "pluck") {
        value = (Math.sin(phase) + 0.35 * Math.sin(phase * 2) + 0.16 * Math.sin(phase * 3)) * Math.exp(-time * 3.2) * Math.min(1, time / 0.008);
      } else {
        const attack = n.voice === "pad" ? 0.6 : 0.08;
        const release = n.voice === "pad" ? 1.0 : 0.25;
        const envelope = Math.min(1, time / attack, (duration - time) / release);
        const vibrato = n.voice === "flute" ? 0.018 * Math.sin(2 * Math.PI * 4.5 * time) : 0;
        value = (Math.sin(phase + vibrato) + (n.voice === "flute" ? 0.13 : 0.22) * Math.sin(phase * 2)) * envelope;
      }
      value *= n.gain;
      for (let c = 0; c < 2; c++) {
        const pan = Math.sqrt((1 + (c === 0 ? -n.pan : n.pan)) / 2);
        const output = channels[c]!;
        output[(start + i) % length]! += value * pan;
        // A short, quiet room instead of a long, muddy wash.
        output[(start + i + Math.round(sampleRate * (c ? 0.31 : 0.23))) % length]! += value * pan * 0.18;
        output[(start + i + Math.round(sampleRate * 0.57)) % length]! += value * pan * 0.07;
      }
    }
  }
  return channels;
}
