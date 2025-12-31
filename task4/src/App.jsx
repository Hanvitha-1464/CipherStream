import React, { useState, useRef, useEffect, useCallback } from 'react';
import './App.css';

//  DCT  
function createEmptyMatrix(size) {
  return Array(size).fill().map(() => Array(size).fill(0));
}

function dct1D(signal) {
  const N = signal.length;
  const result = new Array(N).fill(0);
  for (let k = 0; k < N; k++) {
    let sum = 0;
    const alpha = k === 0 ? Math.sqrt(1 / N) : Math.sqrt(2 / N);
    for (let n = 0; n < N; n++) {
      sum += signal[n] * Math.cos((Math.PI / N) * (n + 0.5) * k);
    }
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

function transpose(matrix) {
  if (!matrix || matrix.length === 0) return [];
  return matrix[0].map((_, col) => matrix.map(row => row[col]));
}

function dct2D(block, quality = 100) {
  if (!block || block.length === 0) return createEmptyMatrix(8);

  const N = block.length;
  let temp = block.map(row => dct1D(row));
  temp = transpose(temp);
  temp = temp.map(row => dct1D(row));
  let result = transpose(temp);

  // Apply quality reduction (zero out high frequencies)
  if (quality < 100) {
    const keepRatio = quality / 100;
    const threshold = Math.floor(N * (1 - keepRatio));

    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        if (i + j > threshold) {
          result[i][j] *= keepRatio;
        }
      }
    }
  }

  return result;
}

function idct2D(coeffs) {
  if (!coeffs || coeffs.length === 0) return createEmptyMatrix(8);

  const N = coeffs.length;
  let temp = coeffs.map(row => idct1D(row));
  temp = transpose(temp);
  temp = temp.map(row => idct1D(row));
  return transpose(temp);
}

function rgbToGrayscale(r, g, b) {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}


class CircularBuffer {
  constructor(size) {
    this.size = size;
    this.buffer = new Array(size);
    this.writeIndex = 0;
    this.readIndex = 0;
    this.count = 0;
  }

  write(frame) {
    if (this.count === this.size) {
      // Buffer full, overwrite oldest
      this.readIndex = (this.readIndex + 1) % this.size;
      this.count--;
    }

    this.buffer[this.writeIndex] = frame;
    this.writeIndex = (this.writeIndex + 1) % this.size;
    this.count++;
    return true;
  }

  read() {
    if (this.count === 0) return null;

    const frame = this.buffer[this.readIndex];
    this.readIndex = (this.readIndex + 1) % this.size;
    this.count--;
    return frame;
  }

  peek() {
    if (this.count === 0) return null;
    return this.buffer[this.readIndex];
  }

  getCount() {
    return this.count;
  }

  clear() {
    this.writeIndex = 0;
    this.readIndex = 0;
    this.count = 0;
  }
}

//  FRAME PROCESSOR
class FrameProcessor {
  constructor() {
    this.buffer = new CircularBuffer(5);
    this.processing = false;
    this.stats = {
      processedFrames: 0,
      droppedFrames: 0,
      avgProcessingTime: 0
    };
    this.processingTimes = [];
  }

  addFrame(frame) {
    return this.buffer.write(frame);
  }

  async processFrame(callback) {
    if (this.processing || this.buffer.getCount() === 0) return;

    this.processing = true;
    const frame = this.buffer.peek();
    if (!frame) {
      this.processing = false;
      return;
    }

    try {
      const startTime = performance.now();

      // Process the frame 
      const result = await this.applyDCTPipeline(
        frame.imageData,
        frame.blockSize,
        frame.quality
      );

      const processingTime = performance.now() - startTime;

      if (result) {
        this.buffer.read(); // Remove processed frame
        this.stats.processedFrames++;
        this.processingTimes.push(processingTime);

        // Keep only last 10 processing times for average
        if (this.processingTimes.length > 10) {
          this.processingTimes.shift();
        }

        this.stats.avgProcessingTime = this.processingTimes.reduce((a, b) => a + b, 0) / this.processingTimes.length;

        callback({
          processedImageData: result,
          processingTime,
          bufferUsage: (this.buffer.getCount() / this.buffer.size) * 100
        });
      } else {
        this.stats.droppedFrames++;
        this.buffer.read(); // Remove failed frame
      }
    } catch (error) {
      console.error('Frame processing error:', error);
      this.stats.droppedFrames++;
      this.buffer.read(); // Remove errored frame
    } finally {
      this.processing = false;
    }
  }

