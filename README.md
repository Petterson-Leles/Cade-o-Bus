# Cadê o Busão

App para relógios **Zepp OS** (feito para o Amazfit Active 3 Premium; funciona em relógios redondos com Zepp OS 4 ou mais recente) que mostra quanto falta para os ônibus de Belo Horizonte chegarem ao seu ponto, usando os dados abertos de tempo real da **BHTrans**.

## Como funciona

```
Relógio (page/)  ──mensagem──▶  App Zepp no celular (app-side/)  ──HTTPS──▶  temporeal.pbh.gov.br
```

- `setting/`: tela de configurações que abre no app Zepp do celular, nas cores do tema escolhido para o relógio (paletas `CSS_THEMES.dark`/`light` em `utils/colors.js`). Título, seções com rótulo pequeno em maiúsculas (**Relógio**, **Mapa de BH**, **Novo ponto**, **Pontos salvos**) e cartões de cantos 16 px com borda sutil. Tema num seletor segmentado (Escuro/Claro) e o interruptor geral **Vibrar no relógio**. Novo ponto: campo limpo "Ex.: 9250" com até 6 sugestões como linhas leves (selo + nome) no mesmo cartão (ou "Uai, não achei essa linha em BH..."); a linha encontrada vira um cabeçalho (selo + nome) com o link "trocar"; o sentido em duas linhas "Para <destino>" com "<n> pontos · sai de <1º ponto>"; o ponto numa lista com cara de trajeto (trilho, bolinhas, 1º, 2º...), busca pela rua sem ligar para acentos e, no ponto escolhido, "entre <anterior> e <próximo>"; nome opcional com atalhos 🏠 Casa / 💼 Trabalho / 🎓 Faculdade. Pontos salvos em cartões compactos: selo, nome, "<rua> · sentido <destino> · <n>º ponto", "entre X e Y" e o horário de aviso; ações em links de texto **Editar** e **Remover** (vermelho apagado). Remover mostra a faixa "“Casa” removido · Desfazer", que some na próxima ação. **Editar** muda o nome e o horário de aviso (abre sozinho depois de adicionar um ponto). Há uma opção avançada para digitar latitude e longitude.
- `app-side/`: roda no celular. Baixa o CSV de posições GPS dos ônibus (um download serve todos os pedidos de 15 s), mede a distância de cada ônibus até o ponto **pela rua** (projetando no trajeto da linha), descarta os que já passaram e devolve ao relógio:
  - `GET_FAVORITES`: pontos salvos (com a rua do ponto abreviada, `street`) e tema;
  - `GET_SUMMARY`: o próximo ônibus de **todos** os pontos de uma vez (`{ items: [{ key, eta }] }`), para a tela inicial;
  - `GET_BUSES`: os 3 primeiros ônibus de um ponto e o mini mapa já em pixels e já enquadrado (`zoom` opcional: escala manual em px/km; com o mapa de ruas, `levels` e `level`);
  - `MAP_SYNC` / `MAP_DOWNLOAD`: o relógio manda o que já tem do mapa de BH (e pede para baixar); o celular responde com o manifesto, o estado de cada tema e o que apagar. O celular avisa com `MAP_CHANGED`.
  Ele também lembra, entre as atualizações, quais ônibus vinham chegando, para avisar o que **acabou de passar** do ponto. Mudanças no `settingsStorage` só viram aviso ao relógio para as chaves `favorites`, `theme`, `vibrate` e `mapBackground`; `mapCommand` aciona o download do mapa.
