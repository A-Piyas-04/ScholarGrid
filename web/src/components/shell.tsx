"use client";

import clsx from "clsx";
import { ChevronDown, FolderOpen, Menu, Moon, Settings, Sun, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useStatus } from "@/lib/hooks";
import { useProject, useToast } from "@/lib/project";
import { Button, Callout, Spinner } from "./ui";

export function Logo({ className }: { className?: string }) {
  // A 3x3 grid with one highlighted cell: the collection, and the part you care about.
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <rect x="1" y="1" width="22" height="22" rx="4" fill="var(--surface)" stroke="var(--ink)" strokeWidth="1.6" />
      <path d="M8.33 1v22M15.67 1v22M1 8.33h22M1 15.67h22" stroke="var(--ink)" strokeWidth="1.1" opacity=".55" />
      <rect x="9.2" y="9.2" width="5.6" height="5.6" rx="1" fill="var(--mark)" />
    </svg>
  );
}

const PRIMARY = [
  { href: "/", label: "Start", match: (p: string) => p === "/" || p.startsWith("/topic") || p.startsWith("/plan") },
  { href: "/search", label: "Search papers", match: (p: string) => p.startsWith("/search") || p.startsWith("/paper") },
  { href: "/ask", label: "Ask", match: (p: string) => p.startsWith("/ask") },
  { href: "/projects", label: "Projects", match: (p: string) => p.startsWith("/projects") },
];
const EXPLORE = [
  { href: "/map", label: "Research map", note: "Every paper placed by meaning" },
  { href: "/areas", label: "Research areas", note: "The collection's main areas" },
  { href: "/trends", label: "Trends", note: "Which areas grow, and how crowded they are" },
  { href: "/evaluate", label: "Judge search results", note: "Label relevance to measure search quality" },
  { href: "/about", label: "How it works", note: "Data, methods and limits" },
];

function ThemeToggle() {
  const [dark, setDark] = useState<boolean | null>(null);
  useEffect(() => {
    const t = document.documentElement.dataset.theme;
    setDark(t ? t === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches);
  }, []);
  const flip = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.dataset.theme = next ? "dark" : "light";
    try {
      localStorage.setItem("sg-theme", next ? "dark" : "light");
    } catch {
      /* ignore */
    }
  };
  return (
    <button
      onClick={flip}
      className="inline-flex size-9 items-center justify-center rounded-[8px] text-muted hover:bg-surface-2 hover:text-ink"
      aria-label={dark ? "Use light theme" : "Use dark theme"}
      title={dark ? "Light theme" : "Dark theme"}
    >
      {dark ? <Sun className="size-[18px]" /> : <Moon className="size-[18px]" />}
    </button>
  );
}

