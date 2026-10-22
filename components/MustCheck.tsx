/** Red MUST CHECK stamp with room for a signature, for the top-right corner of an order. */
export function MustCheck({ className = "" }: { className?: string }) {
  return (
    <div
      data-testid="must-check"
      className={`w-60 shrink-0 rounded-md border-[3px] border-[#dc2626] bg-[#ffffff] px-3 pt-2 pb-2 text-[#dc2626] [print-color-adjust:exact] ${className}`}
      role="note"
      aria-label="MUST CHECK, signature required"
    >
      <div className="text-center text-2xl leading-none font-black tracking-wider">MUST CHECK</div>
      <div className="h-12" aria-hidden="true" />
      <div className="border-t-2 border-[#dc2626]" aria-hidden="true" />
      <div className="mt-0.5 text-[11px] font-semibold tracking-wide uppercase">Signature</div>
    </div>
  );
}
