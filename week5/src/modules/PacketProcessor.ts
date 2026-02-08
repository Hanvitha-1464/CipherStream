// src/modules/PacketProcessor.ts

// Replace enum with const object
const PacketType = {
  METADATA: 0x01,
  DATA: 0x02,
  END: 0x03,
  ACK: 0x04,
  NACK: 0x05,
} as const;

type PacketTypeValue =
  | typeof PacketType.METADATA
  | typeof PacketType.DATA
  | typeof PacketType.END
  | typeof PacketType.ACK
  | typeof PacketType.NACK;

interface PacketHeader {
  packetType: PacketTypeValue;
  sequenceNumber: number;
  totalPackets: number;
  payloadLength: number;
  fileId: number;
}

export class PacketProcessor {
  private static readonly HEADER_SIZE = 12;
  private static readonly MAX_PAYLOAD_SIZE = 128;
  private static readonly TOTAL_PACKETS = 10;

  static createMetadataPacket(
    fileData: Uint8Array,
    fileId: number,
  ): Uint8Array {
    const header: PacketHeader = {
      packetType: PacketType.METADATA,
      sequenceNumber: 0,
      totalPackets: this.TOTAL_PACKETS,
      payloadLength: 4,
      fileId: fileId,
    };

    const crc = this.calculateCRC32(fileData);
    const payload = new Uint8Array(4);
    const view = new DataView(payload.buffer);
    view.setUint32(0, crc, true);

    return this.createPacket(header, payload);
  }

  static createDataPacket(
    sequence: number,
    fileId: number,
    payload: Uint8Array,
  ): Uint8Array {
    const header: PacketHeader = {
      packetType: PacketType.DATA,
      sequenceNumber: sequence,
      totalPackets: this.TOTAL_PACKETS,
      payloadLength: payload.length,
      fileId: fileId,
    };

    return this.createPacket(header, payload);
  }

  static createEndPacket(fileId: number): Uint8Array {
    const header: PacketHeader = {
      packetType: PacketType.END,
      sequenceNumber: this.TOTAL_PACKETS - 1,
      totalPackets: this.TOTAL_PACKETS,
      payloadLength: 0,
      fileId: fileId,
    };

    return this.createPacket(header, new Uint8Array(0));
  }

  static createAckPacket(sequence: number, fileId: number): Uint8Array {
    const header: PacketHeader = {
      packetType: PacketType.ACK,
      sequenceNumber: sequence,
      totalPackets: this.TOTAL_PACKETS,
      payloadLength: 0,
      fileId: fileId,
    };

    return this.createPacket(header, new Uint8Array(0));
  }

  static createNackPacket(sequence: number, fileId: number): Uint8Array {
    const header: PacketHeader = {
      packetType: PacketType.NACK,
      sequenceNumber: sequence,
      totalPackets: this.TOTAL_PACKETS,
      payloadLength: 0,
      fileId: fileId,
    };

    return this.createPacket(header, new Uint8Array(0));
  }

  private static createPacket(
    header: PacketHeader,
    payload: Uint8Array,
  ): Uint8Array {
    const packet = new Uint8Array(this.HEADER_SIZE + payload.length + 4);
    const view = new DataView(packet.buffer);

    view.setUint16(0, header.packetType, true);
    view.setUint16(2, header.sequenceNumber, true);
    view.setUint16(4, header.totalPackets, true);
    view.setUint16(6, header.payloadLength, true);
    view.setUint32(8, header.fileId, true);

    packet.set(payload, this.HEADER_SIZE);

    const crc = this.calculateCRC32(
      packet.slice(0, this.HEADER_SIZE + payload.length),
    );
    view.setUint32(this.HEADER_SIZE + payload.length, crc, true);

    return packet;
  }

  static parsePacket(packet: Uint8Array): {
    header: PacketHeader;
    payload: Uint8Array;
    crc: number;
    valid: boolean;
  } {
    if (packet.length < this.HEADER_SIZE + 4) {
      throw new Error("Packet too short");
    }

    const view = new DataView(packet.buffer);
    const packetTypeValue = view.getUint16(0, true);

    // Validate packet type
    const validPacketTypes: number[] = [
      PacketType.METADATA,
      PacketType.DATA,
      PacketType.END,
      PacketType.ACK,
      PacketType.NACK,
    ];

    if (!validPacketTypes.includes(packetTypeValue)) {
      throw new Error(`Invalid packet type: ${packetTypeValue}`);
    }

    const header: PacketHeader = {
      packetType: packetTypeValue as PacketTypeValue,
      sequenceNumber: view.getUint16(2, true),
      totalPackets: view.getUint16(4, true),
      payloadLength: view.getUint16(6, true),
      fileId: view.getUint32(8, true),
    };

    const payload = packet.slice(
      this.HEADER_SIZE,
      this.HEADER_SIZE + header.payloadLength,
    );
    const expectedCrc = view.getUint32(
      this.HEADER_SIZE + header.payloadLength,
      true,
    );
    const actualCrc = this.calculateCRC32(
      packet.slice(0, this.HEADER_SIZE + header.payloadLength),
    );

    return {
      header,
      payload,
      crc: expectedCrc,
      valid: expectedCrc === actualCrc,
    };
  }

  static calculateCRC32(data: Uint8Array): number {
    let crc = 0xffffffff;
    const table = new Uint32Array(256);

    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      table[i] = c;
    }

    for (let byte of data) {
      crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    }

    return crc ^ 0xffffffff;
  }

  static splitFileIntoPackets(
    fileData: Uint8Array,
    fileId: number,
  ): Uint8Array[] {
    if (fileData.length !== 1024) {
      throw new Error("File must be exactly 1024 bytes");
    }

    const packets: Uint8Array[] = [];
    packets.push(this.createMetadataPacket(fileData, fileId));

    for (let i = 0; i < 8; i++) {
      const start = i * 128;
      const end = start + 128;
      const payload = fileData.slice(start, end);
      packets.push(this.createDataPacket(i + 1, fileId, payload));
    }

    packets.push(this.createEndPacket(fileId));
    return packets;
  }
}
