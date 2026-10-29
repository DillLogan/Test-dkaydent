"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { setViewMode } from "@/lib/viewMode";

export type TabIcon = "home" | "shop" | "cart" | "user" | "messages" | "orders" | "inventory" | "scan" | "counter" | "routing" | "purchasing" | "receiving";
export type Tab = { href: string; label: string; icon: TabIcon; badge?: number };

const PATHS: Record<TabIcon | "menu", React.ReactNode> = {
  home: <path d="M3 10.5 12 3l9 7.5M5 9v11h5v-6h4v6h5V9" />,
  shop: (
    <>
      <path d="M4 7h16l-1.5 12.5a1 1 0 0 1-1 .9H6.5a1 1 0 0 1-1-.9L4 7Z" />
      <path d="M8.5 9.5V6a3.5 3.5 0 0 1 7 0v3.5" />
    </>
  ),
  cart: (
    <>
      <circle cx="9" cy="20" r="1.5" />
      <circle cx="18" cy="20" r="1.5" />
      <path d="M2 3h3l2.5 12.5a1 1 0 0 0 1 .8h9.7a1 1 0 0 0 1-.8L21 7H6" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </>
  ),
  messages: <path d="M4 5h16v11H9l-5 4V5Z" />,
  orders: (
    <>
      <path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z" />
      <path d="M9 8h6M9 12h6" />
    </>
  ),
  inventory: (
    <>
      <path d="M3 8 12 3l9 5v8l-9 5-9-5V8Z" />
      <path d="m3 8 9 5 9-5M12 13v8" />
    </>
  ),
  scan: <path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M8 9v6M11 9v6M14 9v6M17 9v6" />,
  counter: (
    <>
      <rect x="3" y="10" width="18" height="10" rx="1.5" />
      <path d="M7 10V5h10v5M7 14h2M11 14h2M15 14h2" />
    </>
  ),
  routing: (
    <>
      <path d="M2 6h11v10H2zM13 9h4l4 4v3h-8" />
      <circle cx="6" cy="18" r="2" />
      <circle cx="17" cy="18" r="2" />
    </>
  ),
  purchasing: (
    <>
      <rect x="5" y="4" width="14" height="17" rx="1.5" />
      <path d="M9 3h6v3H9zM9 11h6M9 15h4" />
    </>
  ),
  receiving: (
    <>
      <path d="M3 7l9-4 9 4v10l-9 4-9-4V7Z" />
      <path d="M12 8v7m-3-3 3 3 3-3" />
    </>
  ),
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
};

export function TabIconSvg({ name }: { name: TabIcon | "menu" }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {PATHS[name]}
    </svg>
  );
}

/** Amazon-app style tabs along the bottom, only in Mobile mode. Menu opens the full menu. */
export function TabBar({ tabs, active, menuOpen, onMenu }: { tabs: Tab[]; active: string | undefined; menuOpen: boolean; onMenu: () => void }) {
  const isOn = (href: string) => !menuOpen && (href === "/" ? active === "/" : active === href || (active ?? "").startsWith(href + "/"));
  return (
    <nav className="tabbar border-t border-stone-200 bg-white/95 text-stone-600 backdrop-blur print:hidden" aria-label="Tabs" style={{ ["--tabs" as string]: tabs.length + 1 }}>
      {tabs.map((t) => (
        <Link key={t.href} href={t.href} className={`tab ${isOn(t.href) ? "tab-on text-brand-700" : ""}`} aria-current={isOn(t.href) ? "page" : undefined}>
          <span className="tab-ic">
            <TabIconSvg name={t.icon} />
            {t.badge ? <span className="tab-badge bg-brand-700 text-white">{t.badge > 99 ? "99+" : t.badge}</span> : null}
          </span>
          <span className="tab-label">{t.label}</span>
        </Link>
      ))}
      <button type="button" className={`tab ${menuOpen ? "tab-on text-brand-700" : ""}`} aria-expanded={menuOpen} aria-controls="app-menu" onClick={onMenu}>
        <span className="tab-ic">
          <TabIconSvg name="menu" />
        </span>
        <span className="tab-label">Menu</span>
      </button>
    </nav>
  );
}

/** "Desktop site" in Mobile mode; "Mobile site" in PC mode on a phone. */
export function ViewSwitch() {
  const [state, setState] = useState<{ mobile: boolean; phone: boolean } | null>(null);
  useEffect(() => {
    const d = document.documentElement;
    setState({ mobile: d.classList.contains("mobile"), phone: d.dataset.phone === "1" });
  }, []);
  if (!state || (!state.mobile && !state.phone)) return null;
  return (
    <button type="button" className="text-xs text-stone-500 hover:underline" onClick={() => setViewMode(state.mobile ? "pc" : "mobile")} data-testid="view-switch">
      {state.mobile ? "Desktop site" : "Mobile site"}
    </button>
  );
}
