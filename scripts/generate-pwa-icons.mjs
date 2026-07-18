/**
 * Generate PWA PNG icons (192 / 512) from concrete-link-logo.svg.
 * Adds ~10% padding so content stays in the maskable safe zone.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const svgPath = path.join(root, 'src', 'assets', 'concrete-link-logo.svg');
const outDir = path.join(root, 'public', 'icons');

/** Matches manifest background_color */
const BG = { r: 241, g: 245, b: 249, alpha: 1 };

async function generateIcon(size) {
  const svg = fs.readFileSync(svgPath);
  const pad = Math.round(size * 0.1);
  const inner = size - pad * 2;

  const logo = await sharp(svg)
    .resize(inner, inner, {
      fit: 'contain',
      background: BG,
    })
    .png()
    .toBuffer();

  const outPath = path.join(outDir, `icon-${size}.png`);
  await sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: BG,
    },
  })
    .composite([{ input: logo, gravity: 'centre' }])
    .png()
    .toFile(outPath);

  console.log(`Wrote ${path.relative(root, outPath)} (${size}x${size})`);
}

fs.mkdirSync(outDir, { recursive: true });
await generateIcon(192);
await generateIcon(512);
