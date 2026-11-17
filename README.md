# Cadê o Busão

App para relógios **Zepp OS** (feito para o Amazfit Active 3 Premium; funciona em relógios redondos com Zepp OS 4 ou mais recente) que mostra quanto falta para os ônibus de Belo Horizonte chegarem ao seu ponto, usando os dados abertos de tempo real da **BHTrans**.

## Como funciona

```
Relógio (page/)  ──mensagem──▶  App Zepp no celular (app-side/)  ──HTTPS──▶  temporeal.pbh.gov.br
```

- `setting/`: tela de configurações que abre no app Zepp do celular. Nela você cadastra os pontos favoritos (nome, código da linha, latitude e longitude).
- `app-side/`: roda no celular. Baixa o CSV de posições GPS dos ônibus e devolve ao relógio os 3 ônibus da linha mais próximos do ponto.
- `page/home`: lista os pontos favoritos no relógio.
- `page/detail`: mostra o tempo estimado e a distância de cada ônibus, atualizando a cada 30 s.
- `shared/bhtrans.js`: leitura do CSV e cálculo de distância e tempo. Os testes cobrem essa parte.

> A estimativa usa a distância em linha reta e a velocidade atual do ônibus (mínimo de 15 km/h). Ela ainda não sabe se o ônibus já passou do ponto.

## Código da linha

O feed da BHTrans traz um **código interno** da linha (coluna `NL`), que não é o número que aparece no ônibus. A tabela de conversão está no portal [dados.pbh.gov.br](https://dados.pbh.gov.br), no conjunto "Tempo Real Ônibus - Coordenada".

## Comandos

```bash
npm install -g @zeppos/zeus-cli
npm install
npm test          # testes da lógica da BHTrans
npm run build     # gera o pacote .zab em dist/
npm run preview   # QR code para instalar no relógio (requer `zeus login`)
```
