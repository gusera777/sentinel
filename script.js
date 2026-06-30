const $ = id => document.getElementById(id);
const fmt = (n, d=2) => (n===null||n===undefined||isNaN(n)) ? '—' : Number(n).toFixed(d);

/* ============================================================
   INDICATORS
   ============================================================ */
function ema(values, period){
  const k = 2/(period+1);
  const out = new Array(values.length).fill(null);
  let prev = null;
  for(let i=0;i<values.length;i++){
    if(i < period-1){ continue; }
    if(i === period-1){
      prev = values.slice(0, period).reduce((a,b)=>a+b,0)/period;
      out[i] = prev; continue;
    }
    prev = values[i]*k + prev*(1-k);
    out[i] = prev;
  }
  return out;
}

function rsi(closes, period=14){
  const out = new Array(closes.length).fill(null);
  let gains=0, losses=0;
  for(let i=1;i<=period;i++){
    const diff = closes[i]-closes[i-1];
    if(diff>=0) gains+=diff; else losses-=diff;
  }
  let avgGain = gains/period, avgLoss = losses/period;
  out[period] = avgLoss===0 ? 100 : 100-(100/(1+(avgGain/avgLoss)));
  for(let i=period+1;i<closes.length;i++){
    const diff = closes[i]-closes[i-1];
    const gain = diff>0?diff:0, loss = diff<0?-diff:0;
    avgGain = (avgGain*(period-1)+gain)/period;
    avgLoss = (avgLoss*(period-1)+loss)/period;
    out[i] = avgLoss===0 ? 100 : 100-(100/(1+(avgGain/avgLoss)));
  }
  return out;
}

function atr(highs, lows, closes, period=14){
  const tr = new Array(closes.length).fill(null);
  for(let i=0;i<closes.length;i++){
    if(i===0){ tr[i] = highs[i]-lows[i]; continue; }
    tr[i] = Math.max(highs[i]-lows[i], Math.abs(highs[i]-closes[i-1]), Math.abs(lows[i]-closes[i-1]));
  }
  const out = new Array(closes.length).fill(null);
  let prev = null;
  for(let i=0;i<tr.length;i++){
    if(i < period-1) continue;
    if(i === period-1){ prev = tr.slice(0,period).reduce((a,b)=>a+b,0)/period; out[i]=prev; continue; }
    prev = (prev*(period-1)+tr[i])/period;
    out[i]=prev;
  }
  return out;
}

function sma(values, period){
  const out = new Array(values.length).fill(null);
  for(let i=period-1;i<values.length;i++){
    let s=0; for(let k=0;k<period;k++) s+=values[i-k];
    out[i]=s/period;
  }
  return out;
}

/* ============================================================
   FETCH (Twelvedata)
   ============================================================ */
