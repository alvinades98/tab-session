const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// Ensure directory exists
const iconsDir = path.join(__dirname);
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

// Function to generate a simple RGBA PNG from pixel buffer
function createPNG(width, height, getPixel) {
  // Build uncompressed raw image data with filter type byte (0 = None) at start of each row
  const rowBytes = width * 4;
  const rawData = Buffer.alloc(height * (rowBytes + 1));

  let offset = 0;
  for (let y = 0; y < height; y++) {
    rawData[offset++] = 0; // Filter byte: None
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = getPixel(x, y, width, height);
      rawData[offset++] = r;
      rawData[offset++] = g;
      rawData[offset++] = b;
      rawData[offset++] = a;
    }
  }

  const deflated = zlib.deflateSync(rawData);

  // PNG Signature
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR chunk
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8); // bit depth 8
  ihdr.writeUInt8(6, 9); // color type 6 (RGBA)
  ihdr.writeUInt8(0, 10); // compression 0
  ihdr.writeUInt8(0, 11); // filter 0
  ihdr.writeUInt8(0, 12); // interlace 0

  const ihdrChunk = makeChunk('IHDR', ihdr);
  const idatChunk = makeChunk('IDAT', deflated);
  const iendChunk = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

// CRC32 implementation for PNG chunks
function makeChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);

  const typeBuf = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuf, data]);

  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);

  return Buffer.concat([length, body, crc]);
}

const crcTable = [];
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    if (c & 1) c = 0xedb88320 ^ (c >>> 1);
    else c = c >>> 1;
  }
  crcTable[n] = c;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

// Draw MultiSession layered cards / tabs icon
function getPixel(x, y, w, h) {
  const cx = w / 2;
  const cy = h / 2;
  const r = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
  const maxR = w * 0.46;

  // Background rounded squircle
  const corner = w * 0.22;
  const inSquircle = (
    x >= corner && x <= w - corner ||
    y >= corner && y <= h - corner ||
    Math.sqrt((x - corner)**2 + (y - corner)**2) <= corner ||
    Math.sqrt((x - (w - corner))**2 + (y - corner)**2) <= corner ||
    Math.sqrt((x - corner)**2 + (y - (h - corner))**2) <= corner ||
    Math.sqrt((x - (w - corner))**2 + (y - (h - corner))**2) <= corner
  );

  if (!inSquircle) {
    return [0, 0, 0, 0];
  }

  // Gradient background: Indigo to Cyan
  const t = (x + y) / (w + h);
  let red = Math.round(99 * (1 - t) + 14 * t);
  let green = Math.round(102 * (1 - t) + 165 * t);
  let blue = Math.round(241 * (1 - t) + 233 * t);

  // Draw 2 overlapping session boxes
  const card1 = x >= w * 0.2 && x <= w * 0.65 && y >= h * 0.25 && y <= h * 0.75;
  const card2 = x >= w * 0.45 && x <= w * 0.82 && y >= h * 0.35 && y <= h * 0.85;

  if (card2) {
    return [236, 72, 153, 240]; // Pink highlight card
  }
  if (card1) {
    return [255, 255, 255, 230]; // White front card
  }

  return [red, green, blue, 255];
}

[16, 32, 48, 128].forEach(size => {
  const png = createPNG(size, size, getPixel);
  fs.writeFileSync(path.join(iconsDir, `icon${size}.png`), png);
  console.log(`Generated icon${size}.png (${size}x${size})`);
});
