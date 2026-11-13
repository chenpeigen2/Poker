import * as THREE from 'three';

/** 固定种子的 LCG，保证每次生成的程序化贴图完全一致。 */
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function canvas2d(size: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx === null) throw new Error('Canvas 2D 上下文不可用');
  return { canvas, ctx };
}

function finish(canvas: HTMLCanvasElement, repeat = 1): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  if (repeat !== 1) {
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(repeat, repeat);
  }
  return texture;
}

/** 深绿毡布：底色 + 细密纤维 + 中心高光/边缘暗角。 */
export function makeFeltTexture(): THREE.CanvasTexture {
  const { canvas, ctx } = canvas2d(512);
  const random = lcg(0x5eed01);
  ctx.fillStyle = '#114630';
  ctx.fillRect(0, 0, 512, 512);

  for (let i = 0; i < 14000; i += 1) {
    const x = random() * 512;
    const y = random() * 512;
    const length = 1 + random() * 3;
    ctx.strokeStyle = random() > 0.5
      ? `rgba(180,230,200,${0.02 + random() * 0.05})`
      : `rgba(0,20,12,${0.03 + random() * 0.06})`;
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + length, y + length * (random() - 0.5));
    ctx.stroke();
  }

  const glow = ctx.createRadialGradient(256, 230, 30, 256, 256, 300);
  glow.addColorStop(0, 'rgba(120,200,160,0.13)');
  glow.addColorStop(1, 'rgba(0,0,0,0.34)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, 512, 512);
  return finish(canvas, 2);
}

/** 木质桌沿：横向纹理 + 高光带。 */
export function makeWoodTexture(): THREE.CanvasTexture {
  const { canvas, ctx } = canvas2d(512);
  const random = lcg(0x0a0d);
  ctx.fillStyle = '#3b2416';
  ctx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 260; i += 1) {
    const y = random() * 512;
    ctx.strokeStyle = `rgba(${90 + random() * 60},${55 + random() * 35},${28 + random() * 20},${0.08 + random() * 0.18})`;
    ctx.lineWidth = 0.5 + random() * 2.4;
    ctx.beginPath();
    ctx.moveTo(0, y);
    for (let x = 0; x <= 512; x += 32) {
      ctx.lineTo(x, y + Math.sin((x / 512) * Math.PI * 3 + i) * 2.2);
    }
    ctx.stroke();
  }
  const sheen = ctx.createLinearGradient(0, 0, 0, 512);
  sheen.addColorStop(0, 'rgba(255,220,170,0.12)');
  sheen.addColorStop(0.4, 'rgba(0,0,0,0.16)');
  sheen.addColorStop(1, 'rgba(0,0,0,0.3)');
  ctx.fillStyle = sheen;
  ctx.fillRect(0, 0, 512, 512);
  return finish(canvas, 1);
}

/** 对手座位牌：3D 空间里的姓名/称号。 */
export function makeLabelTexture(title: string, subtitle: string, accent: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 160;
  const ctx = canvas.getContext('2d');
  if (ctx === null) throw new Error('Canvas 2D 上下文不可用');
  ctx.fillStyle = 'rgba(8,18,15,0.92)';
  ctx.beginPath();
  ctx.roundRect(0, 0, 512, 160, 22);
  ctx.fill();
  ctx.strokeStyle = accent;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.textAlign = 'center';
  ctx.fillStyle = '#f2efe4';
  ctx.font = 'bold 62px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillText(title, 256, 74);
  ctx.fillStyle = accent;
  ctx.font = '30px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillText(subtitle, 256, 124);
  return finish(canvas, 1);
}

/** 筹码顶面：外圈 + 内圈 + 三道辐条。 */
export function makeChipTexture(color: string): THREE.CanvasTexture {
  const { canvas, ctx } = canvas2d(256);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(128, 128, 122, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,248,222,0.75)';
  ctx.lineWidth = 14;
  for (let i = 0; i < 6; i += 1) {
    const angle = (i / 6) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(128 + Math.cos(angle) * 78, 128 + Math.sin(angle) * 78);
    ctx.lineTo(128 + Math.cos(angle) * 116, 128 + Math.sin(angle) * 116);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(128, 128, 72, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(10,25,20,0.55)';
  ctx.fill();
  ctx.lineWidth = 8;
  ctx.strokeStyle = 'rgba(255,248,222,0.6)';
  ctx.stroke();
  return finish(canvas, 1);
}
