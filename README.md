# InvisioMZ

**Esconda mensagens e ficheiros dentro de imagens PNG.** O InvisioMZ cifra o conteúdo com **AES-256-GCM** (chave derivada da senha com **Scrypt**) e esconde-o com **LSB** (bit menos significativo) em posições pseudo-aleatórias dos canais R, G, B. Sem a senha, a imagem é só mais uma fotografia.

> 📝 **Projeto académico de Segurança Informática**  
> (Tarefa 2: implementação própria em Python; a Tarefa 1 usa ferramentas como Steghide/Stegosuite, que são independentes deste projeto).

> ⚠️ **Aviso de Segurança**  
> **LSB é detetável por estegoanálise** e a imagem tem de chegar **intacta**. Não use isto como única proteção de segredos de alto risco. Ver [docs/MODELO_AMEACA.md](docs/MODELO_AMEACA.md).

---

## O que tem

| Funcionalidade | Descrição |
| :--- | :--- |
| **Ocultar** | Imagem + mensagem e/ou ficheiros + senha → PNG real. Capacidade em tempo real, comparação de tamanhos, SHA-256, verificação pós-escrita. |
| **Extrair** | PNG + senha → mensagem (com «copiar»), ficheiros (individual ou ZIP). Só revela algo depois de a tag AES-GCM autenticar. Inclui uma **verificação opcional de integridade**: cole o SHA-256 mostrado ao criar a imagem e a aplicação diz «Ficheiro intacto» ou «Ficheiro diferente do original» (calculado no navegador). |
| **Histórico** | (Com conta) operações, PNG guardados com URL assinado de 5 min, eliminar. |
| **Aprender** | **Desligado.** A página (`frontend/src/pages/Learn.tsx`) continua no código, mas a rota e os botões estão comentados (`routes.tsx`, `AppShell.tsx`, `PublicShell.tsx`, `History.tsx`). Para a reativar, descomente-os. |
| **Painel** | Depois de iniciar sessão: resumo das operações, PNG guardados, atividade dos últimos 7 dias e atalhos. É a página inicial da área autenticada. |
| **Login obrigatório** | Ocultar, Extrair, Histórico e Definições exigem sessão (o backend responde `401` sem ela). O modo convidado existe mas vem **desligado** (`ALLOW_GUEST=true`, só para desenvolvimento). |

---

## Stack

* **Frontend:** React 19 + TypeScript + Vite + Tailwind CSS 4 + Lucide + `@supabase/supabase-js` (só chave *anon*).
* **Backend:** Python + FastAPI + Pillow + NumPy + `cryptography` + `httpx` + PyJWT.
* **Base de dados e serviços:** Supabase (Postgres + Auth + Storage) com **Supabase CLI local** (Docker), custo zero.

```text
estego-safe/
├── backend/          # FastAPI, esteganografia, criptografia, testes (pytest)
│   └── app/          # {api,core,services,steganography,crypto,bundle,schemas}
├── frontend/         # React + TS + Tailwind (+ testes Vitest)
├── supabase/         # config.toml, migrations/ (tabelas, RLS, bucket), seed.sql
├── docs/             # DECISOES, MODELO_AMEACA, FORMATO_BINARIO, GUIA_APRESENTACAO, RESULTADOS_TESTES
└── .github/          # workflows/ CI
```

---

## Como funciona (resumo)

1. A **senha** passa por **Scrypt** ($N = 2^{15}$, $r = 8$, $p = 1$, salt de 16 B) e por **HKDF** → chave AES de 256 bits + chave da permutação.
2. O conteúdo vai para um **pacote ZIP** (sem compressão) com um `manifest.json` (SHA-256 de cada ficheiro).
3. O pacote é cifrado com **AES-256-GCM** (nonce de 12 B); o **cabeçalho** de 46 B é a AAD, por isso qualquer alteração invalida a autenticação.
4. O texto cifrado é escondido por **LSB** (1 ou 2 bits por canal) em posições dadas por uma **permutação pseudo-aleatória**; o resto do espaço livre é preenchido com bits aleatórios.
5. O PNG é relido e decifrado no servidor **antes** de lhe ser entregue.  
   * Detalhes: [docs/FORMATO_BINARIO.md](docs/FORMATO_BINARIO.md) · Decisões: [docs/DECISOES.md](docs/DECISOES.md).

---

## Requisitos (Windows 10/11)

| Ferramenta | Para que serve | Verificado com |
| :--- | :--- | :--- |
| **Python 3.11+** | Backend | 3.15.1 |
| **Node.js 20+** (inclui `npm`) | Frontend e Supabase CLI | 24 |
| **Docker Desktop** (a correr) | Supabase local | 29 |
| **Supabase CLI** | Vem como dependência `npm` do projeto (`npx supabase`) | 2.121 |
| **~4 GB de RAM livres** | Supabase local + backend (imagens de 12 MP usam ≈ 1 GB no processamento) | |

> ⚠️ **Nota:** Só foi testado em **Python 3.15.1**. Em versões 3.11 ou 3.12 as mesmas dependências deverão funcionar, mas esse cenário **não foi verificado**.

---

## Instalação e arranque (PowerShell)

Abra o PowerShell na pasta raiz do projeto (`estego-safe`). Se o PowerShell recusar executar o script `Activate.ps1`, execute primeiro o seguinte comando:
```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
```

### 1) Supabase local (contas, histórico, Storage)
Abra o **Docker Desktop** e certifique-se de que exibe a mensagem "Engine running". De seguida, execute:
```powershell
npm install
npm run db:start
```
*A primeira execução irá descarregar as imagens Docker (demora alguns minutos) e **aplicar as migrações** presentes em `supabase/migrations/`.*

