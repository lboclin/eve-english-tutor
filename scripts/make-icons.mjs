// Draws Eve's app icons (the EveMark from components/Orb.tsx on a sky background) as PNGs in web/public, with
// no image library: shapes are rasterized at 4× and averaged down. Run once after changing the design:
//   node scripts/make-icons.mjs
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { deflateSync } from "node:zlib";

const OUT = resolve(import.meta.dirname, "../web/public");
const SKY = [188, 217, 245], WHITE = [255, 255, 255], VISOR = [44, 48, 73], EYE = [143, 212, 255];

// Shapes in a 40×40 design space (same numbers as EveMark), scaled to fit the icon with padding.
function color(x, y) {
  const inEllipse = (cx, cy, rx, ry) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
  const inRoundRect = (rx, ry, w, h, r) => {
    const qx = Math.max(Math.abs(x - (rx + w / 2)) - (w / 2 - r), 0), qy = Math.max(Math.abs(y - (ry + h / 2)) - (h / 2 - r), 0);
    return qx * qx + qy * qy <= r * r;
  };
  if (inEllipse(15.5, 20.5, 3, 3) || inEllipse(24.5, 20.5, 3, 3)) return EYE;
  if (inRoundRect(9, 14, 22, 13, 6.5)) return VISOR;
  if (inEllipse(20, 21, 16, 17)) return WHITE;
  return SKY;
}

function png(size, scale) {
  const S = 4, rows = [];
  const unit = (size * scale) / 40, offset = (size - 40 * unit) / 2;
  for (let py = 0; py < size; py++) {
    const row = Buffer.alloc(1 + size * 3); // filter byte 0, then RGB
    for (let px = 0; px < size; px++) {
      const acc = [0, 0, 0];
      for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
        const c = color((px + (sx + 0.5) / S - offset) / unit, (py + (sy + 0.5) / S - offset) / unit);
        for (let k = 0; k < 3; k++) acc[k] += c[k];
      }
      for (let k = 0; k < 3; k++) row[1 + px * 3 + k] = Math.round(acc[k] / (S * S));
    }
    rows.push(row);
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4), sum = Buffer.alloc(4), body = Buffer.concat([Buffer.from(type), data]);
    len.writeUInt32BE(data.length);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// The mark fills 85% of the square: its face (32×34 of 40) stays inside the maskable safe circle (80%).
for (const [name, size] of [["apple-touch-icon.png", 180], ["icon-192.png", 192], ["icon-512.png", 512]]) {
  writeFileSync(resolve(OUT, name), png(size, 0.85));
  console.log(`wrote web/public/${name}`);
}
