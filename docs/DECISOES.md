# InvisioMZ · Decisões de arquitectura

Documento vivo: regista a arquitectura final e **porquê** de cada decisão relevante, incluindo onde se desviou do enunciado e com que justificação.

## 1. Visão geral

```text
Navegador (React + TS + Tailwind) ──HTTPS──▶ FastAPI (Python) ──service_role──▶ Supabase (Postgres + Storage)
        │  supabase-js (só chave anon)            │  Pillow · NumPy · cryptography
        └────── login / sessão (Supabase Auth) ───┘  valida o JWT (assinatura, expiração, audiência)
```

* O **frontend** nunca vê a `service_role`. Só usa a chave *anon* para o Auth (login/registo/recuperação).
* O **backend** faz toda a esteganografia e a cifra, **em memória**. Valida o JWT do Supabase em cada pedido autenticado.
* O **Supabase** guarda utilizadores (Auth), **metadados** das operações, registos de ficheiros guardados e, opcionalmente, o **PNG resultante** (só útil com a senha).
* **Login obrigatório + Painel:** é preciso conta para ocultar, extrair e ver o histórico; a página inicial da área autenticada é o **Painel** (`GET /api/dashboard`: totais, PNG guardados, actividade de 7 dias, últimas operações). *Decisão do utilizador, posterior à versão inicial*: sem isto a conta era decorativa porque tudo funcionava igual sem ela.
  * O **modo convidado** que o enunciado pedia continua no código, mas atrás de `ALLOW_GUEST` (**desligado** por defeito). Quando ligado, só Ocultar/Extrair/capacidade abrem sem sessão; Painel, Histórico e Definições exigem sempre sessão.
  * O frontend escolhe a estrutura pelo estado da sessão: menu lateral (área autenticada) ou páginas públicas (Início; Entrar, Criar conta, Recuperar e Redefinir senha, estas sem cabeçalho nem rodapé, só com o ícone ao centro e uma seta para voltar). «Aprender», o botão «Criar conta» do cabeçalho e o rodapé público estão **comentados** por decisão do utilizador. Rotas protegidas redirecionam para «Entrar».
  * O painel é calculado a partir das últimas 1 000 operações, lidas **com o JWT do utilizador** (RLS), sem endpoint de agregação no Postgres (suficiente para este âmbito).

## 2. Princípio de segurança central

> A senha e a chave **nunca** são guardadas (nem Supabase, nem logs, nem disco). A imagem esteganográfica já contém dados cifrados.

Como é cumprido (e como é testado):

| Garantia | Mecanismo | Teste |
|---|---|---|
| Senha só em memória, no corpo do pedido (nunca no URL) | `Form(...)` em multipart; chave derivada descartada no fim do pedido | `test_validation_error_never_echoes_password`, `api.test.ts` |
| Logs sem segredos | Formatador JSON com **lista branca** de campos; nenhum `log.*` recebe senha/mensagem/nome | `test_logs_never_contain_password_message_or_filenames` |
| `operations` só com metadados | Colunas fixas + `CHECK`s; o serviço só preenche números/estados | `test_operations_store_only_metadata_never_content`, integração Supabase |
| Sem dados em claro em disco | `MultiPartParser.spool_max_size` elevado ao limite do pedido (o Starlette só passaria para ficheiro temporário acima de 1 MB) | revisão de código |

## 3. Esteganografia

* **LSB em R, G, B**, 1 ou 2 bits por canal. O canal alfa **não** entra na capacidade e é preservado intacto.
* **Cabeçalho de 46 bytes sempre em modo de 1 bit**, nas primeiras 368 posições (legível sem senha): magic `IVMZ`, versão, bits do corpo, KDF, parâmetros do Scrypt, salt, nonce, comprimento do corpo, CRC32. Ver [FORMATO_BINARIO.md](FORMATO_BINARIO.md).
* **Corpo espalhado por uma permutação pseudo-aleatória** derivada de uma sub-chave (HKDF da chave da senha): geram-se *n* inteiros de 32 bits com AES-256-CTR e ordenam-se de forma **estável** (`np.argsort(kind="stable")`). Escolheu-se este método porque (a) é determinístico entre versões do NumPy (ao contrário de `Generator.permutation`, cujo fluxo não é garantido), (b) é fácil de explicar numa defesa («embaralhar ordenando chaves aleatórias») e (c) não inventa criptografia: a segurança vem do AES-GCM; a permutação só reduz padrões.
* **Enchimento:** todas as posições livres recebem bits aleatórios (`os.urandom`), para que a zona com dados e a zona sem dados tenham a mesma estatística.
* **Custo:** a permutação precisa de ~16 bytes por posição durante a operação (chaves + índices). Com o limite de 12 megapíxeis (36 M posições) o pico fica na ordem de algumas centenas de MB (ver `RESULTADOS_TESTES.md` para a medição real). Por isso `MAX_IMAGE_PIXELS=12 000 000` por defeito (configurável).
* **A permutação depende das dimensões da imagem.** Cortar ou redimensionar muda *n* e inutiliza os dados (o que já aconteceria, porque os píxeis mudam).
* **LSB é detectável** por estegoanálise; isto reduz padrões, não os elimina. Está dito na interface, no README e em `MODELO_AMEACA.md`.

