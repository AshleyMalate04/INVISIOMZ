# InvisioMZ · Guia de apresentação

Duração sugerida: 12–15 minutos + perguntas. Tenha **antes**: Docker a correr, `npm run db:start` feito, backend e frontend a correr, uma fotografia de ≥ 1 MP (ex.: 1600 × 1200), um PDF pequeno e um `.txt`, e o PNG de uma demonstração anterior como reserva.

## 1. Guião passo a passo

| # | O que mostrar | O que dizer | Resultado esperado |
|---|---|---|---|
| 1 | **Início** | «Esteganografia esconde que *existe* uma mensagem; criptografia esconde o *conteúdo*. Aqui fazemos as duas: primeiro cifra, depois esconde.» | Fluxo em 5 passos; avisos de capacidade e de LSB. |
| 2 | **Aprender → LSB** (exemplo interactivo) | Escreva «A»: 01000001. «Cada bit substitui o último bit de um canal; o valor muda no máximo ±1.» Mostre a calculadora: 1920 × 1080 × 3 ÷ 8 = 777 600 B. | A tabela mostra −1, −1, −1, +1 nas posições certas. |
| 3 | **Ocultar · 1 Imagem** | Carregue a fotografia. «Mostra logo nome, tamanho original, dimensões e capacidade para 1 e 2 bits.» | Pré-visualização, `JPEG · 1600 × 1200 px`, capacidades úteis. |
| 4 | **2 Conteúdo** | Escreva uma mensagem com acentos e emoji («Olá, Moçambique! ✓ 🚀») e junte o PDF e o `.txt` (arrastar). «A barra mostra o conteúdo estimado contra a capacidade.» | Lista com tamanhos e total; barra de utilização. |
| 5 | **3 Senha** | Escreva uma senha curta (recusa), depois uma frase longa; confirme. «Mínimo 10 caracteres; o indicador de força; avisa que esquecida = irrecuperável.» | Mensagens de validação junto aos campos. |
| 6 | **4 Rever e ocultar → 5 Resultado** | «O servidor cifra com AES-256-GCM, esconde por LSB e **volta a ler o PNG** para confirmar antes de devolver.» Mostre a comparação **original vs final**, a nota sobre o PNG ser maior, o SHA-256 e **Descarregar**. | `k7x2_foto.png`, «2,4 MB → 5,1 MB (+112 %)» (valores reais da sua imagem). |
| 7 | **Extrair (senha certa)** | Carregue o PNG descarregado. Extraia: mensagem (copiar), ficheiros (descarregar, ZIP). Abra o PDF para provar que é idêntico. | Conteúdo igual; SHA-256 verificado. |
| 8 | **Extrair (senha errada)** | «Com AES-GCM, senha errada e dados adulterados são indistinguíveis — por isso a mensagem diz isso e **nada é revelado**.» Repita 5× para mostrar o *backoff* (429 + `Retry-After`). | `WRONG_PASSWORD_OR_TAMPERED`; depois bloqueio temporário. |
| 9 | **Extrair (imagem sem dados)** | Carregue a fotografia original. | `NO_HIDDEN_DATA` (mensagem diferente da senha errada). |
| 10 | **Capacidade insuficiente** | Com uma imagem pequena (ex.: 100 × 100) tente esconder o PDF. | Erro claro com alternativas (imagem maior ou 2 bits). Nunca trunca. |
| 11 | **Código ↔ conceitos** (VS Code) | `lsb.py` (permutação e `embed`), `envelope.py` (cabeçalho e AAD), `kdf.py` (Scrypt/HKDF), `aead.py` (GCM). Mostre `docs/FORMATO_BINARIO.md`. | Cada conceito do §4 está num ficheiro curto. |
| 12 | **Histórico + RLS** | Entre numa conta, oculte com «Guardar no histórico», descarregue, elimine. Mostre `supabase/migrations/…init_schema.sql` (RLS) e corra os testes de integração (RLS: o utilizador B não vê nem apaga dados do A; URL assinado expira). | `10 passed` nos testes de integração. |
| 13 | **Integridade** (opcional) | Abra o PNG no Paint, guarde como JPG e tente extrair. | Falha: LSB não sobrevive a compressão com perdas. |

## 2. Perguntas prováveis (e respostas honestas)

**P: O que é, em termos simples, o LSB?**
R: Cada canal de cor (R, G ou B) tem 8 bits. O último vale ±1 no brilho, o que o olho não vê. Troco esses bits pelos da mensagem. Com 1 bit por canal, uma imagem de 1 MP guarda cerca de 375 KB em bruto.

**P: Porque é que não escreve a mensagem directamente nos bits, em ordem?**
R: Porque o padrão ficaria óbvio. Cifro primeiro (a mensagem passa a ser bytes aleatórios), espalho os bits por posições pseudo-aleatórias derivadas da senha e encho o resto com ruído, para que a zona com dados e a sem dados tenham a mesma estatística.

**P: Isso torna-o indetectável?**
R: **Não.** LSB continua detectável por estegoanálise (qui-quadrado, RS, SPA), sobretudo quando a imagem está muito cheia. Reduzo padrões, não os elimino. O que protege o *conteúdo* é a cifra; a esteganografia só ajuda a que ninguém procure.

**P: Porque AES-GCM e não só AES?**
R: GCM é uma cifra **autenticada**: além de cifrar, produz uma tag que prova que nem o conteúdo nem o cabeçalho foram alterados. Sem autenticação, uma senha errada daria lixo em vez de um erro, e um atacante podia alterar bits sem ser detectado.

