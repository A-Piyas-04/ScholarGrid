"use client";

import clsx from "clsx";
import { AlertTriangle, CircleCheck, Info, LoaderCircle, RotateCw } from "lucide-react";
import Link from "next/link";
import { forwardRef } from "react";
import type { Job } from "@/lib/types";

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------
type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const base =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium transition-colors duration-150 " +
  "disabled:opacity-50 disabled:cursor-not-allowed select-none";
const variants: Record<Variant, string> = {
  primary: "bg-pen text-on-pen hover:bg-pen-hover",
  secondary: "bg-surface text-ink border border-line-strong hover:border-pen hover:text-pen",
  ghost: "text-ink-2 hover:bg-surface-2 hover:text-ink",
  danger: "bg-surface text-brick border border-line-strong hover:border-brick",
};
const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-sm rounded-[7px]",
  md: "h-10 px-4 text-[0.9375rem] rounded-[8px]",
  lg: "h-12 px-5 text-base rounded-[9px]",
};

export function buttonClass(variant: Variant = "secondary", size: Size = "md", className?: string) {
  return clsx(base, variants[variant], sizes[size], className);
}

export const Button = forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; loading?: boolean }
>(function Button({ variant = "secondary", size = "md", loading, className, children, disabled, ...rest }, ref) {
  return (
    <button ref={ref} className={buttonClass(variant, size, className)} disabled={disabled || loading} {...rest}>
      {loading ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : null}
      {children}
    </button>
  );
});

export function LinkButton({
  href,
  variant = "secondary",
  size = "md",
  className,
  children,
  external,
}: {
  href: string;
  variant?: Variant;
  size?: Size;
  className?: string;
  children: React.ReactNode;
  external?: boolean;
}) {
  if (external)
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={buttonClass(variant, size, className)}>
        {children}
      </a>
    );
  return (
    <Link href={href} className={buttonClass(variant, size, className)}>
      {children}
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Form controls
// ---------------------------------------------------------------------------
const field =
  "w-full bg-surface text-ink border border-line-strong rounded-[8px] px-3 placeholder:text-faint " +
  "focus:outline-none focus:border-pen focus:ring-2 focus:ring-pen-soft transition-colors";

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...rest },
  ref,
) {
  return <input ref={ref} className={clsx(field, "h-10", className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...rest }, ref) {
    return <textarea ref={ref} className={clsx(field, "py-2 leading-relaxed", className)} {...rest} />;
  },
);

export function Select({ className, children, ...rest }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={clsx(field, "h-10 pr-8", className)} {...rest}>
      {children}
    </select>
  );
}

export function Label({ children, htmlFor, hint }: { children: React.ReactNode; htmlFor?: string; hint?: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-semibold text-ink">
      {children}
      {hint ? <span className="ml-2 font-normal text-muted">{hint}</span> : null}
    </label>
  );
}

// ---------------------------------------------------------------------------
// Tags, badges
// ---------------------------------------------------------------------------
type Tone = "plain" | "pen" | "verd" | "brick" | "amber" | "outline";
const tones: Record<Tone, string> = {
  plain: "bg-surface-2 text-ink-2",
  pen: "bg-pen-soft text-pen",
  verd: "bg-verd-soft text-verd",
  brick: "bg-brick-soft text-brick",
  amber: "bg-amber-soft text-amber",
  outline: "border border-line-strong text-muted",
};

export function Tag({ tone = "plain", children, className, title }: { tone?: Tone; children: React.ReactNode; className?: string; title?: string }) {
  return (
    <span
      title={title}
      className={clsx("inline-flex items-center gap-1 rounded-[5px] px-2 py-0.5 text-[0.8125rem] font-medium leading-5", tones[tone], className)}
    >
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Feedback
// ---------------------------------------------------------------------------
export function Spinner({ className }: { className?: string }) {
  return <LoaderCircle className={clsx("size-4 animate-spin text-muted", className)} aria-label="Loading" />;
}

export function Callout({
  tone = "info",
  title,
  children,
  className,
}: {
  tone?: "info" | "warn" | "error" | "ok";
  title?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  const Icon = tone === "warn" || tone === "error" ? AlertTriangle : tone === "ok" ? CircleCheck : Info;
  const cls = {
    info: "border-line bg-surface-2 text-ink-2",
    warn: "border-amber/30 bg-amber-soft text-ink-2",
    error: "border-brick/30 bg-brick-soft text-ink-2",
    ok: "border-verd/30 bg-verd-soft text-ink-2",
  }[tone];
  const icon = { info: "text-muted", warn: "text-amber", error: "text-brick", ok: "text-verd" }[tone];
  return (
    <div className={clsx("flex gap-3 rounded-[10px] border px-4 py-3 text-[0.9375rem]", cls, className)} role={tone === "error" ? "alert" : undefined}>
      <Icon className={clsx("mt-0.5 size-[18px] shrink-0", icon)} aria-hidden />
      <div className="min-w-0">
        {title ? <p className="font-semibold text-ink">{title}</p> : null}
        {children ? <div className={clsx(title && "mt-0.5")}>{children}</div> : null}
      </div>
    </div>
  );
}

export function ErrorState({ error, onRetry, title = "This didn't load" }: { error: unknown; onRetry?: () => void; title?: string }) {
  const msg = error instanceof Error ? error.message : String(error ?? "Unknown error");
  return (
    <Callout tone="error" title={title}>
      <p>{msg}</p>
      {onRetry ? (
        <Button size="sm" className="mt-3" onClick={onRetry}>
          <RotateCw className="size-3.5" aria-hidden /> Try again
        </Button>
      ) : null}
    </Callout>
  );
}

export function EmptyState({
  title,
  children,
  action,
  className,
}: {
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={clsx("graph-paper rounded-[14px] border border-line px-6 py-12 text-center", className)}>
      <p className="serif text-2xl text-ink">{title}</p>
      {children ? <div className="mx-auto mt-2 max-w-md text-muted">{children}</div> : null}
      {action ? <div className="mt-5 flex justify-center gap-2">{action}</div> : null}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx("animate-pulse rounded-[6px] bg-surface-2", className)} />;
}

export function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-6" aria-label="Loading" aria-busy>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="space-y-2">
          <Skeleton className="h-5 w-3/4" />
          <Skeleton className="h-3.5 w-1/3" />
          <Skeleton className="h-3.5 w-full" />
          <Skeleton className="h-3.5 w-5/6" />
        </div>
      ))}
    </div>
  );
}

