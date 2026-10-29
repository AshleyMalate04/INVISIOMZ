# Formato binário do envelope InvisioMZ (versão 1)

Todos os inteiros multi-byte são **big-endian**. Os bits são gravados do mais significativo para o menos significativo de cada byte (`numpy.unpackbits`/`packbits`, ordem por defeito).

## 1. Modelo de «posições»

A imagem RGB (H × W × 3, `uint8`) é vista como uma lista de **M = H·W·3 posições** (uma por canal), percorrida por linhas, pixel a pixel, canais R, G, B. Cada posição transporta 1 ou 2 bits no(s) seu(s) bit(s) menos significativo(s). O canal alfa nunca é tocado.

```text
posição:   0 ........ 367 | 368 ................................... M-1
conteúdo:  [ CABEÇALHO ]  | [        zona do CORPO (n = M − 368)       ]
bits/pos.: 1 (sempre)     | 1 ou 2 (campo «bits» do cabeçalho)
ordem:     sequencial     | permutação pseudo-aleatória de [0, n)
```

## 2. Cabeçalho (46 bytes = 368 bits, 1 bit por posição, sequencial)

```text
 off  len  campo           notas
   0    4  magic           ASCII "IVMZ" (49 56 4D 5A)
   4    1  versão          1
   5    1  bits do corpo   1 ou 2
   6    1  id do KDF       1 = scrypt
   7    1  log2(N)         scrypt (por defeito 15; aceite 14–20)
   8    1  r               scrypt (por defeito 8; aceite 1–16)
   9    1  p               scrypt (por defeito 1; aceite 1–4)
  10   16  salt            aleatório por operação (os.urandom)
  26   12  nonce           AES-GCM, aleatório por operação (os.urandom)
  38    4  ct_len          bytes do corpo cifrado, INCLUINDO a tag GCM (≥ 16)
  42    4  CRC32           de bytes 0..41 (zlib.crc32 & 0xFFFFFFFF)
```

* **AAD do AES-GCM = bytes 0..41** (tudo menos o CRC). Mexer em qualquer campo invalida a tag, mesmo que o CRC seja recalculado.
* O CRC32 **não** é uma protecção de segurança: serve só para distinguir «cabeçalho danificado» (`CORRUPTED_IMAGE`) de «não há dados» (`NO_HIDDEN_DATA`).
* Ordem de validação ao ler: magic (`NO_HIDDEN_DATA`) → versão (`UNSUPPORTED_VERSION`) → CRC (`CORRUPTED_IMAGE`) → bits/KDF e limites de custo (`CORRUPTED_IMAGE`) → `ct_len ≥ 16`.

## 3. Corpo

```text
corpo = AES-256-GCM(chave_enc, nonce, pacote_ZIP, aad = cabeçalho[0:42])   →  ciphertext (len(pacote)) ‖ tag (16)
ct_len = len(pacote) + 16
```

### Derivação de chaves

```text
mestre   = scrypt(NFKC(senha).utf8, salt, N = 2^log2n, r, p, dkLen = 32)
chave_enc  = HKDF-SHA256(mestre, salt = nenhum, info = "invisiomz/v1/aes-256-gcm",       L = 32)
chave_perm = HKDF-SHA256(mestre, salt = nenhum, info = "invisiomz/v1/pixel-permutation", L = 32)
```

### Colocação

1. `n = M − 368` posições livres. `n_sym = ⌈ct_len · 8 / bits⌉` símbolos de `bits` bits (com `bits = 2`, o símbolo é `(b₀ << 1) | b₁`, em que b₀ é o bit anterior do fluxo).
2. **Permutação:** `keystream = AES-256-CTR(chave_perm, IV = 0¹⁶)` → `n` inteiros de 32 bits little-endian → `perm = argsort_estável(keystream)`.
3. O símbolo *i* vai para a posição `368 + perm[i]` (para *i* < `n_sym`).
4. Todas as restantes posições livres recebem `bits` bits aleatórios (`os.urandom`).

Como a permutação depende de `n`, **a imagem tem de manter exactamente as mesmas dimensões**.

## 4. Pacote (plaintext do AES-GCM)

ZIP **sem compressão**, datas 1980-01-01:

```text
manifest.json         {"v":1,"message":<string|null>,"files":[{"id":"0001","name":"…","size":N,"sha256":"<hex>","mime":"…"}, …]}
files/0001.bin        bytes do 1.º ficheiro
files/0002.bin        …
```

* `name` é o nome sanitizado (sem caminhos, sem caracteres de controlo/bidi, nomes reservados do Windows prefixados com `_`, ≤ 100 caracteres, únicos sem distinguir maiúsculas).
* Na leitura: `v == 1`; nº de entradas ≤ `MAX_FILES + 1`; só entradas STORED e não cifradas; cada `id` casa `^\d{4}$` e tem entrada `files/<id>.bin` com o tamanho declarado; sem entradas extra; soma dos tamanhos ≤ `MAX_TOTAL_BYTES`; SHA-256 confere.

## 5. Capacidade

| Grandeza | Fórmula |
|---|---|
| Bruta (1 bit) | `W · H · 3 / 8` bytes (arredondado para baixo); para 2 bits, o dobro |
| Corpo cifrado máximo | `⌊(W·H·3 − 368) · bits / 8⌋` |
| Pacote útil máximo | corpo máximo − 16 (tag GCM) |
| Conteúdo útil | pacote útil − sobrecarga do ZIP/manifesto |

Exemplo (1000 × 1000, 1 bit): bruta 375 000 B; corpo máx. 374 954 B; pacote útil 374 938 B.

## 6. Limites e comprimentos

* `ct_len` é validado **antes de alocar** memória: tem de caber nas posições da imagem (`TRUNCATED_PAYLOAD` caso contrário) e não pode exceder `MAX_TOTAL_BYTES + 4·MAX_MESSAGE_CHARS + 1 MiB` (`CORRUPTED_IMAGE`).
* Máximo teórico de `ct_len`: 2³² − 1 bytes (4 GiB), mas o limite prático é o do servidor.
* Imagens com menos de 368 posições não podem ter cabeçalho → `NO_HIDDEN_DATA`.

## 7. Evolução

O campo de versão (1) e os parâmetros do KDF no cabeçalho permitem mudar o formato sem quebrar imagens antigas: uma versão futura lê a versão 1 e uma versão antiga recusa a nova com `UNSUPPORTED_VERSION`.
