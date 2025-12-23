import React, { useRef, useState, useEffect, useCallback } from "react";
import { CircularBuffer } from "../utils/CircularBuffer";
import type { Frame, EffectType, Metrics } from "../types";

const VideoFrameProcessor: React.FC = () => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const rafRef = useRef<number | null>(null);
  const frameBufferRef = useRef(new CircularBuffer<Frame>(3));

  const [isProcessing, setIsProcessing] = useState(false);
  const [isCameraReady, setIsCameraReady] = useState(false);
  const [currentEffect, setCurrentEffect] = useState<EffectType>("none");
  const [lastFrameTime, setLastFrameTime] = useState(0);
  const [error, setError] = useState("");

  const [hasFirstFrame, setHasFirstFrame] = useState(false);

  const [metrics, setMetrics] = useState<Metrics>({
    totalFrames: 0,
    droppedFrames: 0,
    fps: 0,
    processTime: 0,
    bufferSize: "0/3",
  });

  /* ---------------- CAMERA INIT ---------------- */

  const initCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 1280, height: 720, frameRate: 30 },
        audio: false,
      });

      const video = videoRef.current!;
      video.srcObject = stream;

      video.onloadedmetadata = async () => {
        await video.play();

        const canvas = canvasRef.current!;
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;

        ctxRef.current = canvas.getContext("2d", {
          willReadFrequently: true,
        });

        setIsCameraReady(true);
      };
    } catch (err: any) {
      setError(err.message || "Camera access failed");
    }
  }, []);

  /* ---------------- EFFECTS ---------------- */

  const applyEffect = useCallback(
    (imageData: ImageData): ImageData => {
      const { data, width, height } = imageData;
      const out = new Uint8ClampedArray(data);

      if (currentEffect === "none") return imageData;

      for (let i = 0; i < out.length; i += 4) {
        const r = out[i];
        const g = out[i + 1];
        const b = out[i + 2];

        if (currentEffect === "grayscale") {
          const avg = (r + g + b) / 3;
          out[i] = out[i + 1] = out[i + 2] = avg;
        }

        if (currentEffect === "invert") {
          out[i] = 255 - r;
          out[i + 1] = 255 - g;
          out[i + 2] = 255 - b;
        }

        if (currentEffect === "sepia") {
          out[i] = Math.min(255, r * 0.393 + g * 0.769 + b * 0.189);
          out[i + 1] = Math.min(255, r * 0.349 + g * 0.686 + b * 0.168);
          out[i + 2] = Math.min(255, r * 0.272 + g * 0.534 + b * 0.131);
        }
      }

      return new ImageData(out, width, height);
    },
    [currentEffect]
  );

  /* ---------------- PROCESS LOOP ---------------- */

  const processFrame = useCallback(() => {
    if (!ctxRef.current || !videoRef.current) return;

    const start = performance.now();
    const ctx = ctxRef.current;
    const canvas = canvasRef.current!;
    const video = videoRef.current;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const processed = applyEffect(imageData);
    ctx.putImageData(processed, 0, 0);

    if (!hasFirstFrame) {
      setHasFirstFrame(true);
    }

    frameBufferRef.current.enqueue({
      data: processed,
      timestamp: Date.now(),
      processingTime: performance.now() - start,
    });

    const now = performance.now();
    const fps = lastFrameTime ? Math.round(1000 / (now - lastFrameTime)) : 30;
    setLastFrameTime(now);

    setMetrics((m) => ({
      totalFrames: m.totalFrames + 1,
      droppedFrames: m.droppedFrames + (fps < 25 ? 1 : 0),
      fps,
      processTime: Math.round((performance.now() - start) * 100) / 100,
      bufferSize: `${frameBufferRef.current.size}/${frameBufferRef.current.capacity}`,
    }));
  }, [applyEffect, hasFirstFrame, lastFrameTime]);

  useEffect(() => {
    if (!isProcessing) {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      return;
    }

    rafRef.current = requestAnimationFrame(processFrame);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [isProcessing, processFrame]);

  /* ---------------- CONTROLS ---------------- */

  const startProcessing = () => {
    if (!isCameraReady || isProcessing) return;
    setHasFirstFrame(false);
    setLastFrameTime(performance.now());
    setIsProcessing(true);
  };

  const stopProcessing = () => {
    setIsProcessing(false);
    setHasFirstFrame(false);
  };

  /* ---------------- LIFECYCLE ---------------- */

  useEffect(() => {
    initCamera();

    return () => {
      stopProcessing();
      const stream = videoRef.current?.srcObject as MediaStream | null;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [initCamera]);

  /* ---------------- UI ---------------- */

  return (
    <div className="min-h-screen bg-gray-900 text-white p-6">
      <h1 className="text-3xl font-bold text-center mb-6">
        Video Frame Processing
      </h1>

      {error && <p className="text-red-400 text-center mb-4">{error}</p>}

      <div className="relative max-w-4xl mx-auto aspect-video bg-black rounded-xl overflow-hidden">
        <video
          ref={videoRef}
          muted
          playsInline
          className="absolute inset-0 w-full h-full object-cover"
          style={{ opacity: isProcessing && hasFirstFrame ? 0 : 1 }}
        />

        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full"
          style={{ opacity: isProcessing && hasFirstFrame ? 1 : 0 }}
        />
      </div>

      <div className="flex justify-center gap-4 mt-6">
        <button
          onClick={startProcessing}
          disabled={!isCameraReady || isProcessing}
          className="px-6 py-3 bg-green-600 rounded disabled:opacity-50"
        >
          Start
        </button>
        <button
          onClick={stopProcessing}
          disabled={!isProcessing}
          className="px-6 py-3 bg-red-600 rounded disabled:opacity-50"
        >
          Stop
        </button>
        <select
          value={currentEffect}
          onChange={(e) => setCurrentEffect(e.target.value as EffectType)}
          className="bg-gray-800 px-4 py-3 rounded"
        >
          <option value="none">None</option>
          <option value="grayscale">Grayscale</option>
          <option value="invert">Invert</option>
          <option value="sepia">Sepia</option>
        </select>
      </div>
    </div>
  );
};

export default VideoFrameProcessor;
