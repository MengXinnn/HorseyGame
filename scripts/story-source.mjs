import { readFile, writeFile } from 'node:fs/promises';

const source = await readFile(new URL('../docs/story/31-days.md', import.meta.url), 'utf8');
const chapters = source.split(/^## /m).slice(1).map(chapter => {
  const newline = chapter.indexOf('\n');
  return { title: chapter.slice(0, newline).trim(), paragraphs: chapter.slice(newline).trim().split(/\n\n/) };
});
if (chapters.length !== 35) throw new Error(`Expected 35 chapters, got ${chapters.length}`);
const target = new URL('../src/game/script.json', import.meta.url);
if (process.argv.includes('--check')) {
  const saved = JSON.parse(await readFile(target, 'utf8')).map(chapter => ({ ...chapter, paragraphs: chapter.paragraphs.map(p => p.trim()).filter(Boolean) }));
  if (JSON.stringify(chapters) !== JSON.stringify(saved)) throw new Error('Story JSON differs from the polished screenplay. Run npm run story:compile and review paragraph cue indices.');
  console.log('35 chapters match the polished screenplay.');
} else {
  await writeFile(target, JSON.stringify(chapters, null, 2) + '\n');
  console.log('Compiled 35 chapters. Review story.ts / speakers.ts indices after editing source.');
}
