import type { CircularBufferInterface } from '../types';

export class CircularBuffer<T> implements CircularBufferInterface<T> {
  private buffer: (T | null)[];
  private head: number = 0;
  private tail: number = 0;
  private _size: number = 0;

  public capacity: number;
  constructor(capacity : number) {
    this.capacity = capacity;
    this.buffer = new Array<T | null>(capacity);
  }

  get size(): number {
    return this._size;
  }

  enqueue(item: T): void {
    this.buffer[this.head] = item;
    this.head = (this.head + 1) % this.capacity;

    if (this._size === this.capacity) {
      this.tail = (this.tail + 1) % this.capacity;
    } else {
      this._size++;
    }
  }

  dequeue(): T | null {
    if (this._size === 0) return null;

    const item = this.buffer[this.tail];
    this.buffer[this.tail] = null;
    this.tail = (this.tail + 1) % this.capacity;
    this._size--;

    return item;
  }

  peek(): T | null {
    if (this._size === 0) return null;
    return this.buffer[this.tail];
  }

  clear(): void {
    this.head = 0;
    this.tail = 0;
    this._size = 0;
    this.buffer.fill(null);
  }
}