/** 角色等分、道具按实际边界裁取的透明图集；未加载时回退到原有像素画。 */
export const CAST = ["老赵", "米娅", "小白", "K先生", "马董", "阿桃"] as const;
export type CastName = typeof CAST[number];
export type Pose = 0 | 1 | 2 | 3;
const characters = new Image();
const props = new Image();
characters.src = `${import.meta.env.BASE_URL}assets/story/characters.png`;
props.src = `${import.meta.env.BASE_URL}assets/story/props.png`;
export function drawCharacter(ctx: CanvasRenderingContext2D, name: CastName, pose: Pose, x: number, y: number, height: number): boolean {
  if (!characters.complete || !characters.naturalWidth) return false;
  const cw = characters.naturalWidth / 4;
  const ch = characters.naturalHeight / 6;
  const width = height * cw / ch;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(characters, pose * cw, CAST.indexOf(name) * ch, cw, ch, Math.round(x - width / 2), Math.round(y - height * 0.95), width, height);
  return true;
}
export function drawProp(ctx: CanvasRenderingContext2D, index: number, x: number, y: number, size: number): boolean {
  if (!props.complete || !props.naturalWidth) return false;
  const columns = [0,340,640,950,1254].map(v=>v/1254*props.naturalWidth);
  const rows = [0,350,650,940,1254].map(v=>v/1254*props.naturalHeight);
  const col=index%4,row=Math.floor(index/4);
  const sx=columns[col]!,sy=rows[row]!;
  const cw=columns[col+1]!-sx,ch=rows[row+1]!-sy;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(props, sx, sy, cw, ch, Math.round(x - size / 2), Math.round(y - size), size, size);
  return true;
}
export function castName(name: string): CastName | null {
  if (name === "K博士" || name === "K") return "K先生";
  return CAST.find(n => n === name) ?? null;
}
