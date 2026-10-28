"use client";

import { useEffect, useState } from "react";
import { readPrintSettings } from "@/lib/printSettings";

export function PrintButton() {
  const [printer, setPrinter] = useState("");
  useEffect(() => setPrinter(readPrintSettings().regularPrinter), []);
  return (
    <button type="button" className="btn" onClick={() => window.print()} title={printer ? `Choose “${printer}” in the print dialog` : undefined}>
      Print / PDF{printer ? ` · ${printer}` : ""}
    </button>
  );
}