/** A determinate bar with the job's current step. */
export function JobProgress({ job, label, steps }: { job?: Job | null; label?: string; steps?: string[] }) {
  const frac = job?.progress ?? 0;
  const msg = job?.message ?? label ?? "Starting…";
  const current = steps ? Math.max(0, steps.findIndex((s) => msg.startsWith(s.replace(/…$/, "")))) : -1;
  return (
    <div className="rounded-[14px] border border-line bg-surface px-6 py-6" aria-live="polite">
      <div className="flex items-center gap-3">
        <Spinner className="text-pen" />
        <p className="font-semibold text-ink">{msg}</p>
      </div>
      <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-surface-2">
        {frac > 0 ? (
          <div className="h-full rounded-full bg-pen transition-[width] duration-500" style={{ width: `${Math.max(4, frac * 100)}%` }} />
        ) : (
          <div className="progress-indeterminate h-full w-1/3 rounded-full bg-pen/60" />
        )}
      </div>
      {steps ? (
        <ol className="mt-5 grid gap-1.5 text-sm sm:grid-cols-2">
          {steps.map((s, i) => {
            const done = current > i || frac >= 1;
            const now = current === i && frac < 1;
            return (
              <li key={s} className={clsx("flex items-center gap-2", done ? "text-ink-2" : now ? "text-ink font-semibold" : "text-faint")}>
                <span
                  className={clsx(
                    "inline-flex size-5 items-center justify-center rounded-full border text-[0.6875rem] tabular",
                    done ? "border-verd bg-verd text-surface" : now ? "border-pen text-pen" : "border-line-strong",
                  )}
                >
                  {done ? "✓" : i + 1}
                </span>
                {s.replace(/…$/, "")}
              </li>
            );
          })}
        </ol>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Layout helpers
// ---------------------------------------------------------------------------
export function PageHeader({
  title,
  lead,
  actions,
  kicker,
}: {
  title: React.ReactNode;
  lead?: React.ReactNode;
  actions?: React.ReactNode;
  kicker?: React.ReactNode;
}) {
  return (
    <header className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0">
        {kicker ? <div className="mb-2 text-sm text-muted">{kicker}</div> : null}
        <h1 className="serif text-[2.25rem] leading-[1.1] tracking-[-0.01em] text-ink md:text-[2.75rem]">{title}</h1>
        {lead ? <p className="mt-3 max-w-[62ch] text-[1.0625rem] text-muted">{lead}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
    </header>
  );
}

export function SectionTitle({ children, meta, id }: { children: React.ReactNode; meta?: React.ReactNode; id?: string }) {
  return (
    <div className="mb-4 flex items-baseline justify-between gap-4 border-b border-line pb-2">
      <h2 id={id} className="serif text-[1.5rem] leading-tight text-ink">
        {children}
      </h2>
      {meta ? <div className="text-sm text-muted">{meta}</div> : null}
    </div>
  );
}

export function Panel({ children, className }: { children: React.ReactNode; className?: string }) {
  return <section className={clsx("rounded-[10px] border border-line bg-surface p-5 md:p-6", className)}>{children}</section>;
}

export function Stat({ value, label }: { value: React.ReactNode; label: string }) {
  return (
    <div>
      <div className="serif text-[1.75rem] leading-none text-ink tabular">{value}</div>
      <div className="mt-1.5 text-sm text-muted">{label}</div>
    </div>
  );
}
