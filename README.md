# Cadê o Busão

App para relógios **Zepp OS** (feito para o Amazfit Active 3 Premium; funciona em relógios redondos com Zepp OS 4 ou mais recente) que mostra quanto falta para os ônibus de Belo Horizonte chegarem ao seu ponto, usando os dados abertos de tempo real da **BHTrans**.

## Como funciona

```
Relógio (page/)  ──mensagem──▶  App Zepp no celular (app-side/)  ──HTTPS──▶  temporeal.pbh.gov.br
```

- `setting/`: tela de configurações que abre no app Zepp do celular (mesmo visual do protótipo aprovado). Tema em dois botões (Escuro/Claro); número da linha com até 6 sugestões pelo começo do número (ou o aviso "Uai, não achei essa linha em BH..."); a linha encontrada num cartão verde-claro com o selo; o sentido em dois cartões "Para <destino>" com "<n> pontos · sai de <1º ponto>"; o ponto numa lista com cara de trajeto (trilho, bolinhas, 1º, 2º...) e busca pela rua sem ligar para acentos; nome opcional com atalhos 🏠 Casa / 💼 Trabalho / 🎓 Faculdade; pontos salvos em cartões com "Remover" e "Desfazer". Há uma opção avançada para digitar latitude e longitude.
- `app-side/`: roda no celular. Baixa o CSV de posições GPS dos ônibus (um download serve todos os pedidos de 15 s), mede a distância de cada ônibus até o ponto **pela rua** (projetando no trajeto da linha), descarta os que já passaram e devolve ao relógio:
  - `GET_FAVORITES`: pontos salvos (com a rua do ponto abreviada, `street`) e tema;
  - `GET_SUMMARY`: o próximo ônibus de **todos** os pontos de uma vez (`{ items: [{ key, eta }] }`), para a tela inicial;
  - `GET_BUSES`: os 3 primeiros ônibus de um ponto e o mini mapa já em pixels e já enquadrado (`zoom` opcional: escala manual em px/km).
  Ele também lembra, entre as atualizações, quais ônibus vinham chegando, para avisar o que **acabou de passar** do ponto. Mudanças no `settingsStorage` só viram aviso ao relógio para as chaves `favorites` e `theme`.
