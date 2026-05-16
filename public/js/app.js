function runSimulator(){const s=Number(document.getElementById('startAmount').value||0),m=Number(document.getElementById('monthly').value||0),y=Number(document.getElementById('years').value||0),r=Number(document.getElementById('returnRate').value||0)/100/12;let v=s,c=s;for(let i=0;i<y*12;i++){v=v*(1+r)+m;c+=m}document.getElementById('simResult').innerHTML=`Projected value: $${v.toLocaleString(undefined,{maximumFractionDigits:0})}<br>Total contributed: $${c.toLocaleString(undefined,{maximumFractionDigits:0})}`;}

function chartValue(point){return Number(point.close ?? point.price ?? point.value ?? 0);}

function drawLineChart(canvas,points,o={}){if(!canvas||!points||!points.length)return;const ctx=canvas.getContext('2d'),w=canvas.width,h=canvas.height,p={left:58,right:24,top:24,bottom:44};ctx.clearRect(0,0,w,h);const vals=points.map(chartValue).filter(Number.isFinite),min=Math.min(...vals),max=Math.max(...vals),range=max-min||1;const X=i=>p.left+(i/Math.max(1,points.length-1))*(w-p.left-p.right),Y=v=>p.top+((max-v)/range)*(h-p.top-p.bottom);ctx.strokeStyle='#dfe6ef';ctx.lineWidth=1;ctx.font='12px Arial';for(let i=0;i<=4;i++){const gy=p.top+i*((h-p.top-p.bottom)/4);ctx.beginPath();ctx.moveTo(p.left,gy);ctx.lineTo(w-p.right,gy);ctx.stroke();ctx.fillStyle='#637083';ctx.fillText('$'+(max-(i/4)*range).toFixed(2),8,gy+4)}ctx.strokeStyle='#155eef';ctx.lineWidth=3;ctx.beginPath();points.forEach((pt,i)=>{const v=chartValue(pt);if(i===0)ctx.moveTo(X(i),Y(v));else ctx.lineTo(X(i),Y(v))});ctx.stroke();ctx.fillStyle='#132033';ctx.font='bold 15px Arial';ctx.fillText(o.title||'Chart',p.left,18)}

function setText(id,value){const el=document.getElementById(id);if(el)el.textContent=value;}
function money(v){const n=Number(v||0);return '$'+n.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});}
function pct(v){const n=Number(v||0);return n.toFixed(2)+'%';}

function updateQuoteDisplay(tick){
  if(!tick || typeof tick !== 'object') return;
  const price = Number(tick.price ?? tick.c ?? 0);
  if(!Number.isFinite(price) || price <= 0) return;
  setText('liveQuotePrice', money(price));
  setText('liveQuoteSource', 'kunpeng-websocket');
  setText('liveQuoteOpen', money(tick.open));
  setText('liveQuoteHigh', money(tick.high));
  setText('liveQuoteLow', money(tick.low));
  setText('liveQuotePrevClose', money(tick.prev_close));
  setText('liveQuoteChange', `${money(tick.ch)} (${pct(tick.chp)})`);
  if(tick.time){
    const d = new Date(Number(tick.time) * 1000);
    setText('liveQuoteTime', d.toLocaleString());
  }
}

function appendLivePoint(points, tick){
  const price = Number(tick.price ?? tick.c ?? 0);
  if(!Number.isFinite(price) || price <= 0) return points;
  const date = tick.time ? new Date(Number(tick.time)*1000).toISOString().slice(0,10) : new Date().toISOString().slice(0,10);
  const last = points[points.length - 1];
  if(last && last.date === date){
    last.close = price;
    last.price = price;
  } else {
    points.push({date, close: price, price});
    if(points.length > 120) points.shift();
  }
  return points;
}

async function connectKunpeng(canvas, points){
  if(!canvas || !canvas.dataset.symbol) return;
  const status = document.getElementById('kunpengStatus');
  try{
    const res = await fetch('/api/kunpeng/config/'+encodeURIComponent(canvas.dataset.symbol));
    const cfg = await res.json();
    if(!cfg.enabled){
      if(status) status.textContent = cfg.message || 'Kunpeng token missing.';
      return;
    }

    const url = `${cfg.wsUrl}?token=${encodeURIComponent(cfg.token)}`;
    const ws = new WebSocket(url);

    ws.addEventListener('open', () => {
      if(status) status.textContent = `Kunpeng connected. Subscribing to ${cfg.symbol}...`;
      ws.send(JSON.stringify({
        action: 'subscribe',
        market: cfg.market,
        exchange: cfg.exchange,
        symbol: cfg.symbol,
        replay: 'last'
      }));
    });

    ws.addEventListener('message', (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }
      if(msg.type === 'system'){
        if(status) status.textContent = `Kunpeng: ${msg.status || ''} ${msg.message || ''}`.trim();
        return;
      }
      if(msg.symbol && msg.symbol !== cfg.symbol) return;
      updateQuoteDisplay(msg);
      appendLivePoint(points, msg);
      drawLineChart(canvas, points, {title: `${canvas.dataset.symbol} live Kunpeng graph`});
      if(status) status.textContent = `Kunpeng live: ${msg.symbol} ${money(msg.price)} updated`;
    });

    ws.addEventListener('error', () => {
      if(status) status.textContent = 'Kunpeng WebSocket error. Check token, market, exchange and symbol access.';
    });

    ws.addEventListener('close', () => {
      if(status) status.textContent = 'Kunpeng WebSocket closed. Refresh the page to reconnect.';
    });
  }catch(err){
    if(status) status.textContent = 'Kunpeng setup failed: '+err.message;
  }
}

async function loadStockChart(){
  const c=document.getElementById('stockChart');
  if(!c)return;
  try{
    const r=await fetch('/api/candles/'+encodeURIComponent(c.dataset.symbol)+'?days=90');
    const d=await r.json();
    const points=(d.points||[]).map(p=>({date:p.date, close:Number(p.close ?? p.price), price:Number(p.close ?? p.price)}));
    drawLineChart(c,points,{title:c.dataset.symbol+' price history'});
    const status=document.getElementById('kunpengStatus');
    if(status && d.message) status.textContent=d.message;
    connectKunpeng(c, points);
  }catch(err){
    const status=document.getElementById('kunpengStatus');
    if(status) status.textContent='Chart failed: '+err.message;
  }
}

async function loadSandboxChart(){const c=document.getElementById('sandboxChart');if(!c)return;const r=await fetch('/api/chart/sandbox');const d=await r.json();drawLineChart(c,d.points,{title:'Sandbox portfolio value'})}
document.addEventListener('DOMContentLoaded',()=>{loadStockChart();loadSandboxChart();});
