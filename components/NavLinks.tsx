"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { TabBar, ViewSwitch, type Tab } from "./TabBar";

export type NavGroup = { title: string; links: { href: string; label: string }[] };
const OPEN_KEY = "dk-nav-open";

/**
 * The app menu: dropdown groups (the group holding the current page opens by
 * itself; others stay as you left them, remembered on this device). On phones
 * it slides in from the left behind a ☰ button.
 */
export function NavShell({
  groups,
  userName,
  roleLabel,
  signOut,
  tabs = [],
}: {
  groups: NavGroup[];
  userName: string;
  roleLabel: string;
  signOut: () => Promise<void>;
  /** the bottom tabs in Mobile mode */
  tabs?: Tab[];
}) {
  const path = usePathname() || "/";
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [drawer, setDrawer] = useState(false);

  useEffect(() => {
    try {
      setOpen(new Set(JSON.parse(localStorage.getItem(OPEN_KEY) || "[]")));
    } catch {}
  }, []);
  // a new page closes the phone drawer
  useEffect(() => setDrawer(false), [path]);
  useEffect(() => {
    if (!drawer) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setDrawer(false);
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [drawer]);

  const all = groups.flatMap((g) => g.links.map((l) => l.href));
  // the longest matching link wins, so /inventory/locations doesn't also light up Inventory
  const active = all
    .filter((h) => (h === "/" ? path === "/" : path === h || path.startsWith(h + "/")))
    .sort((a, b) => b.length - a.length)[0];

  function toggle(title: string) {
    setOpen((cur) => {
      const next = new Set(cur);
      if (next.has(title)) next.delete(title);
      else next.add(title);
      try {
        localStorage.setItem(OPEN_KEY, JSON.stringify([...next]));
      } catch {}
      return next;
    });
  }

  const link = (l: { href: string; label: string }) => {
    const on = l.href === active;
    return (
      <Link
        key={l.href}
        href={l.href}
        aria-current={on ? "page" : undefined}
        onClick={() => setDrawer(false)}
        className={`nav-link block rounded-full px-3 py-2 text-[15px] md:py-1.5 md:text-sm ${
          on ? "bg-brand-50 font-medium text-brand-800" : "text-stone-600 hover:bg-stone-100 hover:text-stone-900"
        }`}
      >
        {l.label}
      </Link>
    );
  };

  return (
    <>
      {/* phone top bar */}
      <div className="sticky top-0 z-30 flex items-center gap-2 border-b border-stone-200/80 bg-white px-3 py-2.5 md:hidden print:hidden">
        <button
          type="button"
          className="nav-burger grid h-10 w-10 place-content-center gap-1 rounded-full text-stone-800"
          aria-label="Menu"
          aria-expanded={drawer}
          aria-controls="app-menu"
          onClick={() => setDrawer((v) => !v)}
        >
          <span />
          <span />
          <span />
        </button>
        <Link href="/" className="font-display text-xl leading-none text-stone-900">
          DKaydent
        </Link>
      </div>
      <div
        className={`fixed inset-0 z-40 bg-black/30 transition-opacity duration-300 md:hidden ${drawer ? "opacity-100" : "pointer-events-none opacity-0"}`}
        onClick={() => setDrawer(false)}
        aria-hidden="true"
      />
      <aside
        id="app-menu"
        className={`fixed inset-y-0 left-0 z-50 flex w-[min(290px,82vw)] flex-col border-r border-stone-200/80 bg-white shadow-2xl transition-[transform,visibility] duration-[340ms] ease-[cubic-bezier(.22,1,.36,1)] md:sticky md:top-0 md:z-auto md:h-screen md:w-60 md:shrink-0 md:translate-x-0 md:shadow-none md:visible print:hidden ${
          drawer ? "visible translate-x-0" : "invisible -translate-x-[104%]"
        }`}
      >
        <div className="px-5 pt-[max(1.25rem,env(safe-area-inset-top))] pb-4 md:py-6">
          <Link href="/" className="block px-1">
            <div className="font-display text-2xl leading-none text-stone-900">DKaydent</div>
            <div className="mt-1 text-sm text-brand-700">Wholesale flowers &amp; goods</div>
          </Link>
        </div>
        <nav className="flex-1 overflow-y-auto px-3 pb-5" aria-label="Main">
          {groups.map((g, i) => {
            if (!g.title) return <div key={`solo-${i}`}>{g.links.map(link)}</div>;
            const here = g.links.some((l) => l.href === active);
            const isOpen = here || open.has(g.title);
            const id = `grp-${g.title.replace(/\W+/g, "")}`;
            return (
              <div key={g.title} className="mt-1">
                <button
                  type="button"
                  className="nav-link flex w-full items-center justify-between rounded-full px-3 py-2 text-left text-[15px] font-medium text-stone-800 hover:bg-stone-100 md:py-1.5 md:text-sm"
                  aria-expanded={isOpen}
                  aria-controls={id}
                  onClick={() => toggle(g.title)}
                >
                  {g.title}
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 12 12"
                    aria-hidden="true"
                    className={`text-stone-400 transition-transform duration-300 ${isOpen ? "rotate-180" : ""}`}
                  >
                    <path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                <div id={id} className={`nav-group grid ${isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`} inert={!isOpen}>
                  <div className="min-h-0 overflow-hidden pl-2.5">{g.links.map(link)}</div>
                </div>
              </div>
            );
          })}
        </nav>
        <div className="border-t border-stone-200/80 px-5 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <div className="truncate text-sm font-medium">{userName}</div>
          <div className="text-xs text-stone-500">{roleLabel}</div>
          <div className="mt-2 flex items-center gap-4">
            <form action={signOut}>
              <button className="text-xs text-stone-500 hover:underline">Sign out</button>
            </form>
            <ViewSwitch />
          </div>
        </div>
      </aside>
      <TabBar tabs={tabs} active={path} menuOpen={drawer} onMenu={() => setDrawer((v) => !v)} />
    </>
  );
}
