const N = 8;
const cosTable = Array.from({ length: N }, () => new Float64Array(N));
const alpha = new Float64Array(N);

for (let u = 0; u < N; u += 1) {
  alpha[u] = u === 0 ? Math.sqrt(1 / N) : Math.sqrt(2 / N);
  for (let x = 0; x < N; x += 1) {
    cosTable[u][x] = Math.cos(((2 * x + 1) * u * Math.PI) / (2 * N));
  }
}

function clamp(value) { return Math.max(0, Math.min(255, value)); }

export function readBlockLuma(frameData, width, blockIndex) {
  const blocksPerRow = Math.floor(width / N);
  const x0 = (blockIndex % blocksPerRow) * N;
  const y0 = Math.floor(blockIndex / blocksPerRow) * N;
  const out = Array.from({ length: N }, () => new Float64Array(N));
  for (let y = 0; y < N; y += 1) {
    for (let x = 0; x < N; x += 1) {
      const index = ((y0 + y) * width + (x0 + x)) * 4;
      const r = frameData[index];
      const g = frameData[index + 1];
      const b = frameData[index + 2];
      out[y][x] = 0.299 * r + 0.587 * g + 0.114 * b - 128;
    }
  }
  return out;
}

export function writeBlockLuma(frameData, width, blockIndex, block) {
  const blocksPerRow = Math.floor(width / N);
  const x0 = (blockIndex % blocksPerRow) * N;
  const y0 = Math.floor(blockIndex / blocksPerRow) * N;
  for (let y = 0; y < N; y += 1) {
    for (let x = 0; x < N; x += 1) {
      const index = ((y0 + y) * width + (x0 + x)) * 4;
      const luma = clamp(block[y][x] + 128);
      const currentLuma = 0.299 * frameData[index] + 0.587 * frameData[index + 1] + 0.114 * frameData[index + 2];
      const diff = luma - currentLuma;
      frameData[index] = clamp(frameData[index] + diff);
      frameData[index + 1] = clamp(frameData[index + 1] + diff);
      frameData[index + 2] = clamp(frameData[index + 2] + diff);
    }
  }
}

export function dct2d(block) {
  const coeffs = Array.from({ length: N }, () => new Float64Array(N));
  for (let u = 0; u < N; u += 1) {
    for (let v = 0; v < N; v += 1) {
      let sum = 0;
      for (let x = 0; x < N; x += 1) {
        for (let y = 0; y < N; y += 1) {
          sum += block[y][x] * cosTable[u][x] * cosTable[v][y];
        }
      }
      coeffs[v][u] = alpha[u] * alpha[v] * sum;
    }
  }
  return coeffs;
}

export function idct2d(coeffs) {
  const block = Array.from({ length: N }, () => new Float64Array(N));
  for (let x = 0; x < N; x += 1) {
    for (let y = 0; y < N; y += 1) {
      let sum = 0;
      for (let u = 0; u < N; u += 1) {
        for (let v = 0; v < N; v += 1) {
          sum += alpha[u] * alpha[v] * coeffs[v][u] * cosTable[u][x] * cosTable[v][y];
        }
      }
      block[y][x] = sum;
    }
  }
  return block;
}
