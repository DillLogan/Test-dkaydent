import { toSVG } from "bwip-js/node";

/** Code 128 barcode as an SVG string sized by CSS, or null if the value can't be encoded. */
export function barcodeSvg(value: string): string | null {
  try {
    const svg = toSVG({ bcid: "code128", text: value, height: 12, includetext: false, paddingwidth: 4, paddingheight: 0 });
    return svg.replace("<svg ", '<svg preserveAspectRatio="none" width="100%" height="100%" ');
  } catch {
    return null;
  }
}

/** Code 128 barcode rendered to inline SVG on the server. */
export function Barcode({ value, className = "" }: { value: string; className?: string }) {
  const svg = barcodeSvg(value);
  if (!svg) return <span className="text-xs text-red-700">Can&apos;t encode “{value}”</span>;
  return <span className={`block ${className}`} aria-label={`Barcode ${value}`} dangerouslySetInnerHTML={{ __html: svg }} />;
}
