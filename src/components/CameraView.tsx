import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Camera,
  Compass,
  Grid,
  RefreshCw,
  Upload,
} from 'lucide-react';
import { captureFrameFromVideo, type CapturedImagePayload } from '../utils/imageProcessing';

type CameraErrorKind =
  | 'permission-denied'
  | 'no-camera'
  | 'insecure-context'
  | 'camera-busy'
  | null;

interface CameraViewProps {
  onCapture: (payload: CapturedImagePayload) => void;
  onUploadFile: (file: File) => void;
  onTryDemo: () => void;
  onBack: () => void;
}

export const CameraView: React.FC<CameraViewProps> = ({
  onCapture,
  onUploadFile,
  onTryDemo,
  onBack,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [isStarting, setIsStarting] = useState<boolean>(true);
  const [cameraReady, setCameraReady] = useState<boolean>(false);
  const [errorKind, setErrorKind] = useState<CameraErrorKind>(null);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [hasMultipleCameras, setHasMultipleCameras] = useState<boolean>(false);
  const [showHorizonGrid, setShowHorizonGrid] = useState<boolean>(true);

  const stopStream = useCallback(() => {
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }
  }, []);

  const startCamera = useCallback(
    async (preferredFacing: 'environment' | 'user') => {
      stopStream();
      setIsStarting(true);
      setCameraReady(false);
      setErrorKind(null);

      if (typeof window !== 'undefined' && !window.isSecureContext) {
        setIsStarting(false);
        setErrorKind('insecure-context');
        return;
      }

      if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
        setIsStarting(false);
        setErrorKind('no-camera');
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: preferredFacing },
            width: { ideal: 1920 },
            height: { ideal: 1440 },
          },
        });

        streamRef.current = stream;

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {
            // Autoplay handled once metadata settles
          });
        }

        if (typeof navigator.mediaDevices.enumerateDevices === 'function') {
          const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
          const videoInputs = devices.filter((d) => d.kind === 'videoinput');
          setHasMultipleCameras(videoInputs.length > 1);
        }

        setCameraReady(true);
        setIsStarting(false);
      } catch (err) {
        const domErr = err as DOMException | undefined;
        const name = domErr?.name || '';
        setIsStarting(false);
        setCameraReady(false);

        if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
          setErrorKind('permission-denied');
        } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') {
          setErrorKind('no-camera');
        } else {
          setErrorKind('camera-busy');
        }
      }
    },
    [stopStream]
  );

  useEffect(() => {
    void startCamera(facingMode);
    return () => {
      stopStream();
    };
  }, [facingMode, startCamera, stopStream]);

  const handleCaptureClick = () => {
    if (!videoRef.current || !cameraReady) return;
    const payload = captureFrameFromVideo(videoRef.current);
    stopStream();
    onCapture(payload);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      stopStream();
      onUploadFile(file);
      e.target.value = '';
    }
  };

  const toggleFacingMode = () => {
    setFacingMode((prev) => (prev === 'environment' ? 'user' : 'environment'));
  };

  return (
    <section
      aria-label="Real-world camera viewfinder"
      className="relative flex min-h-[calc(100dvh-3.5rem)] w-full flex-col justify-between overflow-hidden bg-black"
    >
      {/* Hidden photo upload input available in all camera states */}
      <input
        ref={fileInputRef}
        id="camera-photo-upload"
        type="file"
        accept="image/*"
        tabIndex={-1}
        aria-hidden="true"
        onChange={handleFileChange}
        className="sr-only"
      />

      {/* Edge-to-edge rear camera video feed */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        onLoadedMetadata={() => setCameraReady(true)}
        className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-200 ${
          cameraReady && !errorKind ? 'opacity-100' : 'opacity-0'
        }`}
      />

      {/* Flash-independent low-light horizon & framing guide */}
      {cameraReady && !errorKind && showHorizonGrid && (
        <svg
          viewBox="0 0 1000 1000"
          preserveAspectRatio="none"
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 h-full w-full"
        >
          {/* Subtle third/horizon alignment lines optimized for dark waterfront scenes */}
          <line
            x1="80"
            y1="500"
            x2="920"
            y2="500"
            stroke="rgba(34, 211, 238, 0.28)"
            strokeWidth="1.5"
            strokeDasharray="10 10"
          />
          <line
            x1="500"
            y1="140"
            x2="500"
            y2="860"
            stroke="rgba(248, 250, 252, 0.14)"
            strokeWidth="1"
            strokeDasharray="8 12"
          />
          {/* Corner framing brackets */}
          <path
            d="M 70 150 L 70 90 L 130 90 M 870 90 L 930 90 L 930 150 M 70 850 L 70 910 L 130 910 M 870 910 L 930 910 L 930 850"
            stroke="rgba(34, 211, 238, 0.55)"
            strokeWidth="3"
            fill="none"
            strokeLinecap="round"
          />
        </svg>
      )}

      {/* Top minimal camera HUD */}
      <div className="relative z-10 flex items-center justify-between gap-3 bg-gradient-to-b from-[#060B16]/85 via-[#060B16]/40 to-transparent px-4 pt-3 pb-6 sm:px-6">
        <button
          type="button"
          onClick={() => {
            stopStream();
            onBack();
          }}
          aria-label="Back to landing screen"
          className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-slate-700/80 bg-[#060B16]/80 px-3.5 py-2 text-sm font-medium text-slate-100 backdrop-blur-md transition-colors hover:border-slate-500 focus-visible:outline-2 focus-visible:outline-cyan-400 whitespace-nowrap shrink-0"
        >
          <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden="true" />
          Back
        </button>

        <div className="flex items-center gap-2">
          {cameraReady && !errorKind && (
            <button
              type="button"
              onClick={() => setShowHorizonGrid((v) => !v)}
              aria-pressed={showHorizonGrid}
              aria-label="Toggle low-light horizon alignment guide"
              className={`inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border backdrop-blur-md transition-colors focus-visible:outline-2 focus-visible:outline-cyan-400 ${
                showHorizonGrid
                  ? 'border-cyan-400/60 bg-cyan-950/60 text-cyan-200'
                  : 'border-slate-700/80 bg-[#060B16]/80 text-slate-300'
              }`}
            >
              <Grid className="h-4 w-4" aria-hidden="true" />
            </button>
          )}

          {hasMultipleCameras && cameraReady && !errorKind && (
            <button
              type="button"
              onClick={toggleFacingMode}
              aria-label="Switch front and rear camera"
              className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-slate-700/80 bg-[#060B16]/80 text-slate-200 backdrop-blur-md transition-colors hover:border-slate-500 focus-visible:outline-2 focus-visible:outline-cyan-400"
            >
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      {/* Center Recovery State when camera is denied, unavailable, or starting */}
      <div className="relative z-10 mx-auto flex w-full max-w-lg flex-1 items-center justify-center px-4">
        {isStarting && !errorKind && (
          <div
            role="status"
            aria-live="polite"
            className="rounded-2xl border border-slate-800 bg-[#060B16]/90 px-6 py-5 text-center backdrop-blur-md"
          >
            <p className="font-display text-base font-semibold text-white">
              Starting rear camera…
            </p>
            <p className="mt-1 text-xs text-slate-400">
              Approve browser camera access if prompted.
            </p>
          </div>
        )}

        {errorKind && (
          <div
            role="alert"
            className="w-full rounded-2xl border border-slate-800 bg-[#0B1222]/95 p-5 shadow-2xl backdrop-blur-md sm:p-6"
          >
            <div className="flex items-center gap-2.5 text-amber-300">
              <AlertTriangle className="h-5 w-5 shrink-0" aria-hidden="true" />
              <h2 className="font-display text-lg font-semibold text-white">
                {errorKind === 'permission-denied'
                  ? 'Camera permission is blocked'
                  : errorKind === 'insecure-context'
                    ? 'Secure HTTPS connection required'
                    : errorKind === 'no-camera'
                      ? 'No live camera detected'
                      : 'Camera is currently unavailable'}
              </h2>
            </div>

            <p className="mt-2.5 text-sm leading-relaxed text-slate-300">
              {errorKind === 'permission-denied'
                ? 'You can still analyze any photo from your device right away, or re-enable camera access in your browser.'
                : errorKind === 'insecure-context'
                  ? 'Mobile browsers require HTTPS (or localhost) to open the live camera. Upload an existing photo or open the HTTPS app URL.'
                  : errorKind === 'no-camera'
                    ? 'We could not find an available camera on this device. Upload a photo from your library or explore the Guided Demo.'
                    : 'Another app or tab may be using the camera. Close other camera apps and retry, or upload a photo below.'}
            </p>

            {errorKind === 'permission-denied' && (
              <div className="mt-4 border-t border-slate-800 pt-3.5 text-xs leading-relaxed text-slate-400">
                <p className="font-semibold text-slate-200">How to enable camera access:</p>
                <ol className="mt-1.5 list-decimal list-inside space-y-1">
                  <li>
                    <strong className="text-slate-200">iPhone (Safari):</strong> Tap the{' '}
                    <span className="text-slate-200">aA</span> or page settings icon in the address
                    bar → Website Settings → Camera → Allow.
                  </li>
                  <li>
                    <strong className="text-slate-200">Android (Chrome):</strong> Tap the tune/lock
                    icon next to the URL → Permissions → Camera → Allow, then tap Retry Camera.
                  </li>
                </ol>
              </div>
            )}

            <div className="mt-5 flex flex-col gap-2.5 sm:flex-row">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-xl bg-cyan-400 px-4 py-3 text-sm font-semibold text-slate-950 transition-colors hover:bg-cyan-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300 whitespace-nowrap shrink-0"
              >
                <Upload className="h-4 w-4 shrink-0" aria-hidden="true" />
                Upload a Photo
              </button>

              <button
                type="button"
                onClick={onTryDemo}
                className="inline-flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition-colors hover:border-slate-500 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-cyan-400 whitespace-nowrap shrink-0"
              >
                <Compass className="h-4 w-4 text-amber-400 shrink-0" aria-hidden="true" />
                Try Guided Demo
              </button>
            </div>

            <div className="mt-3 text-center">
              <button
                type="button"
                onClick={() => void startCamera(facingMode)}
                className="inline-flex min-h-[44px] items-center gap-1.5 text-xs font-medium text-slate-300 underline-offset-4 hover:text-white hover:underline focus-visible:outline-2 focus-visible:outline-cyan-400"
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                Retry Camera Access
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Bottom Natural Thumb-Zone Capture Bar */}
      {!errorKind && (
        <div className="relative z-10 bg-gradient-to-t from-[#060B16]/95 via-[#060B16]/75 to-transparent px-4 pt-8 pb-6 sm:px-6">
          <div className="mx-auto flex max-w-xl flex-col items-center gap-3">
            <p className="text-center text-xs font-medium text-slate-300">
              Hold steady on buildings, reflections, waves, or moving objects
            </p>

            <div className="flex w-full items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                aria-label="Upload an existing photo"
                className="inline-flex min-h-[52px] items-center justify-center gap-2 rounded-xl border border-slate-700/90 bg-slate-900/90 px-4 py-3 text-sm font-medium text-slate-200 backdrop-blur-md transition-colors hover:border-slate-500 hover:text-white focus-visible:outline-2 focus-visible:outline-cyan-400 whitespace-nowrap shrink-0"
              >
                <Upload className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="hidden sm:inline">Upload Photo</span>
                <span className="sm:hidden">Upload</span>
              </button>

              <button
                type="button"
                onClick={handleCaptureClick}
                disabled={!cameraReady}
                aria-label="Capture frame and find the math"
                className="inline-flex min-h-[56px] flex-1 max-w-xs items-center justify-center gap-2.5 rounded-2xl bg-cyan-400 px-6 py-3.5 text-base font-bold text-slate-950 shadow-lg shadow-cyan-950/50 transition-transform duration-150 hover:bg-cyan-300 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300 whitespace-nowrap shrink-0"
              >
                <Camera className="h-5 w-5 shrink-0" aria-hidden="true" />
                Find the Math
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
