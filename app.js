const DATA_URL = "./data/strategy_lab_results.json";
const DEPLOY_INFO_URL = "./deploy-info.json";

const colors = {
  multifactor: "#43d39e",
  low_vol: "#52b7ff",
  adaptive_ic: "#f4bd50",
  equal_weight: "#8fa0ad",
  reversal_5: "#ff6f91",
  trend_follow: "#9b8cff",
  momentum_120: "#e2715b",
};

const factorLabels = {
  momentum: "动量",
  value: "估值",
  low_vol: "低波",
  liquidity: "流动性",
  trend: "趋势",
};

let labData = null;
let selectedId = null;

const fmtPct = (value) => `${(value * 100).toFixed(2)}%`;
const fmtMoney = (value) =>
  new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(value);

function valueClass(value) {
  return value >= 0 ? "positive" : "negative";
}

function makeSvg(width, height) {
  return `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img"></svg>`;
}

function scaleLinear(domainMin, domainMax, rangeMin, rangeMax) {
  const span = domainMax - domainMin || 1;
  return (value) => rangeMin + ((value - domainMin) / span) * (rangeMax - rangeMin);
}

function pathFromPoints(points) {
  return points.map((p, index) => `${index === 0 ? "M" : "L"}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ");
}

function currentStrategy() {
  return labData.strategies.find((s) => s.id === selectedId) || labData.strategies[0];
}

function renderSelect() {
  const select = document.querySelector("#strategySelect");
  select.innerHTML = labData.strategies
    .map((s) => `<option value="${s.id}">${s.name}</option>`)
    .join("");
  select.value = selectedId;
  select.addEventListener("change", () => {
    selectedId = select.value;
    renderAll();
  });
}

function renderMetricGrid() {
  const best = labData.strategies[0];
  const benchmark = labData.strategies.find((s) => s.id === "equal_weight");
  const trained = labData.strategies.find((s) => s.id === "adaptive_ic");
  const meta = labData.meta;
  const cards = [
    ["最优策略", best.name, `夏普 ${best.metrics.sharpe_ratio.toFixed(2)}`],
    ["最优总收益", fmtPct(best.metrics.total_return), `期末 ${fmtMoney(best.metrics.ending_equity)}`],
    ["基准收益", fmtPct(benchmark.metrics.total_return), "流动性等权基准"],
    ["训练模型收益", fmtPct(trained.metrics.total_return), `${meta.rebalance_count} 次月度调仓`],
  ];
  document.querySelector("#overview").innerHTML = cards
    .map(
      ([label, value, note]) => `
      <article class="metric-card">
        <div class="metric-label">${label}</div>
        <div class="metric-value">${value}</div>
        <div class="metric-note">${note}</div>
      </article>`
    )
    .join("");
}

function renderEquityChart() {
  const container = document.querySelector("#equityChart");
  container.innerHTML = makeSvg(980, 430);
  const svg = container.querySelector("svg");
  const margin = { top: 16, right: 22, bottom: 34, left: 58 };
  const width = 980;
  const height = 430;
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;
  const allPoints = labData.strategies.flatMap((s) => s.equity_curve.map((p, i) => ({ ...p, i })));
  const maxIndex = Math.max(...allPoints.map((p) => p.i));
  const minEquity = Math.min(...allPoints.map((p) => p.equity));
  const maxEquity = Math.max(...allPoints.map((p) => p.equity));
  const x = scaleLinear(0, maxIndex, margin.left, margin.left + plotW);
  const y = scaleLinear(minEquity * 0.92, maxEquity * 1.05, margin.top + plotH, margin.top);
  const grid = [0, 0.25, 0.5, 0.75, 1].map((t) => {
    const gy = margin.top + plotH * t;
    const value = maxEquity * 1.05 - (maxEquity * 1.05 - minEquity * 0.92) * t;
    return `<line class="grid-line" x1="${margin.left}" x2="${margin.left + plotW}" y1="${gy}" y2="${gy}"></line>
      <text class="axis-text" x="10" y="${gy + 4}">${fmtMoney(value / 10000)}万</text>`;
  });
  svg.insertAdjacentHTML("beforeend", grid.join(""));
  labData.strategies.slice().reverse().forEach((strategy) => {
    const pts = strategy.equity_curve.map((p, i) => ({ x: x(i), y: y(p.equity) }));
    const active = strategy.id === selectedId;
    svg.insertAdjacentHTML(
      "beforeend",
      `<path d="${pathFromPoints(pts)}" fill="none" stroke="${colors[strategy.id] || "#fff"}" stroke-width="${active ? 3.2 : 1.7}" opacity="${active ? 1 : 0.55}"></path>`
    );
  });
  const firstDate = labData.strategies[0].equity_curve[0].date;
  const lastDate = labData.strategies[0].equity_curve.at(-1).date;
  svg.insertAdjacentHTML(
    "beforeend",
    `<text class="axis-text" x="${margin.left}" y="${height - 8}">${firstDate}</text>
     <text class="axis-text" x="${width - margin.right - 70}" y="${height - 8}">${lastDate}</text>`
  );
  document.querySelector("#equityLegend").innerHTML = labData.strategies
    .map(
      (s) => `<span class="legend-item"><span class="legend-swatch" style="background:${colors[s.id] || "#fff"}"></span>${s.name}</span>`
    )
    .join("");
}

