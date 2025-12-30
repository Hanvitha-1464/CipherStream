function transpose(matrix) {
  return matrix[0].map((_, col) => matrix.map((row) => row[col]));
}

function dct1D(signal) {
  const N = signal.length;
  const result = new Array(N).fill(0);
  for (let k = 0; k < N; k++) {
    let sum = 0;
    for (let n = 0; n < N; n++) {
      sum += signal[n] * Math.cos((Math.PI / N) * (n + 0.5) * k);
    }
    const alpha = k === 0 ? Math.sqrt(1 / N) : Math.sqrt(2 / N);
    result[k] = alpha * sum;
  }
  return result;
}

function idct1D(coeffs) {
  const N = coeffs.length;
  const result = new Array(N).fill(0);
  for (let n = 0; n < N; n++) {
    let sum = 0;
    for (let k = 0; k < N; k++) {
      const alpha = k === 0 ? Math.sqrt(1 / N) : Math.sqrt(2 / N);
      sum += alpha * coeffs[k] * Math.cos((Math.PI / N) * (n + 0.5) * k);
    }
    result[n] = sum;
  }
  return result;
}

function dct2D(block) {
  const N = 8;
  // DCT on rows
  let temp = block.map((row) => dct1D(row));
  // DCT on columns
  temp = transpose(temp);
  temp = temp.map((row) => dct1D(row));
  return transpose(temp);
}

function idct2D(coeffs) {
  const N = 8;
  let temp = coeffs.map((row) => idct1D(row));
  temp = transpose(temp);
  temp = temp.map((row) => idct1D(row));
  return transpose(temp);
}

const block = [
  [52, 55, 61, 66, 70, 61, 64, 73],
  [63, 59, 55, 90, 109, 85, 69, 72],
  [62, 59, 100, 113, 144, 104, 66, 73],
  [63, 58, 71, 122, 154, 106, 70, 69],
  [67, 61, 68, 104, 126, 88, 68, 70],
  [79, 65, 60, 70, 77, 68, 58, 75],
  [85, 71, 64, 59, 55, 61, 65, 83],
  [87, 79, 69, 68, 65, 76, 78, 94],
];

const dctBlock = dct2D(block);
const reconstructed = idct2D(dctBlock);

function printMatrix(mat, title) {
  console.log(title);
  mat.forEach((row) =>
    console.log(row.map((v) => v.toFixed(2).padStart(8)).join(" "))
  );
}

printMatrix(block, "Original");
printMatrix(dctBlock, "DCT Coefficients");
printMatrix(reconstructed, "Reconstructed");

function drawBlock(canvasId, block, scale = 20) {
  const canvas = document.getElementById(canvasId);
  const ctx = canvas.getContext("2d");

  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const v = Math.round(block[y][x]);
      ctx.fillStyle = `rgb(${v},${v},${v})`;
      ctx.fillRect(x * scale, y * scale, scale, scale);
    }
  }
}

drawBlock("orig", block);
drawBlock("recon", reconstructed);

function drawDCT(canvasId, dct, scale = 20) {
  const canvas = document.getElementById(canvasId);
  const ctx = canvas.getContext("2d");

  let max = 0;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      max = Math.max(max, Math.abs(dct[y][x]));
    }
  }

  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const v = Math.log(1 + Math.abs(dct[y][x])) / Math.log(1 + max);
      const g = Math.round(v * 255);
      ctx.fillStyle = `rgb(${g},${g},${g})`;
      ctx.fillRect(x * scale, y * scale, scale, scale);
    }
  }
}

drawDCT("dct", dctBlock);
