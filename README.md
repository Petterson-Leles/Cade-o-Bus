# Cadê o Busão

App para relógios **Zepp OS** (feito para o Amazfit Active 3 Premium; funciona em relógios redondos com Zepp OS 4 ou mais recente) que mostra quanto falta para os ônibus de Belo Horizonte chegarem ao seu ponto, usando os dados abertos de tempo real da **BHTrans**.

## Como funciona

```
Relógio (page/)  ──mensagem──▶  App Zepp no celular (app-side/)  ──HTTPS──▶  temporeal.pbh.gov.br
```

- `setting/`: tela de configurações que abre no app Zepp do celular. Você digita o número da linha (ex. 9250), escolhe o sentido (headsign) e o ponto numa lista com os pontos daquela linha e sentido. Há uma opção avançada para digitar latitude e longitude.
- `app-side/`: roda no celular. Baixa o CSV de posições GPS dos ônibus, mede a distância de cada ônibus até o ponto **pela rua** (projetando no trajeto da linha), descarta os que já passaram e devolve ao relógio os 3 primeiros e o mini mapa já em pixels.
- `page/home`: lista os pontos favoritos no relógio.
- `page/detail`: número grande do tempo à esquerda e mini mapa à direita (~1,5 km em volta do ponto): trajeto, pontos da linha (bolinhas), trecho entre o ônibus e o seu ponto destacado em #2E7D78, o seu ponto e o ícone do ônibus na cor do tempo. O ícone desliza pelo trajeto entre as atualizações de 30 s.
- `shared/`: lógica pura com testes (`npm test`): `bhtrans.js` (feed), `gtfs.js` e `gtfs-build.js` (pacote de dados), `polyline.js`, `route-map.js` (projeção, posição no trajeto, recorte do mapa, animação), `line-codes.js` (código NL), `settings-form.js`.

> A estimativa usa a velocidade atual do ônibus (limitada entre 15 e 60 km/h). Com o ponto escolhido pela lista, a distância é medida ao longo do trajeto; com coordenadas digitadas sem sentido, é em linha reta.

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