  async applyDCTPipeline(imageData, blockSize = 8, quality = 100) {
    const width = imageData.width;
    const height = imageData.height;
    const data = imageData.data;

    // Create grayscale array
    const grayscale = new Uint8ClampedArray(width * height);

    // Convert to grayscale
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        const gray = rgbToGrayscale(data[idx], data[idx + 1], data[idx + 2]);
        grayscale[y * width + x] = gray;
      }
    }

    // Calculate number of blocks
    const blocksX = Math.ceil(width / blockSize);
    const blocksY = Math.ceil(height / blockSize);

    // Process each block
    const processedData = new Uint8ClampedArray(data.length);

    for (let blockY = 0; blockY < blocksY; blockY++) {
      for (let blockX = 0; blockX < blocksX; blockX++) {
        // Extract block
        const block = [];
        for (let y = 0; y < blockSize; y++) {
          const row = [];
          for (let x = 0; x < blockSize; x++) {
            const pixelY = blockY * blockSize + y;
            const pixelX = blockX * blockSize + x;

            if (pixelY < height && pixelX < width) {
              row.push(grayscale[pixelY * width + pixelX]);
            } else {
              row.push(0);
            }
          }
          block.push(row);
        }

        // Apply DCT
        const dctBlock = dct2D(block, quality);

        // Apply IDCT
        const idctBlock = idct2D(dctBlock);

        // Put processed block back
        for (let y = 0; y < blockSize; y++) {
          for (let x = 0; x < blockSize; x++) {
            const pixelY = blockY * blockSize + y;
            const pixelX = blockX * blockSize + x;

            if (pixelY < height && pixelX < width) {
              const idx = (pixelY * width + pixelX) * 4;
              const value = Math.max(0, Math.min(255, idctBlock[y][x]));

              processedData[idx] = value;     // R
              processedData[idx + 1] = value; // G
              processedData[idx + 2] = value; // B
              processedData[idx + 3] = 255;   // A
            }
          }
        }
      }
    }

    return new ImageData(processedData, width, height);
  }

  getStats() {
    return {
      ...this.stats,
      bufferCount: this.buffer.getCount(),
      bufferSize: this.buffer.size,
      isProcessing: this.processing
    };
  }

  reset() {
    this.buffer.clear();
    this.stats = {
      processedFrames: 0,
      droppedFrames: 0,
      avgProcessingTime: 0
    };
    this.processingTimes = [];
    this.processing = false;
  }
}

