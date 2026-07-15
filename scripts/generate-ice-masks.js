// 由短道鞋選色單線稿產生 ice-A/B/C luminance mask（2048x1448）
// 作法（先遮罩、後描邊，全程在 2048 目標解析度處理讓邊界平滑）：
//   1. 遮罩：門檻分割 + 各分區種子點 flood fill，只取「確定屬於該區」的亮/灰色像素
//   2. 描邊：輪廓線像素用多源 BFS（watershed）分給最近的分區，深度上限 CLAIM_DEPTH，
//      每區剛好描到與鄰區共用線條的中線。亮度分級：中亮像素（CLAIM_LUMA_GRAY..CLAIM_LUMA_WHITE，
//      「被線條擠壓的白色」如兩塊 B 料之間的細縫）只有白色鞋身 A 能描，
//      B/C 只能描真正的線條像素（< CLAIM_LUMA_GRAY），避免灰色料件把白縫吃掉
//   3. 補內部封閉孔（字母、圖樣 counter），輸出前加 0.8px 高斯柔邊抗鋸齒
const sharp = require("sharp");

const ROOT = `${__dirname}/..`;
const SRC = `${ROOT}/images/短道鞋參考圖片/短道鞋選色單.jpg`;
const OUT_DIR = `${ROOT}/images/generated-masks`;
const SHEET_W = 2048;
const SHEET_H = 1448;

// 描邊參數（2048 解析度）：A 可描 < CLAIM_LUMA_WHITE 的像素，B/C 只可描 < CLAIM_LUMA_GRAY；
// BFS 最多走 CLAIM_DEPTH 步。線條寬約 6-10px，深度 8 足以讓兩側分區在中線會合，
// 又不會深入大片深色固定區
const CLAIM_LUMA_WHITE = 215;
const CLAIM_LUMA_GRAY = 170;
const CLAIM_DEPTH = 8;

// 種子點與手動補塊用原圖 1080x764 座標標註，程式內換算到 2048
const ZONES = {
  A: {
    // 白色鞋身：只走亮像素（黑線周圍的 JPEG ringing 缺口交給描邊階段收拾）
    passable: (v) => v > 210,
    snapMin: 210,
    seeds: [
      [190, 393], // 鞋口左側白色窄帶
      [240, 470], // LOGO 帶與繡名帶之間的 A 區
      [280, 585], // 下方 A 區主鞋身
      [330, 556], // 繡名帶與火焰面板之間
    ],
    // 下方「A」字母的三角形 counter：字母筆畫連到鞋底輪廓，
    // fillHoles 視為對外相通補不到，手動補一顆圓蓋掉
    extraFills: [{ cx: 322, cy: 590, r: 9 }],
  },
  B: {
    // 灰色料件：限制在灰色帶，避免經 anti-alias 縫隙漏進白色區/背景
    passable: (v) => v > 120 && v < 218,
    snapMin: 120,
    seeds: [
      [370, 425], // LOGO 帶（避開文字）
      [147, 470], // 後跟小片
      [270, 535], // 繡名帶左下
      [345, 508], // 繡名帶右上
    ],
  },
  C: {
    passable: (v) => v > 120 && v < 218,
    snapMin: 120,
    seeds: [
      [390, 570], // 火焰面板左側灰底
      [540, 650], // 鞋頭前端灰底
    ],
  },
};

