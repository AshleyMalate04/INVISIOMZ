# InvisioMZ

**Esconda mensagens e ficheiros dentro de imagens PNG.** O InvisioMZ cifra o conteúdo com **AES-256-GCM** (chave derivada da senha com **Scrypt**) e esconde-o com **LSB** (bit menos significativo) em posições pseudo-aleatórias dos canais R, G, B. Sem a senha, a imagem é só mais uma fotografia.

> Projecto académico de **Segurança Informática** (Tarefa 2: implementação própria em Python; a Tarefa 1 usa ferramentas como Steghide/Stegosuite, que são independentes deste projecto).
> ⚠️ **LSB é detectável por estegoanálise** e a imagem tem de chegar **intacta**. Não use isto como única protecção de segredos de alto risco. Ver [docs/MODELO_AMEACA.md](docs/MODELO_AMEACA.md).

## O que tem

| | |
|---|---|
| **Ocultar** | Imagem + mensagem e/ou ficheiros + senha → PNG real. Capacidade em tempo real, comparação de tamanhos, SHA-256, verificação pós-escrita. |
| **Extrair** | PNG + senha → mensagem (com «copiar»), ficheiros (individual ou ZIP). Só revela algo depois de a tag AES-GCM autenticar. Inclui uma **verificação opcional de integridade**: cole o SHA-256 mostrado ao criar a imagem e a aplicação diz «Ficheiro intacto» ou «Ficheiro diferente do original» (calculado no navegador). |
| **Histórico** | (com conta) operações, PNG guardados com URL assinado de 5 min, eliminar. |
| **Aprender** | **Desligado.** A página (`frontend/src/pages/Learn.tsx`) continua no código mas a rota e os botões estão comentados (`routes.tsx`, `AppShell.tsx`, `PublicShell.tsx`, `History.tsx`). Para a reactivar, descomente-os. |
| **Painel** | Depois de iniciar sessão: resumo das operações, PNG guardados, actividade dos últimos 7 dias e atalhos. É a página inicial da área autenticada. |
| **Login obrigatório** | Ocultar, Extrair, Histórico e Definições exigem sessão (o backend responde `401` sem ela). O modo convidado existe mas vem **desligado** (`ALLOW_GUEST=true`, só para desenvolvimento). |

## Stack

* **Frontend:** React 19 + TypeScript + Vite + Tailwind CSS 4 + Lucide + `@supabase/supabase-js` (só chave *anon*).
* **Backend:** Python + FastAPI + Pillow + NumPy + `cryptography` + `httpx` + PyJWT.
* **Base de dados e serviços:** Supabase (Postgres + Auth + Storage) com **Supabase CLI local** (Docker), custo zero.

```text
estego-safe/
├── backend/            FastAPI, esteganografia, criptografia, testes (pytest)
│   └── app/{api,core,services,steganography,crypto,bundle,schemas}
├── frontend/           React + TS + Tailwind (+ testes Vitest)
├── supabase/           config.toml, migrations/ (tabelas, RLS, bucket), seed.sql
├── docs/               DECISOES, MODELO_AMEACA, FORMATO_BINARIO, GUIA_APRESENTACAO, RESULTADOS_TESTES
└── .github/workflows/  CI
```

## Como funciona (resumo)

1. A **senha** passa por **Scrypt** (N = 2¹⁵, r = 8, p = 1, salt de 16 B) e por **HKDF** → chave AES de 256 bits + chave da permutação.
2. O conteúdo vai para um **pacote ZIP** (sem compressão) com um `manifest.json` (SHA-256 de cada ficheiro).
3. O pacote é cifrado com **AES-256-GCM** (nonce de 12 B); o **cabeçalho** de 46 B é a AAD, por isso qualquer alteração invalida a autenticação.
4. O texto cifrado é escondido por **LSB** (1 ou 2 bits por canal) em posições dadas por uma **permutação pseudo-aleatória**; o resto do espaço livre é preenchido com bits aleatórios.
5. O PNG é relido e decifrado no servidor **antes** de lho entregarmos.

Detalhes: [docs/FORMATO_BINARIO.md](docs/FORMATO_BINARIO.md) · decisões: [docs/DECISOES.md](docs/DECISOES.md).

## Requisitos (Windows 10/11)

| Ferramenta | Para quê | Verificado com |
|---|---|---|
| **Python 3.11+** | backend | 3.15.1 |
| **Node.js 20+** (inclui `npm`) | frontend e Supabase CLI | 24 |
| **Docker Desktop** (a correr) | Supabase local | 29 |
| **Supabase CLI** | vem como dependência `npm` do projecto (`npx supabase`), não precisa de instalar à parte | 2.121 |
| ~4 GB de RAM livres | Supabase local + backend (cada imagem de 12 MP usa ≈ 1 GB durante o processamento) | |

> Só testei em **Python 3.15.1**. Em 3.11/3.12 as mesmas versões deverão funcionar, mas isso **não foi verificado**.

## Instalação e arranque (PowerShell)

