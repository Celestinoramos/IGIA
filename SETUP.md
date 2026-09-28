# Manual do Operador — Sistema Autônomo de Prospecção no Instagram

Este guia é para a pessoa que vai **operar** o sistema. Explica como instalar, criar a
chave da OpenAI, preparar o Chrome dedicado, rodar, pausar e restaurar backup — em
português. A documentação técnica (para quem programa) está em inglês no
[`README.md`](./README.md).

> Toda a interface do painel está em português. Os valores internos (banco, status,
> logs) ficam em inglês por decisão de engenharia — isso não afeta o uso.

---

## 1. Visão geral em uma frase

O sistema descobre perfis no Instagram, envia a **primeira DM pelo seu Chrome real**,
recebe as respostas pelo **webhook oficial da Meta**, continua a conversa pela **API
oficial**, encaminha os interessados para o **WhatsApp** (clientes) ou para o **grupo de
afiliados** (criadores), e faz tudo isso sozinho dentro dos limites que você define. Fora
desses limites, ele **pausa e avisa** no painel.

---

## 2. Pré-requisitos

- **Node.js 24 LTS.** Verifique com `node -v` (precisa mostrar `v24.x`).
  Com `nvm`: `nvm install 24 && nvm use 24`.
- **pnpm.** Ative com `corepack enable` (ou `npm i -g pnpm`).
- **Google Chrome** instalado (só para o modo real, na sua máquina).

---

## 3. Instalação

```bash
pnpm install
cp .env.example .env
cp config/business.example.json config/business.json
```

Depois edite os dois arquivos:

- **`config/business.json`** — os **únicos** dados reais do negócio (nome, empresa,
  links, oferta, ICP e as afirmações). Substitua todos os `{{PLACEHOLDERS}}`.
- **`.env`** — chaves, limites e configurações (próximas seções).

> ⚠️ **Nunca faça commit** de `.env` nem de `config/business.json`. Eles já estão no
> `.gitignore`.

### Regra de afirmações (importante)

Em `config/business.json`, `claims.verified` são as frases **já comprovadas** — só essas
podem ser enviadas. `claims.unverified` ficam **bloqueadas** até você comprovar no site ou
em material oficial e movê-las para `verified`. A IA nunca inventa taxa, condição,
garantia, sociedade ou superlativo, e nunca promete aprovação de conta ou resultado
financeiro.

---

## 4. Criar a chave da OpenAI (com limite de gasto)

1. Acesse **https://platform.openai.com/api-keys**.
2. Crie a chave dentro de um **projeto separado** (não use o projeto principal).
3. Dê permissão **`Restricted`** (o mínimo necessário).
4. Em **Settings → Limits**, defina um **hard limit mensal** de gasto. Isso é a sua rede de
   proteção na própria OpenAI, além do limite do sistema.
5. Copie a chave para o `.env`:

   ```
   OPENAI_API_KEY=sk-...
   OPENAI_MODEL=gpt-4o
   OPENAI_MODEL_FAST=gpt-4o-mini
   OPENAI_MONTHLY_BUDGET_USD=50
   ```

O sistema **pausa automaticamente** quando o gasto estimado do mês atinge
`OPENAI_MONTHLY_BUDGET_USD`. O painel mostra **custo por lead** e **custo por cliente
ativo**.

> 💡 **Sem chave?** Se você deixar `OPENAI_API_KEY` vazio, o sistema roda com um motor
> **mock** determinístico: sem chamadas de rede e sem custo. Ótimo para testar tudo antes
> de conectar a OpenAI de verdade.

---

## 5. Preparar o Chrome dedicado (primeiro contato)

A API oficial da Meta **não abre conversa** com quem nunca te respondeu. Por isso a
primeira DM sai do **seu Chrome real**, com uma sessão do Instagram logada por você **uma
única vez, na mão**.

Você precisa subir o Chrome com um **perfil dedicado** (separado do pessoal) e a porta de
debug em `127.0.0.1`. O Chrome 136+ recusa `--remote-debugging-port` no perfil padrão —
por isso o perfil dedicado é **requisito**, não preferência.

