# InvisioMZ · Resultados dos testes

Resultados **reais** (executados, não estimados), em 22/10/2026.
Ambiente: Windows 11 Pro 10.0.26200 · Python 3.15.1 · Node 24.18.1 / npm 11.16 · Docker Desktop 29 · Supabase CLI 2.121.0 (Postgres 17.11).

## Resumo

| Verificação | Resultado |
|---|---|
| Backend `pytest` **sem** Supabase | **138 passed, 11 skipped**, 0 failed (≈ 12 s) |
| Backend `pytest` **com** Supabase local real | **149 passed**, 0 skipped, 0 failed (≈ 19 s) |
| Frontend `tsc -b` | passou (0 erros) |
| Frontend `eslint .` | passou (0 erros, 0 avisos) |
| Frontend `vitest run` | **66 passed**, 2 skipped (os do «Aprender», desligado) — 5 ficheiros |
| Frontend `vite build` | passou (JS 646 kB / 187 kB gzip; CSS 38 kB / 8 kB gzip) |
| `pip-audit -r requirements.txt` | «No known vulnerabilities found» |
| `npm audit` (frontend e raiz) | 0 vulnerabilities |

Os 11 «skipped» são os testes de integração com o Supabase: **só correm se `SUPABASE_*` apontar para um Supabase acessível**; sem isso aparecem como *skipped*, nunca como *passed*. Nesta máquina correram com o Supabase local (Docker) e passaram todos.

## Backend por ficheiro

| Ficheiro | Testes | O que cobre (itens do enunciado §11) |
|---|---|---|
| `tests/test_core.py` | 58 | 1 round-trip (acentos, símbolos, emojis, 5000 chars) · 2/3 ficheiros e mensagem, SHA-256 idêntico, ficheiro vazio · 4 JPEG/WEBP/BMP/GIF/TIFF/ICO/PNG → PNG real (assinatura + descodificação) · 5 modos de 1 e 2 bits, RGB/RGBA/L/LA/P/CMYK, 16 bits, alfa intacto, EXIF removido, orientação EXIF · 6 capacidade insuficiente, ajuste exacto no limite, imagem sem envelope, versão/CRC inválidos, **comprimento malicioso**, parâmetros KDF maliciosos · 7 senha errada, bit flips no corpo, cabeçalho adulterado **com CRC refeito (AAD)**, bits do cabeçalho trocados, imagem cortada, re-codificação JPEG · 10 salt e nonce únicos · permutação determinística/bijectiva, equivalência da ordenação rápida com a de referência, vector fixo · GIF animado com aviso · formatos inválidos/SVG |
| `tests/test_package_security.py` | 25 | 8 **Zip Slip** (nomes no ZIP e no manifesto), **zip bomb** (entrada de 50 MB comprimida em ≈ 50 KB, recusada), tamanho total, nº de entradas, entradas extra, SHA-256, `id` com `../`, nomes duplicados, sanitização (reservados do Windows, bidi, zero-width, controlo, comprimento), nome de saída `xxxx_nome.png`, `Content-Disposition` RFC 5987 sem injecção |
| `tests/test_api.py` | 38 | 11 health, config, capacity (+ aviso GIF), hide (PNG real, cabeçalhos, nome, SHA-256), extract (inline, ZIP e tokens de **uso único**), formato de erro e códigos HTTP (415, 422, 413, 400…), validação sem eco da senha · 9 pixels a mais, decompression bomb 400 MP, limites de imagem/ficheiros/total, corpo do pedido por `Content-Length` e *chunked* · 11 JWT inválido/expirado/audiência errada/assinatura errada/`alg=none`/ausente, **ES256 via JWKS** · rate limiting, **backoff** após senhas falhadas, reposição após sucesso · 13 **logs sem senha, mensagem nem nomes** · erro 500 genérico com correlation id · CORS · cabeçalhos de segurança · limite de operações pesadas simultâneas |
| `tests/test_history_api.py` | 17 | `operations` só com metadados (sem conteúdo/senha/nomes) · convidado não guarda nada (só `audit_log` com hash do IP) · guardar/listar/descarregar/eliminar · utilizador B não lê nem apaga dados de A · falha de Storage devolve o PNG na mesma · expirados e limpeza · eliminar conta. **Usa um gateway Supabase simulado em memória** (a verdade sobre o RLS está nos testes de integração). |
| `tests/test_supabase_integration.py` | 11 | 12 **Supabase local real**: trigger de perfil · guardar + URL assinado que **expira** (2 s) · **RLS**: B vê 0 linhas e não apaga nada de A, Storage nega a B e ao público · utilizadores autenticados não escrevem em `operations`/`audit_log` nem carregam para o bucket · bucket privado, só `image/png`, ≥ 50 MiB · `operations` nunca contém conteúdo · limpeza de expirados remove objecto e linha · eliminar conta remove utilizador, linhas e objecto |

## Frontend