Abra o PowerShell na pasta do projecto (`estego-safe`). Se o PowerShell recusar executar `Activate.ps1`, corra antes `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass`.

### 1) Supabase local (contas, histórico, Storage)

Abra o **Docker Desktop** e espere que fique «Engine running». Depois:

```powershell
npm install
npm run db:start
```

A primeira vez descarrega algumas imagens Docker (alguns minutos) e **aplica as migrações** de `supabase/migrations/`. No fim, obtenha as chaves locais:

```powershell
npx supabase status -o env
```

> **Portas:** usei 55320–55329 (em vez das 543xx por defeito) porque no Windows o Hyper-V/Docker pode reservar as 543xx e o arranque falha com «bind: forbidden by its access permissions». Pode mudar em `supabase/config.toml`.

### 2) Backend (FastAPI)

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements-dev.txt
Copy-Item .env.example .env
```

Edite `backend\.env` e cole os valores do passo 1: `SUPABASE_URL` (= `API_URL`), `SUPABASE_ANON_KEY` (= `ANON_KEY`), `SUPABASE_SERVICE_ROLE_KEY` (= `SERVICE_ROLE_KEY`) e `SUPABASE_JWT_SECRET` (= `JWT_SECRET`). Depois arranque:

```powershell
python -m uvicorn app.main:app --port 8000
```

Teste em <http://127.0.0.1:8000/api/health> (deve mostrar `"supabase":"ok"`) e a documentação em <http://127.0.0.1:8000/docs>.
**Sem Supabase?** Como o login é obrigatório, sem Supabase ninguém consegue entrar. Só para desenvolvimento, deixe `SUPABASE_*` vazio **e** ponha `ALLOW_GUEST=true` no `backend\.env` (e `VITE_SUPABASE_*` vazio no frontend): Ocultar/Extrair funcionam sem conta e nada é guardado.

### 3) Frontend (React)

Noutro PowerShell:

```powershell
cd frontend
npm install
Copy-Item .env.example .env.local
```

Edite `frontend\.env.local` com `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` (a **anon**, nunca a service_role). Deixe `VITE_API_URL` vazio em desenvolvimento (o Vite encaminha `/api` para o backend). Arranque:

```powershell
npm run dev
```

Abra <http://localhost:5173>.

### Parar tudo

`Ctrl+C` nos dois terminais e `npm run db:stop` na raiz.

## Variáveis de ambiente

### Backend (`backend/.env`)

| Variável | Defeito | Descrição |
|---|---|---|
| `ENVIRONMENT` | `development` | `development` / `test` / `production`. Em produção o arranque **falha** sem Supabase, sem `IP_HASH_SALT` ou com `*` no CORS. |
| `CORS_ORIGINS` | `http://localhost:5173,…` | Origens permitidas (separadas por vírgulas). |
| `ALLOW_GUEST` | `false` | Modo convidado (ocultar/extrair sem conta). Desligado: é preciso iniciar sessão. |
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` | vazio | Ligação ao Supabase. |
| `SUPABASE_SERVICE_ROLE_KEY` | vazio | **Só no backend.** Nunca no frontend nem no git. |
| `SUPABASE_JWT_SECRET` | vazio | Valida JWT HS256; se vazio, valida ES256/RS256 pelo JWKS do Supabase. |
| `IP_HASH_SALT` | aleatório por processo | Sal do hash dos IP no `audit_log` (obrigatório em produção). |
| `MAX_IMAGE_BYTES` / `MAX_IMAGE_PIXELS` | 20 MB / 12 000 000 | Limites da imagem (anti *decompression bomb*). |
| `MAX_FILES` / `MAX_FILE_BYTES` / `MAX_TOTAL_BYTES` | 20 / 10 MB / 25 MB | Limites dos anexos. |
| `MAX_REQUEST_BYTES` | 60 MB | Tamanho máximo do pedido. |
| `MAX_CONCURRENT_JOBS` | 2 | Operações pesadas em simultâneo (controla a RAM). |
| `PASSWORD_MIN_LENGTH` | 10 | Tamanho mínimo da senha (frontend e backend). |
| `SCRYPT_LOG2N` / `SCRYPT_R` / `SCRYPT_P` | 15 / 8 / 1 | Custo do Scrypt (mínimo 14); fica gravado em cada imagem. |
| `RATE_LIMIT_ENABLED` | `true` | Liga o rate limiting. |
| `RATE_HIDE_PER_MIN` / `RATE_EXTRACT_PER_MIN` | 20 / 10 | Pedidos por minuto e por IP. |
| `EXTRACT_FAIL_THRESHOLD` | 5 | Senhas falhadas até começar o *backoff* exponencial. |
| `TRUST_PROXY_HEADERS` | `false` | `true` só atrás de um proxy inverso de confiança (usa `X-Forwarded-For`, lido **da direita**, para não poder ser falsificado); senão, todos os pedidos parecem vir do IP do proxy e partilham os limites. |
| `PROXY_HOPS` | 1 | Quantos proxies de confiança existem à frente da aplicação. |
| `RECORD_TTL_DAYS` | 7 | Dias até um PNG guardado expirar. |
| `SIGNED_URL_TTL_S` | 300 | Validade do URL assinado de descarga. |
| `LOG_LEVEL` | `INFO` | Nível dos logs (JSON, sem dados sensíveis). |

### Frontend (`frontend/.env.local`)

| Variável | Descrição |
|---|---|
| `VITE_API_URL` | URL do backend. Vazio em desenvolvimento (proxy do Vite). |
| `VITE_SUPABASE_URL` | URL do Supabase (necessário para iniciar sessão). |
| `VITE_SUPABASE_ANON_KEY` | Chave **anon** (pública). |

## Testes

```powershell
# Backend (a partir de backend\, com o venv activo)
python -m pytest -q