### Conversões de imagem (definidas e documentadas)

| Entrada | Tratamento |
|---|---|
| PNG, JPG, WEBP, BMP, GIF, TIFF, ICO (validados por *magic bytes* **e** por descodificação real) | aceites; SVG e HEIC **não** (sem dependências testadas) |
| RGB, RGBA | tal como estão; alfa separado e devolvido intacto |
| L, 1 | RGB (canal replicado) |
| LA | RGBA |
| P (paleta) | RGBA se tiver transparência, senão RGB |
| CMYK, YCbCr, LAB, HSV | RGB (conversão simples do Pillow, **sem** gestão de cor) |
| 16 bits (I;16, I) e F | 8 bits (byte mais significativo) → RGB |
| GIF/PNG/WEBP animados | 1.º fotograma + aviso |
| EXIF | orientação aplicada (para a imagem não rodar) e depois **removido** |
| Perfil ICC | convertido para sRGB e **removido** (evita vazar metadados do dispositivo) |

A saída é **sempre PNG real** (descodificar e re-codificar com Pillow; nunca renomear).

## 4. Criptografia

* **AES-256-GCM** (`cryptography`). Nonce de 12 bytes e salt de 16 bytes novos por operação (`os.urandom`).
* **Scrypt** (N = 2¹⁵, r = 8, p = 1 por defeito, ≈ 32 MiB e ≈ 0,1 s): parâmetros gravados no cabeçalho para poderem evoluir. **Ao ler**, os parâmetros são validados contra limites (N ≤ 2²⁰, r ≤ 16, p ≤ 4, memória ≤ 256 MiB) para que um cabeçalho malicioso não force o servidor a gastar memória/tempo arbitrários.
* **HKDF-SHA256** separa a chave de cifra da chave da permutação (info diferentes).
* **AAD = cabeçalho** (bytes 0–41): qualquer alteração ao cabeçalho (mesmo com o CRC refeito) invalida a tag.
* **Senha:** normalizada em NFKC e codificada em UTF-8 (a mesma senha escrita com acentos compostos/decompostos funciona). Mínimo de 10 caracteres no frontend **e** no backend.
* **Mensagem de erro honesta:** com GCM «senha errada» e «dados adulterados» são indistinguíveis → um único código `WRONG_PASSWORD_OR_TAMPERED` e uma mensagem que o explica.
* **Limite honesto da limpeza de memória:** em Python, `str` e `bytes` são imutáveis e não se podem zerar; só o buffer intermédio da senha (`bytearray`) é zerado. Está documentado como *best effort*.

## 5. Pacote interno (ZIP + manifesto)

* ZIP **sem compressão** (STORED) com `manifest.json` e entradas de ficheiros com **nomes fixos** (`files/0001.bin`…). Os nomes reais vivem só no manifesto, como texto sanitizado.
  * **Zip Slip impossível por construção** (nenhum nome do utilizador é usado como caminho).
  * **Zip bomb impossível**: só se aceitam entradas STORED (razão de compressão = 1) e verificam-se nº de entradas, tamanhos declarados e total antes de ler.
  * Capacidade **previsível** (sem compressão, a estimativa do frontend é exacta a menos de uma pequena margem).
  * Datas fixas (1980-01-01) para não vazar a hora real.
* Na extracção verifica-se o **SHA-256** de cada ficheiro do manifesto (comparação em tempo constante).
* O ZIP de **descarga** (para o utilizador) usa DEFLATE, é construído por nós e os nomes são sanitizados e únicos.

## 6. API e segurança

* **Erros:** formato único `{"error": {"code", "message", "correlation_id", "details"?}}`; `500` genérico (sem *stack traces* nem caminhos); erros de validação **nunca** devolvem o valor enviado (pode ser a senha).
* **Limites** (todos configuráveis por `.env`): imagem 20 MB, 12 MP, 20 ficheiros, 10 MB por ficheiro, 25 MB no total, mensagem 100 000 caracteres, pedido 60 MB (verificado por `Content-Length` **e** contando bytes, para pedidos *chunked*).
* **Rate limiting** próprio (janela deslizante em memória, por IP): geral 120/min, ocultar 20/min, **extrair 10/min**; mais **backoff exponencial** após ≥ 5 senhas falhadas (30 s, 60 s, 120 s… até 15 min), que bloqueia até a senha certa durante o bloqueio.
  * *Desvio do enunciado:* `slowapi` é opcional («ou equivalente»). Implementação própria (≈ 60 linhas) porque precisamos de controlar o backoff por falhas, de o testar de forma determinística e de evitar o acoplamento do `slowapi` a decoradores/`Request`.
  * *Limitação:* o estado é por processo. Com vários *workers* seria preciso Redis. Documentado.
