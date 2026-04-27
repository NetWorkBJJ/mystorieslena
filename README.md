# MyStoriesLena — Gerador de Roteiros

Aplicativo desktop (Electron + Next.js) que automatiza a produção de roteiros de romance dark / máfia / milionário em 5 etapas guiadas, cada uma com um agente Claude especializado.

## Etapas do fluxo

1. **Premissa** — conceito central (Parte 1 + Parte 2)
2. **Estrutura — Parte 1** — mapa, capítulos, hook (11.500 palavras / 6 capítulos)
3. **Estrutura — Parte 2** — cena íntima, alternância FMC/MMC, epílogo (13.000–13.500 palavras / 5–6 capítulos)
4. **Escrita** — roteiro completo em fluxo contínuo + auto-revisão + memória viva + validação
5. **Revisor** — editor literário rigoroso com 4 graus de classificação de erro e nota final

## Pré-requisitos

- **Windows** 10/11 x64 **OU macOS** 11+ (Apple Silicon ou Intel)
- Conta Claude Pro ou Max (a app usa sua assinatura, não consome API)
- O `claude` CLI logado pelo menos uma vez (instalado automaticamente junto do app)

## Instalação para usuários finais

Baixe o instalador da [última release](../../releases/latest) conforme o seu sistema:

### Windows

1. Baixe `MyStoriesLena-Setup-X.Y.Z.exe`.
2. Execute. O Windows pode mostrar **"Windows protegeu seu PC"** — clique em **Mais informações** → **Executar mesmo assim** (acontece porque o app não está code-signed).
3. Siga o wizard NSIS.

### macOS

Escolha o `.dmg` de acordo com o seu Mac:
- **Apple Silicon (M1/M2/M3/M4):** `MyStoriesLena-X.Y.Z-arm64.dmg`
- **Intel (Macs até 2020):** `MyStoriesLena-X.Y.Z-x64.dmg`

1. Abra o `.dmg`, arraste o ícone do MyStoriesLena pra **Applications**.
2. Na primeira execução, o macOS vai dizer **"MyStoriesLena.app não pode ser aberto porque é de desenvolvedor não identificado"**. Pra abrir mesmo assim:
   - Clique com **botão direito** (ou Ctrl+clique) no ícone do app em **Aplicativos**.
   - Escolha **Abrir** no menu.
   - Na caixa que aparece, clique em **Abrir**.
   - Só precisa fazer isso uma vez. Nas próximas, abre direto.

### Pós-instalação (qualquer sistema)

3. Na primeira abertura, o app pede pra você logar no Claude. Faça uma vez (abre o navegador) e a credencial fica salva.
4. Comece a usar — a partir daí o app verifica atualizações sozinho a cada inicialização (botão **Verificar atualizações** no header).

## Desenvolvimento

```bash
# instalar deps
npm install

# rodar em modo dev (Next.js + Electron com hot-reload)
npm run electron:dev

# gerar instalador local
npm run icon:build       # gera o ícone .ico a partir do SVG
npm run package          # gera dist-electron/MyStoriesLena-Setup-X.Y.Z.exe

# publicar uma release no GitHub (atualiza app dos colegas automaticamente)
npm run release
```

### Modo LIVE (autor)

Se você é quem mantém o código e quer que o `MyStoriesLena.exe` instalado leia diretamente do código-fonte sem precisar reinstalar a cada mudança, configure uma variável de ambiente apontando pra pasta do projeto:

```powershell
setx MYSTORIESLENA_SOURCE_DIR "C:\Users\<seu-user>\caminho-pro-projeto"
```

Depois fecha e reabre todos os terminais e o app. A partir daí, qualquer alteração no código aparece ao fechar/abrir o `MyStoriesLena.exe`.

## Como a autenticação Claude funciona

O app usa o `@anthropic-ai/claude-agent-sdk`, que por baixo chama o binário `claude` (Claude Code CLI) bundleado dentro do instalador. Esse binário lê o token OAuth de `~/.claude/credentials.json`.

**Cada usuário precisa ter conta Claude própria** (Pro ou Max) e fazer login uma vez no PC dele — não dá pra compartilhar uma única conta entre vários colegas.

`.env.local` é opcional, só se quiser forçar uso de API key. Veja `.env.local.example`.

## Editar os prompts dos agentes

Cada etapa tem o prompt em `lib/agents/`:

- `premissa.ts` + (prompt inline)
- `estrutura1.ts` / `estrutura1-prompt.ts`
- `estrutura2.ts` / `estrutura2-prompt.ts`
- `escrita.ts` / `escrita-prompt.ts`
- `revisor.ts` / `revisor-prompt.ts`

O agente recebe `systemPrompt` (regras gerais) e `buildUserMessage` (contexto do step). Para mexer em qualidade sem alterar regras, ajuste `model`, `thinking`, `effort` no agente.

## Stack

- **Frontend**: Next.js 16 (App Router) + TypeScript + Tailwind CSS 4 + shadcn/ui
- **Estado**: Zustand (wizard) + LocalStorage (rascunhos no navegador)
- **Backend**: Next.js API Routes (`app/api/agent/[step]`) com streaming SSE token-a-token
- **IA**: Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`) — autentica pela sua assinatura
- **Desktop**: Electron 33 + electron-builder (NSIS installer) + electron-updater (auto-update)

## Distribuição e auto-update

Cada `npm run release`:
1. Builda o Next.js standalone
2. Empacota o `.exe` via electron-builder
3. Publica no GitHub Releases

Os apps já instalados nos PCs dos colegas verificam o GitHub Releases na inicialização. Se houver versão nova, baixam silenciosamente e aplicam ao reabrir o app.

Pré-requisito pro `npm run release`: ter `GH_TOKEN` (token GitHub com permissão `repo`) setado como variável de ambiente.
