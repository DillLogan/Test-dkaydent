"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type Group = { title: string; links: { href: string; label: string }[] };

/** Sidebar links; the current section is highlighted. */
export function NavLinks({ groups }: { groups: Group[] }) {
  const path = usePathname() || "/";
  const all = groups.flatMap((g) => g.links.map((l) => l.href));
  // the longest matching link wins, so /inventory/locations doesn't also light up Inventory
  const active = all
    .filter((h) => (h === "/" ? path === "/" : path === h || path.startsWith(h + "/")))
    .sort((a, b) => b.length - a.length)[0];
  return (
    <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:block md:flex-1 md:overflow-y-auto md:pb-5">
      {groups.map((g) => (
        <div key={g.title || "home"} className="contents md:mb-5 md:block">
          {g.title && <div className="hidden px-3 pb-1.5 text-xs font-medium text-stone-400 md:block">{g.title}</div>}
          {g.links.map((l) => {
            const on = l.href === active;
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-current={on ? "page" : undefined}
                className={`nav-link block shrink-0 rounded-full px-3 py-1.5 text-sm whitespace-nowrap ${
                  on ? "bg-brand-50 font-medium text-brand-800" : "text-stone-600 hover:bg-stone-100 hover:text-stone-900"
                }`}
              >
                {l.label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
