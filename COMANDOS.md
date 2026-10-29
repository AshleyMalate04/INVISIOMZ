# InvisioMZ: comandos para o CMD (Linha de Comandos do Windows)

Todos os comandos abaixo são para o **cmd.exe** (não o PowerShell).
Pasta do projecto: `C:\Users\user\Desktop\ESTEGANOGRAFIA\estego-safe`

São precisos **3 janelas do CMD** abertas ao mesmo tempo:

| Janela | O quê | Porta |
|---|---|---|
| 1 | Supabase local (base de dados, contas, Storage) | 55321 (API) |
| 2 | Backend (FastAPI) | 8000 |
| 3 | Frontend (React + Vite) | 5173 |

Antes de tudo, abra o **Docker Desktop** e espere por «Engine running».

---

## Primeira vez (instalação)

### Janela 1: Supabase (na raiz do projecto)

```bat
cd /d C:\Users\user\Desktop\ESTEGANOGRAFIA\estego-safe
npm install
npm run db:start
npx supabase status -o env
```

O último comando mostra `API_URL`, `ANON_KEY`, `SERVICE_ROLE_KEY` e `JWT_SECRET`. Guarde-os para os passos seguintes.

### Janela 2: Backend

```bat
cd /d C:\Users\user\Desktop\ESTEGANOGRAFIA\estego-safe\backend
python -m venv .venv
.venv\Scripts\activate.bat
pip install -r requirements-dev.txt
copy .env.example .env
notepad .env
```

No `.env`, cole os valores da janela 1:

| No `.env` | Valor de `supabase status -o env` |
|---|---|
| `SUPABASE_URL` | `API_URL` (`http://127.0.0.1:55321`) |
| `SUPABASE_ANON_KEY` | `ANON_KEY` |
| `SUPABASE_SERVICE_ROLE_KEY` | `SERVICE_ROLE_KEY` |
| `SUPABASE_JWT_SECRET` | `JWT_SECRET` |

Depois arranque:

```bat
python -m uvicorn app.main:app --port 8000
```

Verifique em <http://127.0.0.1:8000/api/health> (deve aparecer `"supabase":"ok"`).

### Janela 3: Frontend

```bat
cd /d C:\Users\user\Desktop\ESTEGANOGRAFIA\estego-safe\frontend
npm install
copy .env.example .env.local
notepad .env.local
```

No `.env.local`:

* `VITE_API_URL=` (deixe vazio)
* `VITE_SUPABASE_URL=http://127.0.0.1:55321`
* `VITE_SUPABASE_ANON_KEY=` o `ANON_KEY` da janela 1 (**nunca** a service_role)

Depois arranque:

```bat
npm run dev
```

Abra <http://localhost:5173>.

---

## Arranque do dia a dia

Depois da instalação, basta isto (Docker Desktop aberto):

**Janela 1: Supabase**

```bat
cd /d C:\Users\user\Desktop\ESTEGANOGRAFIA\estego-safe
npm run db:start
```

**Janela 2: Backend**

```bat
cd /d C:\Users\user\Desktop\ESTEGANOGRAFIA\estego-safe\backend
.venv\Scripts\activate.bat
python -m uvicorn app.main:app --port 8000
```

**Janela 3: Frontend**

```bat
cd /d C:\Users\user\Desktop\ESTEGANOGRAFIA\estego-safe\frontend
npm run dev
```

---

## Parar tudo

1. `Ctrl+C` na janela do backend e na do frontend (responda `S` se perguntar «Terminar o trabalho em lotes?»).
2. Na janela 1:

```bat
npm run db:stop
```

---

## Testes

### Backend (na pasta `backend`, com o venv activo)

```bat
python -m pytest -q
```

Sem as variáveis do Supabase, os 11 testes de integração aparecem como «skipped». Para os incluir (com o Supabase a correr), defina as variáveis **na mesma janela**, sem aspas e sem espaços à volta do `=`:

```bat
set SUPABASE_URL=http://127.0.0.1:55321
set SUPABASE_ANON_KEY=cole-aqui-o-ANON_KEY
set SUPABASE_SERVICE_ROLE_KEY=cole-aqui-o-SERVICE_ROLE_KEY
set SUPABASE_JWT_SECRET=cole-aqui-o-JWT_SECRET
python -m pytest -q
```

### Frontend (na pasta `frontend`)

```bat
npx tsc -b
npm run lint
npm test
npm run build
```

---

## Outros comandos úteis

| Comando | Onde | Para quê |
|---|---|---|
| `npm run db:status` | raiz | Ver se o Supabase está a correr e os URLs |
| `npm run db:env` | raiz | Mostrar as chaves locais (igual a `npx supabase status -o env`) |
| `npm run db:reset` | raiz | **Apaga os dados locais** e volta a aplicar as migrações e o `seed.sql` |
| `npm run db:start:full` | raiz | Supabase com todos os serviços (inclui o Studio em <http://127.0.0.1:55323>) |
| `npm run preview` | frontend | Servir a versão de produção já compilada (`npm run build` antes) |
| `deactivate` | backend | Sair do venv do Python |
| `python -c "import secrets;print(secrets.token_hex(32))"` | qualquer | Gerar um valor para `IP_HASH_SALT` |

---

## Problemas frequentes no CMD

| Sintoma | Solução |
|---|---|
| `'python' não é reconhecido…` | Instale o Python e marque «Add python.exe to PATH», ou use `py` em vez de `python`. |
| `'npm' não é reconhecido…` | Instale o Node.js 20+ e abra uma janela nova do CMD. |
| `failed to connect to the docker API` | O Docker Desktop não está aberto. Abra-o e espere por «Engine running». |
| `bind: forbidden by its access permissions` | Porta reservada pelo Windows. Veja `netsh interface ipv4 show excludedportrange protocol=tcp` e ajuste as portas em `supabase\config.toml`. |
| `No module named uvicorn` | O venv não está activo: corra `.venv\Scripts\activate.bat` dentro de `backend`. |
| Porta 8000 ou 5173 ocupada | `netstat -ano \| findstr :8000` mostra o PID; feche-o com `taskkill /PID número /F`. |
