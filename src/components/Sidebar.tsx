import Link from "next/link";
import { loadBusinessConfig } from "@/config/business";
import { countOpenExceptions } from "@/features/exceptions/repo";
import { PauseControl } from "./PauseControl";

const NAV = [
  { href: "/", label: "Painel geral" },
  { href: "/import", label: "Importar leads" },
  { href: "/leads?funnel=customer", label: "Funil de clientes" },
  { href: "/leads?funnel=affiliate", label: "Funil de afiliados" },
  { href: "/experiments", label: "Experimentos" },
  { href: "/jobs", label: "Fila de jobs" },
  { href: "/exceptions", label: "Fila de exceções" },
  { href: "/settings", label: "Configurações" },
];

function safeOpenExceptions(): number {
  // The layout wraps statically-prerendered pages (e.g. not-found); the DB may
  // not be migrated at build time, so degrade gracefully to 0.
  try {
    return countOpenExceptions();
  } catch {
    return 0;
  }
}

export function Sidebar() {
  const config = loadBusinessConfig();
  const openExceptions = safeOpenExceptions();
  return (
    <aside className="flex w-64 shrink-0 flex-col gap-4 border-r border-[var(--border)] bg-[var(--surface)] p-4">
      <div>
        <div className="text-sm font-semibold">{config.company.name}</div>
        <div className="text-xs text-[var(--muted)]">Prospecção autônoma</div>
      </div>

      <nav className="flex flex-col gap-1">
        {NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="flex items-center justify-between rounded-lg px-3 py-2 text-sm text-[var(--text)] hover:bg-[var(--surface-2)]"
          >
            <span>{item.label}</span>
            {item.href === "/exceptions" && openExceptions > 0 ? (
              <span className="rounded-full bg-red-500/20 px-2 text-xs text-red-300">{openExceptions}</span>
            ) : null}
          </Link>
        ))}
      </nav>

      <div className="mt-auto space-y-3">
        <div className="flex flex-col gap-1">
          <a href={`https://instagram.com/${config.company.instagramHandle.replace(/^@/, "")}`} target="_blank" rel="noreferrer" className="text-xs text-[var(--muted)] hover:text-[var(--text)]">
            Abrir Instagram ↗
          </a>
          <a href={config.links.whatsapp} target="_blank" rel="noreferrer" className="text-xs text-[var(--muted)] hover:text-[var(--text)]">
            Abrir WhatsApp ↗
          </a>
          <a href={config.links.affiliateGroup} target="_blank" rel="noreferrer" className="text-xs text-[var(--muted)] hover:text-[var(--text)]">
            Abrir grupo de afiliados ↗
          </a>
        </div>
        <PauseControl />
      </div>
    </aside>
  );
}