//  WEBCAM PROCESSOR COMPONENT 
function WebcamProcessor({
  isActive,
  onStatsUpdate,
  blockSize = 8,
  quality = 100,
  showOriginal = true
}) {
  const videoRef = useRef(null);
  const originalCanvasRef = useRef(null);
  const processedCanvasRef = useRef(null);
  const streamRef = useRef(null);
  const animationFrameRef = useRef(null);
  const frameProcessorRef = useRef(null);

  const [localStats, setLocalStats] = useState({
    fps: 0,
    bufferUsage: 0,
    isProcessingFrame: false
  });

  const statsRef = useRef({
    frameCount: 0,
    lastFpsUpdate: 0,
    processingFrame: false
  });

  // Initialize frame processor
  useEffect(() => {
    frameProcessorRef.current = new FrameProcessor();

    // Start processing loop
    const processLoop = () => {
      if (frameProcessorRef.current) {
        frameProcessorRef.current.processFrame((result) => {
          if (result && processedCanvasRef.current) {
            const ctx = processedCanvasRef.current.getContext('2d');
            ctx.putImageData(result.processedImageData, 0, 0);

            setLocalStats(prev => ({
              ...prev,
              bufferUsage: result.bufferUsage,
              isProcessingFrame: false
            }));

            statsRef.current.processingFrame = false;
          }
        });
      }
      requestAnimationFrame(processLoop);
    };

    const loopId = requestAnimationFrame(processLoop);

    return () => {
      cancelAnimationFrame(loopId);
      if (frameProcessorRef.current) {
        frameProcessorRef.current.reset();
      }
    };
  }, []);

  const startWebcam = async () => {
    try {
      const constraints = {
        video: {
          width: { ideal: 320 },
          height: { ideal: 240 },
          frameRate: { ideal: 30 }
        }
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;
      videoRef.current.srcObject = stream;

      videoRef.current.onloadedmetadata = () => {
        console.log('Webcam loaded');
        videoRef.current.play();
        startCaptureLoop();
      };
    } catch (err) {
      console.error('Webcam error:', err);
      alert('Could not access webcam. Please check permissions.');
    }
  };

  const stopWebcam = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (frameProcessorRef.current) {
      frameProcessorRef.current.reset();
    }
  };

  const startCaptureLoop = () => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }

    const captureFrame = () => {
      if (!videoRef.current || !originalCanvasRef.current) {
        animationFrameRef.current = requestAnimationFrame(captureFrame);
        return;
      }

      const video = videoRef.current;
      const originalCtx = originalCanvasRef.current.getContext('2d');

      if (video.videoWidth === 0 || video.videoHeight === 0) {
        animationFrameRef.current = requestAnimationFrame(captureFrame);
        return;
      }

      // Draw original video
      originalCtx.drawImage(video, 0, 0, originalCanvasRef.current.width, originalCanvasRef.current.height);

      // Get image data and add to processor buffer
      if (frameProcessorRef.current && !statsRef.current.processingFrame) {
        const imageData = originalCtx.getImageData(
          0, 0,
          originalCanvasRef.current.width,
          originalCanvasRef.current.height
        );

        const frame = {
          imageData,
          blockSize,
          quality,
          timestamp: Date.now()
        };

        const added = frameProcessorRef.current.addFrame(frame);
        if (!added) {
          console.log('Frame dropped - buffer full');
        } else {
          statsRef.current.processingFrame = true;
          setLocalStats(prev => ({ ...prev, isProcessingFrame: true }));
        }
      }

      // Update FPS stats
      const now = Date.now();
      statsRef.current.frameCount++;

      if (now - statsRef.current.lastFpsUpdate >= 1000) {
        const fps = statsRef.current.frameCount;
        statsRef.current.frameCount = 0;
        statsRef.current.lastFpsUpdate = now;

        setLocalStats(prev => ({ ...prev, fps }));

        if (onStatsUpdate) {
          const processorStats = frameProcessorRef.current?.getStats() || {};
          onStatsUpdate({
            fps,
            droppedFrames: processorStats.droppedFrames || 0,
            processingTime: processorStats.avgProcessingTime || 0,
            bufferUsage: localStats.bufferUsage
          });
        }
      }

      animationFrameRef.current = requestAnimationFrame(captureFrame);
    };

    captureFrame();
  };

  useEffect(() => {
    if (isActive) {
      startWebcam();
    } else {
      stopWebcam();
    }

    return () => {
      stopWebcam();
    };
  }, [isActive]);

  // Update processor settings when they change
  useEffect(() => {
    if (frameProcessorRef.current) {
      // Clear buffer when settings change
      frameProcessorRef.current.reset();
    }
  }, [blockSize, quality]);

  return (
    <div className="video-container">
      {showOriginal && (
        <div className="video-section">
          <h3>Original Webcam</h3>
          <video
            ref={videoRef}
            style={{ display: 'none' }}
            autoPlay
            playsInline
            muted
          />
          <canvas
            ref={originalCanvasRef}
            width="320"
            height="240"
            className="video-canvas"
          />
          <div className="video-stats">
            <span>FPS: {localStats.fps}</span>
            <span>Status: {isActive ? 'Active' : 'Inactive'}</span>
          </div>
        </div>
      )}

      <div className="video-section">
        <h3>DCT Processed</h3>
        <canvas
          ref={processedCanvasRef}
          width="320"
          height="240"
          className="video-canvas processed"
        />
        <div className="video-stats">
          <span>Buffer: {localStats.bufferUsage.toFixed(1)}%</span>
          <span>Processing: {localStats.isProcessingFrame ? 'Yes' : 'No'}</span>
          <span>Block: {blockSize}×{blockSize}</span>
          <span>Quality: {quality}%</span>
        </div>
      </div>
    </div>
  );
}

//  CONTROLS COMPONENT 
function Controls({
  isActive,
  onToggle,
  blockSize,
  onBlockSizeChange,
  quality,
  onQualityChange
}) {
  return (
    <div className="controls-container">
      <div className="control-group">
        <button
          className={`control-btn ${isActive ? 'active' : ''}`}
          onClick={onToggle}
        >
          {isActive ? 'Stop Processing' : 'Start Processing'}
        </button>
      </div>

      <div className="control-group">
        <label className="control-label">
          Block Size: {blockSize}×{blockSize}
          <div className="size-buttons">
            {[4, 8, 16].map(size => (
              <button
                key={size}
                className={`size-btn ${blockSize === size ? 'active' : ''}`}
                onClick={() => onBlockSizeChange(size)}
                disabled={isActive}
              >
                {size}×{size}
              </button>
            ))}
          </div>
          <small>Smaller = Faster, Larger = More Detail</small>
        </label>
      </div>

      <div className="control-group">
        <label className="control-label">
          Quality: {quality}%
          <input
            type="range"
            min="10"
            max="100"
            step="5"
            value={quality}
            onChange={(e) => onQualityChange(parseInt(e.target.value))}
            className="quality-slider"
            disabled={isActive}
          />
          <div className="slider-labels">
            <span>Fast</span>
            <span>Balanced</span>
            <span>Quality</span>
          </div>
        </label>
      </div>
    </div>
  );
}

