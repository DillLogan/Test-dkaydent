import Link from "next/link";

export function PageHeader({
  title,
  subtitle,
  back,
  children,
  corner,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  back?: { href: string; label: string };
  children?: React.ReactNode;
  /** Shown in the top-right corner, above the actions */
  corner?: React.ReactNode;
}) {
  return (
    <div className="mb-8">
      {back && (
        <Link href={back.href} className="mb-3 inline-block text-sm text-stone-500 transition-colors hover:text-brand-700 print:hidden">
          ← {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className={corner ? "min-w-0 flex-1 basis-80" : undefined}>
          <h1 className="text-[2rem] leading-tight text-stone-900">{title}</h1>
          {subtitle && <div className="mt-1.5 text-[15px] text-stone-500">{subtitle}</div>}
        </div>
        {corner ? (
          <div className="ml-auto flex flex-col items-end gap-3">
            {corner}
            {children && <div className="flex flex-wrap justify-end gap-2 print:hidden">{children}</div>}
          </div>
        ) : (
          children && <div className="flex flex-wrap gap-2 print:hidden">{children}</div>
        )}
      </div>
    </div>
  );
}

export function ErrorBanner({ error }: { error?: string | null }) {
  if (!error) return null;
  return (
    <div role="alert" className="settle-in mb-5 rounded-2xl border border-red-200 bg-red-50 px-5 py-3.5 text-sm text-red-800">
      {error}
    </div>
  );
}

export function Notice({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <div role="status" className="settle-in mb-5 rounded-2xl border border-brand-100 bg-brand-50 px-5 py-3.5 text-sm text-brand-800">{message}</div>
  );
}

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-stone-100 text-stone-700",
  ordered: "bg-blue-50 text-blue-700",
  partially_received: "bg-amber-50 text-amber-800",
  received: "bg-brand-50 text-brand-700",
  confirmed: "bg-blue-50 text-blue-700",
  fulfilled: "bg-amber-50 text-amber-800",
  completed: "bg-brand-50 text-brand-700",
  invoiced: "bg-violet-50 text-violet-700",
  open: "bg-amber-50 text-amber-800",
  overdue: "bg-red-50 text-red-700",
  paid: "bg-brand-50 text-brand-700",
  void: "bg-stone-100 text-stone-500",
  cancelled: "bg-stone-100 text-stone-500",
  applied: "bg-brand-50 text-brand-700",
  refunded: "bg-blue-50 text-blue-700",
  inactive: "bg-stone-100 text-stone-500",
  planned: "bg-stone-100 text-stone-700",
  in_transit: "bg-blue-50 text-blue-700",
  arrived: "bg-amber-50 text-amber-800",
};

/** Order steps use the shop's own words. */
export const STATUS_LABELS: Record<string, string> = {
  confirmed: "Ready to pull",
  fulfilled: "Pulled",
  completed: "Completed",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap first-letter:uppercase ${
        STATUS_STYLES[status] ?? "bg-stone-100 text-stone-700"
      }`}
    >
      {STATUS_LABELS[status] ?? status.replace(/_/g, " ")}
    </span>
  );
}

export function Section({
  title,
  actions,
  children,
  className = "",
}: {
  title: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`mb-10 ${className}`}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl text-stone-900">{title}</h2>
        {actions && <div className="flex gap-2 print:hidden">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

export function Stat({
  label,
  value,
  hint,
  href,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  href?: string;
  tone?: "warn" | "bad";
}) {
  const color = tone === "bad" ? "text-red-700" : tone === "warn" ? "text-amber-700" : "text-stone-900";
  const body = (
    <>
      <div className="text-sm text-stone-500">{label}</div>
      <div className={`font-display mt-1 text-[2rem] leading-tight tabular-nums ${color}`}>{value}</div>
      {hint && <div className="mt-1 text-xs text-stone-500">{hint}</div>}
    </>
  );
  return href ? (
    <Link href={href} className="lift card block hover:border-brand-500">
      {body}
    </Link>
  ) : (
    <div className="card">{body}</div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-stone-300 bg-white/60 px-6 py-10 text-center text-[15px] text-stone-500">
      {children}
    </div>
  );
}

export function Field({
  label,
  children,
  className = "",
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="label">{label}</span>
      {children}
    </label>
  );
}

/** Tabs driven by a search param. */
export function Tabs({ items, current }: { items: { href: string; label: string; key: string }[]; current: string }) {
  return (
    <div className="mb-4 flex gap-1.5 overflow-x-auto pb-1">
      {items.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          aria-current={t.key === current ? "page" : undefined}
          className={`rounded-full px-4 py-1.5 text-sm whitespace-nowrap transition-colors duration-200 ${
            t.key === current
              ? "bg-brand-700 font-medium text-white"
              : "bg-white text-stone-600 ring-1 ring-stone-200 hover:text-stone-900 hover:ring-stone-300"
          }`}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}

export function ExpiryText({ days }: { days: number | null }) {
  if (days === null || days === undefined) return <span className="text-stone-400">—</span>;
  if (days < 0) return <span className="font-medium text-red-700">Expired {Math.abs(days)}d ago</span>;
  if (days === 0) return <span className="font-medium text-red-700">Today</span>;
  if (days <= 3) return <span className="font-medium text-amber-700">{days}d</span>;
  return <span>{days}d</span>;
}
