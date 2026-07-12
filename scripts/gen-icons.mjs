// Rasterizes build/icon.svg into the assets electron-builder needs:
//   build/icon.png  (1024x1024 master — macOS .icns + Linux come from this)
//   build/icon.ico  (multi-size Windows icon)
// Run with: pnpm icons
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import sharp from 'sharp';
import pngToIco from 'png-to-ico';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const svg = readFileSync(path.join(root, 'build', 'icon.svg'));

async function main() {
  // Master PNG.
  const master = await sharp(svg).resize(1024, 1024).png().toBuffer();
  writeFileSync(path.join(root, 'build', 'icon.png'), master);

  // Windows .ico from several sizes.
  const sizes = [256, 128, 64, 48, 32, 16];
  const pngs = await Promise.all(
    sizes.map((s) => sharp(svg).resize(s, s).png().toBuffer()),
  );
  const ico = await pngToIco(pngs);
  writeFileSync(path.join(root, 'build', 'icon.ico'), ico);

  console.log('Wrote build/icon.png and build/icon.ico');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
