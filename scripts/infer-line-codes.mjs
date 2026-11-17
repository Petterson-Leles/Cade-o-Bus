// Descobre o código interno (coluna NL) de cada linha no feed de tempo real da BHTrans
// cruzando a posição dos ônibus com os trajetos do GTFS (data/).
// Uso: node scripts/infer-line-codes.mjs feed1.csv [feed2.csv ...]
// Gera shared/line-codes-data.js. Mais arquivos do feed (horários diferentes) = mais linhas.
import fs from 'fs'
const SHP=(await import('../data/gtfs-shapes.js')).default
const {decodePolyline}=await import('../shared/polyline.js')
const MX=111320*Math.cos(-19.9*Math.PI/180),MY=110540
// trajetos em metros, com grade para busca rápida
const routes={}
for(const [k,enc] of Object.entries(SHP.shapes)){const [num]=k.split('|');const pts=decodePolyline(enc).map(([a,b])=>[b*MX,a*MY]);(routes[num]=routes[num]||[]).push(pts)}
const CELL=200,grid=new Map()
for(const [num,shapes] of Object.entries(routes))for(const pts of shapes)for(let i=0;i<pts.length-1;i++){const [x1,y1]=pts[i],[x2,y2]=pts[i+1];const n=Math.ceil(Math.hypot(x2-x1,y2-y1)/CELL)+1;for(let t=0;t<=n;t++){const x=x1+(x2-x1)*t/n,y=y1+(y2-y1)*t/n;const key=Math.floor(x/CELL)+','+Math.floor(y/CELL);let s=grid.get(key);if(!s)grid.set(key,s=new Map());let arr=s.get(num);if(!arr)s.set(num,arr=[]);arr.push(i,pts)}}
function distTo(num,x,y){let best=1e9;const cx=Math.floor(x/CELL),cy=Math.floor(y/CELL);for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++){const s=grid.get((cx+dx)+','+(cy+dy));const arr=s&&s.get(num);if(!arr)continue;for(let k=0;k<arr.length;k+=2){const i=arr[k],pts=arr[k+1];const [x1,y1]=pts[i],[x2,y2]=pts[i+1];const vx=x2-x1,vy=y2-y1,L=vx*vx+vy*vy;const t=L?Math.max(0,Math.min(1,((x-x1)*vx+(y-y1)*vy)/L)):0;const d=Math.hypot(x-x1-t*vx,y-y1-t*vy);if(d<best)best=d}}return best}
const files=process.argv.slice(2)
const byNL=new Map()
for(const f of files){const L=fs.readFileSync(f,'utf8').trim().split(/\r?\n/);const h=L[0].split(';').map(s=>s.trim());const ix=k=>h.indexOf(k)
 for(const l of L.slice(1)){const c=l.split(';');const nl=c[ix('NL')].trim(),la=+c[ix('LT')].replace(',','.'),lo=+c[ix('LG')].replace(',','.');if(!isFinite(la))continue;(byNL.get(nl)||byNL.set(nl,[]).get(nl)).push([lo*MX,la*MY])}}
const report=[]
for(const [nl,ps] of byNL){const cand=new Map()
 for(const [x,y] of ps){const cx=Math.floor(x/CELL),cy=Math.floor(y/CELL);for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++){const s=grid.get((cx+dx)+','+(cy+dy));if(s)for(const num of s.keys())cand.set(num,0)}}
 const sc=[];for(const num of cand.keys()){let ok=0,sum=0;for(const [x,y] of ps){const d=distTo(num,x,y);if(d<=60)ok++;sum+=Math.min(d,500)}sc.push({num,frac:ok/ps.length,mean:sum/ps.length})}
 sc.sort((a,b)=>b.frac-a.frac||a.mean-b.mean)
 const [a,b]=sc;report.push({nl,n:ps.length,best:a?.num,frac:a?+a.frac.toFixed(2):0,second:b?.num,frac2:b?+b.frac.toFixed(2):0})}
report.sort((a,b)=>b.n-a.n)
// Regra de confiança: maioria dos ônibus em cima do trajeto e bem melhor que a 2ª linha.
const ok=r=>r.best&&((r.n>=2&&r.frac>=0.7&&r.frac-r.frac2>=0.25)||(r.n===1&&r.frac===1&&r.frac2<=0.5))
const table={}
for(const r of report)if(ok(r))(table[r.best]=table[r.best]||[]).push(r.nl)
for(const k of Object.keys(table))table[k].sort((a,b)=>Number(a)-Number(b))
const sorted=Object.fromEntries(Object.keys(table).sort((a,b)=>a.localeCompare(b,'pt',{numeric:true})).map(k=>[k,table[k]]))
const out='// Gerado por scripts/infer-line-codes.mjs a partir do feed de tempo real da BHTrans\n'+
 `// (${files.length} arquivo(s), ${report.length} códigos NL vistos, ${Object.keys(sorted).length} linhas mapeadas).\n`+
 '// Número da linha (letreiro/GTFS) -> códigos NL do feed. Não edite à mão sem conferir.\n'+
 'export const INFERRED_LINE_CODES = Object.freeze('+JSON.stringify(sorted,null,0).replace(/],/g,'],\n  ').replace('{','{\n  ').replace(/}$/,'\n}')+')\n'
fs.writeFileSync(new URL('../shared/line-codes-data.js',import.meta.url),out)
console.log('linhas mapeadas:',Object.keys(sorted).length,'de',new Set(Object.keys(SHP.shapes).map(k=>k.split('|')[0])).size)
for(const w of ['6350','9250','4103','5106'])console.log(w,'->',sorted[w])
