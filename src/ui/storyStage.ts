import type { GameState } from "../game/state";
import type { Line } from "../game/story";
import { CAST, castName, drawCharacter, drawProp, type CastName, type Pose } from "../render/storyAssets";
import { personFrame, textSprite, type PersonLook } from "../world/sprites";
import { HorsePuppet } from "../world/puppet";
import { hasWings } from "../game/activities";
import { isFoal } from "../game/state";

const PLAYER: PersonLook = { hat: "none", hair: "#3c281c", skin: "#efc7a0", shirt: "#b65242", shirtDark: "#84352d", pants: "#354e68" };
type Scene = "home" | "arena" | "circus" | "lab" | "shore" | "forest" | "mountain";
const sceneOf = (day: number): Scene => day === 23 ? "mountain" : [15].includes(day) ? "shore" : [12,16].includes(day) ? "forest" : [10,11,17,18,19,24].includes(day) ? "lab" : [8,9,13].includes(day) ? "circus" : [2,5,6,7,14,20,21,27,28,29,31].includes(day) ? "arena" : "home";
const CASTS: Record<Scene, CastName[]> = {
  home: ["老赵", "马董"], arena: ["阿桃", "老赵", "马董"], circus: ["米娅", "阿桃"],
  lab: ["小白", "K先生"], shore: ["老赵"], forest: ["米娅", "老赵"], mountain: ["老赵"],
};
/** 入场、转身、手势、欢呼和低头均随正文推进；游戏时钟在对白期间暂停。 */
export class StoryStage {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private scene: Scene = "home";
  private actors: CastName[] = [];
  private focus = "";
  private pose: Pose = 0;
  private entered = 0;
  private title = "";
  private visible = false;
  private horse: HorsePuppet | null = null;
  private lastFrame = 0;
  constructor(host: HTMLElement) {
    this.canvas = document.createElement("canvas");
    this.canvas.className = "story-stage";
    this.canvas.width = 480;
    this.canvas.height = 240;
    this.canvas.hidden = true;
    this.canvas.setAttribute("aria-label", "角色剧情演出");
    host.appendChild(this.canvas);
    this.ctx = this.canvas.getContext("2d")!;
    requestAnimationFrame(this.frame);
  }
  show(line: Line, game: GameState): void {
    const day = line.sceneDay ?? game.day;
    const scene = game.ending || /夜里|借据|收据|交接|收购|还款|三万元/.test(line.text) ? "home" : sceneOf(day);
    const speaker=castName(line.actor??line.who);
    const mentioned = [...(speaker?[speaker]:[]),...CAST.filter(name => line.text.includes(name) || name === "K先生" && /\bK\b/.test(line.text))];
    const actors = mentioned.length ? [...new Set([...mentioned, ...CASTS[scene]])].slice(0,3) : CASTS[scene];
    if (!this.visible || scene !== this.scene || actors.join() !== this.actors.join()) this.entered = performance.now();
    this.scene = scene;
    this.actors = actors;
    this.focus = speaker || line.who || mentioned[0] || actors[0] || "";
    this.pose = /还不上|怕|哭|不够|落败|没赢|对不起/.test(line.text) ? 3 : /庆祝|笑|冠军|赢了|成了/.test(line.text) ? 2 : /[？?]|说|问|记录|看看/.test(line.text) ? 1 : 0;
    this.title = line.sceneTitle ?? "天马牧场";
    const h = game.horses.find(h => h.bornDay === day) ?? game.horses.find(h => h.id === game.story.choices.horse) ?? game.horses.find(h => h.id === game.selectedId);
    if (h && (this.horse?.id !== h.id || this.horse.genome !== h.genome || this.horse.scale !== (isFoal(h,game.day)?0.6:1))) {
      this.horse = new HorsePuppet(h.id,h.name,h.genome,0,0,isFoal(h,game.day)?0.6:1,hasWings(h));
    }
    this.visible = true;
    this.canvas.hidden = false;
  }
  hide(): void { this.visible = false; this.canvas.hidden = true; }
  private frame = (now: number): void => {
    requestAnimationFrame(this.frame);
    if (!this.visible) return;
    const dt=Math.min(0.04,(now-this.lastFrame)/1000)||0.016;
    this.lastFrame=now;
    const c = this.ctx;
    c.clearRect(0,0,480,240);
    c.imageSmoothingEnabled = false;
    const colors: Record<Scene,[string,string]> = {home:["#cbb580","#91754b"],arena:["#8cba78","#c79663"],circus:["#eccb8d","#b77d53"],lab:["#b8c6b0","#859d8b"],shore:["#98c7ce","#dbc490"],forest:["#85a175","#597f55"],mountain:["#c3dce3","#dce6dd"]};
    const [sky,ground] = colors[this.scene];
    c.fillStyle = sky;c.fillRect(0,0,480,145);
    c.fillStyle = ground;c.fillRect(0,145,480,95);
    for(let y=150;y<235;y+=9){c.fillStyle=y%2?"#ffffff18":"#30271913";for(let x=(y%3)*4;x<480;x+=17)c.fillRect(x,y,4,1);}
    const prop = {home:13,arena:7,circus:0,lab:14,shore:10,forest:11,mountain:12}[this.scene];
    drawProp(c,prop,380,192,185);
    if(this.scene==="circus")drawProp(c,1,100,183,180);
    if(this.scene==="home")drawProp(c,2,62,202,98);
    const progress=Math.min(1,(now-this.entered)/500);
    const ease=1-(1-progress)**3;
    const t=now/1000;
    const player=personFrame(PLAYER,"right",progress<1?Math.floor(t*8)%4:0);
    c.drawImage(player,Math.round(48-(1-ease)*45),151,45,68);
    this.actors.forEach((actor,i)=>{
      const x=155+i*94+(1-ease)*(i%2?100:-100);
      const bob=progress<1?Math.sin(t*13+i)*2:Math.sin(t*2+i)*0.8;
      const pose=actor===this.focus?this.pose:0;
      if(!drawCharacter(c,actor,pose,Math.round(x),Math.round(217+bob),139)){
        const sprite=personFrame({...PLAYER,shirt:i%2?"#6c8099":"#a66b52"},"down",Math.floor(t*2)%2);
        c.drawImage(sprite,x-23,151,45,68);
      }
      if(actor===this.focus){c.fillStyle="#f0cf6a";c.fillRect(Math.round(x-13),227,26,2);}
    });
    if(this.horse&&["home","circus","mountain"].includes(this.scene)){
      this.horse.update(dt);
      this.horse.drawPixel(c,370,235,21);
    }
    const label=textSprite(this.title,"#fbefd4");
    c.fillStyle="#38251c";c.fillRect(8,8,Math.min(460,label.width+16),18);
    c.drawImage(label,16,8);
  };
}
