// src/constants/dctConstants.ts
export const DCT_CONSTANTS = {
  BLOCK_SIZE: 8,
  SYNC_MARKER: 0xaa55,
  COEFF_RANGE: [5, 20] as [number, number],
  MIN_COEFF_VALUE: 2,
  FRAME_WIDTH: 320,
  FRAME_HEIGHT: 240,
  FRAME_RATE: 10,
  BITS_PER_BLOCK: 1,
  CAPACITY_PER_FRAME: 60,
} as const;

export const ZIGZAG_ORDER = [
  0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40,
  48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28, 35, 42, 49, 56, 57, 50, 43, 36, 29,
  22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54,
  47, 55, 62, 63,
];

export const DCT_COS_TABLE = (() => {
  const table: number[][][] = Array(8)
    .fill(0)
    .map(() =>
      Array(8)
        .fill(0)
        .map(() => Array(8).fill(0)),
    );

  for (let u = 0; u < 8; u++) {
    for (let x = 0; x < 8; x++) {
      table[u][x][0] = Math.cos(((2 * x + 1) * u * Math.PI) / 16);
    }
  }

  return table;
})();