**P: O que é a AAD?**
R: «Dados associados»: o cabeçalho do envelope entra na autenticação sem ser cifrado. Se alguém mexer num bit do cabeçalho (mesmo refazendo o CRC32), a tag falha. Há um teste para isso (`test_header_tampering_detected_with_valid_crc`).

**P: Como distingue senha errada de imagem adulterada?**
R: **Não distingo, e isso é uma propriedade do GCM**: nos dois casos a tag falha. Em vez de fingir, a aplicação diz isso. Distingo outros casos: sem dados (`NO_HIDDEN_DATA`), cabeçalho corrompido (`CORRUPTED_IMAGE`), versão desconhecida, dados cortados (`TRUNCATED_PAYLOAD`).

**P: Porque Scrypt?**
R: Uma senha humana tem pouca entropia. O Scrypt gasta memória (≈ 32 MiB) e tempo (≈ 0,1 s) de propósito, o que encarece muito testar senhas em massa. O salt aleatório evita tabelas pré-calculadas; os parâmetros ficam gravados na imagem para poderem evoluir. Mínimo de 10 caracteres.

**P: A senha é guardada?**
R: **Nunca**: nem no Supabase, nem em logs, nem em disco. Viaja ao backend por HTTPS (obrigatório em produção), é usada em memória e descartada. O servidor consegue vê-la durante o pedido: é uma limitação que está no modelo de ameaça. Há testes que capturam os logs e verificam que a senha e a mensagem não aparecem.

**P: Então o que guarda o Supabase?**
R: Contas (Auth), **metadados** das operações (tipo, estado, dimensões, tamanhos — nunca conteúdo) e, se o utilizador pedir, o PNG cifrado num bucket privado que expira em 7 dias. O IP, quando é registado, é só um hash com sal.

**P: Como garante que um utilizador não vê os dados de outro?**
R: **RLS** em todas as tabelas (`auth.uid() = user_id`), Storage por pasta, e o backend lê o histórico **com o JWT do utilizador** (a base de dados aplica o RLS). Há testes de integração contra um Supabase real: o utilizador B recebe listas vazias, não consegue apagar e o Storage devolve erro.

**P: E se mudarem a imagem (WhatsApp, JPEG, redimensionar)?**
R: Os dados perdem-se: o LSB não sobrevive a compressão com perdas nem a alterações de píxeis. Não implementei correcção de erros. Por isso a saída é sempre PNG e a interface avisa para enviar como documento.

**P: Vulnerabilidades dos uploads?**
R: Valido a imagem por descodificação real, com limite de píxeis (*decompression bombs*), de bytes e de nº de ficheiros. Os anexos vão para um ZIP com **nomes internos fixos** (Zip Slip impossível) e **sem compressão** (zip bomb impossível); os nomes verdadeiros são sanitizados. Um cabeçalho malicioso não consegue pedir memória arbitrária: os comprimentos e os parâmetros do Scrypt são validados antes de alocar.

**P: Qual a diferença para o Steghide e o Stegosuite?**
R: São ferramentas **existentes e independentes**: o Steghide (linha de comandos) esconde dados em JPEG/BMP/WAV/AU; o Stegosuite (Java, com interface gráfica) em BMP/GIF/JPG/PNG, ambos com cifra por senha. Servem para a Tarefa 1. Aqui implementei o algoritmo de raiz em Python (Tarefa 2) para o poder explicar byte a byte; **não é compatível** com os ficheiros delas nem as usa. O Steghide, por exemplo, escolhe os píxeis por teoria de grafos para preservar estatísticas; o meu método é mais simples (permutação + enchimento).

**P: Porque PNG e não JPEG?**
R: O PNG é sem perdas: os bits que escrevo são os que leio. O JPEG guarda coeficientes DCT e destrói os LSB. (Esconder em JPEG é possível mas noutros domínios, como o Steghide faz.)

**P: Por que é que o PNG final é muito maior que o JPG original?**
R: Porque o PNG é sem perdas, e o ruído dos LSB torna a compressão menos eficaz. O espaço usado pelos dados escondidos é só uma pequena parte desse aumento (a interface mostra os dois números).

**P: Qual o limite prático?**
R: 12 megapíxeis por defeito. Uma imagem de 12 MP demora ≈ 10 s a ocultar e ≈ 7 s a extrair, com ≈ 1 GB de RAM de pico (medido neste PC; ver `RESULTADOS_TESTES.md`). O custo vem da permutação sobre 36 M de posições. Há um limite de operações pesadas simultâneas.

**P: O que ficou por fazer / limitações?**
R: Correcção de erros; estegoanálise própria; rate limiting partilhado entre vários *workers* (hoje é em memória); auditoria externa; testes E2E (Playwright) — não implementei; só testei em Python 3.15.1.

**P: Isto é seguro para segredos reais?**
R: Para um trabalho académico e uso pessoal de baixo risco, a cifra (AES-256-GCM + Scrypt) é sólida. Mas a esteganografia LSB não resiste a um perito, e é uma implementação não auditada. Para segredos de alto risco, use ferramentas auditadas e canais cifrados.

## 3. Plano B se algo falhar

* **Docker/Supabase não arranca:** sem Supabase não há login, e o login é obrigatório. Para uma demonstração de emergência ligue o modo convidado (`ALLOW_GUEST=true` no `backend\.env`, `SUPABASE_*` e `VITE_SUPABASE_*` vazios): Ocultar/Extrair funcionam, sem painel nem histórico.
* **Backend lento:** use imagens ≤ 2 MP na demonstração (alguns segundos).
* **PNG de reserva:** tenha um `reserva.png` com a senha anotada num papel.