async function fetchOHLC(symbol, interval, apikey, outputsize=260){
  const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}&interval=${interval}&outputsize=${outputsize}&apikey=${encodeURIComponent(apikey)}`;
  const res = await fetch(url);
  const data = await res.json();
  if(data.status === 'error' || data.code){ throw new Error(`[${interval}] ` + (data.message || 'Gagal mengambil data dari Twelvedata.')); }
  if(!data.values){ throw new Error(`[${interval}] Data tidak ditemukan untuk symbol ini.`); }
  const rows = data.values.slice().reverse();
  return rows.map(r=>({
    time: r.datetime,
    open: parseFloat(r.open), high: parseFloat(r.high),
    low: parseFloat(r.low), close: parseFloat(r.close),
    volume: r.volume!==undefined ? parseFloat(r.volume) : null
  }));
}

/* ============================================================
   TREND ENGINE (Tahap 1) — dipakai per timeframe
   ============================================================ */
function trendOf(candles){
  const closes = candles.map(c=>c.close);
  const e50 = ema(closes,50), e200 = ema(closes,200);
  const n = closes.length, last = n-1, prev = n-2;
  if(e50[last]==null || e200[last]==null || e50[prev]==null || e200[prev]==null){
    return {dir:'NONE', label:'Data tidak cukup', e50, e200};
  }
  const diffNow = e50[last]-e200[last], diffPrev = e50[prev]-e200[prev];
  const crossing = (diffNow>0) !== (diffPrev>0);
  if(crossing) return {dir:'NONE', label:'EMA Crossing', e50, e200};
  return { dir: diffNow>0 ? 'BUY' : 'SELL', label: diffNow>0 ? 'Bullish' : 'Bearish', e50, e200 };
}

/* ============================================================
   STRUCTURE ENGINE (Tahap 2) — fractal pivot + HH/HL/LH/LL + BOS/CHOCH
   ============================================================ */
function findPivots(highs, lows, lr=2){
  const piv = [];
  for(let i=lr;i<highs.length-lr;i++){
    let isH=true, isL=true;
    for(let k=1;k<=lr;k++){
      if(highs[i]<=highs[i-k] || highs[i]<=highs[i+k]) isH=false;
      if(lows[i]>=lows[i-k] || lows[i]>=lows[i+k]) isL=false;
    }
    if(isH) piv.push({idx:i, type:'H', price:highs[i]});
    if(isL) piv.push({idx:i, type:'L', price:lows[i]});
  }
  return piv;
}

function structureEngine(candles, dir){
  const highs=candles.map(c=>c.high), lows=candles.map(c=>c.low), closes=candles.map(c=>c.close);
  const piv = findPivots(highs, lows, 2);
  const hPiv = piv.filter(p=>p.type==='H'), lPiv = piv.filter(p=>p.type==='L');
  const out = { ok:false, label:'Data pivot belum cukup', hh:false, hl:false, lh:false, ll:false, bos:false, choch:false, swingHigh:null, swingLow:null };
  if(hPiv.length<2 || lPiv.length<2) return out;

  const H1=hPiv[hPiv.length-1], H2=hPiv[hPiv.length-2];
  const L1=lPiv[lPiv.length-1], L2=lPiv[lPiv.length-2];
  out.hh = H1.price > H2.price; out.lh = !out.hh;
  out.hl = L1.price > L2.price; out.ll = !out.hl;
  out.swingHigh = H1; out.swingLow = L1;

  const lastClose = closes[closes.length-1];
  if(dir==='BUY'){
    out.ok = out.hh && out.hl;
    out.bos = lastClose > H1.price;
    out.choch = out.lh && out.ll; // struktur sebenarnya masih bearish meski filter tren BUY
    out.label = (out.ok ? 'HH-HL' : (out.lh && out.ll ? 'LH-LL (bertentangan)' : 'Mixed')) + (out.bos ? ' · BOS Confirmed' : ' · Belum BOS');
  } else {
    out.ok = out.lh && out.ll;
    out.bos = lastClose < L1.price;
    out.choch = out.hh && out.hl;
    out.label = (out.ok ? 'LH-LL' : (out.hh && out.hl ? 'HH-HL (bertentangan)' : 'Mixed')) + (out.bos ? ' · BOS Confirmed' : ' · Belum BOS');
  }
  return out;
}

/* ============================================================
   SMART MONEY ENGINE (Tahap 3) — Order Block + Fair Value Gap
   ============================================================ */
function smartMoneyEngine(candles, dir, atrArr){
  const n = candles.length;
  const opens=candles.map(c=>c.open), closes=candles.map(c=>c.close), highs=candles.map(c=>c.high), lows=candles.map(c=>c.low);
  const lookback = 40;
  const start = Math.max(1, n-lookback);
  let ob = null, fvg = null;

  // Order Block: candle berlawanan arah tren tepat sebelum candle impulsif (range > 1.5x ATR)
  for(let i=n-2; i>=start; i--){
    const atrAtI = atrArr[i] || atrArr[atrArr.length-1] || 0;
    const impulseRange = highs[i]-lows[i];
    const isImpulse = impulseRange > atrAtI*1.5 && atrAtI>0;
    const bodyDir = closes[i]>opens[i] ? 'BUY' : 'SELL';
    if(isImpulse && bodyDir===dir){
      const prevDir = closes[i-1]>opens[i-1] ? 'BUY' : 'SELL';
      if(prevDir!==dir){
        ob = { idx:i-1, high:highs[i-1], low:lows[i-1] };
        break;
      }
    }
  }

  // Fair Value Gap: gap 3 candle yang belum termitigasi
  for(let i=n-2; i>=start+1; i--){
    if(dir==='BUY' && lows[i+1] > highs[i-1]){
      const gapLow = highs[i-1], gapHigh = lows[i+1];
      const mitigated = lows.slice(i+2).some(l=>l<=gapHigh);
      if(!mitigated){ fvg = { idx:i, low:gapLow, high:gapHigh }; break; }
    }
    if(dir==='SELL' && highs[i+1] < lows[i-1]){
      const gapHigh = lows[i-1], gapLow = highs[i+1];
      const mitigated = highs.slice(i+2).some(h=>h>=gapLow);
      if(!mitigated){ fvg = { idx:i, low:gapLow, high:gapHigh }; break; }
    }
  }
  return { ob, fvg };
}

/* ============================================================
   LIQUIDITY ENGINE (Tahap 4) — equal high/low, sweep, reject
   ============================================================ */
function liquidityEngine(candles, dir){
  const n=candles.length;
  const highs=candles.map(c=>c.high), lows=candles.map(c=>c.low), closes=candles.map(c=>c.close);
  const last=n-1, cand=n-2, prior=n-3;
  const tolPct = 0.0015; // 0.15% toleransi "equal level"

  const lookback = 25, start = Math.max(0, cand-lookback);
  let equalHigh=false, equalLow=false;
  const highsLB = highs.slice(start, cand), lowsLB = lows.slice(start, cand);
  for(let i=0;i<highsLB.length;i++){
    for(let j=i+1;j<highsLB.length;j++){
      if(Math.abs(highsLB[i]-highsLB[j])/highsLB[i] < tolPct){ equalHigh=true; }
      if(Math.abs(lowsLB[i]-lowsLB[j])/lowsLB[i] < tolPct){ equalLow=true; }
    }
  }

  let sweep=false, sweepType=null;
  if(dir==='BUY'){
    sweep = lows[last] < lows[cand] && closes[last] > lows[cand];
    sweepType = 'Sweep Low (Sell-side Liquidity)';
  } else {
    sweep = highs[last] > highs[cand] && closes[last] < highs[cand];
    sweepType = 'Sweep High (Buy-side Liquidity)';
  }

  return { equalHigh, equalLow, sweep, sweepType, cand, last, prior };
}

/* ============================================================
   VOLATILITY ENGINE (Tahap 6)
   ============================================================ */
function volatilityEngine(atrArr){
  const last = atrArr.length-1;
  const atrSeries = atrArr.slice(0,last+1);
  const avgArr = sma(atrSeries.map(v=>v==null?0:v), 50);
  const cur = atrArr[last], avg = avgArr[last];
  if(cur==null || avg==null || avg===0) return { status:'Unknown', ok:false, ratio:null, value:cur };
  const ratio = cur/avg;
  let status = 'Normal', ok = true;
  if(ratio < 0.55){ status='Terlalu Rendah'; ok=false; }
  else if(ratio > 2.2){ status='Terlalu Tinggi'; ok=false; }
  return { status, ok, ratio, value:cur };
}

/* ============================================================
   CANDLE ENGINE (Tahap 7) — pola + konteks zona
   ============================================================ */
function candleEngine(candles, dir, nearZone){
  const n=candles.length;
  const o=candles.map(c=>c.open), cl=candles.map(c=>c.close), h=candles.map(c=>c.high), l=candles.map(c=>c.low);
  const i=n-1, p=n-2;
  const body = i => Math.abs(cl[i]-o[i]);
  const upper = i => h[i]-Math.max(cl[i],o[i]);
  const lower = i => Math.min(cl[i],o[i])-l[i];

  let pattern='Tidak ada pola signifikan', rawScore=0;
  const bullEngulf = cl[i]>o[i] && cl[p]<o[p] && cl[i]>o[p] && o[i]<cl[p];
  const bearEngulf = cl[i]<o[i] && cl[p]>o[p] && cl[i]<o[p] && o[i]>cl[p];
  const bullPin = lower(i) > body(i)*2 && upper(i) < body(i);
  const bearPin = upper(i) > body(i)*2 && lower(i) < body(i);

  if(dir==='BUY' && bullEngulf){ pattern='Bullish Engulfing'; rawScore=8; }
  else if(dir==='SELL' && bearEngulf){ pattern='Bearish Engulfing'; rawScore=8; }
  else if(dir==='BUY' && bullPin){ pattern='Bullish Pin Bar'; rawScore=6; }
  else if(dir==='SELL' && bearPin){ pattern='Bearish Pin Bar'; rawScore=6; }
  else { pattern = dir==='BUY' ? (cl[i]>o[i]?'Bullish Candle (biasa)':'Tidak mendukung') : (cl[i]<o[i]?'Bearish Candle (biasa)':'Tidak mendukung'); rawScore = (dir==='BUY'?cl[i]>o[i]:cl[i]<o[i]) ? 3 : 0; }

  const score = nearZone ? rawScore : Math.round(rawScore*0.5);
  return { pattern, score, contextBoost: nearZone };
}

/* ============================================================
   ANALISIS UTAMA — gabungkan semua engine
   ============================================================ */
function runProAnalysis(tf){
  const { h4, h1, m15 } = tf;
  const result = { valid:false, decision:'NO TRADE', reasons:[], score:0, breakdown:{} };

  // ---- TAHAP 1: TREND ENGINE (multi-timeframe) ----
  const trH4 = trendOf(h4), trH1 = trendOf(h1), trM15 = trendOf(m15);
  result.trend = { h4:trH4, h1:trH1, m15:trM15 };

  const aligned = trH4.dir!=='NONE' && trH4.dir===trH1.dir && trH1.dir===trM15.dir;
  const dir = aligned ? trH4.dir : null;
  result.breakdown.trend = aligned ? 20 : 0;

  if(!aligned){
    result.reasons.push('Trend H4, H1, dan M15 tidak selaras — tidak ada entry (Trend Engine gagal).');
    return result;
  }
  result.direction = dir;

  // indikator M15 (timing entry)
  const closesM = m15.map(c=>c.close), highsM = m15.map(c=>c.high), lowsM = m15.map(c=>c.low);
  const rsiM = rsi(closesM,14), atrM = atr(highsM, lowsM, closesM, 14);
  const lastM = m15.length-1;

  // ---- TAHAP 2: MARKET STRUCTURE ----
  const struct = structureEngine(m15, dir);
  result.structure = struct;
  let structScore = 0;
  if(struct.ok) structScore += 10;
  if(struct.bos) structScore += 10;
  if(struct.choch) structScore = Math.round(structScore*0.4); // peringatan reversal — potong skor
  result.breakdown.structure = structScore;

  if(!struct.bos){
    result.reasons.push('Break of Structure (BOS) belum terjadi pada M15 — sinyal ditahan.');
    result.score = result.breakdown.trend + structScore;
    return result;
  }

  // ---- TAHAP 4: LIQUIDITY ----
  const liq = liquidityEngine(m15, dir);
  result.liquidity = liq;
  let liqScore = 0;
  if(liq.equalHigh || liq.equalLow) liqScore += 5;
  if(liq.sweep) liqScore += 10;
  result.breakdown.liquidity = liqScore;

  if(!liq.sweep){
    result.reasons.push('Liquidity sweep belum terkonfirmasi — menunggu stop hunt sebelum entry.');
    result.score = result.breakdown.trend + structScore + liqScore;
    return result;
  }

  // ---- TAHAP 3: SMART MONEY ----
  const sm = smartMoneyEngine(m15, dir, atrM);
  result.smartMoney = sm;
  let smScore = 0;
  if(sm.ob) smScore += 7;
  if(sm.fvg) smScore += 8;
  result.breakdown.smartMoney = smScore;

  // ---- TAHAP 5/6: MOMENTUM & VOLATILITY ----
  const rsiLast = rsiM[lastM];
  let momentumLabel='Lemah', momentumScore=0;
  if(rsiLast!=null){
    const dist = dir==='BUY' ? rsiLast-50 : 50-rsiLast;
    if(dist>15){ momentumLabel='Strong'; momentumScore=10; }
    else if(dist>5){ momentumLabel='Moderate'; momentumScore=5; }
    else { momentumLabel='Lemah'; momentumScore=0; }
  }
  result.momentum = { rsi:rsiLast, label:momentumLabel };
  result.breakdown.momentum = momentumScore;

  const vol = volatilityEngine(atrM);
  result.volatility = vol;
  result.breakdown.volatility = vol.ok ? 10 : (vol.status==='Unknown'?5:0);

  // ---- TAHAP 7: CANDLE ENGINE ----
  const nearZone = !!(sm.ob || sm.fvg) && liq.sweep;
  const candle = candleEngine(m15, dir, nearZone);
  result.candle = candle;
  result.breakdown.candlestick = Math.min(10, candle.score);

  // ---- TAHAP 8: ENTRY ENGINE ----
  const swingHigh = struct.swingHigh, swingLow = struct.swingLow;
  let legA, legB, entryLow, entryHigh, slPrice;
  const atrLast = atrM[lastM] || 0;

  if(dir==='BUY'){
    legA = swingLow.price;
    legB = Math.max(...highsM.slice(swingLow.idx, m15.length));
    entryLow  = legB - (legB-legA)*0.618;
    entryHigh = legB - (legB-legA)*0.5;
    slPrice = Math.min(legA, lowsM[lastM]) - atrLast*0.5;
  } else {
    legA = swingHigh.price;
    legB = Math.min(...lowsM.slice(swingHigh.idx, m15.length));
    entryHigh = legB + (legA-legB)*0.618;
    entryLow  = legB + (legA-legB)*0.5;
    slPrice = Math.max(legA, highsM[lastM]) + atrLast*0.5;
  }
  const entryMid = (entryLow+entryHigh)/2;
  const risk = Math.abs(entryMid - slPrice);

  let entryVeto = null;
  if(atrLast>0 && risk < atrLast*0.3) entryVeto = 'TP/SL terlalu dekat dari volatilitas pasar saat ini — entry dibatalkan.';
  if(atrLast>0 && risk > atrLast*4) entryVeto = 'SL terlalu besar dibanding volatilitas pasar — entry dibatalkan.';
  if(!vol.ok) entryVeto = entryVeto || `Volatilitas ${vol.status.toLowerCase()} — entry dibatalkan.`;

  const tpPrice = dir==='BUY' ? entryMid + risk*2 : entryMid - risk*2;

  result.entry = { entryLow:Math.min(entryLow,entryHigh), entryHigh:Math.max(entryLow,entryHigh), entryMid, sl:slPrice, tp:tpPrice, risk, veto:entryVeto };

  // ---- TAHAP 9: AI SCORING ----
  const total = result.breakdown.trend + result.breakdown.structure + result.breakdown.liquidity +
                result.breakdown.smartMoney + result.breakdown.momentum + result.breakdown.candlestick + result.breakdown.volatility;
  result.score = total;

  if(entryVeto){
    result.reasons.push(entryVeto);
    result.decision = 'NO TRADE';
    return result;
  }

  // ---- TAHAP 10: KEPUTUSAN ----
  if(total>=95) result.decision = `STRONG ${dir}`;
  else if(total>=90) result.decision = dir;
  else if(total>=85) result.decision = 'WATCHLIST';
  else result.decision = 'NO TRADE';

  result.valid = total>=85;
  return result;
}

/* ============================================================
   CHART
   ============================================================ */
function drawChart(m15, trM15, entry){
  const W=1000, H=320, pad=36;
  const n=m15.length, showFrom=Math.max(0,n-90);
  const closes=m15.map(c=>c.close).slice(showFrom);
  const e50=trM15.e50.slice(showFrom), e200=trM15.e200.slice(showFrom);

  let allVals=closes.slice();
  if(entry){ allVals=allVals.concat([entry.entryMid, entry.sl, entry.tp]); }
  e50.forEach(v=>{ if(v!=null) allVals.push(v); });
  e200.forEach(v=>{ if(v!=null) allVals.push(v); });

  const min=Math.min(...allVals), max=Math.max(...allVals), range=(max-min)||1;
  const x=i=>pad+(i/(closes.length-1))*(W-pad*2);
  const y=v=>H-pad-((v-min)/range)*(H-pad*2);
  const path=arr=>arr.map((v,i)=>v==null?null:`${x(i)},${y(v)}`).filter(Boolean).join(' L ');

  let svg=`<svg viewBox="0 0 ${W} ${H}" style="width:100%; height:auto; display:block;">`;
  for(let g=0; g<=4; g++){
    const gy=pad+g*(H-pad*2)/4;
    svg+=`<line x1="${pad}" y1="${gy}" x2="${W-pad}" y2="${gy}" stroke="#1c232b" stroke-width="1"/>`;
  }
  svg+=`<polyline points="${path(closes)}" fill="none" stroke="#f0b429" stroke-width="1.6"/>`;
  svg+=`<polyline points="${path(e50)}" fill="none" stroke="#3da9fc" stroke-width="1.3"/>`;
  svg+=`<polyline points="${path(e200)}" fill="none" stroke="#b06bf2" stroke-width="1.3"/>`;
  if(entry){
    const hl=(val,color,label)=>{
      const yy=y(val);
      svg+=`<line x1="${pad}" y1="${yy}" x2="${W-pad}" y2="${yy}" stroke="${color}" stroke-width="1" stroke-dasharray="4,3"/>`;
      svg+=`<text x="${W-pad+4}" y="${yy+3}" font-size="9" fill="${color}" font-family="JetBrains Mono">${label}</text>`;
    };
    hl(entry.entryMid,'#28d97c','ENTRY'); hl(entry.sl,'#ff5470','SL'); hl(entry.tp,'#28d97c','TP');
  }
  svg+='</svg>';
  $('chartHolder').innerHTML = svg;
}

/* ============================================================
   RENDER
   ============================================================ */
function chip(label, dir){
  const cls = dir==='BUY'?'buy':dir==='SELL'?'sell':'amber';
  return `<span class="tf-chip ${cls}">${label}: ${dir==='NONE'?'—':dir}</span>`;
}

function render(symbol, tf, result){
  $('result').classList.add('show');
  $('hSymbol').textContent = symbol.toUpperCase();
  $('hTf').textContent = 'H4 / H1 / M15';
  $('hTime').textContent = tf.m15[tf.m15.length-1].time;

  const dirClass = result.valid ? (result.direction==='BUY'?'buy':'sell') : (result.decision==='WATCHLIST'?'amber':'none');
  $('headline').className = 'headline ' + dirClass;
  $('hDir').className = 'direction ' + dirClass;
  $('hDir').textContent = result.decision;
  $('hSub').textContent = result.reasons[0] || 'Confluence dari semua engine terpenuhi.';

  $('confNum').textContent = result.score + '/100';
  let confColor = result.score>=95?'#28d97c':result.score>=90?'#3da9fc':result.score>=85?'#f0b429':'#ff5470';
  $('confFill').style.background = confColor;
  $('confFill').style.width = Math.min(100,result.score)+'%';

  const tag = $('hStatus');
  tag.textContent = result.decision;
  tag.style.color = confColor;
  tag.style.background = result.score>=95?'var(--buy-dim)':result.score>=90?'#0f2a3a':result.score>=85?'#2a2410':'var(--sell-dim)';

  // Trend chips
  $('cTrend').innerHTML = chip('H4',result.trend.h4.dir)+chip('H1',result.trend.h1.dir)+chip('M15',result.trend.m15.dir);
  $('cTrendSub').textContent = result.direction ? `Trend selaras: ${result.direction}` : 'Trend tidak selaras antar timeframe';

  // Structure
  $('cStruct').textContent = result.structure ? (result.structure.bos?'BOS Confirmed':'Belum BOS') : '—';
  $('cStruct').className = 'v ' + (result.structure && result.structure.bos ? (result.direction==='BUY'?'buy':'sell') : 'amber');
  $('cStructSub').textContent = result.structure ? result.structure.label + (result.structure.choch?' · ⚠ CHOCH terdeteksi':'') : 'Pivot belum cukup data';

  // Momentum/ATR
  const momTxt = result.momentum ? `${fmt(result.momentum.rsi,1)} (${result.momentum.label})` : '—';
  const volTxt = result.volatility ? result.volatility.status : '—';
  $('cMom').textContent = `${momTxt} / ATR ${volTxt}`;
  $('cMom').className = 'v ' + (result.breakdown.momentum>=10 ? (result.direction==='BUY'?'buy':'sell') : 'amber');
  $('cMomSub').textContent = result.volatility && result.volatility.ratio ? `ATR rasio thd rata-rata: ${fmt(result.volatility.ratio,2)}x` : 'Data volatilitas terbatas';

  // entry levels
  const e = result.entry;
  $('lZone').textContent = e ? `${fmt(e.entryLow)}–${fmt(e.entryHigh)}` : '—';
  $('lSL').textContent = e ? fmt(e.sl) : '—';
  $('lTP').textContent = e ? fmt(e.tp) : '—';
  $('lRR').textContent = '1 : 2';

  // checklist (skoring breakdown)
  const b = result.breakdown;
  const items = [
    ['Trend (H4/H1/M15 selaras)', b.trend, 20],
    ['Market Structure (HH-HL/LH-LL + BOS)', b.structure||0, 20],
    ['Liquidity (equal level + sweep)', b.liquidity||0, 15],
    ['Smart Money Zone (OB + FVG)', b.smartMoney||0, 15],
    ['Momentum (RSI)', b.momentum||0, 10],
    ['Candlestick (konteks zona)', b.candlestick||0, 10],
    ['Volatility (ATR band)', b.volatility||0, 10],
  ];
  $('checklistItems').innerHTML = items.map(([label,pts,max])=>`
    <div class="chk-item">
      <div class="chk-badge ${pts===max?'yes':(pts>0?'mid':'no')}">${pts}</div>
      <div>${label}</div>
      <div class="chk-score">${pts}/${max} pts</div>
    </div>
  `).join('');

  // raw output
  const obTxt = result.smartMoney && result.smartMoney.ob ? `Detected (${fmt(result.smartMoney.ob.low)}–${fmt(result.smartMoney.ob.high)})` : 'Not detected';
  const fvgTxt = result.smartMoney && result.smartMoney.fvg ? `Detected (${fmt(result.smartMoney.fvg.low)}–${fmt(result.smartMoney.fvg.high)})` : 'Not detected';
  const liqTxt = result.liquidity ? (result.liquidity.sweep ? result.liquidity.sweepType : 'No sweep yet') : '—';
  const dCls = dirClass==='buy'?'buyc':dirClass==='sell'?'sellc':'b';

  const raw = `===========================
