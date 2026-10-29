# InvisioMZ · Modelo de ameaça

Projecto **académico**. Este documento diz com honestidade o que a aplicação protege, contra quem e, sobretudo, o que **não** protege.

## 1. Activos

| Activo | Onde existe | Quem o deve poder ver |
|---|---|---|
| Mensagem/ficheiros em claro | memória do navegador, memória do backend durante o pedido | só o utilizador |
| Senha de ocultação | memória do navegador e do backend durante o pedido | só o utilizador |
| PNG com dados escondidos | navegador do utilizador; opcionalmente Supabase Storage (privado) | quem tiver a senha (o PNG, sozinho, é só uma imagem com dados cifrados) |
| Metadados das operações | Supabase (`operations`) | só o próprio utilizador (RLS) |
| JWT do utilizador | navegador (supabase-js) | só o utilizador |

## 2. Fronteiras de confiança

```text
[Navegador] ──HTTPS──▶ [Backend FastAPI] ──service_role (HTTPS)──▶ [Supabase]
     │                        ▲
     └── anon key + JWT ──────┴──▶ [Supabase Auth / PostgREST sob RLS]
```

* O backend **é confiado** com a senha e o conteúdo em claro durante cada pedido. Quem controla o servidor (ou o seu TLS) pode vê-los.
* O Supabase **não é confiado** com a senha nem com conteúdo em claro: nunca os recebe.

## 3. O que a aplicação protege (e contra quem)

| Ameaça | Protecção | Limites |
|---|---|---|
| **Um observador que só vê a imagem** (não sabe que há dados) | Dados cifrados (AES-256-GCM) e espalhados por posições pseudo-aleatórias; zona livre preenchida com ruído; saída PNG; metadados EXIF/ICC removidos | Não resiste a estegoanálise (ver §4) |
| **Alguém que descobre que há dados** mas não tem a senha | AES-256-GCM + Scrypt: só vê bytes aleatórios autenticados; tentar senhas custa ≈ 32 MiB e ≈ 0,1 s cada | Senhas fracas caem a dicionários offline (o PNG permite ataque offline) |
| **Adulteração** do PNG ou do cabeçalho | Tag GCM com o cabeçalho como AAD; CRC32 distingue corrupção de ausência | Não distingue «senha errada» de «adulterado» (é uma propriedade do GCM) |
| **Fuga a partir do Supabase** (base de dados roubada) | Só há metadados e PNGs cifrados; nunca senhas, chaves ou conteúdo em claro | Os PNG guardados podem ser alvo de ataque offline à senha |
| **Utilizador A a ler dados do B** | RLS em todas as tabelas; Storage por pasta; leituras do histórico feitas com o JWT do utilizador; URLs assinadas de 5 min | Depende de o Supabase estar correctamente configurado (migrações incluídas e testadas) |
| **Upload malicioso** (decompression bomb, Zip Slip, zip bomb, cabeçalho com comprimento falso) | Validação por descodificação real, limite de píxeis/bytes/ficheiros, nomes internos fixos, só entradas STORED, comprimentos validados antes de alocar, limites ao custo do KDF | DoS volumétrico (muitos pedidos válidos) só é mitigado pelo rate limiting básico |
| **Força bruta online** da senha via `/api/extract` | 10 pedidos/min por IP + backoff exponencial após 5 falhas (até 15 min) | Um atacante com muitos IPs ou o PNG offline não é travado |
| **XSS / injecção de cabeçalhos** | CSP, `nosniff`, descargas sempre `attachment` + `application/octet-stream`, `Content-Disposition` RFC 5987 com nomes sanitizados, React a escapar texto | — |
| **Fuga por logs** | Logs JSON com lista branca; sem senhas, mensagens, nomes de ficheiro ou stack traces | Logs de proxies/infra fora do controlo da aplicação |
| **Perda de privacidade do IP** | Só `sha256(sal:ip)` no `audit_log` | O servidor web/proxy pode registar IPs |