No final, obtenha as variáveis de ambiente locais:
```powershell
npx supabase status -o env
```
> 💡 **Nota sobre Portas:** Foram configuradas as portas `55320–55329` (em vez das `543xx` habituais) porque no Windows o Hyper-V/Docker pode reservar o intervalo `543xx`, originando o erro `bind: forbidden by its access permissions`. Pode alterar este comportamento em `supabase/config.toml`.

### 2) Backend (FastAPI)
```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements-dev.txt
Copy-Item .env.example .env
```
Edite o ficheiro `backend\.env` e cole os valores gerados no Passo 1: `SUPABASE_URL` (= `API_URL`), `SUPABASE_ANON_KEY` (= `ANON_KEY`), `SUPABASE_SERVICE_ROLE_KEY` (= `SERVICE_ROLE_KEY`) e `SUPABASE_JWT_SECRET` (= `JWT_SECRET`).

Inicie o servidor:
```powershell
python -m uvicorn app.main:app --port 8000
```
* Teste a API em `http://localhost:8000/health` (deve responder com `"supabase":"ok"`).
* Aceda à documentação interativa em `http://localhost:8000/docs`.

> ⚙️ **Modo Sem Supabase (Desenvolvimento):** Como a autenticação é obrigatória, sem o Supabase ativo não conseguirá aceder às funcionalidades. Para testar localmente em modo convidado, limpe as variáveis `SUPABASE_*` e defina `ALLOW_GUEST=true` no ficheiro `backend\.env` (faça o mesmo limpando `VITE_SUPABASE_*` no frontend). Desta forma, o Ocultar/Extrair funcionará no navegador e nada será guardado na base de dados.

### 3) Frontend (React)
Abra uma nova janela do PowerShell e execute:
```powershell
cd frontend
npm install
Copy-Item .env.example .env.local
```
Edite o ficheiro `frontend\.env.local` configurando os campos `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` (utilize sempre a chave **anon**, nunca a *service_role*). Deixe `VITE_API_URL` em branco em ambiente de desenvolvimento (o Vite faz o proxy automático de `/api` para o backend).

Arranque a aplicação:
```powershell
npm run dev
```
Abra o navegador em `http://localhost:5173`.

### Parar os Serviços
Pressione `Ctrl+C` nos terminais ativos e execute `npm run db:stop` na raiz do projeto.

---

## Variáveis de ambiente

### Backend (`backend/.env`)

| Variável | Valor por Omissão | Descrição |
| :--- | :--- | :--- |
| `ENVIRONMENT` | `development` | `development` / `test` / `production`. Em produção o arranque **falha** sem Supabase, sem `IP_HASH_SALT` ou com `*` no CORS. |
| `CORS_ORIGINS` | `http://localhost:5173` | Origens permitidas (separadas por vírgulas). |
| `ALLOW_GUEST` | `false` | Modo convidado (ocultar/extrair sem conta). Quando falso, exige sessão ativa. |
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` | *vazio* | Parâmetros de ligação à API do Supabase. |
| `SUPABASE_SERVICE_ROLE_KEY` | *vazio* | **Exclusivo do backend.** Nunca partilhar no frontend ou commits de Git. |
| `SUPABASE_JWT_SECRET` | *vazio* | Valida JWT HS256; se estiver em branco, valida os formatos ES256/RS256 através do JWKS do Supabase. |
| `IP_HASH_SALT` | *aleatório por processo* | Salt para mascarar os IPs na tabela `audit_log` (obrigatório em ambiente de produção). |
| `MAX_IMAGE_BYTES` / `MAX_IMAGE_PIXELS` | `20 MB` / `12000000` | Limites máximos da imagem de entrada (proteção contra *decompression bombs*). |
| `MAX_FILES` / `MAX_FILE_BYTES` / `MAX_TOTAL_BYTES` | `20` / `10 MB` / `25 MB` | Restrições aplicadas aos ficheiros anexos. |
| `MAX_REQUEST_BYTES` | `60 MB` | Payload máximo aceite por pedido HTTP. |
| `MAX_CONCURRENT_JOBS` | `2` | Número de tarefas pesadas em execução simultânea para mitigar picos de consumo de RAM. |
| `PASSWORD_MIN_LENGTH` | `10` | Comprimento mínimo exigido para a palavra-passe (validado em ambos os lados). |
| `SCRYPT_LOG2N` / `SCRYPT_R` / `SCRYPT_P` | `15` / `8` / `1` | Fatores de custo do algoritmo Scrypt (mínimo de 14); metadados embutidos no PNG gerado. |
| `RATE_LIMIT_ENABLED` | `true` | Ativa o controlo de fluxo de pedidos (Rate Limiting). |
| `RATE_HIDE_PER_MIN` / `RATE_EXTRACT_PER_MIN` | `20` / `10` | Volume de requisições admitido por minuto para cada endereço IP. |
| `EXTRACT_FAIL_THRESHOLD` | `5` | Número de falhas consecutivas de senha antes de aplicar *backoff* exponencial. |
| `TRUST_PROXY_HEADERS` | `false` | Ative apenas se a aplicação operar atrás de um reverse proxy confiável. Lê o cabeçalho `X-Forwarded-For` **da direita para a esquerda** para evitar falsificações de IP. |
| `PROXY_HOPS` | `1` | Contagem de proxies intermédios de confiança localizados à frente do servidor da aplicação. |
| `RECORD_TTL_DAYS` | `7` | Janela de tempo em dias antes de um ficheiro PNG armazenado ser considerado expirado. |
| `SIGNED_URL_TTL_S` | `300` | Tempo de vida em segundos para a validade do URL assinado de download. |
