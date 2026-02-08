// src/utils/crc32.ts
export function calculateCRC32(data: Uint8Array): number {
  let crc = 0xffffffff;
  const table = new Uint32Array(256);

  // Generate CRC table
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c;
  }

  // Calculate CRC
  for (let byte of data) {
    crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }

  return crc ^ 0xffffffff;
}

export function validateCRC32(data: Uint8Array, expectedCRC: number): boolean {
  return calculateCRC32(data) === expectedCRC;
}

export function crc32ToString(crc: number): string {
  return (crc >>> 0).toString(16).padStart(8, "0").toUpperCase();
}
