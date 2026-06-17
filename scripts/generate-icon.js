// Generate Windows .ico and multi-size PNG icons
// Uses sharp (already in node_modules) to create app icon
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

const SIZES = [16, 24, 32, 48, 64, 128, 256];
const OUTPUT_DIR = path.join(__dirname, "..", "public");

async function createBasePNG(size) {
  // Create a rounded-square icon with a gradient background and recording motif
  const svg = `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" style="stop-color:#6366f1"/>
        <stop offset="100%" style="stop-color:#8b5cf6"/>
      </linearGradient>
    </defs>
    <!-- Background rounded rect -->
    <rect width="${size}" height="${size}" rx="${size * 0.22}" fill="url(#bg)"/>
    <!-- Microphone body -->
    <rect x="${size * 0.38}" y="${size * 0.22}" width="${size * 0.24}" height="${size * 0.32}" rx="${size * 0.12}" fill="white" opacity="0.95"/>
    <!-- Microphone arc (top) -->
    <path d="M${size * 0.32} ${size * 0.26} Q${size * 0.28} ${size * 0.12} ${size * 0.50} ${size * 0.12} Q${size * 0.72} ${size * 0.12} ${size * 0.68} ${size * 0.26}"
          fill="none" stroke="white" stroke-width="${Math.max(2, size * 0.04)}" stroke-linecap="round" opacity="0.9"/>
    <!-- Microphone stand -->
    <rect x="${size * 0.46}" y="${size * 0.54}" width="${size * 0.08}" height="${size * 0.15}" rx="${size * 0.04}" fill="white" opacity="0.8"/>
    <!-- Stand base arc -->
    <path d="M${size * 0.36} ${size * 0.72} Q${size * 0.50} ${size * 0.82} ${size * 0.64} ${size * 0.72}"
          fill="none" stroke="white" stroke-width="${Math.max(2, size * 0.04)}" stroke-linecap="round" opacity="0.8"/>
    <!-- Sound waves -->
    <g opacity="0.7">
      <path d="M${size * 0.72} ${size * 0.32} Q${size * 0.80} ${size * 0.44} ${size * 0.72} ${size * 0.56}"
            fill="none" stroke="white" stroke-width="${Math.max(1.5, size * 0.025)}" stroke-linecap="round"/>
      <path d="M${size * 0.78} ${size * 0.28} Q${size * 0.88} ${size * 0.44} ${size * 0.78} ${size * 0.60}"
            fill="none" stroke="white" stroke-width="${Math.max(1.5, size * 0.025)}" stroke-linecap="round"/>
    </g>
  </svg>`;

  return sharp(Buffer.from(svg)).png().toBuffer();
}

function createICO(pngBuffers) {
  // Build multi-resolution ICO file with PNG data
  const count = pngBuffers.length;
  const headerSize = 6; // reserved(2) + type(2) + count(2)
  const dirEntrySize = 16;
  const dirSize = count * dirEntrySize;

  let offset = headerSize + dirSize;
  const dirEntries = [];

  for (const buf of pngBuffers) {
    const meta = sharp(buf); // We'll get metadata on the fly
    dirEntries.push({ buf, offset });
    offset += buf.length;
  }

  // ICO header
  const header = Buffer.alloc(headerSize);
  header.writeUInt16LE(0, 0);      // Reserved, must be 0
  header.writeUInt16LE(1, 2);      // Type: 1 = ICO
  header.writeUInt16LE(count, 4);  // Number of images

  // Build directory entries and image data
  const chunks = [header];

  for (const entry of dirEntries) {
    // Parse PNG to get dimensions
    // PNG IHDR is at byte 16: width(4) height(4) at offset 16
    const w = entry.buf.readUInt32BE(16);
    const h = entry.buf.readUInt32BE(20);

    const dir = Buffer.alloc(16);
    // Width and height (0 means 256)
    dir.writeUInt8(w >= 256 ? 0 : w, 0);
    dir.writeUInt8(h >= 256 ? 0 : h, 1);
    dir.writeUInt8(0, 2);        // Color palette (0 = no palette)
    dir.writeUInt8(0, 3);        // Reserved
    dir.writeUInt16LE(1, 4);     // Color planes
    dir.writeUInt16LE(32, 6);    // Bits per pixel
    dir.writeUInt32LE(entry.buf.length, 8);  // Image size
    dir.writeUInt32LE(entry.offset, 12);     // Image offset

    chunks.push(dir);
  }

  for (const entry of dirEntries) {
    chunks.push(entry.buf);
  }

  return Buffer.concat(chunks);
}

async function main() {
  console.log("Generating app icons...");

  // Create PNGs for all sizes
  const pngBuffers = [];
  for (const size of SIZES) {
    console.log(`  Creating ${size}x${size} PNG...`);
    const pngBuf = await createBasePNG(size);
    pngBuffers.push(pngBuf);

    // Also save individual PNGs (useful for other platforms)
    if (size === 256) {
      fs.writeFileSync(path.join(OUTPUT_DIR, "icon.png"), pngBuf);
    }
  }

  // Build ICO from the 256x256 PNG (Windows uses it for scaling)
  // For best compatibility, include all sizes in the ICO
  console.log("  Building multi-resolution ICO...");
  const icoBuf = createICO(pngBuffers);
  fs.writeFileSync(path.join(OUTPUT_DIR, "icon.ico"), icoBuf);

  console.log(`Done! Created:`);
  console.log(`  public/icon.ico (${SIZES.length} sizes: ${SIZES.join(", ")})`);
  console.log(`  public/icon.png (256x256)`);
}

main().catch((err) => {
  console.error("Icon generation failed:", err);
  process.exit(1);
});
