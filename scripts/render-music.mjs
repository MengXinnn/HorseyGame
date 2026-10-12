// npm run music:render — rebuild all original music assets without external samples.
import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const compiled = await build({ entryPoints: ['src/audio/score.ts'], bundle: true, write: false, format: 'esm' });
const { THEMES, renderTheme } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
await mkdir('public/music', { recursive: true });
for (const theme of Object.keys(THEMES)) {
  const channels = renderTheme(theme);
  const length = channels[0].length;
  const wav = Buffer.alloc(44 + length * 4);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22);
  wav.writeUInt32LE(22050, 24); wav.writeUInt32LE(88200, 28); wav.writeUInt16LE(4, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(length * 4, 40);
  let peak = 0;
  for (const channel of channels) for (const value of channel) peak = Math.max(peak, Math.abs(value));
  const gain = 0.8 / Math.max(peak, 0.8);
  for (let i = 0; i < length; i++) for (let c = 0; c < 2; c++) wav.writeInt16LE(Math.round(channels[c][i] * gain * 32767), 44 + i * 4 + c * 2);
  const source = join(tmpdir(), `horsey-${theme}.wav`);
  await writeFile(source, wav);
  for (const [extension, codec] of [['ogg', 'libvorbis'], ['mp3', 'libmp3lame']]) {
    const result = spawnSync('ffmpeg', ['-y', '-v', 'error', '-i', source, '-c:a', codec, '-q:a', '4', `public/music/${theme}.${extension}`]);
    if (result.status !== 0) throw new Error(result.stderr.toString());
  }
  console.log(`${THEMES[theme].title}: ${(length / 22050).toFixed(1)}s, peak ${peak.toFixed(3)}`);
}