(async () => {
  // 先放大到 SHEET 尺寸再分割：邊界輪廓經 lanczos 內插後平滑，做出來的 mask 不再有低解析度鋸齒
  const { data, info } = await sharp(SRC)
    .resize(SHEET_W, SHEET_H, { fit: "fill", kernel: "lanczos3" })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const W = info.width;
  const H = info.height;
  const N = W * H;
  const SCALE_X = SHEET_W / 1080;
  const SCALE_Y = SHEET_H / 764;
  const scalePoint = ([x, y]) => [Math.round(x * SCALE_X), Math.round(y * SCALE_Y)];

  const neighborsOf = (idx) => {
    const x = idx % W;
    const y = (idx / W) | 0;
    const out = [];
    if (x > 0) out.push(idx - 1);
    if (x < W - 1) out.push(idx + 1);
    if (y > 0) out.push(idx - W);
    if (y < H - 1) out.push(idx + W);
    return out;
  };

  // 種子吸附到半徑 12 內最亮像素，避免落在文字/線條上
  function snapSeed(seed, snapMin) {
    const [sx, sy] = scalePoint(seed);
    let best = null;
    let bestV = -1;
    for (let y = Math.max(0, sy - 12); y <= Math.min(H - 1, sy + 12); y++) {
      for (let x = Math.max(0, sx - 12); x <= Math.min(W - 1, sx + 12); x++) {
        const v = data[y * W + x];
        if (v > bestV) {
          bestV = v;
          best = [x, y];
        }
      }
    }
    if (bestV <= snapMin) {
      throw new Error(`種子點 (${sx},${sy}) 附近找不到亮於 ${snapMin} 的像素 (max=${bestV})`);
    }
    return best;
  }

  function floodFill(seeds, passable, snapMin) {
    const mask = new Uint8Array(N);
    const queue = [];
    for (const seed of seeds) {
      const [sx, sy] = snapSeed(seed, snapMin);
      const idx = sy * W + sx;
      if (!mask[idx]) {
        mask[idx] = 1;
        queue.push(idx);
      }
    }
    let head = 0;
    while (head < queue.length) {
      const idx = queue[head++];
      for (const n of neighborsOf(idx)) {
        if (!mask[n] && passable(data[n])) {
          mask[n] = 1;
          queue.push(n);
        }
      }
    }
    return mask;
  }

  function fillHoles(mask) {
    // 從影像邊界 flood 非 mask 區；到不了的非 mask 像素就是封閉孔
    const outside = new Uint8Array(N);
    const queue = [];
    const push = (idx) => {
      if (!outside[idx] && !mask[idx]) {
        outside[idx] = 1;
        queue.push(idx);
      }
    };
    for (let x = 0; x < W; x++) {
      push(x);
      push((H - 1) * W + x);
    }
    for (let y = 0; y < H; y++) {
      push(y * W);
      push(y * W + W - 1);
    }
    let head = 0;
    while (head < queue.length) {
      for (const n of neighborsOf(queue[head++])) push(n);
    }
    let filled = 0;
    for (let i = 0; i < N; i++) {
      if (!mask[i] && !outside[i]) {
        mask[i] = 1;
        filled++;
      }
    }
    return filled;
  }

  function stampCircle(mask, circle) {
    const [cx, cy] = scalePoint([circle.cx, circle.cy]);
    const r = Math.round(circle.r * SCALE_X);
    for (let y = Math.max(0, cy - r); y <= Math.min(H - 1, cy + r); y++) {
      for (let x = Math.max(0, cx - r); x <= Math.min(W - 1, cx + r); x++) {
        if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) {
          mask[y * W + x] = 1;
        }
      }
    }
  }

  // 描邊：多源 BFS，把輪廓線像素分給「距離最近的可描分區」（watershed 中線分割）。
  // A（白色鞋身）可描到 CLAIM_LUMA_WHITE，B/C 只能描 < CLAIM_LUMA_GRAY 的真正線條像素
  function claimOutlines(fills) {
    const zoneKeys = Object.keys(fills);
    const claimMax = zoneKeys.map((key) => (key === "A" ? CLAIM_LUMA_WHITE : CLAIM_LUMA_GRAY));
    const anyFill = new Uint8Array(N);
    for (const key of zoneKeys) {
      const fill = fills[key];
      for (let i = 0; i < N; i++) if (fill[i]) anyFill[i] = 1;
    }
    const owner = new Int8Array(N).fill(-1);
    let queue = [];
    for (let z = 0; z < zoneKeys.length; z++) {
      const fill = fills[zoneKeys[z]];
      for (let i = 0; i < N; i++) {
        if (!fill[i]) continue;
        for (const n of neighborsOf(i)) {
          if (!anyFill[n] && owner[n] === -1 && data[n] < claimMax[z]) {
            owner[n] = z;
            queue.push(n);
          }
        }
      }
    }
    for (let depth = 1; depth < CLAIM_DEPTH && queue.length; depth++) {
      const next = [];
      for (const idx of queue) {
        const z = owner[idx];
        for (const n of neighborsOf(idx)) {
          if (owner[n] === -1 && !anyFill[n] && data[n] < claimMax[z]) {
            owner[n] = z;
            next.push(n);
          }
        }
      }
      queue = next;
    }
    for (let i = 0; i < N; i++) {
      if (owner[i] >= 0) fills[zoneKeys[owner[i]]][i] = 1;
    }
  }

  // 階段 1：全部分區先 flood fill
  const fills = {};
  for (const [zone, { passable, snapMin, seeds }] of Object.entries(ZONES)) {
    const mask = floodFill(seeds, passable, snapMin);
    const area = mask.reduce((sum, v) => sum + v, 0);
    // 防外漏：區域碰到影像外框 = 輪廓有缺口
    let touchesBorder = false;
    for (let x = 0; x < W && !touchesBorder; x++) {
      if (mask[x] || mask[(H - 1) * W + x]) touchesBorder = true;
    }
    for (let y = 0; y < H && !touchesBorder; y++) {
      if (mask[y * W] || mask[y * W + W - 1]) touchesBorder = true;
    }
    if (touchesBorder || area > N * 0.4) {
      throw new Error(`${zone} 區 flood fill 外漏（area=${area}, border=${touchesBorder}）`);
    }
    fills[zone] = mask;
  }

  // 階段 2：描邊（watershed 分輪廓線）
  claimOutlines(fills);

  // 階段 3：補孔、手動補塊、輸出
  for (const [zone, { extraFills = [] }] of Object.entries(ZONES)) {
    const mask = fills[zone];
    const holes = fillHoles(mask);
    extraFills.forEach((circle) => stampCircle(mask, circle));

    const area = mask.reduce((sum, v) => sum + v, 0);
    console.log(`${zone}: area=${area} (${((area / N) * 100).toFixed(1)}%), holes filled=${holes}`);

    const buf = Buffer.alloc(N);
    for (let i = 0; i < N; i++) buf[i] = mask[i] ? 255 : 0;
    await sharp(buf, { raw: { width: W, height: H, channels: 1 } })
      .blur(0.8)
      .png({ compressionLevel: 9 })
      .toFile(`${OUT_DIR}/ice-${zone}.png`);
  }
  console.log("done");
})();
