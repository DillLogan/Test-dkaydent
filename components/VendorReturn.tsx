"use client";

import { useState } from "react";

export type ReturnInfo = {
  lotCode: string;
  product: string;
  sku: string;
  qtyReceived: string;
  cost: string;
  receivedOn: string;
  expiresOn: string;
  po: string | null;
  poLine: string | null;
  vendor: string | null;
  vendorEmail: string | null;
  contact: string | null;
};

/** Everything a vendor needs to credit or refund one received box, as text and as a pre-filled email. */
export function VendorReturn({ info }: { info: ReturnInfo }) {
  const [copied, setCopied] = useState(false);
  const lines = [
    `Lot / box code: ${info.lotCode}`,
    `Product: ${info.product} (${info.sku})`,
    info.po ? `Purchase order: ${info.po}` : null,
    info.poLine ? `Ordered: ${info.poLine}` : null,
    `Quantity received: ${info.qtyReceived}`,
    `Cost: ${info.cost}`,
    `Received: ${info.receivedOn}`,
    info.expiresOn ? `Expires: ${info.expiresOn}` : null,
  ].filter(Boolean) as string[];
  const subject = `Return / credit request${info.po ? ` for ${info.po}` : ""}: ${info.product} (lot ${info.lotCode})`;
  const body = `Hello${info.contact ? " " + info.contact : ""},\n\nWe would like to return the box below and ask for a credit or refund.\n\n${lines.join("\n")}\n\nReason: \n\nPlease let us know how you would like it returned and send the credit memo or refund confirmation.\n\nThank you`;
  const mailto = `mailto:${encodeURIComponent(info.vendorEmail ?? "")}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

  return (
    <div className="space-y-3" data-testid="vendor-return">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-stone-500">Vendor</dt>
        <dd>{info.vendor ?? "— (not received against a purchase order)"}{info.contact ? ` · ${info.contact}` : ""}</dd>
        <dt className="text-stone-500">Vendor email</dt>
        <dd>{info.vendorEmail ?? <span className="text-amber-700">None on file. Add one on the vendor.</span>}</dd>
        {lines.map((l) => {
          const [k, ...v] = l.split(": ");
          return (
            <div key={l} className="contents">
              <dt className="text-stone-500">{k}</dt>
              <dd>{v.join(": ")}</dd>
            </div>
          );
        })}
      </dl>
      <div className="flex flex-wrap gap-2">
        <a href={mailto} className="btn btn-primary">
          Email vendor
        </a>
        <button
          type="button"
          className="btn"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(`${subject}\n\n${lines.join("\n")}`);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            } catch {}
          }}
        >
          {copied ? "Copied" : "Copy details"}
        </button>
      </div>
      <p className="text-xs text-stone-500">Opens a draft in your mail app. Add the reason before you send.</p>
    </div>
  );
}
