"use client";

import { useEffect, useState } from "react";
import { TemplateDesigner } from "@/components/pdf/TemplateDesigner";
import { renderDoc, renderLabels } from "@/lib/pdfdocs/render";
import type { DocType, Template } from "@/lib/pdfdocs/types";
import { readPrintSettings } from "@/lib/printSettings";
import { resetPdfTemplate, savePdfTemplate } from "./actions";

export function PrintoutDesigner({ initial, defaults, business }: { initial: Record<DocType, Template>; defaults: Record<DocType, Template>; business: { name: string; address: string; phone: string; footer: string } }) {
  const [size, setSize] = useState<{ w: number; h: number } | undefined>();
  useEffect(() => {
    const s = readPrintSettings();
    setSize({ w: s.w, h: s.h });
  }, []);
  return (
    <TemplateDesigner
      initial={initial}
      defaults={defaults}
      business={business}
      labelSize={size}
      onSave={savePdfTemplate}
      onReset={resetPdfTemplate}
      build={(t, sample) => (t.doc === "label" || t.doc === "boxlabel" ? renderLabels(t, [sample.fields], { mode: "label", w: size?.w ?? t.page.w / 72, h: size?.h ?? t.page.h / 72, paper: "letter" }) : renderDoc(t, sample))}
    />
  );
}
