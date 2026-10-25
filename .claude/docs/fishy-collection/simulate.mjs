// Draft game balance model. No runtime imports, paid assets, or network access.
// Run: bun .claude/docs/fishy-collection/simulate.mjs
import { readFileSync, writeFileSync } from 'node:fs';
const catalog = JSON.parse(readFileSync(new URL('./catalog.json', import.meta.url)));
const runs = 10000;
const limit = 5000;
function rng(seed) {
  return () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function weighted(values, weights, random) {
  let n = random() * weights.reduce((a,b)=>a+b,0);
  for (let i=0;i<values.length;i++) { n-=weights[i]; if(n<0)return values[i]; }
  return values.at(-1);
}
const scheduleCache = new Map();
function condition(slot) {
  const block = Math.floor(slot / 5);
  if (!scheduleCache.has(block)) {
    const order = [...catalog.conditions];
    const r = rng(block ^ 0x53555348);
    for(let i=order.length-1;i>0;i--){const j=Math.floor(r()*(i+1));[order[i],order[j]]=[order[j],order[i]];}
    scheduleCache.set(block,order);
  }
  return scheduleCache.get(block)[slot % 5];
}
const tiers=Object.keys(catalog.rarityProbabilities);
const probs=Object.values(catalog.rarityProbabilities);
if(Math.abs(probs.reduce((a,b)=>a+b,0)-1)>1e-12)throw Error('Tier probabilities must total 1');
if(new Set(catalog.items.map(i=>i.id)).size!==catalog.items.length)throw Error('Duplicate ID');
const pools={}; const itemOdds={};
for(const c of catalog.conditions){
  pools[c]={};
  for(const tier of tiers){
    const ids=catalog.items.map((v,i)=>v.rarity===tier?i:-1).filter(i=>i>=0);
    if(!ids.length)throw Error('Empty tier');
    const weights=ids.map(i=>catalog.items[i].baseWeight*(catalog.items[i].preferredCondition===c?catalog.items[i].conditionMultiplier:1));
    const total=weights.reduce((a,b)=>a+b,0);
    pools[c][tier]={ids,weights};
    ids.forEach((i,k)=>{(itemOdds[catalog.items[i].id]??=[]).push(catalog.rarityProbabilities[tier]*weights[k]/total);});
  }
}
const sets=Object.keys(catalog.sets);
const setIndices=Object.fromEntries(sets.map(s=>[s,catalog.items.map((v,i)=>v.set===s?i:-1).filter(i=>i>=0)]));
const quantiles = a => {a.sort((a,b)=>a-b);return {p50:a[Math.ceil(a.length*.5)-1],p90:a[Math.ceil(a.length*.9)-1],p95:a[Math.ceil(a.length*.95)-1]};};
const scenarios=[];
for(const dailyCatches of [1,2]){
 const half=[],full=[],firstSet=[],at30=[],at100=[],bySet=Object.fromEntries(sets.map(s=>[s,[]]));let censored=0;
 for(let run=0;run<runs;run++){
  const random=rng(20261024+run);const seen=new Set();const done=new Set();let reachedHalf=false;let finished=false;
  const start=run%3000;
  for(let catchNo=1;catchNo<=limit;catchNo++){
   const c=condition(start+(catchNo-1)*(dailyCatches===1?6:3));
   const tier=weighted(tiers,probs,random);const pool=pools[c][tier];
   seen.add(weighted(pool.ids,pool.weights,random));
   if(!reachedHalf&&seen.size>=16){half.push(catchNo);reachedHalf=true;}
   for(const s of sets)if(!done.has(s)&&setIndices[s].every(i=>seen.has(i))){if(!done.size)firstSet.push(catchNo);done.add(s);bySet[s].push(catchNo);}
   if(catchNo===30)at30.push(seen.size);if(catchNo===100)at100.push(seen.size);
   if(!finished&&seen.size===catalog.items.length){full.push(catchNo);finished=true;}
   if(finished&&catchNo>=100)break;
  }
  if(!finished)censored++;
 }
 scenarios.push({dailyCatches,runs,censoredAt5000:censored,halfCollection:quantiles(half),firstSet:quantiles(firstSet),fullCollection:quantiles(full),uniqueAt30:quantiles(at30),uniqueAt100:quantiles(at100),sets:Object.fromEntries(sets.map(s=>[s,quantiles(bySet[s])]))});
}
const output={seed:20261024,runsPerScenario:runs,assumptions:'One collectible per successful catch; fixed daily cadence; rotating conditions; no pity, trading, streak odds bonus, or missed days. Percentiles are catch counts, except uniqueAt fields.',tierCounts:Object.fromEntries(tiers.map(t=>[t,catalog.items.filter(i=>i.rarity===t).length])),itemOdds:Object.fromEntries(Object.entries(itemOdds).map(([id,ps])=>[id,{min:Math.min(...ps),mean:ps.reduce((a,b)=>a+b,0)/ps.length,max:Math.max(...ps)}])),scenarios};
writeFileSync(new URL('./simulation-results.json',import.meta.url),JSON.stringify(output,null,2)+'\n');
console.log(JSON.stringify(scenarios,null,2));
