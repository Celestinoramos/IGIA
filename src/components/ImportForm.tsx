"use client";

import { useActionState } from "react";
import { importLeadsAction, type ImportLeadsState } from "@/app/actions";
import { Card } from "./ui";

const INITIAL: ImportLeadsState = { status: "idle" };

const inputCls =
  "w-full rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--text)]";

/** Lead import form: paste a list or upload a CSV, then show what happened. */
export function ImportForm() {
  const [state, action, pending] = useActionState(importLeadsAction, INITIAL);

  return (
    <div className="space-y-4">
      <Card>
        <form action={action} className="space-y-4">
          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input type="radio" name="funnel" value="customer" defaultChecked /> Funil de clientes
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="funnel" value="affiliate" /> Funil de afiliados
            </label>
          </div>

          <div>
            <label htmlFor="text" className="mb-1 block text-sm font-medium">
              Cole a lista
            </label>
            <textarea
              id="text"
              name="text"
              rows={10}
              className={`${inputCls} font-mono`}
              placeholder={"handle,nome,bio,seguidores,cidade,hashtags\n@loja_da_bela,Loja da Bela,Loja de roupas • dona Bela,3200,São Paulo,moda loja\n\nou apenas um perfil por linha:\n@loja_da_bela\nhttps://instagram.com/burger_house"}
            />
          </div>

          <div>
            <label htmlFor="file" className="mb-1 block text-sm font-medium">
              …ou envie um arquivo CSV
            </label>
            <input id="file" name="file" type="file" accept=".csv,.txt,text/csv,text/plain" className="text-sm" />
            <p className="mt-1 text-xs text-[var(--muted)]">Se escolher um arquivo, o texto colado é ignorado.</p>
          </div>

          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="qualifyAll" className="mt-0.5" />
            <span>
              Contatar todos os perfis da lista, mesmo com pontuação de ICP baixa
              <span className="block text-xs text-[var(--muted)]">
                Use só para listas que você já revisou. A blocklist e a lista de não contatar continuam valendo.
              </span>
            </span>
          </label>

          <button
            type="submit"
            disabled={pending}
            className="rounded-lg bg-[var(--brand)] px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            {pending ? "Importando…" : "Importar leads"}
          </button>
        </form>
      </Card>

      {state.status === "error" ? (
        <Card className="border-red-500/40 bg-red-500/10">
          <div className="text-sm text-red-200">{state.message}</div>
        </Card>
      ) : null}

      {state.status === "ok" && state.result ? (
        <Card className="border-green-500/40 bg-green-500/10">
          <div className="text-sm">
            <div className="font-semibold">Importação concluída</div>
            <ul className="mt-2 space-y-0.5 text-[var(--muted)]">
              <li>{state.result.parsed} perfis lidos</li>
              <li>{state.result.discovered} leads novos</li>
              <li>{state.result.qualified} qualificados — primeiro contato na fila</li>
              <li>{state.result.duplicates} já existiam</li>
              <li>{state.result.blocked} bloqueados (blocklist / não contatar)</li>
            </ul>
            {state.result.discovered > state.result.qualified ? (
              <p className="mt-2 text-xs text-[var(--muted)]">
                Leads não qualificados ficaram como &quot;descobertos&quot; e não recebem DM. Inclua nome, bio e hashtags
                para melhorar a pontuação, ou marque &quot;contatar todos&quot;.
              </p>
            ) : null}
          </div>
        </Card>
      ) : null}

      {state.errors && state.errors.length > 0 ? (
        <Card className="border-amber-500/40 bg-amber-500/10">
          <div className="text-sm text-amber-200">
            <div className="font-semibold">{state.errors.length} linha(s) ignorada(s)</div>
            <ul className="mt-2 max-h-48 space-y-0.5 overflow-auto text-xs">
              {state.errors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
