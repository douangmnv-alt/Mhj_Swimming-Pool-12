/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, X, AlertTriangle, RefreshCw } from "lucide-react";

type Html5QrcodeModule = typeof import("html5-qrcode");
type Html5QrcodeClass = Html5QrcodeModule["Html5Qrcode"];
type Html5QrcodeInstance = InstanceType<Html5QrcodeClass>;

interface CameraScannerProps {
  onScan: (barcode: string) => void;
  onClose: () => void;
  title?: string;
}

export default function CameraScanner({ onScan, onClose, title = "Scan Barcode / QR Code" }: CameraScannerProps) {
  const [error, setError] = useState<string | null>(null);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState<string>("");
  const [isInitializing, setIsInitializing] = useState(true);
  const [cameraLoadToken, setCameraLoadToken] = useState(0);
  const [restartToken, setRestartToken] = useState(0);
  
  const scannerRef = useRef<Html5QrcodeInstance | null>(null);
  const html5QrcodeModuleRef = useRef<Html5QrcodeModule | null>(null);
  const onScanRef = useRef(onScan);
  const lastScanRef = useRef<{ text: string; at: number }>({ text: "", at: 0 });
  const regionIdRef = useRef(`web-barcode-scanner-viewport-${Math.random().toString(36).slice(2)}`);
  const regionId = regionIdRef.current;

  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  const loadHtml5Qrcode = useCallback(async () => {
    if (!html5QrcodeModuleRef.current) {
      html5QrcodeModuleRef.current = await import("html5-qrcode");
    }
    return html5QrcodeModuleRef.current;
  }, []);

  const getSupportedFormats = (module: Html5QrcodeModule) => {
    const formats = module.Html5QrcodeSupportedFormats;
    return [
      formats.QR_CODE,
      formats.EAN_13,
      formats.EAN_8,
      formats.UPC_A,
      formats.UPC_E,
      formats.CODE_128,
      formats.CODE_39,
      formats.ITF
    ];
  };

  const stopScanner = useCallback(async () => {
    const scanner = scannerRef.current;
    if (!scanner) return;

    try {
      if (scanner.isScanning) {
        await scanner.stop();
      }
    } catch (err) {
      console.warn("Scanner stop ignored", err);
    }

    try {
      await (scanner as any).clear?.();
    } catch (err) {
      console.warn("Scanner clear ignored", err);
    }

    if (scannerRef.current === scanner) {
      scannerRef.current = null;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadCameras = async () => {
      try {
        setIsInitializing(true);
        setError(null);

        const module = await loadHtml5Qrcode();
        const devices = await module.Html5Qrcode.getCameras();
        if (cancelled) return;
        if (devices && devices.length > 0) {
          setCameras(devices);
          const backCam = devices.find(device =>
            device.label.toLowerCase().includes("back") ||
            device.label.toLowerCase().includes("environment") ||
            device.label.toLowerCase().includes("rear")
          );
          setSelectedCameraId(backCam ? backCam.id : devices[0].id);
        } else {
          setError("No cameras found. Please verify permissions or connect a camera.");
          setIsInitializing(false);
        }
      } catch (err) {
        if (cancelled) return;
        console.error("Failed to get cameras", err);
        setError("Camera access permission denied or blocked. Please allow camera access in your browser settings.");
        setIsInitializing(false);
      }
    };

    loadCameras();

    return () => {
      cancelled = true;
      void stopScanner();
    };
  }, [cameraLoadToken, loadHtml5Qrcode, stopScanner]);

  useEffect(() => {
    if (!selectedCameraId) return;

    let cancelled = false;
    setIsInitializing(true);
    setError(null);

    const startScanner = async () => {
      try {
        await stopScanner();
        if (cancelled) return;

        const module = await loadHtml5Qrcode();
        if (cancelled) return;

        const html5QrCode = new module.Html5Qrcode(regionId, {
          verbose: false,
          formatsToSupport: getSupportedFormats(module),
          useBarCodeDetectorIfSupported: true
        } as any);
        scannerRef.current = html5QrCode;

        const scanWidth = Math.min(320, Math.max(240, window.innerWidth - 64));
        const scanHeight = Math.min(190, Math.round(scanWidth * 0.58));

        await html5QrCode.start(
          selectedCameraId,
          {
            fps: 12,
            qrbox: { width: scanWidth, height: scanHeight },
            aspectRatio: 1.333333,
            disableFlip: false
          } as any,
          (decodedText) => {
            const code = decodedText.trim();
            const now = Date.now();
            if (!code || (lastScanRef.current.text === code && now - lastScanRef.current.at < 1400)) return;

            lastScanRef.current = { text: code, at: now };
            onScanRef.current(code);

            try {
              const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
              const osc = audioCtx.createOscillator();
              osc.type = "sine";
              osc.frequency.setValueAtTime(1000, audioCtx.currentTime);
              osc.connect(audioCtx.destination);
              osc.start();
              osc.stop(audioCtx.currentTime + 0.08);
            } catch (e) {}
          },
          () => {
            // Decode misses are expected between frames.
          }
        );

        if (!cancelled) {
          setIsInitializing(false);
        }
      } catch (err: any) {
        if (cancelled) return;
        console.error("Failed to start scanner", err);
        setError(`Failed to initialize camera stream: ${err.message || err}`);
        setIsInitializing(false);
      }
    };

    startScanner();

    return () => {
      cancelled = true;
      void stopScanner();
    };
  }, [selectedCameraId, restartToken, loadHtml5Qrcode, stopScanner]);

  const toggleCamera = () => {
    if (cameras.length <= 1) return;
    const currentIndex = cameras.findIndex(c => c.id === selectedCameraId);
    const nextIndex = (currentIndex + 1) % cameras.length;
    setSelectedCameraId(cameras[nextIndex].id);
  };

  const handleClose = () => {
    void stopScanner().finally(onClose);
  };

  const handleRetry = () => {
    setError(null);
    setIsInitializing(true);
    if (selectedCameraId) {
      setRestartToken(token => token + 1);
    } else {
      setCameraLoadToken(token => token + 1);
    }
  };

  return (
    <div id="camera-scanner-overlay" className="fixed inset-0 z-50 bg-slate-950/80 flex items-center justify-center p-4 backdrop-blur-sm animate-fade-in">
      <div id="camera-scanner-modal" className="bg-slate-900 border border-slate-800 text-white rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl flex flex-col">
        {/* Header */}
        <div id="camera-scanner-header" className="p-4 border-b border-slate-800 flex items-center justify-between">
          <div id="camera-scanner-title-wrapper" className="flex items-center gap-2">
            <Camera id="camera-scanner-title-icon" className="w-5 h-5 text-blue-400" />
            <h3 id="camera-scanner-title" className="font-semibold text-slate-100">{title}</h3>
          </div>
          <button
            id="camera-scanner-close-btn"
            aria-label="Close scanner"
            title="Close scanner"
            onClick={handleClose}
            className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Camera Feed Container */}
        <div id="camera-scanner-body" className="relative bg-black flex-1 flex flex-col items-center justify-center min-h-[320px] max-h-[450px]">
          {/* Viewport element for html5-qrcode */}
          <div id={regionId} className="w-full h-full max-h-[380px] object-cover" />

          {/* Overlay scanning frame (matching Android's visual) */}
          {!error && !isInitializing && (
            <div id="camera-scanner-laser-overlay" className="absolute inset-0 pointer-events-none flex items-center justify-center">
              <div id="camera-scanner-guide-box" className="w-[260px] h-[150px] border-2 border-blue-500 rounded-xl relative overflow-hidden flex items-center">
                {/* Horizontal scanning laser animation */}
                <div id="camera-scanner-laser-line" className="w-full h-[2px] bg-blue-400 shadow-[0_0_8px_rgba(59,130,246,0.8)] absolute left-0 top-0 animate-[scan_2s_infinite_ease-in-out]" />
                
                {/* Corner Accents */}
                <span className="absolute top-0 left-0 w-4 h-4 border-t-2 border-l-2 border-blue-400 -mt-[1px] -ml-[1px]" />
                <span className="absolute top-0 right-0 w-4 h-4 border-t-2 border-r-2 border-blue-400 -mt-[1px] -mr-[1px]" />
                <span className="absolute bottom-0 left-0 w-4 h-4 border-b-2 border-l-2 border-blue-400 -mb-[1px] -ml-[1px]" />
                <span className="absolute bottom-0 right-0 w-4 h-4 border-b-2 border-r-2 border-blue-400 -mb-[1px] -mr-[1px]" />
              </div>
            </div>
          )}

          {/* Loading or Connecting State */}
          {isInitializing && !error && (
            <div id="camera-scanner-loading-state" className="absolute inset-0 bg-slate-950/90 flex flex-col items-center justify-center gap-3 text-slate-300">
              <RefreshCw className="w-8 h-8 text-blue-400 animate-spin" />
              <p className="text-sm font-medium">Connecting camera stream...</p>
            </div>
          )}

          {/* Error State */}
          {error && (
            <div id="camera-scanner-error-state" className="absolute inset-0 bg-slate-950 flex flex-col items-center justify-center p-6 text-center gap-3">
              <AlertTriangle className="w-10 h-10 text-rose-500" />
              <p className="text-sm font-medium text-slate-200">{error}</p>
              <button
                id="camera-scanner-retry-btn"
                aria-label="Retry camera stream connection"
                title="Retry camera stream connection"
                onClick={handleRetry}
                className="mt-2 px-4 py-2 bg-slate-850 hover:bg-slate-800 rounded-lg text-xs font-semibold border border-slate-700 transition-colors"
              >
                Retry Stream Connection
              </button>
            </div>
          )}
        </div>

        {/* Controls / Footer */}
        <div id="camera-scanner-footer" className="p-4 border-t border-slate-800 bg-slate-950 flex flex-col gap-2 items-center text-center">
          <p id="camera-scanner-supported" className="text-xs text-slate-400">
            Supports EAN-13, UPC-A, Code128, QR Code, and more
          </p>
          
          {cameras.length > 1 && (
            <button
              id="camera-scanner-switch-camera"
              aria-label="Switch camera"
              title="Switch camera"
              onClick={toggleCamera}
              className="mt-1 flex items-center gap-2 px-3 py-1.5 bg-slate-850 hover:bg-slate-800 rounded-full text-xs font-medium border border-slate-700 text-slate-200 transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Switch Camera
            </button>
          )}
        </div>
      </div>
      
      {/* Laser scan animation styles */}
      <style>{`
        @keyframes scan {
          0% { top: 0%; }
          50% { top: 100%; }
          100% { top: 0%; }
        }
      `}</style>
    </div>
  );
}
