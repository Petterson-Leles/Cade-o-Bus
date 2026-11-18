# Cadê o Busão

App para relógios **Zepp OS** (feito para o Amazfit Active 3 Premium; funciona em relógios redondos com Zepp OS 4 ou mais recente) que mostra quanto falta para os ônibus de Belo Horizonte chegarem ao seu ponto, usando os dados abertos de tempo real da **BHTrans**.

## Como funciona

```
Relógio (page/)  ──mensagem──▶  App Zepp no celular (app-side/)  ──HTTPS──▶  temporeal.pbh.gov.br
```

- `setting/`: tela de configurações que abre no app Zepp do celular, nas cores do tema escolhido para o relógio (paletas `CSS_THEMES.dark`/`light` em `utils/colors.js`). Título, seções com rótulo pequeno em maiúsculas (**Relógio**, **Mapa de BH**, **Novo ponto**, **Pontos salvos**) e cartões de cantos 16 px com borda. Tema num seletor segmentado (Escuro/Claro, com sol e lua animados: ver abaixo) e o interruptor geral **Vibrar no relógio**. Novo ponto: campo limpo "Ex.: 9250" com até 6 sugestões como linhas leves (selo + nome) no mesmo cartão (ou "Uai, não achei essa linha em BH..."); a linha encontrada vira um cabeçalho (selo + nome) com o link "trocar"; o sentido em duas linhas "Para <destino>" com "<n> pontos · sai de <1º ponto>"; o ponto numa lista com cara de trajeto (trilho, bolinhas, 1º, 2º...), busca pela rua sem ligar para acentos e, no ponto escolhido, "entre <anterior> e <próximo>"; nome opcional com atalhos 🏠 Casa / 💼 Trabalho / 🎓 Faculdade. Pontos salvos em cartões compactos: selo, nome, "<rua> · sentido <destino> · <n>º ponto", "entre X e Y" e o horário de aviso; ações em links de texto **Editar** e **Remover** (vermelho apagado). Remover mostra a faixa "“Casa” removido · Desfazer", que some na próxima ação. **Editar** muda o nome e o horário de aviso (abre sozinho depois de adicionar um ponto). Há uma opção avançada para digitar latitude e longitude.
- `app-side/`: roda no celular. Baixa o CSV de posições GPS dos ônibus (um download serve todos os pedidos de 15 s), mede a distância de cada ônibus até o ponto **pela rua** (projetando no trajeto da linha), descarta os que já passaram e devolve ao relógio:
  - `GET_FAVORITES`: pontos salvos (com a rua do ponto abreviada, `street`) e tema;
  - `GET_SUMMARY`: o próximo ônibus de **todos** os pontos de uma vez (`{ items: [{ key, eta }] }`), para a tela inicial;
  - `GET_BUSES`: os 3 primeiros ônibus de um ponto e o mini mapa já em pixels e já enquadrado (`zoom` opcional: escala manual em px/km; com o mapa de ruas, `levels` e `level`; `tile`: o que o relógio tem do mapa, para o envio sob demanda);
  - `MAP_SYNC`: o relógio manda o que tem no cache do mapa; o celular responde com o manifesto, quantos blocos cada tema tem e o que apagar. O celular avisa com `MAP_CHANGED`.
  Erros vão como `error: { code, message }` (`NO_INTERNET`, `FEED_DOWN`, `BAD_REQUEST`, `UNKNOWN`; `shared/conn-errors.js`); o relógio ainda aceita o texto antigo. Ele também lembra, entre as atualizações, quais ônibus vinham chegando, para avisar o que **acabou de passar** do ponto. Mudanças no `settingsStorage` só viram aviso ao relógio para as chaves `favorites`, `theme` e `vibrate`; `mapCommand` aciona o "Limpar mapa do relógio".