| Ficheiro | Testes | Cobre |
|---|---|---|
| `src/utils/utils.test.ts` | 11 | `formatBytes` (B/KB/MB, vírgula decimal), `formatSizeChange` («2,4 MB → 5,1 MB (+113 %)»), fórmulas de capacidade iguais às do backend, estimativa do pacote, força da senha |
| `src/services/api.test.ts` | 6 | erros do backend → `ApiError`, erro de rede, `Retry-After`, JWT enviado e 401 → sessão terminada, senha no corpo (não no URL) |
| `src/utils/hash.test.ts` | 5 | SHA-256 contra o vector padrão FIPS («abc»), ficheiro vazio, normalização do código colado (maiúsculas, espaços, blocos de 8, prefixo `sha256:`) e recusa de códigos inválidos |
| `src/pages/pages.test.tsx` | 27 (2 saltados) |
| `src/pages/dashboard.test.tsx` | 17 | **Login obrigatório** (5 rotas sem sessão → «Entrar»; início público com «Criar conta»; modo convidado ligado; histórico sempre protegido) · **Páginas públicas** (cabeçalho só com «Entrar», «Como funciona», ecrãs de entrada sem cabeçalho/rodapé e com seta de voltar, `/aprender` inexistente) · **Painel** (menu lateral, resumo, taxa de sucesso, PNG guardados, gráfico com tabela acessível, atalhos, estados vazio e de erro, terminar sessão) — com cliente Supabase simulado | Fluxo **Ocultar** completo (5 passos, validação de senha e confirmação, resultado com comparação de tamanhos, descarga com o nome de saída, erro `CAPACITY_EXCEEDED`, bloqueio por capacidade, imagem acima do limite) · **Extrair** (senha errada, `NO_HIDDEN_DATA`, sucesso com ZIP e ficheiro, limpar resultados, `revokeObjectURL`) · Aprender (exemplo LSB e calculadora) · contas indisponíveis em 5 rotas, menu sem «Entrar»/«Histórico», servidor inacessível, 404 · `CapacityBar`, `ConfirmDialog` |

## Verificações manuais (no navegador integrado, Chromium)

Feitas por mim com o backend e o Supabase locais a correr; **não são testes automáticos**:

* Ocultar (imagem JPEG gerada, mensagem com acentos/emoji + ficheiro `.txt`) → PNG real → extrair com a senha certa (mensagem e ficheiro recuperados) e com a errada (erro específico, campo limpo, nada revelado).
* Diálogo de «Sair desta página?» quando o PNG ainda não foi descarregado.
* Registo → sessão iniciada → ocultar com «Guardar no histórico» → pré-visualização carregada do URL assinado → Histórico → Descarregar → Eliminar (objecto removido do Storage) → Definições (nome vindo do trigger de perfil) → **Eliminar conta** (utilizador removido do Auth).
* **Login obrigatório e Painel** (com o backend real): sem sessão, `/ocultar` leva a «Entrar» e `POST /api/hide` devolve `401`; registo → Painel com menu lateral → ocultar com «Guardar no histórico» → o Painel passa a mostrar 1 operação, 100 % de sucesso, o gráfico dos 7 dias e 1 PNG guardado (897,2 KB).
* Tema escuro e viewport de 375 px: sem scroll horizontal em `/`, `/ocultar`, `/extrair`, `/aprender`, `/entrar` e 404.

## Desempenho medido (este PC; imagem aleatória de 12 MP = 4000 × 3000, o limite por defeito)

| Operação | Tempo | Pico de RAM (RSS) |
|---|---|---|
| Scrypt (N = 2¹⁵, r = 8, p = 1) | 0,09 s | — |
| Ocultar (1 ou 2 bits, ~1 MB de conteúdo) | 9,1–9,6 s | ≈ 940–970 MB |
| Extrair | 7,2–7,3 s | ≈ 970 MB |
| PNG resultante | 32,7 MB | — |

A parte dominante é a permutação sobre 36 milhões de posições (ordenação radix de 2 × 16 bits ≈ 5 s). Medidas feitas com o `psutil` num *script* à parte (não faz parte do projecto). Imagens de 1–2 MP demoram poucos segundos.

## O que NÃO foi feito ou verificado

* **Testes E2E (Playwright):** não implementados (eram opcionais). O fluxo foi verificado à mão (acima) e por testes de componentes com a API simulada.
* **CI (`.github/workflows/ci.yml`):** escrito mas **nunca executado** (não houve push para o GitHub). Usa Python 3.12; só testei em **Python 3.15.1**.
* **Produção:** nenhum projecto Supabase real, HTTPS, verificação de email nem recuperação de senha por email foram testados (localmente a confirmação está desligada e o Mailpit foi excluído do arranque). O código dessas partes existe mas está **por verificar** em ambiente real.
* **Navegadores:** só Chromium (o do painel integrado). Firefox, Safari e telemóveis reais não foram testados.
* **Acessibilidade:** boas práticas aplicadas (rótulos, `aria-*`, foco, `<dialog>`, contraste escolhido a olho/cálculo), mas **sem auditoria automática (axe/Lighthouse)** nem teste com leitor de ecrã.
* **Sem testes automáticos** para as páginas de Histórico, Definições e Autenticação com Supabase activo (só os estados «contas indisponíveis»); verificadas manualmente.
* **Tarefa de limpeza agendada** (`_cleanup_loop`): o que ela chama (`cleanup_expired`) está testado, o ciclo temporizado não.
* **`pip-audit`** só sobre `requirements.txt` (dependências de execução), não sobre as de desenvolvimento.
* **Estegoanálise:** não medi a detectabilidade (qui-quadrado, RS) das imagens produzidas. A afirmação «LSB é detectável» é teoria conhecida, não uma medição deste projecto.
* **Vários *workers*:** rate limiting, *backoff* e armazém de descargas são por processo.
