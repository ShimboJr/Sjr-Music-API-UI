/**
 * SJrMusic PWA Icon Generator
 * Run: node generate-icons.js
 * Requires: npm install canvas
 * Generates icons/icon-192.png, icons/icon-512.png, icons/apple-touch-icon.png
 */

const { createCanvas } = require('canvas');
const fs = require('fs');
const path = require('path');

const iconsDir = path.join(__dirname, 'icons');
if (!fs.existsSync(iconsDir)) fs.mkdirSync(iconsDir);

function drawIcon(size) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');

  const r = size / 2;
  const pad = size * 0.08;
  const innerR = r - pad;

  /* ── Background circle ── */
  const bgGrad = ctx.createRadialGradient(r, r, 0, r, r, r);
  bgGrad.addColorStop(0, '#1a0a3e');
  bgGrad.addColorStop(1, '#0a0b0f');
  ctx.fillStyle = bgGrad;
  ctx.beginPath();
  ctx.arc(r, r, r, 0, Math.PI * 2);
  ctx.fill();

  /* ── Purple gradient disc ── */
  const discGrad = ctx.createLinearGradient(pad, pad, size - pad, size - pad);
  discGrad.addColorStop(0, '#7c3aed');
  discGrad.addColorStop(1, '#a855f7');
  ctx.fillStyle = discGrad;
  ctx.beginPath();
  ctx.arc(r, r, innerR, 0, Math.PI * 2);
  ctx.fill();

  /* ── Subtle inner glow ring ── */
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = size * 0.012;
  ctx.beginPath();
  ctx.arc(r, r, innerR - size * 0.02, 0, Math.PI * 2);
  ctx.stroke();

  /* ── Music note (♪) ── */
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = 'rgba(255,255,255,0.55)';
  ctx.shadowBlur = size * 0.06;

  const noteSize = innerR * 0.72;
  const cx = r - noteSize * 0.08;
  const cy = r + noteSize * 0.10;

  // Note head (filled circle at bottom-left)
  const headR = noteSize * 0.22;
  const headX = cx - noteSize * 0.18;
  const headY = cy + noteSize * 0.10;
  ctx.beginPath();
  ctx.ellipse(headX, headY, headR * 1.1, headR * 0.85, -0.35, 0, Math.PI * 2);
  ctx.fill();

  // Second note head (right)
  const head2X = headX + noteSize * 0.48;
  const head2Y = headY - noteSize * 0.18;
  ctx.beginPath();
  ctx.ellipse(head2X, head2Y, headR * 1.1, headR * 0.85, -0.35, 0, Math.PI * 2);
  ctx.fill();

  // Stem up from first head
  const stemW = noteSize * 0.07;
  ctx.fillRect(headX + headR * 0.95, headY - noteSize * 0.62, stemW, noteSize * 0.60);

  // Stem up from second head
  ctx.fillRect(head2X + headR * 0.95, head2Y - noteSize * 0.44, stemW, noteSize * 0.44);

  // Beam connecting the two stems at top
  const beamY = headY - noteSize * 0.60;
  ctx.fillRect(
    headX + headR * 0.95,
    beamY,
    head2X - headX + stemW,
    noteSize * 0.09
  );

  ctx.shadowBlur = 0;
  return canvas;
}

const sizes = [
  { name: 'icon-192.png', size: 192 },
  { name: 'icon-512.png', size: 512 },
  { name: 'apple-touch-icon.png', size: 180 },
];

sizes.forEach(({ name, size }) => {
  const canvas = drawIcon(size);
  const buf = canvas.toBuffer('image/png');
  const dest = path.join(iconsDir, name);
  fs.writeFileSync(dest, buf);
  console.log(`✓ Generated ${dest} (${size}×${size})`);
});

console.log('\nDone! Icons saved to ./icons/');
