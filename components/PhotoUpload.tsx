"use client";

import { useRef, useState, useTransition } from "react";
import { resizeImage } from "@/lib/resizeImage";

type Result = { error?: string } | void;

/**
 * Pick / take a photo, shrink it in the browser, and hand it to a server action.
 * `upload` receives FormData with "file" (and "aspect" = width / height).
 */
export function PhotoUpload({
  current,
  alt,
  upload,
  remove,
  canEdit,
  label = "photo",
  maxSide,
  aspectClass = "aspect-[4/3]",
}: {
  current: string | null;
  alt: string;
  upload: (fd: FormData) => Promise<Result>;
  remove: () => Promise<Result>;
  canEdit: boolean;
  label?: string;
  maxSide?: number;
  aspectClass?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const shown = preview ?? current;

  async function onFile(file?: File) {
    if (!file) return;
    setError(null);
    try {
      const { blob, width, height } = await resizeImage(file, maxSide);
      const local = URL.createObjectURL(blob);
      setPreview(local);
      const fd = new FormData();
      fd.append("file", new File([blob], "photo.webp", { type: blob.type }));
      fd.append("aspect", String(width / height));
      start(async () => {
        const r = await upload(fd);
        if (r && r.error) {
          setError(r.error);
          setPreview(null);
        }
      });
    } catch (e: any) {
      setError(e?.message ?? "Upload failed");
    } finally {
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="space-y-2">
      <div className={`relative overflow-hidden rounded-lg border border-stone-200 bg-stone-100 ${aspectClass}`}>
        {shown ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={shown} alt={alt} className={`h-full w-full object-cover transition-opacity ${pending ? "opacity-60" : ""}`} />
        ) : (
          <div className="grid h-full place-items-center p-4 text-center text-sm text-stone-500">No {label} yet</div>
        )}
        {pending && <div className="absolute inset-x-0 bottom-0 bg-stone-900/70 px-3 py-1.5 text-xs text-white">Uploading…</div>}
      </div>
      {error && <p className="text-sm text-red-700">{error}</p>}
      {canEdit && (
        <div className="flex flex-wrap gap-2">
          <input
            ref={input}
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            id={`photo-${alt.replace(/\W+/g, "-")}`}
            onChange={(e) => onFile(e.target.files?.[0])}
          />
          <label htmlFor={`photo-${alt.replace(/\W+/g, "-")}`} className="btn btn-sm cursor-pointer">
            {shown ? `Replace ${label}` : `Add ${label}`}
          </label>
          {current && (
            <button
              type="button"
              className="btn btn-sm btn-danger"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await remove();
                  if (r && r.error) setError(r.error);
                  else setPreview(null);
                })
              }
            >
              Remove
            </button>
          )}
        </div>
      )}
    </div>
  );
}
