// src/components/VideoPanel.tsx
import React, { useRef, useEffect } from "react";

interface VideoPanelProps {
  title: string;
  videoId: string;
  muted?: boolean;
  isLocal?: boolean;
  stream?: MediaStream | null;
}

const VideoPanel: React.FC<VideoPanelProps> = ({
  title,
  videoId,
  muted = false,
  isLocal = false,
  stream = null,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (video && stream) {
      video.srcObject = stream;
    } else if (video && !stream) {
      video.srcObject = null;
    }
  }, [stream]);

  const handleVideoClick = () => {
    const video = videoRef.current;
    if (video) {
      if (video.requestFullscreen) {
        video.requestFullscreen();
      }
    }
  };

  return (
    <div className="video-panel">
      <h2 className="video-title">{title}</h2>
      <div className="video-container">
        <video
          ref={videoRef}
          id={videoId}
          autoPlay
          muted={muted}
          playsInline
          className={`video-element ${isLocal ? "local" : "remote"}`}
          onClick={handleVideoClick}
        />
        {!stream && (
          <div className="video-placeholder">
            <div className="placeholder-text">
              {isLocal ? "Local Stream" : "Waiting for stream..."}
            </div>
          </div>
        )}
      </div>
      <div className="video-info">
        <span className="info-label">Resolution:</span>
        <span className="info-value">320×240</span>
        <span className="info-separator">•</span>
        <span className="info-label">FPS:</span>
        <span className="info-value">10</span>
      </div>
    </div>
  );
};

export default VideoPanel;
