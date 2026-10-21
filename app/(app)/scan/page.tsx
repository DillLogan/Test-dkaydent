import { getSession } from "@/lib/auth";
import { ScanRouter } from "@/components/ScanRouter";
import { ErrorBanner, PageHeader } from "@/components/ui";

type SP = Promise<Record<string, string | undefined>>;

export default async function ScanPage({ searchParams }: { searchParams: SP }) {
  const { error } = await searchParams;
  await getSession();
  return (
    <>
      <PageHeader title="Scan" subtitle="Scan a lot label to move, write off or count it. Scan a SKU, PO, order or invoice number to open it." />
      <ErrorBanner error={error} />
      <div className="card max-w-xl space-y-4">
        <ScanRouter />
        <ul className="list-disc space-y-1 pl-5 text-sm text-stone-600">
          <li>
            <strong>Handheld scanner</strong> (USB or Bluetooth): click the box and scan. It types the code and presses Enter.
          </li>
          <li>
            <strong>Phone or tablet:</strong> tap <em>Camera</em> and point at the label. The browser will ask for camera permission once.
          </li>
          <li>To fill an order from specific lots, open the order and use <em>Hand-pick lots / scan to pick</em>.</li>
        </ul>
      </div>
    </>
  );
}
