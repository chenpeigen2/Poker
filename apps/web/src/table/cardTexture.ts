import * as THREE from 'three';
import type { Card } from '@poker/domain';
import { rankLabelText, suitSymbol } from '@poker/domain';

const WIDTH = 256;
const HEIGHT = 358;

const cache = new Map<string, THREE.CanvasTexture>();

function roundedPath(ctx: CanvasRenderingContext2D, radius = 20): void {
  ctx.beginPath();
  ctx.moveTo(radius, 0);
  ctx.lineTo(WIDTH - radius, 0);
  ctx.quadraticCurveTo(WIDTH, 0, WIDTH, radius);
  ctx.lineTo(WIDTH, HEIGHT - radius);
  ctx.quadraticCurveTo(WIDTH, HEIGHT, WIDTH - radius, HEIGHT);
  ctx.lineTo(radius, HEIGHT);
  ctx.quadraticCurveTo(0, HEIGHT, 0, HEIGHT - radius);
  ctx.lineTo(0, radius);
  ctx.quadraticCurveTo(0, 0, radius, 0);
  ctx.closePath();
}

function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

const PIPS: Readonly<Record<number, readonly (readonly [number, number])[]>> = {
  2: [[0.5, 0.2], [0.5, 0.8]],
  3: [[0.5, 0.2], [0.5, 0.5], [0.5, 0.8]],
  4: [[0.28, 0.2], [0.72, 0.2], [0.28, 0.8], [0.72, 0.8]],
  5: [[0.28, 0.2], [0.72, 0.2], [0.5, 0.5], [0.28, 0.8], [0.72, 0.8]],
  6: [[0.28, 0.2], [0.72, 0.2], [0.28, 0.5], [0.72, 0.5], [0.28, 0.8], [0.72, 0.8]],
  7: [[0.28, 0.2], [0.72, 0.2], [0.5, 0.35], [0.28, 0.5], [0.72, 0.5], [0.28, 0.8], [0.72, 0.8]],
  8: [[0.28, 0.2], [0.72, 0.2], [0.5, 0.35], [0.28, 0.5], [0.72, 0.5], [0.5, 0.65], [0.28, 0.8], [0.72, 0.8]],
  9: [[0.28, 0.2], [0.72, 0.2], [0.28, 0.42], [0.72, 0.42], [0.5, 0.5], [0.28, 0.58], [0.72, 0.58], [0.28, 0.8], [0.72, 0.8]],
  10: [[0.28, 0.2], [0.72, 0.2], [0.28, 0.42], [0.72, 0.42], [0.5, 0.32], [0.5, 0.68], [0.28, 0.58], [0.72, 0.58], [0.28, 0.8], [0.72, 0.8]],
};

function drawFace(ctx: CanvasRenderingContext2D, card: Card): void {
  const red = card.suit === 'd' || card.suit === 'h';
  const ink = red ? '#b3272d' : '#17191d';
  const symbol = suitSymbol(card.suit);
  const rank = rankLabelText(card.rank);

  // 纸张微纹理
  const random = lcg(card.rank * 31 + card.suit.charCodeAt(0));
  ctx.fillStyle = '#f8f5ed';
  roundedPath(ctx);
  ctx.fill();
  for (let i = 0; i < 900; i += 1) {
    ctx.fillStyle = `rgba(120,110,90,${0.015 + random() * 0.025})`;
    ctx.fillRect(random() * WIDTH, random() * HEIGHT, 1.2, 1.2);
  }

  // 双层边框
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#cfc7b6';
  roundedPath(ctx);
  ctx.stroke();
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(120,110,90,0.35)';
  roundedPath(ctx, 12);
  ctx.stroke();

  // 角标（左上 + 右下旋转）
  const corner = (): void => {
    ctx.textAlign = 'center';
    ctx.fillStyle = ink;
    ctx.font = 'bold 74px Georgia, serif';
    ctx.fillText(rank, 40, 72);
    ctx.font = '48px Georgia, serif';
    ctx.fillText(symbol, 40, 120);
  };
  corner();
  ctx.save();
  ctx.translate(WIDTH, HEIGHT);
  ctx.rotate(Math.PI);
  corner();
  ctx.restore();

  // 中央牌面
  ctx.fillStyle = ink;
  if (card.rank <= 10) {
    const positions = PIPS[card.rank] ?? PIPS[2]!;
    ctx.font = '64px Georgia, serif';
    ctx.textAlign = 'center';
    for (const [nx, ny] of positions) {
      ctx.fillText(symbol, 62 + nx * 132, 138 + ny * 142);
    }
  } else {
    // J / Q / K / A：装饰画框 + 大字母
    ctx.fillStyle = red ? 'rgba(179,39,45,0.09)' : 'rgba(23,25,29,0.09)';
    roundedPath(ctx, 12);
    ctx.fill();
    ctx.strokeStyle = ink;
    ctx.lineWidth = 2.5;
    ctx.strokeRect(62, 116, 132, 150);
    ctx.strokeRect(70, 124, 116, 134);
    ctx.textAlign = 'center';
    ctx.font = 'bold 104px Georgia, serif';
    ctx.fillStyle = ink;
    ctx.fillText(rank, 128, 212);
    ctx.font = '62px Georgia, serif';
    ctx.fillText(symbol, 128, 268);
    ctx.font = '26px Georgia, serif';
    ctx.fillText('✦', 82, 142);
    ctx.fillText('✦', 174, 142);
  }
}

function drawBack(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = '#12345a';
  roundedPath(ctx);
  ctx.fill();
  ctx.save();
  roundedPath(ctx);
  ctx.clip();
  ctx.strokeStyle = 'rgba(160,205,235,0.22)';
  ctx.lineWidth = 2;
  for (let x = -HEIGHT; x < WIDTH + HEIGHT; x += 22) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + HEIGHT, HEIGHT);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x + HEIGHT, 0);
    ctx.lineTo(x, HEIGHT);
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(201,162,39,0.16)';
  ctx.beginPath();
  ctx.arc(WIDTH / 2, HEIGHT / 2, 62, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.lineWidth = 6;
  ctx.strokeStyle = '#d8bd6a';
  roundedPath(ctx, 14);
  ctx.stroke();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(255,240,200,0.6)';
  roundedPath(ctx, 8);
  ctx.stroke();
  ctx.textAlign = 'center';
  ctx.fillStyle = '#e8cf86';
  ctx.font = 'bold 76px Georgia, serif';
  ctx.fillText('♠', WIDTH / 2, HEIGHT / 2 + 28);
}

/** 程序化牌面/牌背贴图，带缓存；glow 用于摊牌胜方高亮。 */
export function makeCardTexture(
  card: Card | null,
  faceDown: boolean,
  glow = false,
): THREE.CanvasTexture {
  const key = faceDown || card === null
    ? `back-${glow ? 1 : 0}`
    : `${card.rank}-${card.suit}-${glow ? 1 : 0}`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d');
  if (ctx === null) throw new Error('Canvas 2D 上下文不可用');

  if (faceDown || card === null) drawBack(ctx);
  else drawFace(ctx, card);

  if (glow) {
    ctx.save();
    ctx.shadowColor = '#ffd970';
    ctx.shadowBlur = 26;
    ctx.lineWidth = 7;
    ctx.strokeStyle = '#ffd970';
    roundedPath(ctx, 18);
    ctx.stroke();
    ctx.restore();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  cache.set(key, texture);
  return texture;
}