### macOS

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port=9222 \
  --user-data-dir="$HOME/.chrome-agent-profile"
```

### Linux

```bash
google-chrome \
  --remote-debugging-port=9222 \
  --user-data-dir="$HOME/.chrome-agent-profile"
```

### Windows (PowerShell)

```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" `
  --remote-debugging-port=9222 `
  --user-data-dir="$env:USERPROFILE\.chrome-agent-profile"
```

Depois de abrir esse Chrome dedicado:

1. Faça **login no Instagram** normalmente, uma única vez, nessa janela.
2. Deixe essa janela aberta enquanto o sistema estiver operando.
3. No `.env`, aponte para essa sessão:

   ```
   CHROME_CDP_URL=http://127.0.0.1:9222
   CHROME_PROFILE_DIR=./.chrome-profile
   BROWSER_DRIVER=real
   DRY_RUN=true      # comece SEMPRE com dry-run (não envia de verdade)
   ```

O sistema **reaproveita** o contexto já logado, abre a **própria aba**, faz o trabalho e
**fecha a aba** ao fim (mesmo em erro). Ele **nunca** traz a aba para frente, nunca toma o
mouse/teclado e nunca abre um Chrome novo por conta própria. Se a conexão CDP falhar, ele
**pausa a fila** e avisa no painel — não tenta contornar.

> 🔒 **Aviso de segurança crítico.** A porta de debug dá **controle total** sobre a sessão
> logada. Mantenha-a **sempre em `127.0.0.1`**, **nunca em `0.0.0.0`** e **nunca em uma
> máquina compartilhada**. Qualquer processo que alcance essa porta controla seu
> Instagram.

---

## 6. Webhook oficial da Meta (respostas)

Para o sistema continuar a conversa pela API oficial depois que o lead responde, preencha
no `.env`:

```
INSTAGRAM_APP_SECRET=...
INSTAGRAM_PAGE_ACCESS_TOKEN=...
INSTAGRAM_WEBHOOK_VERIFY_TOKEN=...
INSTAGRAM_BUSINESS_ACCOUNT_ID=...
```

Aponte o webhook do seu app da Meta para:

```
POST http://SEU_HOST:4319/api/webhooks/instagram
```

O sistema **verifica a assinatura** de cada webhook e é **idempotente** (recebe a mesma
mensagem duas vezes sem duplicar). Sem esses valores, a etapa de API roda em modo
simulado — útil para testar o restante do fluxo.

---

## 7. Ritmo humano e limites (saúde da conta)

Estes limites protegem a conta — não servem para burlar detecção. Ajuste no `.env`:

```
MAX_DMS_PER_DAY=30
MIN_SECONDS_BETWEEN_DMS=90
MAX_SECONDS_BETWEEN_DMS=240
OPERATING_HOURS=09:00-20:00
OPERATING_TIMEZONE=America/Sao_Paulo
```

Há um **aquecimento** automático: 5 DMs/dia na 1ª semana, +5 por semana, até o teto de
`MAX_DMS_PER_DAY`. Fora da janela de operação, o sistema espera.

---

## 8. Como rodar

Um comando sobe **painel + worker** juntos:

```bash
pnpm dev
```

Abra o painel em **http://127.0.0.1:4319**.

Para popular o painel com dados de demonstração:

```bash
pnpm seed
```

Para ver todos os fluxos críticos rodando de ponta a ponta (com navegador simulado e IA
mock, em banco isolado):

```bash
pnpm demo
```

Em produção, use `pnpm build` e depois `pnpm start`.

### De onde vêm os leads

O sistema não busca perfis sozinho no Instagram: **você** traz a lista. No painel, abra
**Importar leads**, escolha o funil (clientes ou afiliados) e cole a lista ou envie um CSV:

```
handle,nome,bio,seguidores,cidade,hashtags
@loja_da_bela,Loja da Bela,Loja de roupas • dona Bela,3200,São Paulo,moda loja
```

