// DCTSteganography.ts
export class DCTSteganography {
  private static readonly BLOCK_SIZE = 8;
  private static readonly SYNC_MARKER = 0xaa55; // 16-bit sync pattern
  private static readonly COEFF_RANGE = [5, 20]; // Mid-frequency coefficients
  private static readonly MIN_COEFF_VALUE = 2;

  static embedData(
    frame: ImageData,
    data: Uint8Array,
    fragmentIndex: number,
  ): ImageData {
    const width = frame.width;
    const height = frame.height;
    const luminance = this.extractLuminance(frame);
    const blocks = this.splitIntoBlocks(luminance, width, height);

    let dataBits = this.prepareDataBits(data, fragmentIndex);
    let bitIndex = 0;

    for (let block of blocks) {
      const dctBlock = this.forwardDCT(block);

      for (
        let coeffIdx = this.COEFF_RANGE[0];
        coeffIdx <= this.COEFF_RANGE[1];
        coeffIdx++
      ) {
        if (bitIndex >= dataBits.length) break;

        const coeff = dctBlock[coeffIdx];
        if (Math.abs(coeff) < this.MIN_COEFF_VALUE) continue;

        const bit = dataBits[bitIndex];
        const modifiedCoeff = this.setLSB(coeff, bit);
        dctBlock[coeffIdx] = modifiedCoeff;
        bitIndex++;
      }

      const modifiedBlock = this.inverseDCT(dctBlock);
      for (let i = 0; i < 64; i++) {
        block[i] = modifiedBlock[i];
      }
    }

    return this.reconstructFrame(luminance, width, height);
  }

  static extractData(frame: ImageData): {
    data: Uint8Array | null;
    fragmentIndex: number;
  } {
    const width = frame.width;
    const height = frame.height;
    const luminance = this.extractLuminance(frame);
    const blocks = this.splitIntoBlocks(luminance, width, height);

    const extractedBits: number[] = [];

    for (let block of blocks) {
      const dctBlock = this.forwardDCT(block);

      for (
        let coeffIdx = this.COEFF_RANGE[0];
        coeffIdx <= this.COEFF_RANGE[1];
        coeffIdx++
      ) {
        const coeff = dctBlock[coeffIdx];
        if (Math.abs(coeff) < this.MIN_COEFF_VALUE) continue;

        const bit = this.getLSB(coeff);
        extractedBits.push(bit);
      }
    }

    return this.decodeBits(extractedBits);
  }

  private static extractLuminance(frame: ImageData): number[] {
    const luminance: number[] = [];
    for (let i = 0; i < frame.data.length; i += 4) {
      const r = frame.data[i];
      const g = frame.data[i + 1];
      const b = frame.data[i + 2];
      const y = 0.299 * r + 0.587 * g + 0.114 * b;
      luminance.push(y);
    }
    return luminance;
  }

  private static splitIntoBlocks(
    luminance: number[],
    width: number,
    height: number,
  ): number[][] {
    const blocks: number[][] = [];
    const blocksX = Math.floor(width / this.BLOCK_SIZE);
    const blocksY = Math.floor(height / this.BLOCK_SIZE);

    for (let by = 0; by < blocksY; by++) {
      for (let bx = 0; bx < blocksX; bx++) {
        const block: number[] = [];
        for (let y = 0; y < this.BLOCK_SIZE; y++) {
          for (let x = 0; x < this.BLOCK_SIZE; x++) {
            const px = bx * this.BLOCK_SIZE + x;
            const py = by * this.BLOCK_SIZE + y;
            const index = py * width + px;
            block.push(luminance[index]);
          }
        }
        blocks.push(block);
      }
    }
    return blocks;
  }

  private static forwardDCT(block: number[]): number[] {
    const dctBlock: number[] = new Array(64).fill(0);
    const alpha = (u: number, v: number) => {
      return (
        (u === 0 ? 1 / Math.sqrt(2) : 1) * (v === 0 ? 1 / Math.sqrt(2) : 1)
      );
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

  private static inverseDCT(dctBlock: number[]): number[] {
    const block: number[] = new Array(64).fill(0);
    const alpha = (u: number, v: number) => {
      return (
        (u === 0 ? 1 / Math.sqrt(2) : 1) * (v === 0 ? 1 / Math.sqrt(2) : 1)
      );
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

  private static setLSB(value: number, bit: number): number {
    const intValue = Math.round(value);
    return (intValue & ~1) | bit;
  }

  private static getLSB(value: number): number {
    return Math.round(value) & 1;
  }

  private static prepareDataBits(
    data: Uint8Array,
    fragmentIndex: number,
  ): number[] {
    const bits: number[] = [];

    for (let i = 0; i < 16; i++) {
      bits.push((this.SYNC_MARKER >> (15 - i)) & 1);
    }

    for (let i = 0; i < 8; i++) {
      bits.push((fragmentIndex >> (7 - i)) & 1);
    }

    for (let byte of data) {
      for (let i = 0; i < 8; i++) {
        bits.push((byte >> (7 - i)) & 1);
      }
    }

    return bits;
  }

  private static decodeBits(bits: number[]): {
    data: Uint8Array | null;
    fragmentIndex: number;
  } {
    if (bits.length < 24) return { data: null, fragmentIndex: -1 };

    const syncBits = bits.slice(0, 16);
    let syncMarker = 0;
    for (let i = 0; i < 16; i++) {
      syncMarker = (syncMarker << 1) | syncBits[i];
    }

    if (syncMarker !== this.SYNC_MARKER) {
      return { data: null, fragmentIndex: -1 };
    }

    const indexBits = bits.slice(16, 24);
    let fragmentIndex = 0;
    for (let i = 0; i < 8; i++) {
      fragmentIndex = (fragmentIndex << 1) | indexBits[i];
    }

    const dataBits = bits.slice(24);
    if (dataBits.length % 8 !== 0) {
      return { data: null, fragmentIndex: -1 };
    }

    const dataBytes = new Uint8Array(dataBits.length / 8);
    for (let i = 0; i < dataBytes.length; i++) {
      let byte = 0;
      for (let j = 0; j < 8; j++) {
        byte = (byte << 1) | dataBits[i * 8 + j];
      }
      dataBytes[i] = byte;
    }

    return { data: dataBytes, fragmentIndex };
  }

  private static reconstructFrame(
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
}
