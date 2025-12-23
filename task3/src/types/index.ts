export interface Frame {
  data: ImageData;
  timestamp: number;
  processingTime: number;
}

export interface Metrics {
  totalFrames: number;
  droppedFrames: number;
  fps: number;
  processTime: number;
  bufferSize: string;
}

export type EffectType = 'none' | 'grayscale' | 'invert' | 'edge' | 'sepia';

export interface CircularBufferInterface<T> {
  capacity: number;
  size: number;
  enqueue(item: T): void;
  dequeue(): T | null;
  peek(): T | null;
  clear(): void;
}