Só a coluna do perfil é obrigatória (aceita `@perfil` ou o link do perfil); também vale
uma lista simples, um perfil por linha. Cada perfil é deduplicado, checado contra a
blocklist e pontuado pelo ICP do `config/business.json`. Os qualificados entram na fila de
primeiro contato e saem no ritmo da seção 7. Sem nome e bio a pontuação costuma ficar
baixa; para uma lista que você já revisou, marque **"contatar todos"**.

---

## 9. Como pausar

- **Pausa manual:** no painel, use o botão **Pausar** (canto da barra lateral / página de
  Configurações). Para retomar, use **Retomar**.
- **Pausa automática:** o sistema pausa sozinho diante de alerta/restrição do Instagram,
  perda de sessão, crescimento anormal de erro, mensagem duplicada, aumento de
  bloqueios/opt-outs, divergência entre navegador/API/CRM, comportamento inesperado da IA
  ou estouro do orçamento da OpenAI. Quando isso acontece, veja a **fila de exceções** e
  os **alertas de integração** no painel.

Pedido de "parar" de um lead é atendido na hora: o perfil vai para `do_not_contact`, de
forma permanente, sem follow-up e sem reentrada por nenhum canal.

---

## 10. Backup e restauração

O sistema faz **backup automático diário** do banco SQLite (em `backups/`). Para um backup
manual imediato:

```bash
pnpm backup
```

**Restaurar** um backup:

1. Pare o sistema (encerre `pnpm dev`/`pnpm start`).
2. Substitua o arquivo do banco (o caminho vem de `DATABASE_URL`, por padrão
   `data/app.db`) pelo arquivo desejado da pasta `backups/`.
3. Suba o sistema de novo (`pnpm dev`). As migrações são idempotentes e o worker se
   **recupera** de onde parou.

> Dica: teste a restauração pelo menos uma vez em um ambiente de teste, para ter certeza
> de que o procedimento funciona quando você precisar.

---

## 11. Chave da OpenAI vazou — o que fazer

1. Vá em **https://platform.openai.com/api-keys** e **revogue** a chave imediatamente.
2. Gere uma **nova** chave (projeto separado, permissão `Restricted`, hard limit mensal).
3. Atualize `OPENAI_API_KEY` no `.env`.
4. Reinicie o sistema.
5. Confira o uso/custo no painel da OpenAI para detectar consumo indevido.

O mesmo vale para tokens da Meta: revogue e gere novos no painel da Meta, depois atualize
o `.env`.

---

## 12. Rollout recomendado

Vá com calma, do seguro para o real:

1. **Simulação** — `BROWSER_DRIVER=simulated`, IA mock (sem chave). Rode `pnpm demo` e
   navegue pelo painel.
2. **Dry-run real** — `BROWSER_DRIVER=real`, `DRY_RUN=true`. Conecta no seu Chrome, mas
   **não envia** de verdade. Confirme que a aba abre, faz o trabalho e fecha sozinha. Os
   leads usados no teste continuam pendentes: ao reiniciar com `DRY_RUN=false`, eles
   recebem a DM de verdade.
3. **Autorização + piloto limitado** — só depois que você autorizar, coloque
   `DRY_RUN=false` com `MAX_DMS_PER_DAY` bem baixo e observe.
4. **Autonomia** — aumente os limites gradualmente conforme a conta e os resultados
   permitirem.

---

## 13. Onde ver o quê no painel

- **Dashboard** — visão geral, status do sistema, custo de IA.
- **Leads** — Kanban separado por funil (clientes / afiliados), com score e estados.
- **Detalhe do lead** — cadastro, histórico da conversa e timeline de eventos.
- **Jobs** — fila de tarefas do worker (tentativas, erros).
- **Exceções** — casos que pedem atenção humana.
- **Experimentos** — testes A/B e comparação de variantes.
- **Configurações** — limites, integrações, identidade do negócio e o botão de pausa.
