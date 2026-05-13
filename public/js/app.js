
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
