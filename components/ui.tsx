import Link from "next/link";

export function PageHeader({
  title,
  subtitle,
  back,
  children,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  back?: { href: string; label: string };
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-6">
      {back && (
        <Link href={back.href} className="mb-2 inline-block text-sm text-stone-500 hover:text-stone-800 print:hidden">
          ← {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {subtitle && <div className="mt-1 text-sm text-stone-500">{subtitle}</div>}
        </div>
        {children && <div className="flex flex-wrap gap-2 print:hidden">{children}</div>}
      </div>
    </div>
  );
}

export function ErrorBanner({ error }: { error?: string | null }) {
  if (!error) return null;
  return (
    <div role="alert" className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
      {error}
    </div>
  );
}

export function Notice({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <div className="mb-4 rounded-md border border-brand-100 bg-brand-50 px-4 py-3 text-sm text-brand-800">{message}</div>
  );
}

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-stone-100 text-stone-700",
  ordered: "bg-blue-50 text-blue-700",
  partially_received: "bg-amber-50 text-amber-800",
  received: "bg-brand-50 text-brand-700",
  confirmed: "bg-blue-50 text-blue-700",
  fulfilled: "bg-brand-50 text-brand-700",
  invoiced: "bg-violet-50 text-violet-700",
  open: "bg-amber-50 text-amber-800",
  overdue: "bg-red-50 text-red-700",
  paid: "bg-brand-50 text-brand-700",
  void: "bg-stone-100 text-stone-500",
  cancelled: "bg-stone-100 text-stone-500",
  applied: "bg-brand-50 text-brand-700",
  refunded: "bg-blue-50 text-blue-700",
  inactive: "bg-stone-100 text-stone-500",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap capitalize ${
        STATUS_STYLES[status] ?? "bg-stone-100 text-stone-700"
      }`}
    >
      {status.replace(/_/g, " ")}
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
    <section className={`mb-8 ${className}`}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{title}</h2>
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
      <div className="text-xs font-medium tracking-wide text-stone-500 uppercase">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${color}`}>{value}</div>
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
    <div className="rounded-lg border border-dashed border-stone-300 bg-white px-4 py-8 text-center text-sm text-stone-500">
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
    <div className="mb-4 flex gap-1 overflow-x-auto border-b border-stone-200">
      {items.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          className={`-mb-px border-b-2 px-3 py-2 text-sm whitespace-nowrap ${
            t.key === current
              ? "border-brand-700 font-medium text-brand-800"
              : "border-transparent text-stone-500 hover:text-stone-800"
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