// STATS COMPONENT 
function StatsDisplay({ stats }) {
  const { fps, droppedFrames, processingTime, bufferUsage } = stats;

  const getFpsStatus = (fps) => {
    if (fps >= 25) return { text: 'Excellent', color: '#10b981' };
    if (fps >= 15) return { text: 'Good', color: '#3b82f6' };
    if (fps >= 8) return { text: 'Fair', color: '#f59e0b' };
    return { text: 'Poor', color: '#ef4444' };
  };

  const fpsStatus = getFpsStatus(fps);

  return (
    <div className="stats-container">
      <h3>Performance Metrics</h3>
      <div className="metrics-grid">
        <div className="metric-card">
          <div className="metric-value" style={{ color: fpsStatus.color }}>
            {fps.toFixed(1)}
          </div>
          <div className="metric-label">FPS</div>
          <div className="metric-status" style={{ color: fpsStatus.color }}>
            {fpsStatus.text}
          </div>
          <div className="metric-bar">
            <div
              className="metric-fill"
              style={{
                width: `${Math.min(fps / 30 * 100, 100)}%`,
                backgroundColor: fpsStatus.color
              }}
            />
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-value">{droppedFrames}</div>
          <div className="metric-label">Dropped Frames</div>
          <div className="metric-status">
            {droppedFrames === 0 ? 'Perfect' : droppedFrames < 5 ? 'Good' : 'High'}
          </div>
          <div className="metric-bar">
            <div
              className="metric-fill"
              style={{ width: `${Math.min(droppedFrames / 20 * 100, 100)}%` }}
            />
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-value">{processingTime.toFixed(1)}ms</div>
          <div className="metric-label">Process Time</div>
          <div className="metric-status">
            {processingTime < 20 ? 'Fast' : processingTime < 50 ? 'Moderate' : 'Slow'}
          </div>
          <div className="metric-bar">
            <div
              className="metric-fill"
              style={{ width: `${Math.min(processingTime / 100 * 100, 100)}%` }}
            />
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-value">{bufferUsage.toFixed(1)}%</div>
          <div className="metric-label">Buffer Usage</div>
          <div className="metric-status">
            {bufferUsage < 50 ? 'Optimal' : bufferUsage < 80 ? 'High' : 'Full'}
          </div>
          <div className="metric-bar">
            <div
              className="metric-fill"
              style={{ width: `${bufferUsage}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function App() {
  const [isActive, setIsActive] = useState(false);
  const [blockSize, setBlockSize] = useState(8);
  const [quality, setQuality] = useState(80);
  const [stats, setStats] = useState({
    fps: 0,
    droppedFrames: 0,
    processingTime: 0,
    bufferUsage: 0
  });

  const handleStatsUpdate = useCallback((newStats) => {
    setStats(prev => ({ ...prev, ...newStats }));
  }, []);

  const handleToggle = () => {
    setIsActive(!isActive);
  };

  const handleBlockSizeChange = (size) => {
    setBlockSize(size);
  };

  const handleQualityChange = (newQuality) => {
    setQuality(newQuality);
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1>Real-Time DCT Video Processor</h1>
        <p className="subtitle">
          Grayscale - DCT Compression - IDCT Reconstruction with Circular Buffer
        </p>
      </header>

      <main className="app-content">
        <div className="main-controls">
          <Controls
            isActive={isActive}
            onToggle={handleToggle}
            blockSize={blockSize}
            onBlockSizeChange={handleBlockSizeChange}
            quality={quality}
            onQualityChange={handleQualityChange}
          />
        </div>

        <div className="main-video">
          {isActive ? (
            <WebcamProcessor
              isActive={isActive}
              onStatsUpdate={handleStatsUpdate}
              blockSize={blockSize}
              quality={quality}
              showOriginal={true}
            />
          ) : (
            <div className="placeholder">
              <div className="placeholder-content">
                <h3>Ready to Process</h3>
                <p>Click "Start Processing" to begin real-time DCT compression</p>
                <p className="placeholder-tip">
                  Tip: Start with 8×8 blocks and 80% quality
                </p>
              </div>
            </div>
          )}
        </div>
      </main>

      <footer className="app-footer">
        <p>
          Real-Time DCT Video Processor •
          Circular Buffer Optimized •
          {isActive ? ` Processing at ${stats.fps.toFixed(1)} FPS` : ' Ready'}
        </p>
      </footer>
    </div>
  );
}

export default App;