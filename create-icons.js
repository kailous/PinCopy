// 纯 Node.js PNG 图标生成器（无外部依赖）
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

// CRC32 查找表
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c;
  }
  return table;
})();

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buf[i]) & 0xFF];
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function makeChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.allocUnsafe(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcInput = Buffer.concat([typeBytes, data]);
  const crcBuf = Buffer.allocUnsafe(4);
  crcBuf.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([lenBuf, typeBytes, data, crcBuf]);
}

function makePNG(size, pixelFn) {
  // IHDR
  const ihdr = Buffer.allocUnsafe(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // RGBA color type
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  // 像素数据（每行: 1字节滤波器 + size*4字节RGBA）
  const rowBytes = 1 + size * 4;
  const raw = Buffer.allocUnsafe(size * rowBytes);

  for (let y = 0; y < size; y++) {
    raw[y * rowBytes] = 0; // 无滤波器
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixelFn(x, y, size);
      const offset = y * rowBytes + 1 + x * 4;
      raw[offset]     = r;
      raw[offset + 1] = g;
      raw[offset + 2] = b;
      raw[offset + 3] = a;
    }
  }

  const compressed = zlib.deflateSync(raw, { level: 9 });

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), // PNG 签名
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', compressed),
    makeChunk('IEND', Buffer.alloc(0))
  ]);
}

// ─── 图标绘制函数 ────────────────────────────────────────────────────

// 绘制带有"+"符号的红色圆形图标
function drawPinCopyIcon(x, y, size) {
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 0.5;

  // 抗锯齿距离
  const dx = x - cx + 0.5;
  const dy = y - cy + 0.5;
  const dist = Math.sqrt(dx * dx + dy * dy);

  // 圆形外透明
  if (dist > r + 0.5) return [0, 0, 0, 0];

  // 圆形边缘抗锯齿 alpha
  const circleAlpha = dist > r - 0.5
    ? Math.round((r + 0.5 - dist) * 255)
    : 255;

  // "+" 十字 - 宽度和长度随尺寸缩放
  const crossW = Math.max(1.2, size * 0.095);
  const crossL = size * 0.28;

  const inH = Math.abs(dy) <= crossW && Math.abs(dx) <= crossL;
  const inV = Math.abs(dx) <= crossW && Math.abs(dy) <= crossL;

  if (inH || inV) {
    // 白色十字
    return [255, 255, 255, circleAlpha];
  }

  // Pinterest 红色背景 #E60023
  return [230, 0, 35, circleAlpha];
}

// ─── 生成图标文件 ────────────────────────────────────────────────────

const iconsDir = path.join(__dirname, 'icons');
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir);
}

const sizes = [16, 32, 48, 128];
sizes.forEach(size => {
  const png = makePNG(size, drawPinCopyIcon);
  const outPath = path.join(iconsDir, `icon${size}.png`);
  fs.writeFileSync(outPath, png);
  console.log(`✓ 生成 icons/icon${size}.png (${png.length} bytes)`);
});

console.log('\n图标生成完成！');
