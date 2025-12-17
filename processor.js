class VideoFrameProcessor {
  constructor() {
    // Core elements
    this.video = document.getElementById("videoInput");
    this.canvas = document.getElementById("canvasOutput");
    this.ctx = this.canvas.getContext("2d", { willReadFrequently: true });

    // Frame buffer for processing
    this.frameBuffer = new CircularBuffer(3); // Store 3 recent frames
    this.isProcessing = false;
    this.processingInterval = null;

    // Performance tracking
    this.metrics = {
      totalFrames: 0,
      droppedFrames: 0,
      lastFrameTime: 0,
      fps: 0,
      processingTimes: [],
      bufferStats: {
        currentSize: 0,
        maxSize: 0,
      },
    };

    // Video constraints
    this.constraints = {
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30 },
      },
    };

    this.currentEffect = "none";
    this.setupEventListeners();
  }

  // Initialize camera
  async initCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia(
        this.constraints
      );
      this.video.srcObject = stream;

      // Wait for video metadata to load
      await new Promise((resolve) => {
        this.video.onloadedmetadata = () => resolve();
      });

      // Set canvas dimensions to match video
      this.canvas.width = this.video.videoWidth;
      this.canvas.height = this.video.videoHeight;

      console.log("Camera initialized:", {
        width: this.video.videoWidth,
        height: this.video.videoHeight,
      });
    } catch (error) {
      console.error("Error accessing camera:", error);
      alert("Cannot access camera. Please check permissions.");
    }
  }

  // Start frame processing
  startProcessing() {
    if (this.isProcessing) return;

    this.isProcessing = true;
    this.metrics.lastFrameTime = performance.now();

    // Process at ~30 FPS (33ms per frame)
    this.processingInterval = setInterval(() => {
      this.processFrame();
    }, 33); // ~30 FPS

    console.log("Frame processing started at 30 FPS");
  }

  // Stop processing
  stopProcessing() {
    this.isProcessing = false;
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
    }
    console.log("Frame processing stopped");
  }

  // Main frame processing pipeline
  processFrame() {
    const startTime = performance.now();

    // Check if video is ready
    if (this.video.videoWidth === 0 || this.video.videoHeight === 0) return;

    // 1. Capture frame from video
    this.ctx.drawImage(this.video, 0, 0, this.canvas.width, this.canvas.height);

    // 2. Extract pixel data
    const imageData = this.ctx.getImageData(
      0,
      0,
      this.canvas.width,
      this.canvas.height
    );

    // 3. Apply selected effect
    const processedData = this.applyEffect(imageData);

    // 4. Store in frame buffer
    const frame = {
      data: processedData,
      timestamp: Date.now(),
      processingTime: performance.now() - startTime,
    };

    this.frameBuffer.enqueue(frame);
    this.metrics.totalFrames++;

    // 5. Render processed frame
    this.ctx.putImageData(processedData, 0, 0);

    // 6. Update metrics
    this.updateMetrics(startTime);
  }

  // Apply visual effects
  applyEffect(imageData) {
    const data = imageData.data;
    const width = imageData.width;
    const height = imageData.height;

    switch (this.currentEffect) {
      case "grayscale":
        return this.applyGrayscale(data, width, height);
      case "invert":
        return this.applyInvert(data, width, height);
      case "edge":
        return this.applyEdgeDetection(data, width, height);
      case "sepia":
        return this.applySepia(data, width, height);
      default:
        return imageData;
    }
  }

  // Grayscale effect
  applyGrayscale(data, width, height) {
    for (let i = 0; i < data.length; i += 4) {
      const avg = (data[i] + data[i + 1] + data[i + 2]) / 3;
      data[i] = avg; // Red
      data[i + 1] = avg; // Green
      data[i + 2] = avg; // Blue
    }
    return new ImageData(data, width, height);
  }

  // Invert colors
  applyInvert(data, width, height) {
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 255 - data[i]; // Red
      data[i + 1] = 255 - data[i + 1]; // Green
      data[i + 2] = 255 - data[i + 2]; // Blue
    }
    return new ImageData(data, width, height);
  }

  // Simple edge detection
  applyEdgeDetection(data, width, height) {
    const newData = new Uint8ClampedArray(data.length);

    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = (y * width + x) * 4;

        // Get surrounding pixels
        const top = ((y - 1) * width + x) * 4;
        const bottom = ((y + 1) * width + x) * 4;
        const left = (y * width + (x - 1)) * 4;
        const right = (y * width + (x + 1)) * 4;

        // Calculate gradient
        const gradientR =
          Math.abs(data[top] - data[bottom]) +
          Math.abs(data[left] - data[right]);
        const gradientG =
          Math.abs(data[top + 1] - data[bottom + 1]) +
          Math.abs(data[left + 1] - data[right + 1]);
        const gradientB =
          Math.abs(data[top + 2] - data[bottom + 2]) +
          Math.abs(data[left + 2] - data[right + 2]);

        const gradient = Math.min(255, gradientR + gradientG + gradientB);

        newData[idx] = gradient;
        newData[idx + 1] = gradient;
        newData[idx + 2] = gradient;
        newData[idx + 3] = 255;
      }
    }

    return new ImageData(newData, width, height);
  }

  // Sepia effect
  applySepia(data, width, height) {
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];

      data[i] = Math.min(255, r * 0.393 + g * 0.769 + b * 0.189);
      data[i + 1] = Math.min(255, r * 0.349 + g * 0.686 + b * 0.168);
      data[i + 2] = Math.min(255, r * 0.272 + g * 0.534 + b * 0.131);
    }
    return new ImageData(data, width, height);
  }

  // Update performance metrics
  updateMetrics(startTime) {
    const now = performance.now();
    const frameTime = now - this.metrics.lastFrameTime;

    // Calculate FPS
    this.metrics.fps = Math.round(1000 / frameTime);
    this.metrics.lastFrameTime = now;

    // Track processing time
    const processTime = now - startTime;
    this.metrics.processingTimes.push(processTime);
    if (this.metrics.processingTimes.length > 60) {
      this.metrics.processingTimes.shift();
    }

    // Check for dropped frames (processing taking too long)
    if (processTime > 33) {
      // More than 30 FPS interval
      this.metrics.droppedFrames++;
    }

    // Update buffer stats
    this.metrics.bufferStats.currentSize = this.frameBuffer.size();
    this.metrics.bufferStats.maxSize = this.frameBuffer.capacity;

    // Update UI
    this.updateStatsDisplay();
  }

  // Update stats in HTML
  updateStatsDisplay() {
    const avgProcessTime =
      this.metrics.processingTimes.length > 0
        ? this.metrics.processingTimes.reduce((a, b) => a + b) /
          this.metrics.processingTimes.length
        : 0;

    document.getElementById("fpsCounter").textContent = this.metrics.fps;
    document.getElementById("processTime").textContent =
      avgProcessTime.toFixed(2);
    document.getElementById("droppedFrames").textContent =
      this.metrics.droppedFrames;
    document.getElementById(
      "bufferSize"
    ).textContent = `${this.metrics.bufferStats.currentSize}/${this.metrics.bufferStats.maxSize}`;
    document.getElementById("totalFrames").textContent =
      this.metrics.totalFrames;
  }

  // Event listeners
  setupEventListeners() {
    document.getElementById("startBtn").addEventListener("click", () => {
      this.startProcessing();
    });

    document.getElementById("stopBtn").addEventListener("click", () => {
      this.stopProcessing();
    });

    document.getElementById("effectSelect").addEventListener("change", (e) => {
      this.currentEffect = e.target.value;
      console.log("Effect changed to:", this.currentEffect);
    });
  }
}

// Circular Buffer implementation for frame management
class CircularBuffer {
  constructor(capacity) {
    this.capacity = capacity;
    this.buffer = new Array(capacity);
    this.head = 0;
    this.tail = 0;
    this.size = 0;
  }

  enqueue(item) {
    this.buffer[this.head] = item;
    this.head = (this.head + 1) % this.capacity;

    if (this.size === this.capacity) {
      this.tail = (this.tail + 1) % this.capacity;
    } else {
      this.size++;
    }
  }

  dequeue() {
    if (this.size === 0) return null;

    const item = this.buffer[this.tail];
    this.tail = (this.tail + 1) % this.capacity;
    this.size--;

    return item;
  }

  peek() {
    if (this.size === 0) return null;
    return this.buffer[this.tail];
  }

  clear() {
    this.head = 0;
    this.tail = 0;
    this.size = 0;
    this.buffer.fill(null);
  }
}

// Initialize when page loads
window.addEventListener("DOMContentLoaded", async () => {
  const processor = new VideoFrameProcessor();
  await processor.initCamera();
  window.processor = processor; // Make available in console for debugging
});
