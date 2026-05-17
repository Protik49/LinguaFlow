import sharp from "sharp";
import { mkdirSync, existsSync } from "fs";
import { resolve } from "path";

const dist = resolve(process.cwd(), "dist", "icons");
if (!existsSync(dist)) mkdirSync(dist, { recursive: true });

const svg = `<svg width="128" height="128" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#6366f1"/>
      <stop offset="100%" stop-color="#818cf8"/>
    </linearGradient>
  </defs>
  <rect width="128" height="128" rx="28" fill="url(#g)"/>
  <text x="64" y="82" font-size="60" text-anchor="middle" fill="white" font-family="Arial,sans-serif" font-weight="bold">L</text>
</svg>`;

const svgBuffer = Buffer.from(svg);

async function generate() {
  const png = await sharp(svgBuffer).png().toBuffer();
  const sizes = [
    { name: "icon16.png", width: 16 },
    { name: "icon48.png", width: 48 },
    { name: "icon128.png", width: 128 },
  ];

  for (const { name, width } of sizes) {
    await sharp(png).resize(width, width).png().toFile(resolve(dist, name));
    console.log(`  Generated ${name} (${width}x${width})`);
  }
}

generate().catch(console.error);
