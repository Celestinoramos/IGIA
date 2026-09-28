import { PageHeader, Card } from "@/components/ui";
import { ImportForm } from "@/components/ImportForm";
import { MAX_IMPORT_ROWS } from "@/features/campaigns/import";
import { QUALIFY_THRESHOLD } from "@/features/campaigns/discovery";

export const dynamic = "force-dynamic";

export default function ImportPage() {
  return (
    <div>
      <PageHeader
        title="Importar leads"
        description="Traga os perfis que você quer prospectar. Cada perfil é deduplicado, checado contra a blocklist e pontuado pelo ICP; os qualificados entram na fila de primeiro contato, com o ritmo e os limites configurados."
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <ImportForm />
        </div>
        <Card>
          <h2 className="mb-2 text-sm font-semibold">Formato</h2>
          <div className="space-y-2 text-xs text-[var(--muted)]">
            <p>
              CSV com cabeçalho, separado por vírgula, ponto e vírgula ou tab. Só a coluna do perfil é obrigatória:
            </p>
            <ul className="list-disc space-y-0.5 pl-4">
              <li><code>handle</code> (ou <code>instagram</code>, <code>usuario</code>) — @perfil ou link</li>
              <li><code>nome</code>, <code>bio</code>, <code>categoria</code></li>
              <li><code>seguidores</code> — aceita 3200, 3.200 ou 3,2k</li>
              <li><code>cidade</code>, <code>hashtags</code></li>
            </ul>
            <p>Ou uma lista simples, um perfil por linha, sem cabeçalho.</p>
            <p>
              Um lead é qualificado com pontuação de ICP ≥ {QUALIFY_THRESHOLD}. Só com o @ a pontuação costuma ficar
              abaixo disso: nome e bio fazem diferença.
            </p>
            <p>Até {MAX_IMPORT_ROWS} linhas por importação.</p>
          </div>
        </Card>
      </div>
    </div>
  );
}
