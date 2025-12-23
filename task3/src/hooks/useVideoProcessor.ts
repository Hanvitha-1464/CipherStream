import { useState, useRef, useCallback, useEffect } from 'react';
import type { EffectType, Metrics, Frame } from '../types';
import { CircularBuffer } from '../utils/CircularBuffer';

export const useVideoProcessor = () => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
const processingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const frameBufferRef = useRef(new CircularBuffer<Frame>(3));
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);

  const [isProcessing, setIsProcessing] = useState(false);
  const [currentEffect, setCurrentEffect] = useState<EffectType>('none');
  const [metrics, setMetrics] = useState<Metrics>({
    totalFrames: 0,
    droppedFrames: 0,
    fps: 0,
    processTime: 0,
    bufferSize: '0/3',
  });
  const [isCameraReady, setIsCameraReady] = useState(false);
  const [lastFrameTime, setLastFrameTime] = useState<number>(0);

  // Initialize camera
  const initCamera = useCallback(async () => {
    try {
      const constraints: MediaStreamConstraints = {
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 },
        },
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        
        videoRef.current.onloadedmetadata = () => {
          if (canvasRef.current && videoRef.current && videoRef.current.videoWidth) {
            canvasRef.current.width = videoRef.current.videoWidth;
            canvasRef.current.height = videoRef.current.videoHeight;
            ctxRef.current = canvasRef.current.getContext('2d', { willReadFrequently: true });
            setIsCameraReady(true);
          }
        };
      }
    } catch (error) {
      console.error('Error accessing camera:', error);
      alert('Cannot access camera. Please check permissions.');
    }
  }, []);

  // Effect functions
  const applyGrayscale = useCallback((data: Uint8ClampedArray, width: number, height: number): ImageData => {
    const newData = new Uint8ClampedArray(data);
    for (let i = 0; i < newData.length; i += 4) {
      const avg = (newData[i] + newData[i + 1] + newData[i + 2]) / 3;
      newData[i] = avg;
      newData[i + 1] = avg;
      newData[i + 2] = avg;
    }
    return new ImageData(newData, width, height);
  }, []);

  const applyInvert = useCallback((data: Uint8ClampedArray, width: number, height: number): ImageData => {
    const newData = new Uint8ClampedArray(data);
    for (let i = 0; i < newData.length; i += 4) {
      newData[i] = 255 - newData[i];
      newData[i + 1] = 255 - newData[i + 1];
      newData[i + 2] = 255 - newData[i + 2];
    }
    return new ImageData(newData, width, height);
  }, []);

  const applyEdgeDetection = useCallback((data: Uint8ClampedArray, width: number, height: number): ImageData => {
    const newData = new Uint8ClampedArray(data.length);
    
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = (y * width + x) * 4;
        const top = ((y - 1) * width + x) * 4;
        const bottom = ((y + 1) * width + x) * 4;
        const left = (y * width + (x - 1)) * 4;
        const right = (y * width + (x + 1)) * 4;

        const gradientR = Math.abs(data[top] - data[bottom]) + Math.abs(data[left] - data[right]);
        const gradientG = Math.abs(data[top + 1] - data[bottom + 1]) + Math.abs(data[left + 1] - data[right + 1]);
        const gradientB = Math.abs(data[top + 2] - data[bottom + 2]) + Math.abs(data[left + 2] - data[right + 2]);

        const gradient = Math.min(255, gradientR + gradientG + gradientB);

        newData[idx] = gradient;
        newData[idx + 1] = gradient;
        newData[idx + 2] = gradient;
        newData[idx + 3] = 255;
      }
    }
    return new ImageData(newData, width, height);
  }, []);

  const applySepia = useCallback((data: Uint8ClampedArray, width: number, height: number): ImageData => {
    const newData = new Uint8ClampedArray(data);
    for (let i = 0; i < newData.length; i += 4) {
      const r = newData[i];
      const g = newData[i + 1];
      const b = newData[i + 2];

      newData[i] = Math.min(255, r * 0.393 + g * 0.769 + b * 0.189);
      newData[i + 1] = Math.min(255, r * 0.349 + g * 0.686 + b * 0.168);
      newData[i + 2] = Math.min(255, r * 0.272 + g * 0.534 + b * 0.131);
    }
    return new ImageData(newData, width, height);
  }, []);

  const applyEffect = useCallback((imageData: ImageData): ImageData => {
    const { data, width, height } = imageData;

    switch (currentEffect) {
      case 'grayscale':
        return applyGrayscale(data, width, height);
      case 'invert':
        return applyInvert(data, width, height);
      case 'edge':
        return applyEdgeDetection(data, width, height);
      case 'sepia':
        return applySepia(data, width, height);
      default:
        return imageData;
    }
  }, [currentEffect, applyGrayscale, applyInvert, applyEdgeDetection, applySepia]);

  const processFrame = useCallback(() => {
    if (!videoRef.current || !canvasRef.current || !ctxRef.current || !isProcessing) return;
    
    const startTime = performance.now();
    
    // Check if video is ready
    if (videoRef.current.videoWidth === 0 || videoRef.current.videoHeight === 0) return;

    // Draw video frame to canvas
    ctxRef.current.drawImage(
      videoRef.current,
      0,
      0,
      canvasRef.current.width,
      canvasRef.current.height
    );

    // Get image data and apply effect
    const imageData = ctxRef.current.getImageData(
      0,
      0,
      canvasRef.current.width,
      canvasRef.current.height
    );
    
    const processedData = applyEffect(imageData);

    // Store in frame buffer
    const frame: Frame = {
      data: processedData,
      timestamp: Date.now(),
      processingTime: performance.now() - startTime,
    };
    
    frameBufferRef.current.enqueue(frame);

    // Render processed frame
    ctxRef.current.putImageData(processedData, 0, 0);

    // Calculate FPS
    const now = performance.now();
    const frameTime = now - lastFrameTime;
    const fps = frameTime > 0 ? Math.round(1000 / frameTime) : 0;
    setLastFrameTime(now);

    // Update metrics
    const processTime = performance.now() - startTime;
    const droppedFrames = processTime > 33 ? 1 : 0;
    
    setMetrics(prev => ({
      totalFrames: prev.totalFrames + 1,
      droppedFrames: prev.droppedFrames + droppedFrames,
      fps,
      processTime: Math.round(processTime * 100) / 100,
      bufferSize: `${frameBufferRef.current.size}/${frameBufferRef.current.capacity}`,
    }));
  }, [currentEffect, isProcessing, lastFrameTime, applyEffect]);

  // Start processing
  const startProcessing = useCallback(() => {
    if (!isCameraReady || isProcessing) return;
    
    setIsProcessing(true);
    setLastFrameTime(performance.now());
    processingIntervalRef.current = setInterval(processFrame, 33); // ~30 FPS
  }, [isCameraReady, isProcessing, processFrame]);

  // Stop processing
  const stopProcessing = useCallback(() => {
    setIsProcessing(false);
    if (processingIntervalRef.current) {
      clearInterval(processingIntervalRef.current);
      processingIntervalRef.current = null;
    }
  }, []);

  // Handle effect change
  const handleEffectChange = useCallback((effect: EffectType) => {
    setCurrentEffect(effect);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    initCamera();

    return () => {
      stopProcessing();
      if (videoRef.current?.srcObject) {
        const stream = videoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, [initCamera, stopProcessing]);

  return {
    videoRef,
    canvasRef,
    isProcessing,
    isCameraReady,
    currentEffect,
    metrics,
    startProcessing,
    stopProcessing,
    handleEffectChange,
  };
};