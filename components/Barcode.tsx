import { toSVG } from "bwip-js/node";

/** Code 128 barcode rendered to inline SVG on the server. */
export function Barcode({ value, className = "" }: { value: string; className?: string }) {
  let svg = "";
  try {
    svg = toSVG({ bcid: "code128", text: value, height: 12, includetext: false, paddingwidth: 4, paddingheight: 0 });
  } catch {
    return <span className="text-xs text-red-700">Can&apos;t encode “{value}”</span>;
  }
  // Let CSS control the size
  svg = svg.replace("<svg ", '<svg preserveAspectRatio="none" width="100%" height="100%" ');
  return <span className={`block ${className}`} aria-label={`Barcode ${value}`} dangerouslySetInnerHTML={{ __html: svg }} />;
}
