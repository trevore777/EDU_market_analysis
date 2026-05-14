
function runSimulator(){
  const start = Number(document.getElementById("startAmount").value || 0);
  const monthly = Number(document.getElementById("monthly").value || 0);
  const years = Number(document.getElementById("years").value || 0);
  const rate = Number(document.getElementById("returnRate").value || 0) / 100 / 12;
  const months = years * 12;
  let value = start, contributed = start;
  for(let i=0;i<months;i++){ value = value * (1 + rate) + monthly; contributed += monthly; }
  const gain = value - contributed;
  document.getElementById("simResult").innerHTML =
    `Projected value: $${value.toLocaleString(undefined,{maximumFractionDigits:0})}<br>
     Total contributed: $${contributed.toLocaleString(undefined,{maximumFractionDigits:0})}<br>
     Projected growth: $${gain.toLocaleString(undefined,{maximumFractionDigits:0})}`;
}


function drawLineChart(canvas, points, options = {}) {
  if (!canvas || !points || points.length === 0) return;
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  const pad = { left: 58, right: 24, top: 24, bottom: 44 };
  ctx.clearRect(0, 0, width, height);

  const values = points.map(p => Number(p.price ?? p.value));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  function x(i) {
    return pad.left + (i / Math.max(1, points.length - 1)) * (width - pad.left - pad.right);
  }

  function y(v) {
    return pad.top + ((max - v) / range) * (height - pad.top - pad.bottom);
  }

  ctx.font = "12px Arial";
  ctx.strokeStyle = "#dfe6ef";
  ctx.lineWidth = 1;

  for (let i = 0; i <= 4; i++) {
    const gy = pad.top + i * ((height - pad.top - pad.bottom) / 4);
    ctx.beginPath();
    ctx.moveTo(pad.left, gy);
    ctx.lineTo(width - pad.right, gy);
    ctx.stroke();

    const labelValue = max - (i / 4) * range;
    ctx.fillStyle = "#637083";
    ctx.fillText("$" + labelValue.toFixed(2), 8, gy + 4);
  }

  ctx.strokeStyle = "#155eef";
  ctx.lineWidth = 3;
  ctx.beginPath();
  points.forEach((p, i) => {
    const value = Number(p.price ?? p.value);
    if (i === 0) ctx.moveTo(x(i), y(value));
    else ctx.lineTo(x(i), y(value));
  });
  ctx.stroke();

  const first = values[0];
  const last = values[values.length - 1];
  const change = ((last - first) / first) * 100;

  ctx.fillStyle = "#132033";
  ctx.font = "bold 15px Arial";
  ctx.fillText(options.title || "Price history", pad.left, 18);

  ctx.fillStyle = change >= 0 ? "#11845b" : "#c53030";
  ctx.fillText(`${change >= 0 ? "+" : ""}${change.toFixed(2)}%`, width - 90, 18);

  ctx.fillStyle = "#637083";
  ctx.font = "12px Arial";
  ctx.fillText(points[0].date, pad.left, height - 16);
  ctx.fillText(points[points.length - 1].date, width - pad.right - 80, height - 16);

  if (options.markers && options.markers.length) {
    options.markers.forEach(marker => {
      const idx = points.findIndex(p => p.date >= marker.date);
      if (idx >= 0) {
        const value = Number(points[idx].price ?? points[idx].value);
        ctx.beginPath();
        ctx.arc(x(idx), y(value), 5, 0, Math.PI * 2);
        ctx.fillStyle = marker.action === "BUY" ? "#11845b" : "#b7791f";
        ctx.fill();
      }
    });
  }
}

async function loadStockChart() {
  const canvas = document.getElementById("stockChart");
  if (!canvas) return;
  const symbol = canvas.dataset.symbol;
  const res = await fetch(`/api/chart/stock/${encodeURIComponent(symbol)}`);
  const data = await res.json();
  drawLineChart(canvas, data.points, { title: `${symbol} sample price history` });
}

async function loadSandboxChart() {
  const canvas = document.getElementById("sandboxChart");
  if (!canvas) return;
  const res = await fetch("/api/chart/sandbox");
  const data = await res.json();
  drawLineChart(canvas, data.points, { title: "Sandbox portfolio value", markers: data.markers });
}

document.addEventListener("DOMContentLoaded", () => {
  loadStockChart();
  loadSandboxChart();
});