- `page/home`: saudação pelo horário, título com a barrinha de 4 cores e um cartão por ponto (selo da linha, nome, rua abreviada e, à direita, os minutos do próximo ônibus na cor da faixa, ou "—"). Atualiza a cada 30 s; com mais de 3 pontos a tela rola.
- `page/detail`: número grande do tempo à esquerda e mini mapa à direita. O celular escolhe a escala para caber o ônibus e o ponto (30–260 px/km, centro entre os dois) e a mantém enquanto ela servir, para o mapa não pular. Girar a **coroa** (ou tocar em **+**/**−**) muda o zoom e pede o mapa nessa escala; **tocar no mapa** volta ao automático. O rodapé mostra a escala ("zoom automático · 700 m por 100 px"). No mapa: trajeto, pontos da linha, trecho do ônibus até o seu ponto em #2E7D78 saindo exatamente do ícone, pontilhado coral sobre o caminho que o ônibus já fez (até 4 km atrás, parado no mapa) e o ícone do ônibus na cor do tempo, que desliza entre as atualizações. Quando um ônibus passa do ponto, ele aparece em cinza com "passou" e some em ~4,5 s (ease-in-out), a pílula "Esse passou · vem o próximo" fica ~3,5 s e o destaque vai para o seguinte.
- `shared/`: lógica pura com testes (`npm test`): `bhtrans.js` (feed), `gtfs.js` e `gtfs-build.js` (pacote de dados), `polyline.js`, `route-map.js` (projeção, posição no trajeto, recorte e montagem do mini mapa, animação), `map-frame.js` (escala automática/manual, coroa, pontilhado), `passing.js` (quem passou, easing e quadros do sumiço), `summary.js` (resumo da tela inicial, cache do feed, ruas dos favoritos), `text.js` (abreviação de ruas, busca sem acento, saudação, rótulo da escala), `line-codes.js` (código NL), `settings-form.js`, `map-tiles.js` (manifesto, blocos, mapa de bits, quais blocos cobrem o mini mapa), `map-demand.js` (mapa sob demanda: blocos que faltam na vista, pré-envio, fila com prioridade, cache LRU do relógio, cache do celular), `map-download.js` (o que o celular sabe do cache do relógio, "Limpar", parâmetros de cada bloco), `conn-errors.js` (códigos de erro e a tela de cada caso), `theme-icons.js` (sol e lua em SVG animado), `bus-anim.js` (animação ao longo do trajeto), `vibrate.js` (quando vibrar), `schedule.js` (horário de aviso por ponto: janela, fuso, próximo alarme). `settings-form.js` também monta "onde fica o ponto" (`stopContext`: "<rua> · sentido <destino> · <n>º ponto" e "entre X e Y").

> A estimativa usa a velocidade atual do ônibus (limitada entre 15 e 60 km/h). Com o ponto escolhido pela lista, a distância é medida ao longo do trajeto; com coordenadas digitadas sem sentido, é em linha reta.

### Mapa de BH (ruas no mini mapa)

As ruas chegam como imagens: blocos PNG de 256 px (32 cores, nomes de rua já desenhados, © colaboradores do OpenStreetMap, ODbL) publicados em `https://raw.githubusercontent.com/Petterson-Leles/cade-o-bus-mapa/main/` (`manifest.json`: projeção equiretangular, temas `dark`/`light`, níveis de 40, 80 e 160 px/km; ~3,3–3,7 MB e ~400 blocos por tema).

**Mapa sob demanda** (único modo: o relógio sempre precisa do celular por perto, que é quem tem os horários em tempo real). O celular guarda os blocos e o relógio só "espelha" o pedaço que está na tela:

- **Celular** (`app-side/map-sync.js`): baixa da URL pública só o que for pedido (`network.downloader`), converte para o formato do relógio (`image.convert`) e guarda o convertido em `data://download/cob-c-<tema>-<k>-<x>_<y>.png`. O side service não tem API de arquivos, então o que já está convertido fica anotado em bits no `settingsStorage` (`mapPhoneCache`, por etiqueta do manifesto); se o arquivo sumiu, o envio falha e o bloco é baixado de novo. Ao abrir, e quando os pontos salvos mudam, pré-baixa no celular (só internet, nada vai ao relógio) até 40 blocos a 800 m dos pontos.
- **Pedido**: a tela do ponto manda junto do `GET_BUSES` o `tile` `{ theme, have (bits do tema), r (raio do mapa em px físicos), scale, mv (etiqueta do manifesto) }`. O celular escolhe o enquadramento (nível e centro), calcula com a mesma projeção do relógio (`shared/map-tiles.js` `tilesForView`, via `shared/map-demand.js` `demandPlan`) quais blocos cobrem a vista e põe **na frente da fila** os que o relógio não tem (nem recebeu há menos de 60 s); atrás, com baixa prioridade, até 8 vizinhos do mesmo nível (mais perto primeiro) e a mesma vista nos níveis vizinhos. Um bloco por vez pela outbox do `TransferFile`; enquanto um vai, o próximo já é preparado. Três falhas seguidas esvaziam a fila até o próximo pedido. Se o relógio ainda não tem o manifesto, o celular calcula os níveis com a escala da tela e manda o manifesto curto na resposta (`result.tiles.manifest`).
- **Relógio** (`utils/map-store.js`): `app.js` recebe os arquivos (inbox do `TransferFile`) e os guarda em `data://map/<tema>-<k>-<x>_<y>.png`; o registro (bits por tema) e a ordem de uso (LRU) ficam no `LocalStorage`. Cache de **120 blocos por tema** (~1 MB): passou disso, apaga os usados há mais tempo (até 8 por vez; os da tela são marcados como usados ao desenhar). As páginas não definem `onReceivedFile` (a zml apaga os ouvintes do inbox quando uma página com ele fecha).
- **Desenho** (`page/detail`): o zoom usa os níveis dos blocos (40/80/160 px **físicos** por km = 41,2/82,4/164,8 px de design no Active 3): o automático escolhe o maior nível que enquadra ônibus e ponto; a coroa (um passo a cada ~15°) e +/− trocam de nível; tocar no mapa volta ao automático. A tela desenha os blocos que já tem (até 4 IMG recortados ao quadrado do mapa, atrás do trajeto, com a máscara `assets/common.r/map/mask-<tema>.png` por cima) e, enquanto falta algum da vista, relê o registro a cada 1,5 s (até 60 s) e completa o mapa quando eles chegam. Sem manifesto, tudo funciona como antes (escala livre 30–260 px/km).
- **Tempos esperados**: cada vista usa 1–4 blocos de 256 px (~8–10 KB cada). Com o bloco já no cache do celular, ~1–3 s por bloco pelo Bluetooth; sem cache, some o download (~0,3–1 s no 4G) e a conversão. Na primeira vez num ponto, a vista completa em ~3–10 s; trocar de nível com a coroa costuma ser instantâneo (o nível vizinho já foi pré-enviado).
- **Configurações**: só "Mapa: ruas aparecem conforme você usa · X blocos guardados no relógio" e **Limpar mapa do relógio** (marca na hora; o relógio apaga quando o app abre). O "X" vem dos bits que o relógio manda no `MAP_SYNC` e no `GET_BUSES`.

**O que conferir no relógio real**: se o arquivo convertido no `data://download/` do celular continua lá depois de enviado (se a outbox apagar, o celular baixa de novo a cada envio: funciona, só gasta mais internet); o tempo de cada bloco pelo Bluetooth; se o `rmSync` do LRU libera espaço; e o `connectStatus()` de `@zos/ble` no Active 3.

### Tela de erro de conexão

Nas duas telas (inicial e do ponto), uma tela com imagem 160×160, título, texto e **Tentar de novo** (`utils/conn-screen.js`, textos em `shared/conn-errors.js`):

| Caso | Como detecta | Imagem | Título / texto | Nova tentativa |
| --- | --- | --- | --- | --- |
| Sem Bluetooth / celular longe | [`connectStatus()`](https://docs.zepp.com/docs/reference/device-app-api/newAPI/ble/connectStatus/) de `@zos/ble` falso, ou o pedido da zml rejeitado (ela rejeita com "ble disconnect" / "side service is not running") | `offline/<tema>.png` | "Ops… sem conexão" / "Bluetooth desligado ou celular longe. Aproxime o relógio do celular." | sozinha na volta do Bluetooth (`onBleChanged` da zml e checagem a cada 3 s) |
| Celular sem internet | o side service responde `NO_INTERNET` (o fetch da BHTrans rejeitou ou esgotou o tempo) | `internet/<tema>.png` | "Ops… celular sem internet" / "Ligue os dados móveis ou o Wi-Fi do celular." | em 30 s |
| BHTrans fora do ar | `FEED_DOWN` (chegou resposta, mas HTTP de erro, vazia ou fora do formato) | `internet/<tema>.png` | "Ops… BHTrans fora do ar" / "Tentamos de novo em 30 s." | em 30 s |

### Contraste e ícones do tema

O tema escuro tem mais contraste (`utils/colors.js`): elementos gráficos (bordas de cartões e campos, trajeto, anel do mapa, botões +/−, divisórias) ≥ 3:1 e textos ≥ 4,5:1 contra o fundo onde ficam, conferidos em `test/colors.test.mjs`. Para passar de 3:1, as bordas ficaram um pouco mais claras que o pedido inicial (`cardEdge` 0x707E8C no relógio; `border`/`fieldBorder` #7A8896 no celular).

No seletor de tema das configurações, o componente [`Image`](https://docs.zepp.com/docs/reference/app-settings-api/ui/image/) da Settings App API aceita "URL ou base64": o sol (Claro) e a lua (Escuro) são SVGs em data URI base64 (`shared/theme-icons.js`) com animação SMIL: na opção escolhida o sol nasce, os raios giram devagar e pulsam; a lua aparece e 3 estrelinhas piscam. A outra opção fica parada e esmaecida (opacity 0,5). A doc não diz se o WebView do app Zepp roda SMIL em `<img>`; se não rodar, os desenhos aparecem parados (ainda certos).

### Vibração e horário de aviso

Cada ponto salvo tem um horário de aviso (`alert` no favorito: `{ on, days: [1..7] (1 = seg), from, to }` em minutos; lógica em `shared/schedule.js`). Nas configurações, em **Editar**: **Avisar no relógio**, chips **Seg … Dom** e "das HH:MM às HH:MM" (Select de 15 em 15 min). Pontos novos e antigos começam com avisos **desligados** (Seg–Sex 06:00–09:00 pré-preenchido). Se `to` ≤ `from`, a janela cruza a meia-noite e pertence ao dia em que começa (sexta 22:00–01:00 vale até 01:00 de sábado). A hora local vem do sensor `Time` do relógio (fuso do relógio).

O relógio só vibra para um ponto **dentro da janela do ponto e com o interruptor geral ligado**; fora dela nada vibra, mesmo com a tela do ponto aberta, e o rodapé mostra "avisos desligados agora".

**Abrir sozinho** (`utils/alarms.js`, [`@zos/alarm` set](https://docs.zepp.com/docs/reference/device-app-api/newAPI/alarm/set/), [`cancel`](https://docs.zepp.com/docs/reference/device-app-api/newAPI/alarm/cancel/), [`getAllAlarms`](https://docs.zepp.com/docs/reference/device-app-api/newAPI/alarm/getAllAlarms/), API 3.0+, permissão `device:os.alarm`): sempre que a tela inicial recebe os favoritos (ao abrir e no `SETTINGS_CHANGED`), o relógio cancela os alarmes do app e agenda um alarme único (`REPEAT_ONCE`, `store: true`) para o **próximo início de janela** de cada ponto (até 8). O alarme abre `page/home/index.page` com `param` `{ cadeAlarm: 1, favId }` (o param chega ao `onCreate` do `app.js` e ao `onInit` da página); a tela inicial abre a tela desse ponto e, ao carregar os favoritos, já agenda o próximo. Aberta pelo alarme, a tela do ponto avisa já na primeira leitura. As configurações mostram "O relógio abre sozinho às 07:00 nos dias marcados". Mudanças feitas no celular com o app do relógio fechado só viram alarme na próxima vez que o app abrir no relógio.

Com a tela do ponto aberta (e dentro da janela), o relógio vibra (`Vibrator` de `@zos/sensor`): curta quando o próximo ônibus entra em "já já" (≤ 5 min), longa quando entra em "chegando: corre!" (≤ 2 min) e duas curtas quando ele passa pelo ponto. Cada aviso uma vez por veículo (volta a valer se o tempo subir 3 min acima do limiar); a primeira leitura ao abrir a tela não vibra. Interruptor **Vibrar no relógio** nas configurações (padrão ligado). Lógica em `shared/vibrate.js`.

> Com o app fechado, quem avisa é o alarme do sistema: ele abre o app no início da janela; a vibração continua só com a tela do ponto aberta.

### Ônibus no trajeto e variantes da linha

O pacote de dados guarda, além do trajeto mais usado, **todas as variantes** (outros shapes do GTFS) de cada linha e sentido, com a sequência de pontos de cada uma (até 8 por sentido). O side service usa só as que passam pelo ponto do usuário e encaixa cada ônibus na variante em que ele está (a mais perto, até 150 m, que ainda chega ao ponto); ônibus numa variante que não passa pelo ponto sai da lista. O mapa desenha a variante do ônibus em destaque. O ícone fica sempre sobre o trajeto (também quando está fora do círculo: anda pelo trajeto até a borda) e toda animação anda ao longo da polyline: o deslizamento a cada ~150 ms pelo tempo real decorrido e a correção suave (~0,9 s, ease-out) quando chega posição nova interpolam a distância ao longo da rota, nunca x/y em linha reta (`shared/bus-anim.js`); só pula direto acima de 80 px de diferença. Os trajetos são simplificados com 5 m (≈ 1 px na maior escala).

### Diferenças para o protótipo (limites do Zepp OS)

- **Negrito**: o `TEXT` do relógio não tem peso de fonte (só um arquivo de fonte próprio via `font`), então nome e título ficam no peso normal.
- **Pinça e roda do mouse** viram coroa digital (`onDigitalCrown` de `@zos/interaction`) e dois botões pequenos **+**/**−** na borda do mapa, para relógios sem coroa giratória. "Enquadrar ônibus" virou tocar no mapa.
- **Zoom não é instantâneo**: o relógio só desenha pixels prontos; ao girar a coroa o rodapé muda na hora e o mapa novo chega do celular ~0,5 s depois de parar de girar.
- **Esmaecer as bordas do mapa** (gradiente atrás dos textos) não existe no canvas do Zepp; o mapa fica dentro de um círculo com borda fina, e os textos da esquerda ficam por cima.
- **Pontilhado**: o canvas não tem linha tracejada; o celular manda as bolinhas já espaçadas (10 px) e o relógio desenha círculos.
- **Sumiço do ônibus que passou**: a doc do `IMG` lista `alpha` (0–255); para não depender dele, cada quadro troca para um ícone cinza pré-gerado com 80/60/40/20 % de opacidade (`assets/common.r/bus/*-passou-*.png`) e ajusta o `alpha` para completar a opacidade exata. Se o `alpha` funcionar, o sumiço é contínuo; se não, fica em 5 degraus. O ícone que passou fica parado (no protótipo ele segue andando) e o rótulo "passou" esmaece trocando a cor (o `TEXT` não tem alpha).
- **"Passou" depende do trajeto**: só funciona com o ponto escolhido pela lista (no modo avançado lat/lon não há trajeto) e aparece na primeira atualização depois da passagem (até 30 s depois).
- **Configurações**: o `TextInput` do app Zepp abre uma caixa de edição e só avisa ao confirmar, então as sugestões de linha e a busca de rua aparecem depois de confirmar o texto, não a cada letra. A lista de pontos usa `maxHeight`/`overflowY` (rola dentro do cartão se o app Zepp aceitar; senão a lista fica inteira). O tema é escolhido num seletor segmentado sem os ícones de lua/sol. **Animações**: a Settings App API só documenta `style` (CSS inline em camelCase) e `onClick`; não há `:active`, eventos de pressionar nem animação própria. Os botões são `View` + `Text` com `transition` (cor de fundo, texto e borda em ~220 ms), que só anima se o app Zepp reaproveitar o elemento no re-render, e `WebkitTapHighlightColor` para o realce nativo de toque do WebView; se o app Zepp ignorar essas propriedades, a troca de estilo é imediata.

## Dados de linhas, pontos e trajetos (GTFS)

Linhas, sentidos, pontos e trajetos vêm do **GTFS oficial de Belo Horizonte**, da Superintendência de Mobilidade Urbana (**SUMOB/PBH**), publicado pela Bus2 (versão 202603252005, válido até 15/03/2027). Os dados pertencem à Prefeitura de Belo Horizonte; este app só os reorganiza.

O pacote gerado fica em `data/` (vai para o repositório; o zip original não):

| Arquivo | Conteúdo | Tamanho |
| --- | --- | --- |
| `data/gtfs-index.js` | 302 linhas, sentidos (headsign mais comum), sequência de pontos de uma viagem representativa e tabela de 9.591 pontos (id, nome, lat/lon em inteiros 1e5) | ~670 KB (gzip ~180 KB) |
| `data/gtfs-shapes.js` | trajeto mais usado de cada linha e sentido e as variantes (outros shapes, com seus pontos), simplificados (Douglas-Peucker 5 m) e em polyline codificada | ~630 KB (gzip ~350 KB) |

O side service importa os dois; a tela de configurações importa só o índice (ela é um bundle JS comum, sem `eval`, então lê o pacote direto sem depender do side service). O relógio não recebe o pacote: só uns 200–400 bytes de pixels por atualização. O `.zab` fica com ~2,5 MB (o celular leva as variantes; no relógio só a máscara do mapa, ~55 KB por tema, e os blocos que chegam sob demanda).

Para atualizar quando sair um GTFS novo:

```bash
# coloque o zip em data-src/gtfs-bh.zip (ignorado pelo git)
npm run build:data   # lê o zip em streaming (~10 s) e reescreve data/
npm run build:masks  # máscaras do círculo do mapa (assets/common.r/map/)
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
