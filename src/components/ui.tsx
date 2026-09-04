import Link from "next/link";
import type { ReactNode } from "react";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`card p-4 ${className}`}>{children}</div>;
}

export function StatCard({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "ok" | "warn" | "danger";
}) {
  const toneColor =
    tone === "ok" ? "text-[var(--ok)]" : tone === "warn" ? "text-[var(--warn)]" : tone === "danger" ? "text-[var(--danger)]" : "text-[var(--text)]";
  return (
    <Card>
      <div className="text-xs uppercase tracking-wide text-[var(--muted)]">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${toneColor}`}>{value}</div>
      {hint ? <div className="mt-1 text-xs text-[var(--muted)]">{hint}</div> : null}
    </Card>
  );
}

const BADGE_TONES: Record<string, string> = {
  neutral: "bg-[var(--surface-2)] text-[var(--muted)]",
  brand: "bg-indigo-500/15 text-indigo-300",
  ok: "bg-green-500/15 text-green-300",
  warn: "bg-amber-500/15 text-amber-300",
  danger: "bg-red-500/15 text-red-300",
};

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: keyof typeof BADGE_TONES }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${BADGE_TONES[tone]}`}>
      {children}
    </span>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold">{title}</h1>
        {description ? <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">{description}</p> : null}
      </div>
      {actions ? <div className="flex gap-2">{actions}</div> : null}
    </div>
  );
}

export function EmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <Card className="text-center">
      <div className="py-10">
        <div className="text-sm font-medium">{title}</div>
        {description ? <div className="mt-1 text-sm text-[var(--muted)]">{description}</div> : null}
      </div>
    </Card>
  );
}

export function LinkButton({ href, children, external = false }: { href: string; children: ReactNode; external?: boolean }) {
  const cls =
    "inline-flex items-center rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-1.5 text-sm font-medium hover:bg-[var(--border)]";
  if (external) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className={cls}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={cls}>
      {children}
    </Link>
  );
}