* **CORS** restrito às origens do `.env`; em produção `*` é recusado no arranque.
* **Cabeçalhos:** CSP restritiva (`default-src 'none'`; mais permissiva só em `/docs`), `nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`, `Cache-Control: no-store` em `/api`, HSTS em produção.
* **Configuração validada no arranque** (`pydantic-settings`): em produção exige Supabase, `IP_HASH_SALT` e CORS sem `*`.
* **Documentação OpenAPI** (`/docs`) desligada em produção por defeito.
* **IP:** nunca em claro; só `sha256(sal:ip)` truncado, no `audit_log`.
* **Descarga de extracção:** os ficheiros extraídos vão para um armazém **em memória** com tokens aleatórios, validade de 5 min e **uso único**; nunca tocam em disco nem no Supabase.
  * Até 4 MB: os ficheiros vão **inline em Base64** na resposta JSON; o ZIP vai sempre por token (o frontend vai buscá-lo logo, uma vez).
  * Acima de 4 MB: cada ficheiro e o ZIP têm o seu token de uso único.
  * *Limitação:* o armazém é por processo (mesma limitação do rate limiter).

## 7. Supabase

* **Cliente do backend:** `httpx` directo ao PostgREST/Storage/Auth Admin (o enunciado permite «`supabase`/`httpx`»). Evita as dependências pesadas do `supabase-py` e deixa claro qual chave é usada em cada chamada.
* **Escritas** de `operations`, `stego_files` e `audit_log` e todo o Storage: `service_role` (só no backend).
* **Leituras e remoções do utilizador** (`/api/history*`): feitas **com o JWT do próprio utilizador** + chave anon, para o RLS ser aplicado pela base de dados (defesa em profundidade: mesmo que houvesse um erro no código, o Postgres bloquearia o acesso cruzado). A remoção do objecto no Storage usa `service_role` depois de o RLS confirmar que a linha é do utilizador.
* **RLS em todas as tabelas**; `audit_log` com RLS e **sem políticas** (ninguém, excepto o `service_role`, lê ou escreve). Privilégios revogados a `anon`/`authenticated` e concedidos só o mínimo.
* **Storage:** bucket privado `stego-results`, só `image/png`, 64 MiB; caminho `{user_id}/{uuid}.png`; o utilizador só vê/apaga a sua pasta; **não há política de INSERT** para utilizadores (só o backend carrega). Descarga **só por URL assinada de 5 min**.
* **Expiração e limpeza:** `expires_at` por defeito 7 dias (`RECORD_TTL_DAYS`). A limpeza corre **numa tarefa agendada do backend** (de hora a hora) e não em `pg_cron`: apagar linhas de `storage.objects` por SQL deixa os ficheiros órfãos no armazenamento; é preciso chamar a API do Storage. O registo da operação (metadados) mantém-se; o ficheiro passa a «expirado».
* **Eliminar conta:** o backend apaga primeiro os objectos do utilizador e depois o utilizador via Auth Admin; `ON DELETE CASCADE` remove perfil, operações, ficheiros e auditoria.
* **Perfil automático** por *trigger* no registo.

## 8. Frontend

* React 19 + TypeScript + Vite + Tailwind CSS 4 + Lucide + `@supabase/supabase-js` (só anon).
* Fontes **auto-alojadas** (`@fontsource-variable`: Fraunces para títulos, Inter para texto): sem pedidos a terceiros e compatível com uma CSP estrita.
* **Identidade visual:** creme (`#FBF4E6`) e laranja (`#C4560C`/`#F08828`) retirados do logótipo, com tema escuro quente. Contraste verificado para texto e botões (texto sobre laranja usa `#FFF8EE`/`#1A0E05`; ligações usam o laranja escuro `#9A3F05` sobre creme).
* **Acessibilidade:** ligação «Saltar para o conteúdo», foco visível, rótulos e `aria-describedby` nos campos, `aria-live` nos estados, `<dialog>` nativo para confirmações (foco preso, Esc), `prefers-reduced-motion`.
* **Trabalho em curso protegido:** `useBlocker` + `beforeunload` pedem confirmação antes de perder uma imagem por descarregar.
* **Memória:** `URL.revokeObjectURL` ao mudar/sair; a senha é apagada do estado logo depois de usada; «Limpar resultados» no Extrair.
* **Sem contas configuradas** (sem `VITE_SUPABASE_*`), as páginas que as exigem mostram uma explicação em vez de botões mortos, e o menu não mostra «Histórico» nem «Entrar».

## 9. Desvios da estrutura de pastas do enunciado

| Enunciado | Aqui | Porquê |
|---|---|---|
| `backend/app/cryptography/` | `backend/app/crypto/` | Evita o nome do pacote `cryptography` (a biblioteca) e confusões de importação. |
| `backend/app/packaging/` | `backend/app/bundle/` | Evita o nome do pacote PyPI `packaging`. |
| `slowapi` | limitador próprio | Ver §6. |

## 10. Ambiente de desenvolvimento verificado

Windows 11, **Python 3.15.1**, Node 24, Docker Desktop 29, Supabase CLI 2.121 (via `npm`). As versões estão fixas em `backend/requirements.txt` e `frontend/package-lock.json`. Foram escolhidas versões que têm *wheels* para Python 3.15; em Python 3.11/3.12 as mesmas versões também devem funcionar, mas **só foi testado em 3.15**.
