// src/utils/dctUtils.ts
export function applyDCT(block: number[]): number[] {
  const dctBlock: number[] = new Array(64).fill(0);
  const alpha = (u: number, v: number) => {
    return (u === 0 ? 1 / Math.sqrt(2) : 1) * (v === 0 ? 1 / Math.sqrt(2) : 1);
  };

  for (let u = 0; u < 8; u++) {
    for (let v = 0; v < 8; v++) {
      let sum = 0;
      for (let x = 0; x < 8; x++) {
        for (let y = 0; y < 8; y++) {
          const pix = block[y * 8 + x];
          const cos1 = Math.cos(((2 * x + 1) * u * Math.PI) / 16);
          const cos2 = Math.cos(((2 * y + 1) * v * Math.PI) / 16);
          sum += pix * cos1 * cos2;
        }
      }
      dctBlock[v * 8 + u] = 0.25 * alpha(u, v) * sum;
    }
  }
  return dctBlock;
}

export function applyInverseDCT(dctBlock: number[]): number[] {
  const block: number[] = new Array(64).fill(0);
  const alpha = (u: number, v: number) => {
    return (u === 0 ? 1 / Math.sqrt(2) : 1) * (v === 0 ? 1 / Math.sqrt(2) : 1);
  };

  for (let x = 0; x < 8; x++) {
    for (let y = 0; y < 8; y++) {
      let sum = 0;
      for (let u = 0; u < 8; u++) {
        for (let v = 0; v < 8; v++) {
          const coeff = dctBlock[v * 8 + u];
          const cos1 = Math.cos(((2 * x + 1) * u * Math.PI) / 16);
          const cos2 = Math.cos(((2 * y + 1) * v * Math.PI) / 16);
          sum += alpha(u, v) * coeff * cos1 * cos2;
        }
      }
      block[y * 8 + x] = Math.max(0, Math.min(255, 0.25 * sum));
    }
  }
  return block;
}

export function extractLuminance(imageData: ImageData): number[] {
  const luminance: number[] = [];
  const data = imageData.data;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const y = 0.299 * r + 0.587 * g + 0.114 * b;
    luminance.push(y);
  }

  return luminance;
}

export function reconstructLuminanceFrame(
  luminance: number[],
  width: number,
  height: number,
): ImageData {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  const imageData = ctx.createImageData(width, height);

  for (let i = 0; i < luminance.length; i++) {
    const y = luminance[i];
    const idx = i * 4;
    imageData.data[idx] = y;
    imageData.data[idx + 1] = y;
    imageData.data[idx + 2] = y;
    imageData.data[idx + 3] = 255;
  }

  return imageData;
}

export function splitIntoBlocks(
  luminance: number[],
  width: number,
  height: number,
): number[][] {
  const BLOCK_SIZE = 8;
  const blocks: number[][] = [];
  const blocksX = Math.floor(width / BLOCK_SIZE);
  const blocksY = Math.floor(height / BLOCK_SIZE);

  for (let by = 0; by < blocksY; by++) {
    for (let bx = 0; bx < blocksX; bx++) {
      const block: number[] = [];
      for (let y = 0; y < BLOCK_SIZE; y++) {
        for (let x = 0; x < BLOCK_SIZE; x++) {
          const px = bx * BLOCK_SIZE + x;
          const py = by * BLOCK_SIZE + y;
          const index = py * width + px;
          block.push(luminance[index]);
        }
      }
      blocks.push(block);
    }
  }

  return blocks;
}

export function setLSB(value: number, bit: number): number {
  const intValue = Math.round(value);
  return (intValue & ~1) | bit;
}

export function getLSB(value: number): number {
  return Math.round(value) & 1;
}
