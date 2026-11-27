import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Camera,
  Monitor,
  Image as ImageIcon,
  Flashlight,
  RefreshCw,
  Upload,
  Clipboard,
  AlertCircle,
  Play,
  Square,
  Sparkles,
  HelpCircle,
  Check,
} from 'lucide-react';
import { scanImageData, scanImageFile } from '../utils/qrScanner';
import type { CodeFormat } from '../utils/qrLogic';
import { playScanSuccessSound, playTapSound, triggerHaptic } from '../utils/audio';
import { readClipboardImageFromDevice } from '../utils/nativeFiles';
import {
  isNativeScreenCapturePlatform,
  mapNativeCodeFormat,
  startNativeScreenCapture,
  stopNativeScreenCapture,
  getNativeScreenCaptureStatus,
  addScreenCaptureStateListener,
} from '../utils/screenCapture';
import {
  isNativeCameraPlatform,
  computeCameraBackdropColor,
  normalizeViewportBounds,
  detectWebTrackTorchSupport,
  startNativeCamera,
  stopNativeCamera,
  setNativeCameraTorch,
  updateNativeCameraBounds,
  addNativeCameraCodeListener,
  addNativeCameraStateListener,
} from '../utils/nativeCamera';
import { Language, TRANSLATIONS } from '../utils/i18n';
import { ThemeMode } from '../utils/theme';
import {
  resolveScannerModeFromQuickAction,
  shouldAutoStartScreenFromQuickAction,
  type QuickActionRequest,
} from '../utils/quickActions';

interface ScannerViewProps {
  onQrDetected: (rawText: string, source: 'camera' | 'screen' | 'file', codeFormat?: CodeFormat) => void;
  lang?: Language;
  theme?: ThemeMode;
  demoMode?: boolean;
  suspended?: boolean;
  quickActionRequest?: QuickActionRequest | null;
  onQuickActionHandled?: (nonce: number) => void;
}

type ScanMode = 'camera' | 'screen' | 'file';