function renderSelectedDetail() {
  const s = currentStrategy();
  document.querySelector("#selectedName").textContent = s.name;
  document.querySelector("#selectedDescription").textContent = s.description;
  const metrics = [
    ["总收益", fmtPct(s.metrics.total_return), valueClass(s.metrics.total_return)],
    ["年化收益", fmtPct(s.metrics.annual_return), valueClass(s.metrics.annual_return)],
    ["最大回撤", fmtPct(s.metrics.max_drawdown), "negative"],
    ["夏普比率", s.metrics.sharpe_ratio.toFixed(2), valueClass(s.metrics.sharpe_ratio)],
    ["胜率", fmtPct(s.metrics.win_rate), ""],
    ["平均换手", fmtPct(s.metrics.avg_turnover), ""],
  ];
  document.querySelector("#detailMetrics").innerHTML = metrics
    .map(
      ([label, value, klass]) => `<div class="detail-item"><span>${label}</span><strong class="${klass}">${value}</strong></div>`
    )
    .join("");
}

function renderDrawdownChart() {
  const s = currentStrategy();
  const container = document.querySelector("#drawdownChart");
  container.innerHTML = makeSvg(640, 270);
  const svg = container.querySelector("svg");
  const margin = { top: 10, right: 16, bottom: 28, left: 52 };
  const width = 640;
  const height = 270;
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;
  const minD = Math.min(...s.equity_curve.map((p) => p.drawdown));
  const x = scaleLinear(0, s.equity_curve.length - 1, margin.left, margin.left + plotW);
  const y = scaleLinear(minD * 1.15, 0, margin.top + plotH, margin.top);
  const pts = s.equity_curve.map((p, i) => ({ x: x(i), y: y(p.drawdown) }));
  const area = `${pathFromPoints(pts)} L${x(s.equity_curve.length - 1)},${y(0)} L${x(0)},${y(0)} Z`;
  svg.insertAdjacentHTML(
    "beforeend",
    `<line class="grid-line" x1="${margin.left}" x2="${margin.left + plotW}" y1="${y(0)}" y2="${y(0)}"></line>
     <path d="${area}" fill="rgba(255,111,145,0.22)"></path>
     <path d="${pathFromPoints(pts)}" fill="none" stroke="${colors[s.id] || "#ff6f91"}" stroke-width="2.4"></path>
     <text class="axis-text" x="8" y="${y(minD) + 4}">${fmtPct(minD)}</text>
     <text class="axis-text" x="${margin.left}" y="${height - 8}">${s.equity_curve[0].date}</text>
     <text class="axis-text" x="${width - margin.right - 70}" y="${height - 8}">${s.equity_curve.at(-1).date}</text>`
  );
}

function renderYearlyChart() {
  const s = currentStrategy();
  const container = document.querySelector("#yearlyChart");
  container.innerHTML = makeSvg(640, 270);
  const svg = container.querySelector("svg");
  const width = 640;
  const height = 270;
  const margin = { top: 16, right: 16, bottom: 32, left: 42 };
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;
  const values = s.yearly_returns.map((r) => r.return);
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const y = scaleLinear(min * 1.15, max * 1.15 || 0.1, margin.top + plotH, margin.top);
  const barW = plotW / Math.max(values.length, 1) - 8;
  svg.insertAdjacentHTML("beforeend", `<line class="grid-line" x1="${margin.left}" x2="${margin.left + plotW}" y1="${y(0)}" y2="${y(0)}"></line>`);
  s.yearly_returns.forEach((row, i) => {
    const x = margin.left + i * (plotW / s.yearly_returns.length) + 4;
    const y0 = y(0);
    const yv = y(row.return);
    const h = Math.abs(yv - y0);
    const top = Math.min(y0, yv);
    const fill = row.return >= 0 ? "var(--green)" : "var(--rose)";
    svg.insertAdjacentHTML(
      "beforeend",
      `<rect x="${x}" y="${top}" width="${barW}" height="${Math.max(h, 1)}" rx="4" fill="${fill}"></rect>
       <text class="axis-text" x="${x}" y="${height - 8}">${row.year.slice(2)}</text>`
    );
  });
}