- `page/home`: saudação pelo horário, título com a barrinha de 4 cores e um cartão por ponto (selo da linha, nome, rua abreviada e, à direita, os minutos do próximo ônibus na cor da faixa, ou "—"). Atualiza a cada 30 s; com mais de 3 pontos a tela rola.
- `page/detail`: número grande do tempo à esquerda e mini mapa à direita. O celular escolhe a escala para caber o ônibus e o ponto (30–260 px/km, centro entre os dois) e a mantém enquanto ela servir, para o mapa não pular. Girar a **coroa** (ou tocar em **+**/**−**) muda o zoom e pede o mapa nessa escala; **tocar no mapa** volta ao automático. O rodapé mostra a escala ("zoom automático · 700 m por 100 px"). No mapa: trajeto, pontos da linha, trecho do ônibus até o seu ponto em #2E7D78 saindo exatamente do ícone, pontilhado coral sobre o caminho que o ônibus já fez (até 4 km atrás, parado no mapa) e o ícone do ônibus na cor do tempo, que desliza entre as atualizações. Quando um ônibus passa do ponto, ele aparece em cinza com "passou" e some em ~4,5 s (ease-in-out), a pílula "Esse passou · vem o próximo" fica ~3,5 s e o destaque vai para o seguinte.
- `shared/`: lógica pura com testes (`npm test`): `bhtrans.js` (feed), `gtfs.js` e `gtfs-build.js` (pacote de dados), `polyline.js`, `route-map.js` (projeção, posição no trajeto, recorte e montagem do mini mapa, animação), `map-frame.js` (escala automática/manual, coroa, pontilhado), `passing.js` (quem passou, easing e quadros do sumiço), `summary.js` (resumo da tela inicial, cache do feed, ruas dos favoritos), `text.js` (abreviação de ruas, busca sem acento, saudação, rótulo da escala), `line-codes.js` (código NL), `settings-form.js`.

> A estimativa usa a velocidade atual do ônibus (limitada entre 15 e 60 km/h). Com o ponto escolhido pela lista, a distância é medida ao longo do trajeto; com coordenadas digitadas sem sentido, é em linha reta.

### Mapa da tela do ponto: nomes de ruas (a fazer)

Ainda **não há ruas** no relógio. Elas vão chegar como imagens (blocos do mapa com as ruas e os nomes já desenhados) baixadas pelo celular e enviadas ao relógio. Onde entram:

- `app-side/index.js` → `getBuses`: escolher os blocos que cobrem o enquadramento (`frame.k` e `frame.center`) e mandar quais são e onde ficam, junto com o `map`;
- `page/detail/index.page.js` → `drawMap()`: desenhar os blocos no `mapCanvas` com `canvas.drawImage` **antes** do trajeto (há um comentário marcando o lugar).

### Diferenças para o protótipo (limites do Zepp OS)

- **Negrito**: o `TEXT` do relógio não tem peso de fonte (só um arquivo de fonte próprio via `font`), então nome e título ficam no peso normal.
- **Pinça e roda do mouse** viram coroa digital (`onDigitalCrown` de `@zos/interaction`) e dois botões pequenos **+**/**−** na borda do mapa, para relógios sem coroa giratória. "Enquadrar ônibus" virou tocar no mapa.
- **Zoom não é instantâneo**: o relógio só desenha pixels prontos; ao girar a coroa o rodapé muda na hora e o mapa novo chega do celular ~0,5 s depois de parar de girar.
- **Esmaecer as bordas do mapa** (gradiente atrás dos textos) não existe no canvas do Zepp; o mapa fica dentro de um círculo com borda fina, e os textos da esquerda ficam por cima.
- **Pontilhado**: o canvas não tem linha tracejada; o celular manda as bolinhas já espaçadas (10 px) e o relógio desenha círculos.
- **Sumiço do ônibus que passou**: a doc do `IMG` lista `alpha` (0–255); para não depender dele, cada quadro troca para um ícone cinza pré-gerado com 80/60/40/20 % de opacidade (`assets/common.r/bus/*-passou-*.png`) e ajusta o `alpha` para completar a opacidade exata. Se o `alpha` funcionar, o sumiço é contínuo; se não, fica em 5 degraus. O ícone que passou fica parado (no protótipo ele segue andando) e o rótulo "passou" esmaece trocando a cor (o `TEXT` não tem alpha).
- **"Passou" depende do trajeto**: só funciona com o ponto escolhido pela lista (no modo avançado lat/lon não há trajeto) e aparece na primeira atualização depois da passagem (até 30 s depois).
- **Configurações**: o `TextInput` do app Zepp abre uma caixa de edição e só avisa ao confirmar, então as sugestões de linha e a busca de rua aparecem depois de confirmar o texto, não a cada letra. A lista de pontos usa `maxHeight`/`overflowY` (rola dentro do cartão se o app Zepp aceitar; senão a lista fica inteira). O tema é escolhido em botões sem os ícones de lua/sol.

## Dados de linhas, pontos e trajetos (GTFS)

Linhas, sentidos, pontos e trajetos vêm do **GTFS oficial de Belo Horizonte**, da Superintendência de Mobilidade Urbana (**SUMOB/PBH**), publicado pela Bus2 (versão 202603252005, válido até 15/03/2027). Os dados pertencem à Prefeitura de Belo Horizonte; este app só os reorganiza.

O pacote gerado fica em `data/` (vai para o repositório; o zip original não):

| Arquivo | Conteúdo | Tamanho |
| --- | --- | --- |
| `data/gtfs-index.js` | 302 linhas, sentidos (headsign mais comum), sequência de pontos de uma viagem representativa e tabela de 9.044 pontos (id, nome, lat/lon em inteiros 1e5) | ~640 KB (gzip ~175 KB) |
| `data/gtfs-shapes.js` | trajeto mais usado de cada linha e sentido, simplificado (Douglas-Peucker 8 m) e em polyline codificada | ~165 KB (gzip ~115 KB) |

O side service importa os dois; a tela de configurações importa só o índice (ela é um bundle JS comum, sem `eval`, então lê o pacote direto sem depender do side service). O relógio não recebe o pacote: só uns 200–400 bytes de pixels por atualização. O `.zab` fica com ~1,5 MB.

Para atualizar quando sair um GTFS novo:

```bash
# coloque o zip em data-src/gtfs-bh.zip (ignorado pelo git)
npm run build:data   # lê o zip em streaming (~10 s) e reescreve data/
```

## Código da linha (coluna NL)

O feed de tempo real traz um **código interno** da linha (coluna `NL`), que pode não ser o número do letreiro. A conversão fica em `shared/line-codes.js`:

```js
export const LINE_CODES = Object.freeze({
  '9250': ['1234'], // número do ônibus -> um ou mais códigos NL
})
```

A tabela começa **vazia**: daqui não foi possível acessar o feed nem o portal. Sem entrada para a linha, o app compara o `NL` direto com o número (ignorando zeros à esquerda). Para preencher, abra `https://temporeal.pbh.gov.br/?param=C` com um ônibus da linha rodando e anote o `NL` dele, ou use a tabela de linhas do conjunto "Tempo Real Ônibus - Coordenada" em [dados.pbh.gov.br](https://dados.pbh.gov.br). Se o feed tiver a coluna `DG` (rumo em graus), ela é usada para descartar ônibus no sentido contrário.

## Comandos

```bash
npm install -g @zeppos/zeus-cli
npm install
npm test          # testes da lógica da BHTrans
npm run build     # gera o pacote .zab em dist/
npm run preview   # QR code para instalar no relógio (requer `zeus login`)
```