# Com o Supabase local a correr: inclui os testes de integração (RLS, Storage, URLs assinadas, limpeza)
npx supabase status -o env     # copie as chaves para as variáveis abaixo
$env:SUPABASE_URL="…"; $env:SUPABASE_ANON_KEY="…"; $env:SUPABASE_SERVICE_ROLE_KEY="…"; $env:SUPABASE_JWT_SECRET="…"
python -m pytest -q

# Frontend (a partir de frontend\)
npx tsc -b
npm run lint
npm test
npm run build
```

Sem as variáveis `SUPABASE_*`, os 11 testes de integração aparecem como **«skipped»** (não como «passed»). Resultados reais: [docs/RESULTADOS_TESTES.md](docs/RESULTADOS_TESTES.md).

## Formatos e limites

* **Entrada:** PNG, JPG/JPEG, WEBP, BMP, GIF (1.º fotograma, com aviso), TIFF, ICO. Validados por *magic bytes* **e** descodificação real. **SVG e HEIC não são suportados.**
* **Saída:** sempre **PNG real** (RGB ou RGBA). Metadados EXIF/ICC removidos; o canal alfa é preservado.
* **Capacidade bruta** (1 bit): `largura × altura × 3 ÷ 8` bytes; com 2 bits, o dobro. A **útil** desconta o cabeçalho (46 B), a tag GCM (16 B) e o pacote ZIP/manifesto. Exemplo: 1920 × 1080 → 777 600 B brutos.
* Se não couber, dá erro claro (`CAPACITY_EXCEEDED`) com alternativas; **nunca trunca** nem reduz automaticamente.

## Limitações de segurança (a ler antes de usar)

* LSB é **detectável** (qui-quadrado, RS…); o InvisioMZ reduz padrões, **não** os elimina.
* **Qualquer alteração aos píxeis** (JPEG, redimensionar, recortar, WhatsApp…) destrói os dados. Partilhe o PNG como documento.
* A senha viaja ao servidor por **HTTPS** (obrigatório em produção); o servidor não a guarda mas **vê-a** durante o pedido.
* **Senha esquecida = dados irrecuperáveis.**
* Rate limiting, *backoff* e descargas temporárias vivem em **memória de um processo** (um só *worker*).
* Em Python não se consegue apagar `str`/`bytes` da memória; a limpeza é *best effort*.
* Implementação académica: não auditada por terceiros.

## Problemas frequentes

| Sintoma | Causa e solução |
|---|---|
| `npm run db:start` falha com «bind: forbidden by its access permissions» | O Windows reservou a porta. Mude as portas em `supabase/config.toml` (já estão em 553xx) ou veja `netsh interface ipv4 show excludedportrange protocol=tcp`. |
| «failed to connect to the docker API» | O Docker Desktop não está a correr. Abra-o e espere por «Engine running». |
| Aparece «Contas indisponíveis neste ambiente» | O frontend ou o backend estão sem Supabase configurado (ou o backend está desligado). Veja `/api/health` e `frontend\.env.local`. |
| Sou sempre levado para «Entrar» | É o comportamento normal sem sessão: a área autenticada exige login. |
| `Activate.ps1 cannot be loaded` | `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass` e repita. |
| Erro de CORS no navegador | Ponha a origem do frontend em `CORS_ORIGINS` (ou use o proxy do Vite com `VITE_API_URL` vazio). |
| «Senha errada ou imagem alterada» com a senha certa | A imagem foi recomprimida/redimensionada, ou não é o PNG do InvisioMZ. Use o ficheiro exactamente como foi descarregado. |
| Ocultar demora muito | Imagens perto de 12 MP demoram ≈ 10 s e ≈ 1 GB de RAM; use uma imagem mais pequena ou reduza `MAX_IMAGE_PIXELS`. |
| Recebo `429` ao extrair | Rate limiting / *backoff* após senhas falhadas. Aguarde o tempo indicado em `Retry-After`. |

## Demonstração

Guião passo a passo e perguntas prováveis do docente: [docs/GUIA_APRESENTACAO.md](docs/GUIA_APRESENTACAO.md).
#   I N V I S I O M Z  
 