- `page/home`: saudação pelo horário, título com a barrinha de 4 cores e um cartão por ponto (selo da linha, nome, rua abreviada e, à direita, os minutos do próximo ônibus na cor da faixa, ou "—"). Atualiza a cada 30 s; com mais de 3 pontos a tela rola.
- `page/detail`: número grande do tempo à esquerda e mini mapa à direita. O celular escolhe a escala para caber o ônibus e o ponto (30–260 px/km, centro entre os dois) e a mantém enquanto ela servir, para o mapa não pular. Girar a **coroa** (ou tocar em **+**/**−**) muda o zoom e pede o mapa nessa escala; **tocar no mapa** volta ao automático. O rodapé mostra a escala ("zoom automático · 700 m por 100 px"). No mapa: trajeto, pontos da linha, trecho do ônibus até o seu ponto em #2E7D78 saindo exatamente do ícone, pontilhado coral sobre o caminho que o ônibus já fez (até 4 km atrás, parado no mapa) e o ícone do ônibus na cor do tempo, que desliza entre as atualizações. Quando um ônibus passa do ponto, ele aparece em cinza com "passou" e some em ~4,5 s (ease-in-out), a pílula "Esse passou · vem o próximo" fica ~3,5 s e o destaque vai para o seguinte.
- `shared/`: lógica pura com testes (`npm test`): `bhtrans.js` (feed), `gtfs.js` e `gtfs-build.js` (pacote de dados), `polyline.js`, `route-map.js` (projeção, posição no trajeto, recorte e montagem do mini mapa, animação), `map-frame.js` (escala automática/manual, coroa, pontilhado), `passing.js` (quem passou, easing e quadros do sumiço), `summary.js` (resumo da tela inicial, cache do feed, ruas dos favoritos), `text.js` (abreviação de ruas, busca sem acento, saudação, rótulo da escala), `line-codes.js` (código NL), `settings-form.js`, `map-tiles.js` (manifesto, blocos, mapa de bits, quais blocos cobrem o mini mapa), `map-download.js` (estado do download, fila retomável, comandos, aviso do relógio), `map-service.js` (download com a tela desligada: param do service, decisão de cada minuto, registro do service, permissão), `bus-anim.js` (animação ao longo do trajeto), `vibrate.js` (quando vibrar), `schedule.js` (horário de aviso por ponto: janela, fuso, próximo alarme). `settings-form.js` também monta "onde fica o ponto" (`stopContext`: "<rua> · sentido <destino> · <n>º ponto" e "entre X e Y").

> A estimativa usa a velocidade atual do ônibus (limitada entre 15 e 60 km/h). Com o ponto escolhido pela lista, a distância é medida ao longo do trajeto; com coordenadas digitadas sem sentido, é em linha reta.

### Mapa de BH (ruas no mini mapa)

As ruas chegam como imagens: blocos PNG de 256 px (32 cores, nomes de rua já desenhados, © colaboradores do OpenStreetMap, ODbL) publicados em `https://raw.githubusercontent.com/Petterson-Leles/cade-o-bus-mapa/main/` (`manifest.json`: projeção equiretangular, temas `dark`/`light`, níveis de 40, 80 e 160 px/km; ~3,3–3,7 MB e ~400 blocos por tema).

- **Pedido ao usuário**: no relógio, na primeira abertura sem mapa, a tela inicial pergunta "Baixar o mapa de BH? (~3,5 MB, uma vez só)" com **Baixar** / **Agora não** (não pergunta de novo por 3 dias; a escolha fica no relógio). No celular, a seção **Mapa de BH** das configurações mostra o estado de cada tema (não baixado / baixando n de N com barrinha / pausado / pronto / erro) e tem **Baixar mapa (tamanho)**, **Baixar também o tema claro/escuro**, **Pausar** e **Apagar mapa do relógio**.
- **Download** (`app-side/map-sync.js`): fila sequencial, um bloco por vez: baixa (`network.downloader`), converte para o formato do relógio (`image.convert`) e manda pela outbox do `TransferFile`, esperando o relógio confirmar antes do próximo. O estado fica no `settingsStorage` (`mapDownload`, um por tema, com o mapa de bits do que já foi entregue); os botões das configurações gravam `mapCommand`. Se parar no meio (relógio longe, app fechado, celular sem internet), pausa sozinho e **continua de onde parou** quando o app do relógio abre (o relógio manda o que já tem em `MAP_SYNC`).
- **Relógio**: `app.js` recebe os arquivos (inbox do `TransferFile`, via `onReceivedFile` da zml) e os guarda em `data://map/<tema>-<k>-<x>_<y>.png`; o registro fica no `LocalStorage` (permissão `device:os.local_storage`). As páginas não podem definir `onReceivedFile` (a zml apaga os ouvintes do inbox quando uma página com ele fecha).
- **Desenho** (`page/detail`): com o mapa do tema pronto, o zoom usa só os níveis dos blocos (40/80/160 px **físicos** por km = 41,2/82,4/164,8 px de design no Active 3): o automático escolhe o maior nível que enquadra ônibus e ponto; a coroa (um passo a cada ~15°) e +/− trocam de nível; tocar no mapa volta ao automático. O celular manda o nível e o centro do enquadramento; `shared/map-tiles.js` calcula quais blocos cobrem o círculo e onde ficam (até 4 IMG recortados ao quadrado do mapa com `pos_x`/`pos_y`), atrás do trajeto. Por cima dos blocos vai uma máscara (`assets/common.r/map/mask-<tema>.png`, gerada por `npm run build:masks`: anel na cor do fundo com o centro transparente) que esconde os cantos fora do círculo. Sem mapa, tudo funciona como antes (escala livre 30–260 px/km).

### Download com a tela desligada (EXPERIMENTAL)

Sem isso, o download só anda com o app aberto no relógio (a tela inicial mantém a tela acesa). Com isso, um **App Service contínuo** no relógio (`app-service/map-service.js`, registrado em `app.json` > `module` > `app-service`, permissão `device:os.bg_service`) recebe os blocos com a tela apagada ou o app fechado.

- **Como liga**: na tela inicial, enquanto o mapa baixa, aparece no fim da lista o cartão **Continuar com a tela desligada** (experimental). Nas configurações do celular, em **Mapa de BH**, o interruptor **Baixar com a tela desligada (experimental)** (chave `mapBackground`, vai ao relógio como `bgMap` junto com o tema): ligado, a tela inicial liga o service sozinha ao começar/continuar o download (uma tentativa por abertura).
- **Permissão**: antes de ligar, [`queryPermission`](https://docs.zepp.com/docs/reference/device-app-api/newAPI/app/queryPermission/); se não concedida, [`requestPermission`](https://docs.zepp.com/docs/reference/device-app-api/newAPI/app/requestPermission/) (o relógio mostra o pedido). Negada ou erro: aviso (toast) e o cartão "Tela acesa até terminar"; fica no modo antigo (tela acesa). Tocar no cartão pede de novo.
- **Ligar/parar**: [`start`](https://docs.zepp.com/docs/reference/device-app-api/newAPI/app-service/start/) (com `reload: false`, API 4: não volta sozinho depois de reiniciar o relógio), [`stop`](https://docs.zepp.com/docs/reference/device-app-api/newAPI/app-service/stop/) (tocar no cartão "Baixando com a tela desligada"), [`getAllAppServices`](https://docs.zepp.com/docs/reference/device-app-api/newAPI/app-service/getAllAppServices/) para saber se roda e [`exit`](https://docs.zepp.com/docs/reference/device-app-api/newAPI/app-service/exit/) dentro do service. Com ele rodando, a tela inicial não segura mais a tela acesa.
- **O service** ([guia](https://docs.zepp.com/docs/guides/framework/device/app-service/)): ouve o inbox do [`TransferFile`](https://docs.zepp.com/docs/reference/device-app-api/newAPI/transfer-file/TransferFile/) (`@zos/ble/TransferFile`; a doc libera `@zos/ble` no service, menos as APIs `mst*`) e guarda cada bloco como o app (mesmo `data://map/<tema>-<k>-<x>_<y>.png`, `utils/map-files.js`). Como a doc **não lista `@zos/storage`** entre as APIs do service, ele anota o que guardou num JSON próprio (`data://map/service-have.json`), não no LocalStorage do app; o app soma esse registro ao dele (`readTheme` faz a união; `absorbServiceTiles` copia para o LocalStorage no `MAP_SYNC` da tela inicial e apaga o JSON quando o service não está rodando).
- **Sem timers no service** (a doc diz que `setTimeout` não existe lá): o relógio do service é o sensor `Time` (`onPerMinute`, como no exemplo oficial `3.0-feature`). A cada minuto ele: tenta de novo os blocos que não conseguiu guardar; **encerra sozinho** quando o tema fica completo, após **30 min** ou sem nenhum bloco novo por **5 min** (`shared/map-service.js` `serviceTick`).
- **Manter o celular andando**: o service não tem a mensageria da zml (ela depende de `getApp()`, `@zos/ui` e timers). Em vez do `MAP_SYNC` por mensagem, ele manda ao celular um **arquivo pequeno** pela outbox do TransferFile (`data://map/cob-ping.txt`, criado pela página, com `params` `{ kind: 'cob-sync', have }`) ao começar e quando passa 90 s sem bloco novo. No celular, `onReceivedFile` do side service (a zml liga ao evento `file` do inbox) trata isso como `MAP_SYNC` "só soma" (`mergeWatchBits`: nunca tira bits nem apaga) e retoma a fila pausada.
- **Duas gravações do mesmo bloco**: não há como escolher quem do relógio recebe cada arquivo (app aberto e service ouvem o mesmo inbox), então a gravação é **idempotente**: `moveReceivedTile` só apaga o destino se tiver o original em mãos (o segundo dono acha o original já movido e só confirma o destino), e cada dono marca um bit no seu registro; a contagem é a união.

**O que depende do relógio/celular real (a doc não garante)**:
- Se o **side service do celular continua rodando** sem a página aberta no relógio. A doc do side service não descreve quando ele é iniciado/encerrado. A zml trata `sideService.launchReasons.fileTransfer` (o app Zepp abre o side service quando chega arquivo do relógio) e `settingsChanged`, o que sugere que o arquivo de "MAP_SYNC" acorda o side service, mas isso não está documentado. O app Zepp precisa estar aberto ou em segundo plano no celular, e o sistema do celular (economia de bateria do Android/iOS) pode matá-lo.
- Se o **inbox do TransferFile entrega arquivos ao service** com o app fechado (a doc libera `@zos/ble` no service, mas não fala do TransferFile nele) e se o celular consegue mandar arquivos com o app do relógio fechado.
- **Gravar arquivos no service só funciona com a tela desligada ou em AOD** (doc). Com a tela acesa (por exemplo, olhando o mostrador), o bloco fica numa lista e é tentado de novo no minuto seguinte; se o sistema apagar o arquivo recebido antes disso, o bloco falta e volta para a fila no próximo `MAP_SYNC` do app aberto (o relógio é quem manda no que tem).
- `@zos/fs` no service; o formato do campo do `start` (a doc diz `file`; o exemplo oficial e a zml usam `url`: o app manda os dois); o nome do evento do inbox (a doc escreve `NEWFILE`; a zml, que funciona no relógio, usa `newfile`: o service usa `newfile`).
- A doc diz que só um service contínuo roda por vez no sistema; se houver conflito, o relógio pergunta ao usuário qual manter.

**Como testar**: instale (`npm run preview`), apague o mapa nas configurações, ligue **Baixar com a tela desligada** e toque **Baixar mapa**. No relógio, abra o app: deve aparecer o pedido de permissão; aceite (toast "Pode apagar a tela: o mapa continua") e o cartão "Baixando com a tela desligada". Abaixe o pulso / saia do app e acompanhe nas configurações do celular se "Baixando n de N" continua subindo. Depois de alguns minutos, abra o app no relógio: o recado "Mapa: chegou n de N" deve ter avançado. Teste também: negar a permissão (deve cair na tela acesa), tocar no cartão para parar, e deixar o celular sem internet (o service deve sair sozinho em ~5 min). Logs do service aparecem com o prefixo `[Cadê o Busão service]`.

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

O side service importa os dois; a tela de configurações importa só o índice (ela é um bundle JS comum, sem `eval`, então lê o pacote direto sem depender do side service). O relógio não recebe o pacote: só uns 200–400 bytes de pixels por atualização. O `.zab` fica com ~2,5 MB (o celular leva as variantes; no relógio só a máscara do mapa, ~55 KB por tema, e os blocos baixados depois).

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
