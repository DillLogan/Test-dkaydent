"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Barcode entry that works three ways:
 * - USB / Bluetooth scanners (they type the code and press Enter)
 * - Typing a code by hand
 * - The device camera (ZXing; works on iPhone and Android browsers)
 */
export function ScanInput({
  onCode,
  placeholder = "Scan or type a code, then Enter",
  autoFocus,
  label = "Scan",
}: {
  onCode: (code: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  label?: string;
}) {
  const [value, setValue] = useState("");
  const [cameraOn, setCameraOn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const stopRef = useRef<(() => void) | null>(null);
  const lastRef = useRef<{ code: string; at: number }>({ code: "", at: 0 });

  const emit = (raw: string) => {
    const code = raw.trim();
    if (!code) return;
    // Ignore the same code read twice within 1.5s by the camera
    const now = Date.now();
    if (code === lastRef.current.code && now - lastRef.current.at < 1500) return;
    lastRef.current = { code, at: now };
    onCode(code);
  };

  useEffect(() => {
    if (!cameraOn) return;
    let cancelled = false;
    (async () => {
      try {
        const { BrowserMultiFormatReader } = await import("@zxing/browser");
        const reader = new BrowserMultiFormatReader();
        if (cancelled || !videoRef.current) return;
        const controls = await reader.decodeFromConstraints(
          { video: { facingMode: { ideal: "environment" } } },
          videoRef.current,
          (result) => {
            if (result) {
              if ("vibrate" in navigator) navigator.vibrate?.(60);
              emit(result.getText());
            }
          },
        );
        stopRef.current = () => controls.stop();
        if (cancelled) controls.stop();
      } catch (e: any) {
        setError(
          e?.name === "NotAllowedError"
            ? "Camera permission was denied. Allow camera access for this site, or use a scanner / type the code."
            : "Couldn't start the camera on this device. Use a scanner or type the code.",
        );
        setCameraOn(false);
      }
    })();
    return () => {
      cancelled = true;
      stopRef.current?.();
      stopRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraOn]);

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input
          className="input font-mono"
          value={value}
          autoFocus={autoFocus}
          placeholder={placeholder}
          aria-label={label}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              emit(value);
              setValue("");
            }
          }}
        />
        <button
          type="button"
          className="btn"
          onClick={() => {
            emit(value);
            setValue("");
          }}
        >
          Go
        </button>
        <button
          type="button"
          className={`btn ${cameraOn ? "btn-primary" : ""}`}
          onClick={() => {
            setError(null);
            setCameraOn((on) => !on);
          }}
        >
          {cameraOn ? "Stop camera" : "Camera"}
        </button>
      </div>
      {error && <p className="text-sm text-red-700">{error}</p>}
      {cameraOn && (
        <div className="relative overflow-hidden rounded-lg bg-black">
          <video ref={videoRef} className="aspect-video w-full object-cover" muted playsInline />
          <div className="pointer-events-none absolute inset-x-8 top-1/2 h-0.5 -translate-y-1/2 bg-red-500/80" />
        </div>
      )}
    </div>
  );
}
