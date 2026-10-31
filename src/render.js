import { ALGAE_MAX } from './world.js';
import { T } from './genome.js';

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 8;

export class Renderer {
  constructor(canvas, world) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.camera = { x: 0, y: 0, zoom: 1 };
    this.time = 0;
    this.resize();
    this.setWorld(world);
  }

  setWorld(world) {
    this.world = world;
    this.algaeCanvas = document.createElement('canvas');
    this.algaeCanvas.width = world.cols;
    this.algaeCanvas.height = world.rows;
    this.algaeCtx = this.algaeCanvas.getContext('2d');
    this.algaeImage = this.algaeCtx.createImageData(world.cols, world.rows);
    this.fit();
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    this.dpr = dpr;
    this.w = this.canvas.clientWidth;
    this.h = this.canvas.clientHeight;
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
  }

  fit() {
    const { world } = this;
    this.camera.zoom = Math.min(this.w / world.width, this.h / world.height) * 0.94;
    this.camera.x = world.width / 2;
    this.camera.y = world.height / 2;
  }

  screenToWorld(sx, sy) {
    const { x, y, zoom } = this.camera;
    return { x: (sx - this.w / 2) / zoom + x, y: (sy - this.h / 2) / zoom + y };
  }

  pan(dx, dy) {
    this.camera.x -= dx / this.camera.zoom;
    this.camera.y -= dy / this.camera.zoom;
  }

  zoomAt(sx, sy, factor) {
    const before = this.screenToWorld(sx, sy);
    this.camera.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this.camera.zoom * factor));
    const after = this.screenToWorld(sx, sy);
    this.camera.x += before.x - after.x;
    this.camera.y += before.y - after.y;
  }

  follow(c) {
    this.camera.x += (c.x - this.camera.x) * 0.12;
    this.camera.y += (c.y - this.camera.y) * 0.12;
  }

  draw({ selected, hover, toolRadius }) {
    const { ctx, world, camera, dpr } = this;
    this.time += 1 / 60;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#04121a';
    ctx.fillRect(0, 0, this.w, this.h);

    const z = camera.zoom;
    ctx.setTransform(dpr * z, 0, 0, dpr * z, dpr * (this.w / 2 - camera.x * z), dpr * (this.h / 2 - camera.y * z));

    this.drawFloor();
    this.drawCaustics();
    for (const c of world.creatures) this.drawCreature(c);
    if (selected?.alive) this.drawSelection(selected);
    if (hover && toolRadius) {
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 1.5 / z;
      ctx.setLineDash([6 / z, 6 / z]);
      ctx.beginPath();
      ctx.arc(hover.x, hover.y, toolRadius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  drawFloor() {
    const { ctx, world } = this;
    const px = this.algaeImage.data;
    const { algae, fertility, bonus } = world;
    for (let i = 0; i < algae.length; i++) {
      const v = Math.sqrt(algae[i] / ALGAE_MAX); // sqrt so thin films of algae still show
      const f = Math.min(1, fertility[i] + bonus[i]);
      const o = i * 4;
      px[o] = 14 + 22 * f + 30 * v;
      px[o + 1] = 52 + 26 * f + 120 * v;
      px[o + 2] = 66 + 14 * f - 18 * v;
      px[o + 3] = 255;
    }
    this.algaeCtx.putImageData(this.algaeImage, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.algaeCanvas, 0, 0, world.width, world.height);

    ctx.strokeStyle = '#2b5c63';
    ctx.lineWidth = 6;
    ctx.strokeRect(-3, -3, world.width + 6, world.height + 6);
  }

  // Slowly drifting pools of light, like sun through moving water.
  drawCaustics() {
    const { ctx, world, time } = this;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let k = 0; k < 7; k++) {
      const x = world.width * (0.5 + 0.45 * Math.sin(time * 0.05 * (k + 1) + k * 1.7));
      const y = world.height * (0.5 + 0.45 * Math.cos(time * 0.037 * (k + 2) + k * 2.3));
      const r = 180 + 60 * Math.sin(time * 0.2 + k);
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(160, 230, 255, 0.07)');
      g.addColorStop(1, 'rgba(160, 230, 255, 0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    ctx.restore();
  }

  drawCreature(c) {
    const { ctx } = this;
    const r = c.radius * 1.3; // drawn a little larger than the hitbox so they read at low zoom
    const hue = c.genome.traits[T.hue] * 360;
    const vigor = Math.max(0, Math.min(1, c.energy / c.maxEnergy));
    const sat = 35 + 45 * vigor;
    const light = c.diet > 0.5 ? 52 : 64;
    c.phase += 0.12 + c.thrust * 0.6;
    const wag = Math.sin(c.phase) * 0.45;

    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate(c.angle);

    ctx.fillStyle = `hsla(${hue}, ${sat}%, ${light - 14}%, 0.9)`;
    ctx.beginPath();
    ctx.moveTo(-r * 0.7, 0);
    ctx.lineTo(-r * 1.9, (wag - 0.6) * r);
    ctx.lineTo(-r * 1.9, (wag + 0.6) * r);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = `hsl(${hue}, ${sat}%, ${light}%)`;
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 1.2, r * 0.8, 0, 0, Math.PI * 2);
    ctx.fill();

    if (c.diet > 0.5) {
      const open = c.attacking ? 0.55 : 0.25;
      ctx.strokeStyle = `hsl(${hue}, 70%, 85%)`;
      ctx.lineWidth = Math.max(0.6, r * 0.18);
      ctx.beginPath();
      ctx.moveTo(r * 0.9, -r * 0.35);
      ctx.lineTo(r * 1.65, -r * open);
      ctx.moveTo(r * 0.9, r * 0.35);
      ctx.lineTo(r * 1.65, r * open);
      ctx.stroke();
    }

    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath();
    ctx.arc(r * 0.55, -r * 0.32, r * 0.17, 0, Math.PI * 2);
    ctx.arc(r * 0.55, r * 0.32, r * 0.17, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  drawSelection(c) {
    const { ctx } = this;
    const z = this.camera.zoom;
    ctx.lineWidth = 1.5 / z;
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath();
    ctx.arc(c.x, c.y, c.radius * 2.2, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.setLineDash([4 / z, 6 / z]);
    ctx.beginPath();
    ctx.arc(c.x, c.y, c.vision, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    if (c.seen?.alive) {
      ctx.strokeStyle = c.attacking ? 'rgba(255,120,120,0.8)' : 'rgba(255,255,255,0.4)';
      ctx.beginPath();
      ctx.moveTo(c.x, c.y);
      ctx.lineTo(c.seen.x, c.seen.y);
      ctx.stroke();
    }
  }
}