AI ANALYZE XAUUSD PRO V1
===========================
<span class="t">Trend H4</span>   <span class="b">${result.trend.h4.label}</span>
<span class="t">Trend H1</span>   <span class="b">${result.trend.h1.label}</span>
<span class="t">Trend M15</span>  <span class="b">${result.trend.m15.label}</span>
<span class="t">Market Structure</span>  <span class="b">${result.structure ? result.structure.label : '—'}</span>
<span class="t">Liquidity</span>  <span class="b">${liqTxt}</span>
<span class="t">Order Block</span>  <span class="b">${obTxt}</span>
<span class="t">Fair Value Gap</span>  <span class="b">${fvgTxt}</span>
<span class="t">Momentum</span>   <span class="b">${result.momentum ? result.momentum.label : '—'}</span>
<span class="t">ATR</span>        <span class="b">${result.volatility ? result.volatility.status : '—'}</span>
<span class="t">Candlestick</span>  <span class="b">${result.candle ? result.candle.pattern : '—'}</span>
<span class="t">Entry Zone</span>  <span class="b">${e?fmt(e.entryLow)+' - '+fmt(e.entryHigh):'—'}</span>
<span class="t">Entry</span>      <span class="b">${e?fmt(e.entryMid):'—'}</span>
<span class="t">Stop Loss</span>  <span class="b">${e?fmt(e.sl):'—'}</span>
<span class="t">Take Profit</span>  <span class="b">${e?fmt(e.tp):'—'}</span>
<span class="t">Risk Reward</span>  <span class="b">1 : 2</span>
<span class="t">AI Score</span>   <span class="b">${result.score} /100</span>
<span class="t">Decision</span>   <span class="${dCls}">${result.decision}</span>
===========================`;
  $('rawOutput').innerHTML = raw;

  drawChart(tf.m15, result.trend.m15, e);
}

/* ============================================================
   MAIN
   ============================================================ */
async function main(){
  const apikey = $('apiKey').value.trim();
  const symbol = $('symbol').value.trim();
  const errBox=$('errBox'), loadBox=$('loadBox'), btn=$('runBtn');

  errBox.classList.remove('show');
  $('result').classList.remove('show');

  if(!apikey){ errBox.textContent='Masukkan Twelvedata API key terlebih dahulu.'; errBox.classList.add('show'); return; }
  if(!symbol){ errBox.textContent='Masukkan symbol, contoh: XAU/USD.'; errBox.classList.add('show'); return; }

  btn.disabled=true; loadBox.classList.add('show');
  $('liveDot').classList.remove('live'); $('liveText').textContent='fetching H4/H1/M15…';

  try{
    const [h4, h1, m15] = await Promise.all([
      fetchOHLC(symbol, '4h', apikey, 260),
      fetchOHLC(symbol, '1h', apikey, 260),
      fetchOHLC(symbol, '15min', apikey, 260),
    ]);
    [h4,h1,m15].forEach((c,idx)=>{
      if(c.length<210){
        const names=['H4','H1','M15'];
        throw new Error(`Data ${names[idx]} terlalu sedikit (${c.length} candle). Butuh minimal ~210 candle untuk EMA200.`);
      }
    });
    const tf = {h4,h1,m15};
    const result = runProAnalysis(tf);
    render(symbol, tf, result);
    $('liveDot').classList.add('live'); $('liveText').textContent='analysis complete';
  } catch(err){
    errBox.textContent = '⚠ ' + (err.message || 'Terjadi kesalahan saat mengambil/menganalisis data.');
    errBox.classList.add('show');
    $('liveDot').classList.remove('live'); $('liveText').textContent='error';
  } finally{
    btn.disabled=false; loadBox.classList.remove('show');
  }
}

$('runBtn').addEventListener('click', main);
$('apiKey').addEventListener('keydown', e=>{ if(e.key==='Enter') main(); });
$('symbol').addEventListener('keydown', e=>{ if(e.key==='Enter') main(); });
