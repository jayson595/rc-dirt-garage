// Small canvas-generated textures. Placeholder art: swap for authored textures later.
import * as THREE from 'three';

const cache = new Map<string, THREE.Texture>();

function canvasTex(key: string, w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, repeat?: [number, number]) {
  const hit = cache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d')!;
  draw(g);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  cache.set(key, t);
  return t;
}

export function labelTexture(text: string, opts: { bg?: string; fg?: string; w?: number; h?: number; font?: string; stripe?: string } = {}) {
  const { bg = '#1d1d1f', fg = '#f4efe6', w = 512, h = 128, font = '800 64px "Barlow Condensed", system-ui, sans-serif', stripe } = opts;
  return canvasTex(`label:${text}:${bg}:${fg}:${w}:${h}:${stripe}`, w, h, (g) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    if (stripe) { g.fillStyle = stripe; g.fillRect(0, h - h * 0.14, w, h * 0.14); g.fillRect(0, 0, w, h * 0.08); }
    g.fillStyle = fg; g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, w / 2, h / 2 + 2);
  });
}

export function checkerTexture(n = 8) {
  return canvasTex(`checker:${n}`, 256, 64, (g) => {
    const s = 256 / (n * 4);
    for (let y = 0; y < 64 / s; y++) for (let x = 0; x < n * 4; x++) {
      g.fillStyle = (x + y) % 2 ? '#111' : '#f4f4f0';
      g.fillRect(x * s, y * s, s, s);
    }
  });
}

export function pegboardTexture() {
  return canvasTex('pegboard', 256, 256, (g) => {
    g.fillStyle = '#b98a57'; g.fillRect(0, 0, 256, 256);
    g.fillStyle = 'rgba(60,35,15,0.55)';
    for (let y = 8; y < 256; y += 16) for (let x = 8; x < 256; x += 16) { g.beginPath(); g.arc(x, y, 2.4, 0, Math.PI * 2); g.fill(); }
  }, [6, 3]);
}

export function woodTexture() {
  return canvasTex('wood', 256, 256, (g) => {
    g.fillStyle = '#c08a52'; g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 40; i++) {
      g.strokeStyle = `rgba(${90 + Math.random() * 40},${50 + Math.random() * 30},20,${0.12 + Math.random() * 0.15})`;
      g.lineWidth = 1 + Math.random() * 2;
      const y = Math.random() * 256;
      g.beginPath(); g.moveTo(0, y);
      for (let x = 0; x <= 256; x += 32) g.lineTo(x, y + Math.sin(x * 0.05 + i) * 3);
      g.stroke();
    }
  }, [2, 1]);
}

export function concreteTexture() {
  return canvasTex('concrete', 256, 256, (g) => {
    g.fillStyle = '#8e8b85'; g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 2500; i++) {
      const v = 110 + Math.random() * 50;
      g.fillStyle = `rgba(${v},${v - 4},${v - 10},0.25)`;
      g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
    }
  }, [4, 4]);
}

export function dirtNoiseTexture() {
  return canvasTex('dirt', 256, 256, (g) => {
    g.fillStyle = '#808080'; g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 6000; i++) {
      const v = 90 + Math.random() * 90;
      g.fillStyle = `rgba(${v},${v},${v},0.35)`;
      const r = Math.random() * 2.2;
      g.fillRect(Math.random() * 256, Math.random() * 256, r, r);
    }
  }, [40, 40]);
}

export function matTexture() {
  return canvasTex('mat', 256, 256, (g) => {
    g.fillStyle = '#2f5f9e'; g.fillRect(0, 0, 256, 256);
    g.strokeStyle = 'rgba(255,255,255,0.22)'; g.lineWidth = 1;
    for (let i = 0; i <= 256; i += 16) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 256); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(256, i); g.stroke(); }
  });
}

export function skyTexture() {
  return canvasTex('sky', 4, 256, (g) => {
    const gr = g.createLinearGradient(0, 0, 0, 256);
    gr.addColorStop(0, '#5f9fdc'); gr.addColorStop(0.55, '#a9cfef'); gr.addColorStop(1, '#e8eef0');
    g.fillStyle = gr; g.fillRect(0, 0, 4, 256);
  });
}

export function markerTexture() {
  return canvasTex('marker', 128, 128, (g) => {
    g.strokeStyle = '#ffd43b'; g.lineWidth = 10;
    g.beginPath(); g.arc(64, 64, 44, 0, Math.PI * 2); g.stroke();
    g.fillStyle = '#ffd43b';
    g.beginPath(); g.moveTo(64, 2); g.lineTo(80, 22); g.lineTo(48, 22); g.fill();
  });
}

export function blobShadowTexture() {
  return canvasTex('blob', 128, 128, (g) => {
    const gr = g.createRadialGradient(64, 64, 4, 64, 64, 62);
    gr.addColorStop(0, 'rgba(0,0,0,0.55)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  });
}

export function treadTexture() {
  return canvasTex('tread', 128, 32, (g) => {
    g.fillStyle = '#1b1b1b'; g.fillRect(0, 0, 128, 32);
    g.fillStyle = '#2c2c2c';
    for (let x = 2; x < 128; x += 8) for (let y = 3; y < 32; y += 8) g.fillRect(x + ((y / 8) % 2) * 4, y, 3, 3);
  });
}