function ExploreMenu({ pathname }: { pathname: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const active = EXPLORE.some((e) => pathname.startsWith(e.href));
  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={clsx(
          "inline-flex h-9 items-center gap-1 rounded-[8px] px-3 text-[0.9375rem] font-medium",
          active ? "text-pen" : "text-ink-2 hover:bg-surface-2 hover:text-ink",
        )}
      >
        Explore <ChevronDown className={clsx("size-4 transition-transform", open && "rotate-180")} />
      </button>
      {open ? (
        <div className="absolute right-0 top-11 z-50 w-72 rounded-[10px] border border-line bg-surface p-1.5 shadow-[0_12px_32px_-12px_rgba(19,32,44,.35)]">
          {EXPLORE.map((e) => (
            <Link key={e.href} href={e.href} className="block rounded-[7px] px-3 py-2 hover:bg-surface-2">
              <span className="block font-medium text-ink">{e.label}</span>
              <span className="block text-sm text-muted">{e.note}</span>
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ActiveProject() {
  const { enabled, active } = useProject();
  if (!enabled) return null;
  return (
    <Link
      href={active ? `/projects/${active.id}` : "/projects"}
      className="hidden max-w-[16rem] items-center gap-2 rounded-[8px] border border-line px-3 py-1.5 text-sm text-ink-2 hover:border-pen hover:text-pen lg:inline-flex"
      title="Saved papers, open problems and plans go to this project"
    >
      <FolderOpen className="size-4 shrink-0" aria-hidden />
      <span className="truncate">{active ? active.title : "No project yet"}</span>
      {active ? <span className="tabular text-faint">{active.counts.papers + active.counts.gaps}</span> : null}
    </Link>
  );
}

function Header() {
  const pathname = usePathname() || "/";
  const [mobile, setMobile] = useState(false);
  useEffect(() => setMobile(false), [pathname]);
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-paper/92 backdrop-blur supports-[backdrop-filter]:bg-paper/80">
      <div className="mx-auto flex h-16 max-w-[1240px] items-center gap-3 px-4 md:px-6">
        <Link href="/" className="mr-3 flex items-center gap-2.5" aria-label="ScholarGrid home">
          <Logo className="size-7" />
          <span className="serif text-[1.375rem] font-medium tracking-[-0.01em] text-ink">ScholarGrid</span>
        </Link>
        <nav className="hidden items-center gap-0.5 md:flex" aria-label="Main">
          {PRIMARY.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              aria-current={n.match(pathname) ? "page" : undefined}
              className={clsx(
                "inline-flex h-9 items-center rounded-[8px] px-3 text-[0.9375rem] font-medium",
                n.match(pathname) ? "bg-pen-soft text-pen" : "text-ink-2 hover:bg-surface-2 hover:text-ink",
              )}
            >
              {n.label}
            </Link>
          ))}
          <ExploreMenu pathname={pathname} />
        </nav>
        <div className="ml-auto flex items-center gap-1">
          <ActiveProject />
          <Link
            href="/settings"
            className="inline-flex size-9 items-center justify-center rounded-[8px] text-muted hover:bg-surface-2 hover:text-ink"
            aria-label="Settings"
            title="Settings"
          >
            <Settings className="size-[18px]" />
          </Link>
          <ThemeToggle />
          <button
            className="inline-flex size-9 items-center justify-center rounded-[8px] text-ink md:hidden"
            onClick={() => setMobile((m) => !m)}
            aria-label={mobile ? "Close menu" : "Open menu"}
            aria-expanded={mobile}
          >
            {mobile ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>
      </div>
      {mobile ? (
        <nav className="border-t border-line bg-surface px-4 py-3 md:hidden" aria-label="Main mobile">
          {[...PRIMARY, ...EXPLORE].map((n) => (
            <Link key={n.href} href={n.href} className="block rounded-[7px] px-3 py-2.5 font-medium text-ink hover:bg-surface-2">
              {n.label}
            </Link>
          ))}
        </nav>
      ) : null}
    </header>
  );
}

function Toaster() {
  const { toasts, dismiss } = useToast();
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={clsx(
            "pointer-events-auto flex max-w-md items-center gap-3 rounded-[10px] px-4 py-3 text-[0.9375rem] shadow-[0_14px_36px_-14px_rgba(19,32,44,.5)]",
            t.tone === "error" ? "bg-brick text-white" : "bg-ink text-paper",
          )}
        >
          <span>{t.text}</span>
          {t.href ? (
            <Link href={t.href} className="font-semibold underline underline-offset-2" onClick={() => dismiss(t.id)}>
              {t.hrefLabel ?? "Open"}
            </Link>
          ) : null}
          <button onClick={() => dismiss(t.id)} aria-label="Dismiss" className="opacity-70 hover:opacity-100">
            <X className="size-4" />
          </button>
        </div>
      ))}
    </div>
  );
}

function StatusGate({ children }: { children: React.ReactNode }) {
  const { data, error, refetch, isLoading } = useStatus();
  if (error) {
    return (
      <div className="mx-auto max-w-xl px-4 py-24">
        <Callout tone="error" title="The ScholarGrid server isn't running">
          <p>Start the API in a terminal from the project folder, then reload this page:</p>
          <pre className="mt-2 overflow-x-auto rounded-[6px] bg-surface px-3 py-2 text-sm">python -m scholargrid.api</pre>
          <Button size="sm" className="mt-3" onClick={() => refetch()}>
            Check again
          </Button>
        </Callout>
      </div>
    );
  }
  if (isLoading || (data && !data.ready)) {
    if (data?.error)
      return (
        <div className="mx-auto max-w-xl px-4 py-24">
          <Callout tone="error" title="The research collection could not be loaded">
            <p className="break-words">{data.error}</p>
            <p className="mt-2">Build one with <code>python pipeline/run_pipeline.py</code>, or check <code>data/releases/CURRENT</code>.</p>
          </Callout>
        </div>
      );
    return (
      <div className="graph-paper flex min-h-[70vh] items-center justify-center px-4">
        <div className="rounded-[14px] border border-line bg-surface px-8 py-7 text-center">
          <Logo className="mx-auto size-10" />
          <p className="serif mt-4 text-xl text-ink">Opening the research collection</p>
          <p className="mt-1 flex items-center justify-center gap-2 text-sm text-muted">
            <Spinner /> Loading papers, embeddings and the search index. This takes about half a minute after a restart.
          </p>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}

function Notices() {
  const { data } = useStatus();
  const r = data?.release;
  if (!r) return null;
  const notes: React.ReactNode[] = [];
  if (r.synthetic)
    notes.push(
      <Callout key="syn" tone="warn" title="Demo data">
        These papers are synthetic. They show how the tool works; they are not real arXiv records.
      </Callout>,
    );
  if (!r.semantic_search)
    notes.push(
      <Callout key="sem" tone="warn" title="Search by meaning is unavailable">
        The embedding model didn't load, so search uses keyword matching only.
      </Callout>,
    );
  if (!notes.length) return null;
  return <div className="mx-auto mb-6 grid max-w-[1240px] gap-2 px-4 md:px-6">{notes}</div>;
}

function Footer() {
  return (
    <footer className="mt-20 border-t border-line">
      <div className="mx-auto flex max-w-[1240px] flex-col gap-3 px-4 py-8 text-sm text-muted md:flex-row md:justify-between md:px-6">
        <p className="max-w-[70ch]">
          Paper metadata from <a className="underline" href="https://arxiv.org" target="_blank" rel="noopener noreferrer">arXiv</a>,{" "}
          <a className="underline" href="https://openalex.org" target="_blank" rel="noopener noreferrer">OpenAlex</a> and{" "}
          <a className="underline" href="https://www.semanticscholar.org" target="_blank" rel="noopener noreferrer">Semantic Scholar</a>. Thank
          you to arXiv for use of its open access interoperability. Abstracts stay under each paper&apos;s licence. ScholarGrid
          helps you explore; it does not judge research value.
        </p>
        <div className="flex gap-4">
          <Link href="/about" className="hover:text-ink">How it works</Link>
          <Link href="/settings" className="hover:text-ink">Settings</Link>
        </div>
      </div>
    </footer>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || "/";
  const wide = pathname.startsWith("/map");
  return (
    <div className="flex min-h-screen flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-50 focus:rounded focus:bg-surface focus:px-3 focus:py-2">
        Skip to content
      </a>
      <Header />
      <StatusGate>
        <main id="main" className={clsx("flex-1", wide ? "" : "pt-8 md:pt-10")}>
          {wide ? null : <Notices />}
          {children}
        </main>
      </StatusGate>
      {wide ? null : <Footer />}
      <Toaster />
    </div>
  );
}

export function Container({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={clsx("mx-auto max-w-[1240px] px-4 md:px-6", className)}>{children}</div>;
}