function renderStrategyTable() {
  const rows = labData.strategies
    .map((s, index) => {
      const m = s.metrics;
      return `<tr data-id="${s.id}">
        <td>${index + 1}</td>
        <td>${s.name}</td>
        <td>${s.category}</td>
        <td class="${valueClass(m.total_return)}">${fmtPct(m.total_return)}</td>
        <td class="${valueClass(m.annual_return)}">${fmtPct(m.annual_return)}</td>
        <td class="negative">${fmtPct(m.max_drawdown)}</td>
        <td class="${valueClass(m.sharpe_ratio)}">${m.sharpe_ratio.toFixed(2)}</td>
        <td>${fmtPct(m.win_rate)}</td>
        <td>${fmtMoney(m.ending_equity)}</td>
      </tr>`;
    })
    .join("");
  document.querySelector("#strategyTable").innerHTML = `
    <thead><tr><th>#</th><th>策略</th><th>类别</th><th>总收益</th><th>年化</th><th>最大回撤</th><th>夏普</th><th>胜率</th><th>期末权益</th></tr></thead>
    <tbody>${rows}</tbody>`;
  document.querySelectorAll("#strategyTable tbody tr").forEach((row) => {
    row.addEventListener("click", () => {
      selectedId = row.dataset.id;
      document.querySelector("#strategySelect").value = selectedId;
      renderAll();
    });
  });
}

function renderHoldings() {
  const s = currentStrategy();
  const rows = s.latest_holdings.length
    ? s.latest_holdings
        .map(
          (h, i) => `<tr><td>${i + 1}</td><td>${h.symbol}</td><td>${h.name || ""}</td><td>${fmtPct(h.weight)}</td></tr>`
        )
        .join("")
    : `<tr><td colspan="4">暂无持仓</td></tr>`;
  document.querySelector("#holdingsTable").innerHTML = `
    <thead><tr><th>#</th><th>代码</th><th>名称</th><th>权重</th></tr></thead>
    <tbody>${rows}</tbody>`;
}

function renderWeightsHeatmap() {
  const rows = labData.adaptive_factor_weights.filter((_, i) => i % 6 === 0).slice(-14);
  const factors = ["momentum", "value", "low_vol", "liquidity", "trend"];
  document.querySelector("#weightsHeatmap").innerHTML = rows
    .map((row) => {
      const cells = factors
        .map((factor) => {
          const value = row[factor] || 0;
          const alpha = 0.18 + value * 0.82;
          return `<div class="heat-cell" title="${factorLabels[factor]} ${(value * 100).toFixed(1)}%" style="background: rgba(67,211,158,${alpha})"></div>`;
        })
        .join("");
      return `<div class="heat-row"><div class="heat-date">${row.date}</div>${cells}</div>`;
    })
    .join("");
}

function renderRoadmap() {
  document.querySelector("#roadmapGrid").innerHTML = labData.roadmap
    .map(
      (stage) => `<article class="roadmap-card">
        <div class="roadmap-stage">${stage.stage}</div>
        <div class="roadmap-title">${stage.title}</div>
        <ul>${stage.items.map((item) => `<li>${item}</li>`).join("")}</ul>
      </article>`
    )
    .join("");
}

function renderDeployInfo(info) {
  const el = document.querySelector("#deployInfo");
  if (!el || !info) return;
  const date = new Date(info.deployed_at);
  const label = Number.isNaN(date.getTime())
    ? info.deployed_at
    : new Intl.DateTimeFormat("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(date);
  const sha = info.source_sha ? info.source_sha.slice(0, 7) : "unknown";
  el.textContent = `${label} · ${sha}`;
}

function renderAll() {
  renderMetricGrid();
  renderEquityChart();
  renderSelectedDetail();
  renderDrawdownChart();
  renderYearlyChart();
  renderStrategyTable();
  renderHoldings();
  renderWeightsHeatmap();
  renderRoadmap();
}

fetch(DATA_URL)
  .then((response) => {
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  })
  .then((data) => {
    labData = data;
    selectedId = data.strategies[0].id;
    renderSelect();
    renderAll();
  })
  .catch((error) => {
    document.body.innerHTML = `<main class="empty-state">无法读取回测结果：${error.message}</main>`;
  });

fetch(DEPLOY_INFO_URL)
  .then((response) => (response.ok ? response.json() : null))
  .then(renderDeployInfo)
  .catch(() => {});