## 4. O que NÃO protege

1. **Estegoanálise.** LSB é um método clássico e **detectável** (qui-quadrado, RS, SPA…), sobretudo com a imagem muito cheia. O InvisioMZ reduz padrões (permutação + enchimento aleatório) mas **não torna o LSB invisível a um perito**. Esconder que há comunicação não é garantido.
2. **Robustez.** Qualquer alteração aos píxeis (JPEG, redimensionar, recortar, rodar, filtros, recompressão por apps de mensagens como o WhatsApp) destrói os dados. Não há correcção de erros.
3. **O servidor vê tudo durante o pedido.** A senha viaja ao backend por HTTPS (**obrigatório em produção**; sem HTTPS qualquer rede intermédia a lê). Se não confiar no servidor, não use um servidor alheio: corra o seu.
4. **Dispositivo comprometido** (malware, *keylogger*, extensões do navegador): vê a senha e o conteúdo antes de qualquer protecção.
5. **Senha fraca ou esquecida.** Fraca: o PNG permite ataque offline. Esquecida: **irrecuperável** (não há *backdoor*).
6. **Metadados de tamanho.** O comprimento do corpo cifrado fica no cabeçalho (em claro) e o resto é ruído: revela *aproximadamente* quanto foi escondido e que a imagem é do InvisioMZ (o *magic* `IVMZ` é legível, por desenho do enunciado: «cabeçalho fixo em 1 bit para ser sempre legível»).
7. **Limpeza de memória.** Em Python não é possível zerar `str`/`bytes` imutáveis; a senha e as chaves podem permanecer na memória até o coletor as libertar (e, num *swap* ou *core dump*, ir parar a disco). Só se zera o `bytearray` intermédio da senha.
8. **Estado por processo.** Rate limiting, backoff e o armazém de descargas vivem na memória de um único processo; vários *workers* contornariam os limites.
9. **Ataques de canal lateral** (tempos, cache) à implementação em Python.
10. **Negação de serviço distribuída.**
11. **Conformidade legal** (RGPD/LPD): fora do âmbito. Os dados pessoais guardados são email, nome opcional, metadados de operações e o hash salgado do IP, apagáveis pelo próprio utilizador.

## 5. Decisões que reduzem o risco

* **Cifrar antes de esconder**: se o LSB for detectado, o atacante só obtém dados autenticados.
* **Scrypt com parâmetros no cabeçalho**: dá para endurecer sem quebrar imagens antigas.
* **Falhar fechado**: qualquer erro em validação/KDF/AEAD/ZIP devolve erro sem conteúdo parcial.
* **Verificação pós-escrita**: o PNG gerado é relido e decifrado antes de ser devolvido.
* **Mínimo privilégio**: a `service_role` só no backend; `anon`/`authenticated` sem escrita em `operations`/`stego_files`/`audit_log`.

## 6. Superfície de ataque e mitigação resumida

| Entrada | Validação principal |
|---|---|
| Imagem | *magic bytes* + descodificação real + limite de bytes e de píxeis (`DecompressionBombError` tratado) |
| Ficheiros anexos | nº, tamanho individual e total; tratados como bytes; nome sanitizado; nunca executados |
| Mensagem | limite de caracteres |
| Senha | ≥ 10 caracteres (frontend e backend); nunca registada; NFKC |
| Cabeçalho escondido | magic, versão, CRC, bits/KDF dentro de limites, comprimento ≤ capacidade e ≤ limite, tudo **antes** de alocar |
| Pacote ZIP (só após autenticação GCM) | STORED, nº/tamanho/nomes/SHA-256 verificados |
| JWT | assinatura (HS256 com segredo, ou ES256/RS256 por JWKS), `exp`, `aud=authenticated`; `alg=none` recusado |
| Parâmetros de rota | `operation_id` validado como UUID |
