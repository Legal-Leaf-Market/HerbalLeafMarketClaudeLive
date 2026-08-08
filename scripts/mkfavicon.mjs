import sharp from 'sharp';
import { writeFileSync } from 'fs';

// Lily of the valley: central stem, two broad leaves, 3 alternating hanging bells
// Bells use ellipse elements — reliable rendering at all sizes
const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 60 72' width='512' height='512'>
  <rect width='60' height='72' fill='#0b120d' rx='11'/>

  <!-- Broad leaves sweeping from base -->
  <path d='M30 64 C17 57 7 41 11 25 C16 36 24 51 30 57 Z' fill='#22c55e' opacity='0.8'/>
  <path d='M30 60 C43 53 53 37 49 21 C44 32 36 47 30 53 Z' fill='#16a34a' opacity='0.7'/>

  <!-- Central stem -->
  <path d='M30 65 L30 13' stroke='#4ade80' stroke-width='2.4' stroke-linecap='round'/>

  <!-- Stalks branching alternately left/right -->
  <line x1='30' y1='17' x2='41' y2='17' stroke='#4ade80' stroke-width='1.2' stroke-linecap='round'/>
  <line x1='30' y1='29' x2='19' y2='29' stroke='#4ade80' stroke-width='1.2' stroke-linecap='round'/>
  <line x1='30' y1='41' x2='41' y2='41' stroke='#4ade80' stroke-width='1.2' stroke-linecap='round'/>

  <!-- Bell 1 right: ellipse hangs below stalk tip -->
  <ellipse cx='41' cy='23' rx='4.2' ry='6' fill='#eaf3ec' stroke='#4ade80' stroke-width='1.1'/>
  <path d='M37.8 28 Q39.5 31 41 29 Q42.5 31 44.2 28' fill='none' stroke='#4ade80' stroke-width='1' stroke-linecap='round'/>

  <!-- Bell 2 left -->
  <ellipse cx='19' cy='35' rx='4.2' ry='6' fill='#eaf3ec' stroke='#4ade80' stroke-width='1.1'/>
  <path d='M15.8 40 Q17.5 43 19 41 Q20.5 43 22.2 40' fill='none' stroke='#4ade80' stroke-width='1' stroke-linecap='round'/>

  <!-- Bell 3 right lower -->
  <ellipse cx='41' cy='47' rx='4.2' ry='6' fill='#eaf3ec' stroke='#4ade80' stroke-width='1.1'/>
  <path d='M37.8 52 Q39.5 55 41 53 Q42.5 55 44.2 52' fill='none' stroke='#4ade80' stroke-width='1' stroke-linecap='round'/>
</svg>`;

const buf = Buffer.from(svg);
await sharp(buf).resize(32,32).png().toFile('public/favicon-32x32.png');
await sharp(buf).resize(16,16).png().toFile('public/favicon-16x16.png');
await sharp(buf).resize(180,180).png().toFile('public/apple-touch-icon.png');
await sharp(buf).resize(192,192).png().toFile('public/icon-192.png');
await sharp(buf).resize(512,512).png().toFile('public/icon-512.png');

const b32 = await sharp(buf).resize(32,32).png().toBuffer();
const b16 = await sharp(buf).resize(16,16).png().toBuffer();
const count = 2, hSz = 6 + count * 16, header = Buffer.alloc(hSz);
header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(count, 4);
let offset = hSz;
[[b32, 32], [b16, 16]].forEach(([img, sz], i) => {
  const e = 6 + i * 16;
  header.writeUInt8(sz, e); header.writeUInt8(sz, e + 1);
  header.writeUInt8(0, e + 2); header.writeUInt8(0, e + 3);
  header.writeUInt16LE(1, e + 4); header.writeUInt16LE(32, e + 6);
  header.writeUInt32LE(img.length, e + 8); header.writeUInt32LE(offset, e + 12);
  offset += img.length;
});
writeFileSync('public/favicon.ico', Buffer.concat([header, b32, b16]));
console.log('All favicon files written successfully');