export function ScannerView({
  onQrDetected,
  lang = 'ru',
  theme = 'dark',
  demoMode = false,
  suspended = false,
  quickActionRequest = null,
  onQuickActionHandled,
}: ScannerViewProps) {
  const isDark = theme === 'dark';
  const t = TRANSLATIONS[lang];
  const [mode, setMode] = useState<ScanMode>('camera');
  const [isScanning, setIsScanning] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [torchEnabled, setTorchEnabled] = useState(false);
  const [hasTorch, setHasTorch] = useState(false);
  const [isProcessingFile, setIsProcessingFile] = useState(false);

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animFrameIdRef = useRef<number | null>(null);
  const torchCheckTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastScanTimestampRef = useRef<number>(0);
  const nativeScreenActiveRef = useRef<boolean>(false);
  const nativeCameraActiveRef = useRef<boolean>(false);
  const lastHandledQuickNonceRef = useRef<number | null>(null);
  const pendingAutoScreenStartRef = useRef<boolean>(false);
  const themeRef = useRef<ThemeMode>(theme);
  themeRef.current = theme;

  const isNativeScreen = isNativeScreenCapturePlatform();
  const isNativeCamera = isNativeCameraPlatform();

  const readViewportBounds = useCallback(() => {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) {
      return normalizeViewportBounds({ left: 16, top: 120, width: 320, height: 360 }, 28);
    }
    return normalizeViewportBounds(rect, 28);
  }, []);

  // Stop active video media streams, native CameraX, or native screen capture
  const stopCurrentStream = useCallback(() => {
    if (torchCheckTimerRef.current) {
      clearTimeout(torchCheckTimerRef.current);
      torchCheckTimerRef.current = null;
    }
    if (animFrameIdRef.current) {
      cancelAnimationFrame(animFrameIdRef.current);
      animFrameIdRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    if (nativeCameraActiveRef.current) {
      nativeCameraActiveRef.current = false;
      void stopNativeCamera();
    }
    if (nativeScreenActiveRef.current) {
      nativeScreenActiveRef.current = false;
      void stopNativeScreenCapture();
    }
    setIsScanning(false);
    setTorchEnabled(false);
    setHasTorch(false);
  }, []);

  // Frame processing loop (Web / Desktop camera & desktop screen capture)
  const processVideoFrame = useCallback(() => {
    const video = videoRef.current;
    if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      animFrameIdRef.current = requestAnimationFrame(processVideoFrame);
      return;
    }

    const now = performance.now();
    if (now - lastScanTimestampRef.current > 90) {
      lastScanTimestampRef.current = now;

      if (!canvasRef.current) {
        canvasRef.current = document.createElement('canvas');
      }
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });

      if (ctx && video.videoWidth > 0 && video.videoHeight > 0) {
        const maxDimension = 960;
        let scale = 1;
        if (video.videoWidth > maxDimension || video.videoHeight > maxDimension) {
          scale = Math.min(maxDimension / video.videoWidth, maxDimension / video.videoHeight);
        }

        canvas.width = Math.floor(video.videoWidth * scale);
        canvas.height = Math.floor(video.videoHeight * scale);

        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

        const result = scanImageData(imageData);
        if (result && result.data) {
          playScanSuccessSound();
          triggerHaptic([40, 30, 80]);
          stopCurrentStream();
          onQrDetected(result.data, mode === 'screen' ? 'screen' : 'camera', result.format);
          return;
        }
      }
    }

    animFrameIdRef.current = requestAnimationFrame(processVideoFrame);
  }, [mode, onQrDetected, stopCurrentStream]);

  const probeWebTorchSupport = useCallback(async (track: MediaStreamTrack | undefined): Promise<boolean> => {
    if (!track) return false;
    let photoCaps: { fillLightMode?: string[] } | null = null;
    const ImageCaptureCtor = (window as unknown as {
      ImageCapture?: new (t: MediaStreamTrack) => { getPhotoCapabilities?: () => Promise<{ fillLightMode?: string[] }> };
    }).ImageCapture;

    if (typeof ImageCaptureCtor === 'function') {
      try {
        const ic = new ImageCaptureCtor(track);
        if (typeof ic.getPhotoCapabilities === 'function') {
          photoCaps = await ic.getPhotoCapabilities();
        }
      } catch {
        // Ignore ImageCapture errors on unsupported tracks
      }
    }

    return detectWebTrackTorchSupport(track, photoCaps);
  }, []);

  // Start Camera Stream (Native Android CameraX or Web getUserMedia)
  const startCamera = useCallback(async () => {
    if (suspended) return;
    stopCurrentStream();
    setErrorMsg(null);

    if (isNativeCamera) {
      try {
        const res = await startNativeCamera({
          facing: facingMode,
          bounds: readViewportBounds(),
          viewportWidth: typeof window !== 'undefined' ? window.innerWidth : 360,
          backdropColor: computeCameraBackdropColor(themeRef.current),
        });

        if (res?.permissionDenied) {
          nativeCameraActiveRef.current = false;
          setErrorMsg(t.cameraPermissionDenied);
          setHasTorch(false);
          setTorchEnabled(false);
          setIsScanning(false);
          return;
        }

        if (res?.started) {
          nativeCameraActiveRef.current = true;
          setHasTorch(Boolean(res.hasTorch));
          setTorchEnabled(Boolean(res.torchEnabled));
          setIsScanning(true);
        }
      } catch (err: unknown) {
        console.warn('Native camera start error:', err);
        nativeCameraActiveRef.current = false;
        setHasTorch(false);
        setTorchEnabled(false);
        setIsScanning(false);
        setErrorMsg(t.cameraNotFound);
      }
      return;
    }

    try {
      const constraints: MediaStreamConstraints = {
        video: {
          facingMode: { ideal: facingMode },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      const track = stream.getVideoTracks()[0];
      const supportedNow = await probeWebTorchSupport(track);
      if (supportedNow) {
        setHasTorch(true);
      } else if (track) {
        torchCheckTimerRef.current = setTimeout(() => {
          void probeWebTorchSupport(track).then((delayedSupport) => {
            if (delayedSupport && streamRef.current === stream) {
              setHasTorch(true);
            }
          });
        }, 350);
      }

      setIsScanning(true);
      animFrameIdRef.current = requestAnimationFrame(processVideoFrame);
    } catch (err: unknown) {
      console.warn('Camera start error:', err);
      const errName = (err as { name?: string })?.name;
      const msg = errName === 'NotAllowedError' ? t.cameraPermissionDenied : t.cameraNotFound;
      setErrorMsg(msg);
      setIsScanning(false);
    }
  }, [
    facingMode,
    isNativeCamera,
    probeWebTorchSupport,
    processVideoFrame,
    readViewportBounds,
    stopCurrentStream,
    suspended,
    t.cameraNotFound,
    t.cameraPermissionDenied,
  ]);

  // Start Screen Capture Stream (Native Android MediaProjection or Browser getDisplayMedia)
  const startScreenCapture = useCallback(async () => {
    stopCurrentStream();
    setErrorMsg(null);

    if (isNativeScreen) {
      try {
        const res = await startNativeScreenCapture({
          notifTitle: t.screenNotifTitle,
          notifText: t.screenNotifText,
          notifStop: t.screenNotifStop,
          detectedTitle: t.screenDetectedTitle,
          detectedText: t.screenDetectedText,
        });
        if (res?.cancelled) {
          nativeScreenActiveRef.current = false;
          setIsScanning(false);
          return;
        }
        if (res?.started) {
          nativeScreenActiveRef.current = true;
          setIsScanning(true);
        }
      } catch (err: any) {
        console.warn('Native Android screen capture error:', err);
        setErrorMsg(t.screenCaptureStartFailed + (err?.message || 'Error'));
        nativeScreenActiveRef.current = false;
        setIsScanning(false);
      }
      return;
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      setErrorMsg(t.screenCaptureUnsupported);
      return;
    }

    try {
      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: 'monitor' } as any,
        audio: false,
      });

      streamRef.current = displayStream;

      displayStream.getVideoTracks()[0].onended = () => {
        stopCurrentStream();
      };

      if (videoRef.current) {
        videoRef.current.srcObject = displayStream;
        await videoRef.current.play();
      }

      setIsScanning(true);
      animFrameIdRef.current = requestAnimationFrame(processVideoFrame);
    } catch (err: any) {
      console.warn('Screen capture error:', err);
      if (err.name !== 'NotAllowedError') {
        setErrorMsg(t.screenCaptureStartFailed + (err.message || 'Error'));
      }
      setIsScanning(false);
    }
  }, [
    isNativeScreen,
    processVideoFrame,
    stopCurrentStream,
    t.screenCaptureStartFailed,
    t.screenCaptureUnsupported,
    t.screenDetectedText,
    t.screenDetectedTitle,
    t.screenNotifStop,
    t.screenNotifText,
    t.screenNotifTitle,
  ]);

  useEffect(() => {
    if (!isNativeScreen) return;
    let disposed = false;
    const handles: Array<{ remove: () => Promise<void> }> = [];

    const checkStatus = async () => {
      const capturing = await getNativeScreenCaptureStatus();
      if (!disposed) {
        nativeScreenActiveRef.current = capturing;
        if (mode === 'screen') {
          setIsScanning(capturing);
        }
      }
    };

    const setupListeners = async () => {
      const stateHandle = await addScreenCaptureStateListener((state) => {
        if (disposed) return;
        nativeScreenActiveRef.current = Boolean(state.capturing);
        if (!state.capturing && mode === 'screen') {
          setIsScanning(false);
        }
      });
      if (stateHandle) handles.push(stateHandle);

      await checkStatus();
    };

    void setupListeners();

    const handleVisibilityOrFocus = () => {
      if (document.visibilityState === 'visible') {
        void checkStatus();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityOrFocus);
    window.addEventListener('focus', handleVisibilityOrFocus);

    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
      window.removeEventListener('focus', handleVisibilityOrFocus);
      handles.forEach((h) => {
        void h.remove();
      });
    };
  }, [isNativeScreen, mode]);

  useEffect(() => {
    if (!isNativeCamera) return;
    let disposed = false;
    const handles: Array<{ remove: () => Promise<void> }> = [];

    const setup = async () => {
      const codeHandle = await addNativeCameraCodeListener((event) => {
        if (disposed || !event?.data) return;
        nativeCameraActiveRef.current = false;
        setIsScanning(false);
        setTorchEnabled(false);
        setHasTorch(false);
        playScanSuccessSound();
        triggerHaptic([40, 30, 80]);
        onQrDetected(event.data, 'camera', mapNativeCodeFormat(event.format));
      });
      if (codeHandle) handles.push(codeHandle);

      const stateHandle = await addNativeCameraStateListener((state) => {
        if (disposed) return;
        if (!state.running) {
          nativeCameraActiveRef.current = false;
          setIsScanning(false);
          setTorchEnabled(Boolean(state.torchEnabled));
        }
      });
      if (stateHandle) handles.push(stateHandle);
    };

    void setup();

    const handleResume = () => {
      if (
        document.visibilityState === 'visible' &&
        mode === 'camera' &&
        !suspended &&
        !nativeCameraActiveRef.current
      ) {
        void startCamera();
      }
    };

    document.addEventListener('visibilitychange', handleResume);
    window.addEventListener('focus', handleResume);

    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', handleResume);
      window.removeEventListener('focus', handleResume);
      handles.forEach((h) => {
        void h.remove();
      });
    };
  }, [isNativeCamera, mode, onQrDetected, startCamera, suspended]);

  const isNativeCameraRendering = isNativeCamera && mode === 'camera' && isScanning && !suspended;

  useEffect(() => {
    document.documentElement.classList.toggle('native-camera-active', isNativeCameraRendering);
    return () => {
      document.documentElement.classList.remove('native-camera-active');
    };
  }, [isNativeCameraRendering]);

  useEffect(() => {
    if (!isNativeCameraRendering) return;

    const syncBounds = () => {
      void updateNativeCameraBounds({
        bounds: readViewportBounds(),
        viewportWidth: typeof window !== 'undefined' ? window.innerWidth : 360,
        backdropColor: computeCameraBackdropColor(theme),
      });
    };

    syncBounds();

    const observer =
      typeof ResizeObserver !== 'undefined' && viewportRef.current
        ? new ResizeObserver(syncBounds)
        : null;
    if (observer && viewportRef.current) {
      observer.observe(viewportRef.current);
    }

    window.addEventListener('resize', syncBounds);
    window.addEventListener('scroll', syncBounds, true);

    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', syncBounds);
      window.removeEventListener('scroll', syncBounds, true);
    };
  }, [isNativeCameraRendering, readViewportBounds, theme]);

  useEffect(() => {
    if (suspended) {
      stopCurrentStream();
      return () => {
        stopCurrentStream();
      };
    }

    if (mode === 'camera') {
      startCamera();
    } else if (mode === 'screen') {
      stopCurrentStream();
      setErrorMsg(null);
      if (pendingAutoScreenStartRef.current) {
        pendingAutoScreenStartRef.current = false;
        void startScreenCapture();
      }
    } else if (mode === 'file') {
      stopCurrentStream();
      setErrorMsg(null);
    }

    return () => {
      stopCurrentStream();
    };
  }, [mode, startCamera, startScreenCapture, stopCurrentStream, suspended]);

  useEffect(() => {
    if (!quickActionRequest) return;
    if (lastHandledQuickNonceRef.current === quickActionRequest.nonce) return;

    const targetMode = resolveScannerModeFromQuickAction(quickActionRequest.action);
    if (!targetMode) return;

    lastHandledQuickNonceRef.current = quickActionRequest.nonce;
    setErrorMsg(null);

    if (targetMode === 'camera') {
      pendingAutoScreenStartRef.current = false;
      if (mode === 'camera') {
        if (!isScanning && !suspended) {
          void startCamera();
        }
      } else {
        setMode('camera');
      }
    } else if (targetMode === 'screen') {
      const autoStart = shouldAutoStartScreenFromQuickAction(quickActionRequest.action);
      if (mode === 'screen') {
        pendingAutoScreenStartRef.current = false;
        if (autoStart && !isScanning) {
          void startScreenCapture();
        }
      } else {
        pendingAutoScreenStartRef.current = autoStart;
        setMode('screen');
      }
    }

    onQuickActionHandled?.(quickActionRequest.nonce);
  }, [isScanning, mode, onQuickActionHandled, quickActionRequest, startCamera, startScreenCapture, suspended]);

  const toggleTorch = async () => {
    playTapSound();
    triggerHaptic(15);
    const nextState = !torchEnabled;

    if (isNativeCamera && nativeCameraActiveRef.current) {
      try {
        const res = await setNativeCameraTorch(nextState);
        if (res && res.supported === false) {
          setHasTorch(false);
          setTorchEnabled(false);
          return;
        }
        setTorchEnabled(Boolean(res?.enabled));
      } catch (e) {
        console.warn('Native torch toggle failed:', e);
      }
      return;
    }

    if (!streamRef.current) return;
    const track = streamRef.current.getVideoTracks()[0];
    if (!track) return;

    try {
      await (track as unknown as { applyConstraints: (c: unknown) => Promise<void> }).applyConstraints({
        advanced: [{ torch: nextState }],
      });
      setTorchEnabled(nextState);
    } catch {
      try {
        await (track as unknown as { applyConstraints: (c: unknown) => Promise<void> }).applyConstraints({
          torch: nextState,
        });
        setTorchEnabled(nextState);
      } catch (e) {
        console.warn('Torch toggle failed:', e);
        if (!nextState) {
          // Workaround for WebView/Chromium drivers that turn torch on but ignore torch: false
          await startCamera();
        }
      }
    }
  };

  const flipCamera = () => {
    playTapSound();
    triggerHaptic(15);
    setTorchEnabled(false);
    setFacingMode((prev) => (prev === 'environment' ? 'user' : 'environment'));
  };

  const handleFileScan = async (file: File) => {
    playTapSound();
    setIsProcessingFile(true);
    setErrorMsg(null);
    try {
      const result = await scanImageFile(file);
      if (result && result.data) {
        playScanSuccessSound();
        triggerHaptic([40, 30, 80]);
        onQrDetected(result.data, 'file', result.format);
      } else {
        setErrorMsg(t.noCodeDetectedInImage);
      }
    } catch (err: any) {
      setErrorMsg(t.imageReadErrorPrefix + (err.message || ''));
    } finally {
      setIsProcessingFile(false);
    }
  };

  const handlePasteFromClipboard = async () => {
    playTapSound();
    setIsProcessingFile(true);
    setErrorMsg(null);
    try {
      const clipResult = await readClipboardImageFromDevice();
      if (!clipResult.supported) {
        setErrorMsg(t.clipboardUnsupported);
        return;
      }
      if (clipResult.permissionDenied) {
        setErrorMsg(t.clipboardPermissionDenied);
        return;
      }
      if (clipResult.file) {
        await handleFileScan(clipResult.file);
        return;
      }
      setErrorMsg(t.clipboardEmptyImage);
    } catch (err: any) {
      setErrorMsg(t.clipboardReadFailedPrefix + (err.message || ''));
    } finally {
      setIsProcessingFile(false);
    }
  };

  const handleTestSample = (sampleType: 'ticket' | 'loyalty' | 'wifi' | 'barcode') => {
    playTapSound();
    playScanSuccessSound();
    triggerHaptic();
    if (sampleType === 'barcode') {
      onQrDetected('4607004650932', 'file', 'EAN_13');
      return;
    }
    let text = '';
    if (sampleType === 'ticket') {
      text = 'TICKET:AEROFLOT:SU-1120:GATE-14B:SEAT-03A:CONF-992019';
    } else if (sampleType === 'loyalty') {
      text = 'LOYALTY:X5-CLUB:8839201948123019';
    } else {
      text = 'WIFI:S:Guest_Cafe_Free;T:WPA;P:CoffeeAndCake2026;;';
    }
    onQrDetected(text, 'file', 'QR_CODE');
  };

  return (
    <div className="flex flex-col h-full w-full max-w-xl mx-auto px-4 py-2 space-y-4">
      {/* Material You 3 Segmented Button for Mode Selection */}
      <div className="flex items-center p-1 rounded-full bg-[#1e1f23] border border-white/[0.04]">
        <button
          onClick={() => {
            playTapSound();
            setMode('camera');
          }}
          className={`flex-1 py-2 px-3 rounded-full text-xs font-semibold flex items-center justify-center gap-1.5 transition-all duration-200 ${
            mode === 'camera'
              ? isDark
                ? 'bg-[#394738] text-[#a8f09b] shadow-sm font-bold'
                : 'bg-[#e8f5e9] text-[#1b5e20] shadow-sm font-bold'
              : isDark
                ? 'text-[#8e918f] hover:text-[#e3e2e6]'
                : 'text-[#575a56] hover:text-[#191c19]'
          }`}
          aria-label={t.modeCamera}
        >
          {mode === 'camera' ? <Check className="w-3.5 h-3.5" /> : <Camera className="w-3.5 h-3.5" />}
          <span>{t.modeCamera}</span>
        </button>

        <button
          onClick={() => {
            playTapSound();
            setMode('screen');
          }}
          className={`flex-1 py-2 px-3 rounded-full text-xs font-semibold flex items-center justify-center gap-1.5 transition-all duration-200 ${
            mode === 'screen'
              ? isDark
                ? 'bg-[#394738] text-[#a8f09b] shadow-sm font-bold'
                : 'bg-[#e8f5e9] text-[#1b5e20] shadow-sm font-bold'
              : isDark
                ? 'text-[#8e918f] hover:text-[#e3e2e6]'
                : 'text-[#575a56] hover:text-[#191c19]'
          }`}
          aria-label={t.modeScreen}
        >
          {mode === 'screen' ? <Check className="w-3.5 h-3.5" /> : <Monitor className="w-3.5 h-3.5" />}
          <span>{t.modeScreen}</span>
        </button>

        <button
          onClick={() => {
            playTapSound();
            setMode('file');
          }}
          className={`flex-1 py-2 px-3 rounded-full text-xs font-semibold flex items-center justify-center gap-1.5 transition-all duration-200 ${
            mode === 'file'
              ? isDark
                ? 'bg-[#394738] text-[#a8f09b] shadow-sm font-bold'
                : 'bg-[#e8f5e9] text-[#1b5e20] shadow-sm font-bold'
              : isDark
                ? 'text-[#8e918f] hover:text-[#e3e2e6]'
                : 'text-[#575a56] hover:text-[#191c19]'
          }`}
          aria-label={t.modeScreenshot}
        >
          {mode === 'file' ? <Check className="w-3.5 h-3.5" /> : <ImageIcon className="w-3.5 h-3.5" />}
          <span>{t.modeScreenshot}</span>
        </button>
      </div>

      {/* Main Viewport Container */}
      <div
        ref={viewportRef}
        className="native-camera-viewport relative flex-1 min-h-[380px] sm:min-h-[430px] bg-[#1a1b1f] rounded-[28px] overflow-hidden border border-white/[0.04] shadow-xl flex flex-col items-center justify-center"
      >
        <video
          ref={videoRef}
          playsInline
          muted
          className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${
            isScanning && !isNativeCameraRendering ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
        />

        {/* --- CAMERA & DESKTOP ACTIVE SCREEN STREAM OVERLAY --- */}
        {isScanning && !(mode === 'screen' && isNativeScreen) && (
          <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-between p-4 sm:p-6 gap-3">
            <div className="px-4 py-1.5 rounded-full bg-[#121316]/80 backdrop-blur-md border border-white/15 flex items-center gap-2 text-xs font-semibold text-[#a8f09b] shadow-sm">
              <span className="w-2 h-2 rounded-full bg-[#a8f09b] animate-ping" />
              <span>
                {mode === 'camera' ? t.scanningCamera : t.scanningScreen}
              </span>
            </div>

            <div className="relative w-52 h-52 sm:w-64 sm:h-64 flex items-center justify-center">
              <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-[#a8f09b] rounded-tl-2xl" />
              <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-[#a8f09b] rounded-tr-2xl" />
              <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-[#a8f09b] rounded-bl-2xl" />
              <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-[#a8f09b] rounded-br-2xl" />

              <div className="w-full h-1 bg-gradient-to-r from-transparent via-[#a8f09b] to-transparent absolute shadow-[0_0_15px_#a8f09b] animate-pulse transition-all duration-75 top-1/2 -translate-y-1/2" />
            </div>

            <div className="pointer-events-auto flex items-center gap-3">
              {mode === 'camera' && (
                <>
                  {hasTorch && (
                    <button
                      type="button"
                      onClick={toggleTorch}
                      data-testid="torch-toggle-btn"
                      aria-label={torchEnabled ? t.torchTurnOff : t.torchTurnOn}
                      aria-pressed={torchEnabled}
                      title={torchEnabled ? t.torchTurnOff : t.torchTurnOn}
                      className={`w-12 h-12 rounded-full backdrop-blur-md flex items-center justify-center transition-all active:scale-95 shadow-lg ${
                        torchEnabled
                          ? 'bg-[#a8f09b] text-[#0b3810] ring-2 ring-[#a8f09b]/50'
                          : 'bg-[#121316]/75 text-white hover:bg-[#121316]/90 border border-white/20'
                      }`}
                    >
                      <Flashlight className="w-5 h-5" />
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={flipCamera}
                    className="w-12 h-12 rounded-full bg-[#121316]/75 backdrop-blur-md text-white hover:bg-[#121316]/90 active:rotate-180 flex items-center justify-center transition-all border border-white/20 shadow-lg"
                    aria-label={t.flipCameraLabel}
                    title={t.flipCameraLabel}
                  >
                    <RefreshCw className="w-5 h-5" />
                  </button>
                </>
              )}

              {mode === 'screen' && (
                <button
                  onClick={() => {
                    playTapSound();
                    stopCurrentStream();
                  }}
                  className="px-5 py-3 rounded-full bg-[#93000a] text-[#ffdad6] font-bold text-xs flex items-center gap-2 shadow-lg hover:brightness-110 active:scale-95 transition-all"
                >
                  <Square className="w-4 h-4 fill-[#ffdad6]" />
                  <span>{t.stopScreenCapture}</span>
                </button>
              )}
            </div>
          </div>
        )}

        {/* --- NATIVE ANDROID ACTIVE SCREEN CAPTURE STATE --- */}
        {mode === 'screen' && isScanning && isNativeScreen && (
          <div className="p-6 flex flex-col items-center text-center max-w-sm space-y-5">
            <div className="px-4 py-1.5 rounded-full bg-[#244927]/80 border border-[#a8f09b]/30 flex items-center gap-2 text-xs font-semibold text-[#a8f09b]">
              <span className="w-2.5 h-2.5 rounded-full bg-[#a8f09b] animate-ping" />
              <span>{t.scanningScreenNativeTitle}</span>
            </div>

            <div className="w-16 h-16 rounded-full bg-[#244927] text-[#a8f09b] flex items-center justify-center shadow-lg">
              <Monitor className="w-8 h-8 animate-pulse" />
            </div>

            <p className="text-xs text-[#c4c7c5] leading-relaxed">
              {t.scanningScreenNativeDesc}
            </p>

            <button
              onClick={() => {
                playTapSound();
                stopCurrentStream();
              }}
              className="w-full py-3.5 px-6 rounded-full bg-[#93000a] text-[#ffdad6] font-bold text-sm flex items-center justify-center gap-2 shadow-lg hover:brightness-110 active:scale-95 transition-all"
            >
              <Square className="w-4 h-4 fill-[#ffdad6]" />
              <span>{t.stopScreenCapture}</span>
            </button>
          </div>
        )}

        {/* --- SCREEN CAPTURE INACTIVE STATE --- */}
        {mode === 'screen' && !isScanning && (
          <div className="p-6 flex flex-col items-center text-center max-w-sm space-y-4">
            <div className={`w-16 h-16 rounded-full flex items-center justify-center shadow-md ${
              isDark ? 'bg-[#244927] text-[#a8f09b]' : 'bg-[#e8f5e9] text-[#2e6c31]'
            }`}>
              <Monitor className="w-8 h-8" />
            </div>

            <div className="space-y-1">
              <h3 className="font-bold text-lg text-[#e3e2e6]">
                {t.screenModeTitle}
              </h3>
              <p className="text-xs text-[#8e918f] leading-relaxed">
                {t.screenModeDesc}
              </p>
            </div>

            <button
              onClick={() => {
                playTapSound();
                startScreenCapture();
              }}
              className={`w-full py-3.5 px-6 rounded-full font-bold text-sm shadow-md flex items-center justify-center gap-2 transition-all active:scale-95 ${
                isDark
                  ? 'bg-[#a8f09b] hover:brightness-105 text-[#0b3810]'
                  : 'bg-[#2e6c31] hover:bg-[#255928] text-white'
              }`}
            >
              <Play className="w-4 h-4 fill-current" />
              <span>{isNativeScreen ? t.startScreenCaptureNative : t.startScreenCapture}</span>
            </button>

            <div className={`flex items-start gap-2.5 p-3 rounded-2xl text-xs text-left ${
              isDark ? 'bg-[#282a2f]/80 text-[#c4c7c5]' : 'bg-[#e8ece4] text-[#404943]'
            }`}>
              <HelpCircle className={`w-4 h-4 shrink-0 mt-0.5 ${isDark ? 'text-[#a8f09b]' : 'text-[#2e6c31]'}`} />
              <span>{isNativeScreen ? t.screenModeTipNative : t.screenModeTip}</span>
            </div>
          </div>
        )}

        {/* --- FILE / SCREENSHOT / CLIPBOARD MODE --- */}
        {mode === 'file' && (
          <div className="p-6 flex flex-col items-center text-center w-full max-w-md space-y-4">
            <div className={`w-16 h-16 rounded-full flex items-center justify-center shadow-md ${
              isDark ? 'bg-[#233549] text-[#a8c7fa]' : 'bg-[#dbeafe] text-[#1d4ed8]'
            }`}>
              <ImageIcon className="w-8 h-8" />
            </div>

            <div className="space-y-1">
              <h3 className="font-bold text-lg text-[#e3e2e6]">
                {t.screenshotTitle}
              </h3>
              <p className="text-xs text-[#8e918f] leading-relaxed">
                {t.screenshotDesc}
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full">
              <label className="py-3 px-4 rounded-2xl bg-[#282a2f] hover:bg-[#33353a] active:scale-95 text-[#e3e2e6] text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer transition-all shadow-sm">
                <Upload className={`w-4 h-4 ${isDark ? 'text-[#a8f09b]' : 'text-[#2e6c31]'}`} />
                <span>{t.chooseFromGallery}</span>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleFileScan(f);
                    e.target.value = '';
                  }}
                  className="hidden"
                />
              </label>

              <button
                onClick={handlePasteFromClipboard}
                disabled={isProcessingFile}
                className="py-3 px-4 rounded-2xl bg-[#282a2f] hover:bg-[#33353a] active:scale-95 text-[#e3e2e6] text-xs font-semibold flex items-center justify-center gap-2 transition-all shadow-sm"
              >
                <Clipboard className={`w-4 h-4 ${isDark ? 'text-[#d0bcff]' : 'text-[#6d28d9]'}`} />
                <span>{t.pasteScreenshot}</span>
              </button>
            </div>

            {isProcessingFile && (
              <div className={`flex items-center gap-2 text-xs py-1 font-medium animate-pulse ${isDark ? 'text-[#a8f09b]' : 'text-[#2e6c31]'}`}>
                <div className={`w-3.5 h-3.5 border-2 ${isDark ? 'border-[#a8f09b]' : 'border-[#2e6c31]'} border-t-transparent rounded-full animate-spin`} />
                <span>{t.analyzingImage}</span>
              </div>
            )}
          </div>
        )}

        {/* Camera fallback */}
        {mode === 'camera' && !isScanning && (
          <div className="p-6 flex flex-col items-center text-center max-w-sm space-y-3">
            <Camera className="w-12 h-12 text-[#8e918f] mb-2" />
            <p className="text-xs text-[#8e918f]">
              {t.cameraDisabled}
            </p>
            <button
              onClick={() => {
                playTapSound();
                startCamera();
              }}
              className={`py-2.5 px-6 rounded-full font-bold text-xs active:scale-95 transition-all shadow-sm ${
                isDark
                  ? 'bg-[#a8f09b] text-[#0b3810] hover:brightness-105'
                  : 'bg-[#2e6c31] text-white hover:bg-[#255928]'
              }`}
            >
              {t.enableCamera}
            </button>
          </div>
        )}
      </div>

      {/* Error alert */}
      {errorMsg && (
        <div className={`p-3.5 rounded-2xl text-xs flex items-start gap-2.5 border ${
          isDark
            ? 'bg-[#371e1d] text-[#ffdad6] border-[#ffb4ab]/20'
            : 'bg-[#fde8e8] text-[#690005] border-[#b3261e]/20'
        }`}>
          <AlertCircle className={`w-4 h-4 shrink-0 mt-0.5 ${isDark ? 'text-[#ffb4ab]' : 'text-[#b3261e]'}`} />
          <div className="flex-1 leading-relaxed">{errorMsg}</div>
        </div>
      )}

      {/* Demo Testing Quick Scan Chips (hidden unless demo mode is active) */}
      {demoMode && (
        <div className="bg-[#1e1f23] rounded-[24px] p-3.5 space-y-2 border border-white/[0.04]">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[#c4c7c5] flex items-center gap-1.5">
              <Sparkles className={`w-3.5 h-3.5 ${isDark ? 'text-[#a8f09b]' : 'text-[#2e6c31]'}`} />
              {t.quickScanTest}
            </span>
            <span className="text-[10px] text-[#8e918f]">
              {t.testWithoutCamera}
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <button
              onClick={() => handleTestSample('ticket')}
              className="py-2 px-2.5 rounded-full bg-[#282a2f] hover:bg-[#33353a] text-[#e3e2e6] text-[11px] font-semibold transition-all active:scale-95 text-center truncate border border-white/[0.04]"
            >
              {t.sampleTicket}
            </button>
            <button
              onClick={() => handleTestSample('loyalty')}
              className="py-2 px-2.5 rounded-full bg-[#282a2f] hover:bg-[#33353a] text-[#e3e2e6] text-[11px] font-semibold transition-all active:scale-95 text-center truncate border border-white/[0.04]"
            >
              {t.sampleLoyalty}
            </button>
            <button
              onClick={() => handleTestSample('wifi')}
              className="py-2 px-2.5 rounded-full bg-[#282a2f] hover:bg-[#33353a] text-[#e3e2e6] text-[11px] font-semibold transition-all active:scale-95 text-center truncate border border-white/[0.04]"
            >
              {t.sampleWifi}
            </button>
            <button
              onClick={() => handleTestSample('barcode')}
              className="py-2 px-2.5 rounded-full bg-[#282a2f] hover:bg-[#33353a] text-[#e3e2e6] text-[11px] font-semibold transition-all active:scale-95 text-center truncate border border-white/[0.04]"
            >
              {t.sampleBarcode}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
