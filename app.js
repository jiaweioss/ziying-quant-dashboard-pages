const LEGACY_URL = "./data/strategy_lab_results.json";
const REAL_URL = "./data/backtest_result.json";
const DEPLOY_INFO_URL = "./deploy-info.json";
const KLINE_API_URL = "api/kline";
const KLINE_STATIC_URLS = {
  "1d": "./data/kline_000001_1d.json",
  "60m": "./data/kline_000001_60m_20251231.json",
  "30m": "./data/kline_000001_30m_20251231.json",
  "15m": "./data/kline_000001_15m_20251231.json",
  "5m": "./data/kline_000001_5m_20251231.json",
  "1m": "./data/kline_000001_1m_20251231.json",
};
const LIGHTWEIGHT_CHARTS_URL =
  "https://cdn.jsdelivr.net/npm/lightweight-charts@4.2.3/dist/lightweight-charts.standalone.production.js";

const colors = {
  multifactor: "#43d39e",
  low_vol: "#52b7ff",
  adaptive_ic: "#f4bd50",
  equal_weight: "#8fa0ad",
  reversal_5: "#ff6f91",
  trend_follow: "#9b8cff",
  momentum_120: "#e2715b",
  hs300_multifactor: "#7ce7d4",
  real_eq_weight: "#b6c2cc",
  real_buy_hold: "#d2a15f",
};

const factorLabels = {
  momentum: "动量",
  value: "估值",
  low_vol: "低波",
  liquidity: "流动性",
  trend: "趋势",
};

let state = {
  legacy: null,
  real: null,
  deploy: null,
  strategies: [],
  selectedId: null,
  kline: {
    payload: null,
    chart: null,
    controlsReady: false,
    scriptReady: null,
  },
};

const finite = (value, fallback = 0) =>
  Number.isFinite(Number(value)) ? Number(value) : fallback;

const isFiniteNumber = (value) => Number.isFinite(Number(value));

const fmtPct = (value, opts = {}) => {
  if (!isFiniteNumber(value)) return "-";
  const sign = opts.signed && value > 0 ? "+" : "";
  return `${sign}${(Number(value) * 100).toFixed(opts.digits ?? 2)}%`;
};

const fmtMoney = (value) =>
  isFiniteNumber(value)
    ? new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(Number(value))
    : "-";

const fmtNum = (value, digits = 2) =>
  isFiniteNumber(value) ? Number(value).toFixed(digits) : "-";

const fmtDate = (value) => {
  const s = String(value ?? "");
  if (s.length === 8) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6)}`;
  return s || "-";
};

function valueClass(value, inverse = false) {
  if (!isFiniteNumber(value)) return "";
  const good = inverse ? Number(value) <= 0 : Number(value) >= 0;
  return good ? "positive" : "negative";
}

function makeSvg(width, height) {
  return `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img"></svg>`;
}

function scaleLinear(domainMin, domainMax, rangeMin, rangeMax) {
  const span = domainMax - domainMin || 1;
  return (value) => rangeMin + ((value - domainMin) / span) * (rangeMax - rangeMin);
}

function pathFromPoints(points) {
  return points
    .map((p, index) => `${index === 0 ? "M" : "L"}${p.x.toFixed(2)},${p.y.toFixed(2)}`)
    .join(" ");
}

function parseLooseJson(text) {
  return JSON.parse(text.replace(/\bNaN\b/g, "null"));
}

async function fetchJsonLoose(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) return null;
  const text = await response.text();
  return parseLooseJson(text);
}

function normalizeDrawdown(value) {
  if (!isFiniteNumber(value)) return 0;
  return -Math.abs(Number(value));
}

function normalizeLegacyStrategy(strategy) {
  return {
    ...strategy,
    source: "历史实验",
    badge: "Legacy Lab",
    metrics: {
      ...strategy.metrics,
      max_drawdown: Math.abs(finite(strategy.metrics.max_drawdown)),
    },
    equity_curve: (strategy.equity_curve || []).map((point) => ({
      date: String(point.date),
      equity: finite(point.equity),
      period_return: finite(point.period_return),
      turnover: finite(point.turnover),
      drawdown: normalizeDrawdown(point.drawdown),
    })),
    yearly_returns: strategy.yearly_returns || [],
    latest_holdings: strategy.latest_holdings || [],
  };
}

function inferReturnFromCurve(curve, key) {
  const values = curve.map((row) => Number(row[key])).filter(Number.isFinite);
  if (values.length < 2 || values[0] === 0) return null;
  return values.at(-1) / values[0] - 1;
}

function normalizeRealCurve(records, key) {
  let last = null;
  let peak = 0;
  return (records || [])
    .map((row) => {
      const raw = Number(row[key]);
      const equity = Number.isFinite(raw) ? raw : last;
      if (!Number.isFinite(equity)) return null;
      last = equity;
      peak = Math.max(peak, equity);
      const drawdown = peak > 0 ? equity / peak - 1 : 0;
      return {
        date: String(row.date),
        equity,
        drawdown,
        period_return: 0,
        turnover: 0,
      };
    })
    .filter(Boolean);
}

function normalizeRealPayload(payload) {
  if (!payload) return [];
  const meta = payload.meta || {};
  const metrics = payload.metrics || {};
  const equityCurve = normalizeRealCurve(payload.equity_curve, "strategy_nav");
  const ending = equityCurve.length ? equityCurve.at(-1).equity : null;
  const strategy = {
    id: meta.strategy_id || "hs300_multifactor",
    name: meta.strategy_name || "真实数据多因子管线",
    category: "Real Pipeline",
    source: "新框架",
    badge: "Real Data",
    description: meta.strategy_description || "数据层、因子层、组合层、执行层和风控层串联后的真实数据回测。",
    metrics: {
      total_return: metrics.total_return,
      annual_return: metrics.annualised_return,
      max_drawdown: metrics.max_drawdown,
      sharpe_ratio: metrics.sharpe_ratio,
      calmar_ratio: metrics.calmar_ratio,
      win_rate: metrics.win_rate,
      avg_turnover: isFiniteNumber(metrics.avg_turnover_pct)
        ? Number(metrics.avg_turnover_pct) / 100
        : null,
      ending_equity: ending,
    },
    equity_curve: equityCurve,
    yearly_returns: (payload.yearly_returns || []).map((row) => ({
      year: row.year,
      return: row.strategy,
    })),
    latest_holdings: (payload.latest_holdings || []).map((row) => ({
      symbol: row.symbol || row.ts_code,
      name: row.name,
      weight: row.weight,
    })),
  };

  const eqStats = metrics.benchmark_eq_weight || {};
  const bhStats = metrics.benchmark_buy_hold || {};
  const eqCurve = normalizeRealCurve(payload.equity_curve, "eq_weight_nav");
  const bhCurve = normalizeRealCurve(payload.equity_curve, "buy_hold_nav");
  const benchmarks = [
    {
      id: "real_eq_weight",
      name: "真实管线等权基准",
      category: "Benchmark",
      source: "新框架",
      badge: "Benchmark",
      description: "真实数据管线内置的流动性股票等权再平衡基准。",
      stats: eqStats,
      curve: eqCurve,
      yearlyKey: "eq_weight",
    },
    {
      id: "real_buy_hold",
      name: "真实管线买入持有",
      category: "Benchmark",
      source: "新框架",
      badge: "Benchmark",
      description: "真实数据管线内置的初始等权买入持有基准。",
      stats: bhStats,
      curve: bhCurve,
      yearlyKey: "buy_hold",
    },
  ]
    .filter((item) => item.curve.length)
    .map((item) => ({
      id: item.id,
      name: item.name,
      category: item.category,
      source: item.source,
      badge: item.badge,
      description: item.description,
      metrics: {
        total_return: isFiniteNumber(item.stats.total_return)
          ? item.stats.total_return
          : inferReturnFromCurve(payload.equity_curve || [], item.id === "real_eq_weight" ? "eq_weight_nav" : "buy_hold_nav"),
        annual_return: null,
        max_drawdown: item.stats.max_drawdown,
        sharpe_ratio: item.stats.sharpe_ratio,
        win_rate: null,
        avg_turnover: null,
        ending_equity: item.curve.at(-1).equity,
      },
      equity_curve: item.curve,
      yearly_returns: (payload.yearly_returns || []).map((row) => ({
        year: row.year,
        return: row[item.yearlyKey],
      })),
      latest_holdings: [],
    }));

  return [strategy, ...benchmarks];
}

function currentStrategy() {
  return state.strategies.find((s) => s.id === state.selectedId) || state.strategies[0];
}

function historicalBest() {
  const legacy = state.strategies.filter((s) => s.source === "历史实验");
  return legacy.sort((a, b) => finite(b.metrics.total_return) - finite(a.metrics.total_return))[0];
}

function realStrategy() {
  return state.strategies.find((s) => s.badge === "Real Data");
}

function renderSelect() {
  const select = document.querySelector("#strategySelect");
  select.innerHTML = state.strategies
    .map((s) => `<option value="${s.id}">${s.name} · ${s.source}</option>`)
    .join("");
  select.value = state.selectedId;
  select.addEventListener("change", () => {
    state.selectedId = select.value;
    renderAll();
  });
}

function renderMetricGrid() {
  const best = historicalBest();
  const real = realStrategy();
  const meta = state.real?.meta || state.legacy?.meta || {};
  const riskEvents = state.real?.risk_events || [];
  const cards = [
    {
      label: "历史最佳",
      value: best ? fmtPct(best.metrics.total_return, { signed: true }) : "-",
      note: best ? `${best.name} · 夏普 ${fmtNum(best.metrics.sharpe_ratio, 2)}` : "等待历史实验",
      tone: "green",
    },
    {
      label: "新框架收益",
      value: real ? fmtPct(real.metrics.total_return, { signed: true }) : "-",
      note: real ? `${fmtDate(meta.start)} → ${fmtDate(meta.end)}` : "等待真实回测",
      tone: real && real.metrics.total_return >= 0 ? "green" : "rose",
    },
    {
      label: "股票池",
      value: fmtMoney(meta.n_universe_stocks || state.legacy?.meta?.data_rows),
      note: meta.n_trading_days ? `${meta.n_trading_days} 个交易日` : `${state.legacy?.meta?.rebalance_count || "-"} 次调仓`,
      tone: "cyan",
    },
    {
      label: "风控事件",
      value: String(riskEvents.length),
      note: riskEvents.length ? riskEvents.map((e) => e.type).slice(0, 2).join(" / ") : "当前样本未触发",
      tone: riskEvents.length ? "amber" : "green",
    },
  ];
  document.querySelector("#overview").innerHTML = cards
    .map(
      (card) => `
      <article class="metric-card tone-${card.tone}">
        <div class="metric-label">${card.label}</div>
        <div class="metric-value">${card.value}</div>
        <div class="metric-note">${card.note}</div>
      </article>`
    )
    .join("");
}

function renderCommandStrip() {
  const best = historicalBest();
  const real = realStrategy();
  const gap = best && real && isFiniteNumber(best.metrics.total_return) && isFiniteNumber(real.metrics.total_return)
    ? Number(real.metrics.total_return) - Number(best.metrics.total_return)
    : null;
  const meta = state.real?.meta || state.legacy?.meta || {};
  document.querySelector("#bestLine").textContent = best
    ? `${best.name} ${fmtPct(best.metrics.total_return, { signed: true })}`
    : "--";
  document.querySelector("#realLine").textContent = real
    ? `${real.name} ${fmtPct(real.metrics.total_return, { signed: true })}`
    : "--";
  document.querySelector("#gapLine").textContent = isFiniteNumber(gap)
    ? `${fmtPct(gap, { signed: true })}`
    : "--";
  document.querySelector("#gapLine").className = valueClass(gap);
  document.querySelector("#windowLine").textContent =
    meta.start && meta.end ? `${fmtDate(meta.start)} → ${fmtDate(meta.end)}` : "--";
}

function renderEquityChart() {
  const container = document.querySelector("#equityChart");
  container.innerHTML = makeSvg(980, 430);
  const svg = container.querySelector("svg");
  const margin = { top: 16, right: 24, bottom: 34, left: 64 };
  const width = 980;
  const height = 430;
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;
  const candidates = [
    currentStrategy(),
    historicalBest(),
    realStrategy(),
    ...state.strategies.filter((s) => s.category === "Benchmark"),
  ].filter(Boolean);
  const seen = new Set();
  const series = candidates.filter((s) => {
    if (seen.has(s.id) || !s.equity_curve?.length) return false;
    seen.add(s.id);
    return true;
  });
  const allPoints = series.flatMap((s) => s.equity_curve.map((p, i) => ({ ...p, i })));
  if (!allPoints.length) return;
  const maxIndex = Math.max(...allPoints.map((p) => p.i));
  const minEquity = Math.min(...allPoints.map((p) => p.equity));
  const maxEquity = Math.max(...allPoints.map((p) => p.equity));
  const x = scaleLinear(0, maxIndex, margin.left, margin.left + plotW);
  const y = scaleLinear(minEquity * 0.92, maxEquity * 1.05, margin.top + plotH, margin.top);
  const grid = [0, 0.25, 0.5, 0.75, 1].map((t) => {
    const gy = margin.top + plotH * t;
    const value = maxEquity * 1.05 - (maxEquity * 1.05 - minEquity * 0.92) * t;
    return `<line class="grid-line" x1="${margin.left}" x2="${margin.left + plotW}" y1="${gy}" y2="${gy}"></line>
      <text class="axis-text" x="12" y="${gy + 4}">${fmtMoney(value / 10000)}万</text>`;
  });
  svg.insertAdjacentHTML("beforeend", grid.join(""));
  series.slice().reverse().forEach((strategy) => {
    const pts = strategy.equity_curve.map((p, i) => ({ x: x(i), y: y(p.equity) }));
    const active = strategy.id === state.selectedId;
    svg.insertAdjacentHTML(
      "beforeend",
      `<path d="${pathFromPoints(pts)}" fill="none" stroke="${colors[strategy.id] || "#edf4f7"}" stroke-width="${active ? 3.4 : 1.8}" opacity="${active ? 1 : 0.62}"></path>`
    );
  });
  const firstDate = series[0].equity_curve[0].date;
  const lastDate = series[0].equity_curve.at(-1).date;
  svg.insertAdjacentHTML(
    "beforeend",
    `<text class="axis-text" x="${margin.left}" y="${height - 8}">${fmtDate(firstDate)}</text>
     <text class="axis-text" x="${width - margin.right - 92}" y="${height - 8}">${fmtDate(lastDate)}</text>`
  );
  document.querySelector("#equityLegend").innerHTML = series
    .map(
      (s) => `<span class="legend-item"><span class="legend-swatch" style="background:${colors[s.id] || "#edf4f7"}"></span>${s.name}</span>`
    )
    .join("");
}

function renderSelectedDetail() {
  const s = currentStrategy();
  if (!s) return;
  document.querySelector("#selectedName").textContent = s.name;
  document.querySelector("#selectedBadge").textContent = s.badge || s.source || "--";
  document.querySelector("#selectedDescription").textContent = s.description || "";
  const metrics = [
    ["总收益", fmtPct(s.metrics.total_return, { signed: true }), valueClass(s.metrics.total_return)],
    ["年化收益", fmtPct(s.metrics.annual_return, { signed: true }), valueClass(s.metrics.annual_return)],
    ["最大回撤", fmtPct(s.metrics.max_drawdown), "negative"],
    ["夏普比率", fmtNum(s.metrics.sharpe_ratio, 2), valueClass(s.metrics.sharpe_ratio)],
    ["胜率", fmtPct(s.metrics.win_rate), ""],
    ["平均换手", fmtPct(s.metrics.avg_turnover), ""],
    ["期末权益", fmtMoney(s.metrics.ending_equity), ""],
    ["数据源", s.source || "-", ""],
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
  if (!s?.equity_curve?.length) return;
  const svg = container.querySelector("svg");
  const margin = { top: 10, right: 18, bottom: 28, left: 54 };
  const width = 640;
  const height = 270;
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;
  const minD = Math.min(-0.01, ...s.equity_curve.map((p) => normalizeDrawdown(p.drawdown)));
  const x = scaleLinear(0, s.equity_curve.length - 1, margin.left, margin.left + plotW);
  const y = scaleLinear(minD * 1.15, 0, margin.top + plotH, margin.top);
  const pts = s.equity_curve.map((p, i) => ({ x: x(i), y: y(normalizeDrawdown(p.drawdown)) }));
  const area = `${pathFromPoints(pts)} L${x(s.equity_curve.length - 1)},${y(0)} L${x(0)},${y(0)} Z`;
  svg.insertAdjacentHTML(
    "beforeend",
    `<line class="grid-line" x1="${margin.left}" x2="${margin.left + plotW}" y1="${y(0)}" y2="${y(0)}"></line>
     <path d="${area}" fill="rgba(255,111,145,0.20)"></path>
     <path d="${pathFromPoints(pts)}" fill="none" stroke="${colors[s.id] || "#ff6f91"}" stroke-width="2.4"></path>
     <text class="axis-text" x="8" y="${y(minD) + 4}">${fmtPct(minD)}</text>
     <text class="axis-text" x="${margin.left}" y="${height - 8}">${fmtDate(s.equity_curve[0].date)}</text>
     <text class="axis-text" x="${width - margin.right - 90}" y="${height - 8}">${fmtDate(s.equity_curve.at(-1).date)}</text>`
  );
}

function renderYearlyChart() {
  const s = currentStrategy();
  const container = document.querySelector("#yearlyChart");
  container.innerHTML = makeSvg(640, 270);
  const rows = (s?.yearly_returns || []).filter((r) => isFiniteNumber(r.return));
  if (!rows.length) {
    container.innerHTML = `<div class="empty-state">年度数据待生成</div>`;
    return;
  }
  const svg = container.querySelector("svg");
  const width = 640;
  const height = 270;
  const margin = { top: 16, right: 18, bottom: 32, left: 44 };
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;
  const values = rows.map((r) => Number(r.return));
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const y = scaleLinear(min * 1.15, max * 1.15 || 0.1, margin.top + plotH, margin.top);
  const step = plotW / Math.max(rows.length, 1);
  const barW = Math.max(10, step - 8);
  svg.insertAdjacentHTML("beforeend", `<line class="grid-line" x1="${margin.left}" x2="${margin.left + plotW}" y1="${y(0)}" y2="${y(0)}"></line>`);
  rows.forEach((row, i) => {
    const x = margin.left + i * step + 4;
    const y0 = y(0);
    const yv = y(Number(row.return));
    const h = Math.abs(yv - y0);
    const top = Math.min(y0, yv);
    const fill = Number(row.return) >= 0 ? "var(--green)" : "var(--rose)";
    svg.insertAdjacentHTML(
      "beforeend",
      `<rect x="${x}" y="${top}" width="${barW}" height="${Math.max(h, 1)}" rx="4" fill="${fill}"></rect>
       <text class="axis-text" x="${x}" y="${height - 8}">${String(row.year).slice(2)}</text>`
    );
  });
}

function renderStrategyTable() {
  const rows = state.strategies
    .slice()
    .sort((a, b) => finite(b.metrics.total_return, -999) - finite(a.metrics.total_return, -999))
    .map((s, index) => {
      const m = s.metrics;
      return `<tr data-id="${s.id}">
        <td>${index + 1}</td>
        <td><button class="row-button" data-id="${s.id}">${s.name}</button></td>
        <td><span class="source-badge small">${s.source}</span></td>
        <td>${s.category}</td>
        <td class="${valueClass(m.total_return)}">${fmtPct(m.total_return, { signed: true })}</td>
        <td class="${valueClass(m.annual_return)}">${fmtPct(m.annual_return, { signed: true })}</td>
        <td class="negative">${fmtPct(m.max_drawdown)}</td>
        <td class="${valueClass(m.sharpe_ratio)}">${fmtNum(m.sharpe_ratio, 2)}</td>
        <td>${fmtPct(m.win_rate)}</td>
        <td>${fmtMoney(m.ending_equity)}</td>
      </tr>`;
    })
    .join("");
  document.querySelector("#strategyTable").innerHTML = `
    <thead><tr><th>#</th><th>策略</th><th>来源</th><th>类别</th><th>总收益</th><th>年化</th><th>最大回撤</th><th>夏普</th><th>胜率</th><th>期末权益</th></tr></thead>
    <tbody>${rows}</tbody>`;
  document.querySelectorAll(".row-button").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedId = button.dataset.id;
      document.querySelector("#strategySelect").value = state.selectedId;
      renderAll();
    });
  });
}

function renderHoldings() {
  const s = currentStrategy();
  const rows = s?.latest_holdings?.length
    ? s.latest_holdings
        .slice(0, 16)
        .map(
          (h, i) => `<tr><td>${i + 1}</td><td>${h.symbol || h.ts_code}</td><td>${h.name || ""}</td><td>${fmtPct(h.weight)}</td></tr>`
        )
        .join("")
    : `<tr><td colspan="4">暂无持仓快照</td></tr>`;
  document.querySelector("#holdingsTable").innerHTML = `
    <thead><tr><th>#</th><th>代码</th><th>名称</th><th>权重</th></tr></thead>
    <tbody>${rows}</tbody>`;
}

function renderRiskEvents() {
  const events = state.real?.risk_events || [];
  document.querySelector("#riskEvents").innerHTML = events.length
    ? events
        .map(
          (event) => `<div class="event-row">
            <span class="event-type">${event.type}</span>
            <strong>${isFiniteNumber(event.value) ? fmtNum(event.value, 3) : "-"}</strong>
            <span>${event.limit ? `limit ${event.limit}` : ""}</span>
          </div>`
        )
        .join("")
    : `<div class="empty-state">真实管线样本未产生风控事件</div>`;
}

function fmtVolume(value) {
  if (!isFiniteNumber(value)) return "-";
  const number = Number(value);
  if (Math.abs(number) >= 100000000) return `${(number / 100000000).toFixed(2)}亿`;
  if (Math.abs(number) >= 10000) return `${(number / 10000).toFixed(2)}万`;
  return fmtMoney(number);
}

function ensureLightweightCharts() {
  if (window.LightweightCharts) return Promise.resolve(true);
  if (state.kline.scriptReady) return state.kline.scriptReady;
  state.kline.scriptReady = new Promise((resolve) => {
    const script = document.createElement("script");
    script.src = LIGHTWEIGHT_CHARTS_URL;
    script.async = true;
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.head.appendChild(script);
  });
  return state.kline.scriptReady;
}

function klineQuery() {
  const symbol = document.querySelector("#klineSymbol")?.value?.trim() || "000001.SZ";
  const interval = document.querySelector("#klineInterval")?.value || "1d";
  const limit = interval === "1d" ? 260 : 320;
  const params = new URLSearchParams({ symbol, interval, limit: String(limit) });
  return { symbol, interval, limit, url: `${KLINE_API_URL}?${params.toString()}` };
}

async function fetchKlinePayload(query) {
  const fallbackUrl = KLINE_STATIC_URLS[query.interval] || KLINE_STATIC_URLS["1d"];
  const urls = [query.url, fallbackUrl];
  let lastError = null;
  for (const url of urls) {
    try {
      const payload = await fetchJsonLoose(url);
      if (payload?.bars?.length) {
        return {
          ...payload,
          meta: {
            ...(payload.meta || {}),
            delivery: url === query.url ? "local-api" : "static-sample",
          },
        };
      }
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("K line data unavailable");
}

function klineBarColor(bar) {
  return finite(bar.close) >= finite(bar.open) ? colors.multifactor : colors.reversal_5;
}

function renderKlineSummary(payload) {
  const summary = document.querySelector("#klineSummary");
  if (!summary) return;
  const bars = payload?.bars || [];
  const last = bars.at(-1);
  const prev = bars.length > 1 ? bars.at(-2) : null;
  const change = last && prev && finite(prev.close) !== 0 ? finite(last.close) / finite(prev.close) - 1 : null;
  const meta = payload?.meta || {};
  const delivery = meta.delivery === "local-api" ? "本地 API" : "静态样例";
  summary.innerHTML = last
    ? [
        ["标的", `${meta.symbol || "--"} ${meta.name || ""}`.trim(), `${meta.interval || "--"} · ${delivery}`],
        ["最新价", fmtNum(last.close, 2), last.label || last.time],
        ["涨跌", isFiniteNumber(change) ? fmtPct(change, { signed: true }) : "-", "相邻 K 线"],
        ["成交量", fmtVolume(last.volume), "原始本地字段"],
        ["数据源", String(meta.count || bars.length), meta.source || "-"],
      ]
        .map(
          ([label, value, note]) => `<div class="summary-chip">
            <span>${label}</span>
            <strong class="${label === "涨跌" ? valueClass(change) : ""}">${value}</strong>
            <em>${note}</em>
          </div>`
        )
        .join("")
    : `<div class="empty-state">暂无 K 线数据</div>`;
}

function renderKlineFallback(container, bars) {
  const width = 1200;
  const height = 520;
  const pad = { top: 24, right: 48, bottom: 34, left: 36 };
  const rows = bars.slice(-120);
  const highs = rows.map((bar) => finite(bar.high));
  const lows = rows.map((bar) => finite(bar.low));
  const min = Math.min(...lows);
  const max = Math.max(...highs);
  const x = scaleLinear(0, Math.max(rows.length - 1, 1), pad.left, width - pad.right);
  const y = scaleLinear(min, max, height - pad.bottom, pad.top);
  const candleWidth = Math.max(3, Math.min(9, (width - pad.left - pad.right) / rows.length * 0.62));
  const candles = rows
    .map((bar, index) => {
      const cx = x(index);
      const openY = y(finite(bar.open));
      const closeY = y(finite(bar.close));
      const highY = y(finite(bar.high));
      const lowY = y(finite(bar.low));
      const color = klineBarColor(bar);
      const bodyTop = Math.min(openY, closeY);
      const bodyHeight = Math.max(Math.abs(openY - closeY), 1.5);
      return `<line class="wick" x1="${cx}" x2="${cx}" y1="${highY}" y2="${lowY}" stroke="${color}" />
        <rect class="candle" x="${cx - candleWidth / 2}" y="${bodyTop}" width="${candleWidth}" height="${bodyHeight}" fill="${color}" />`;
    })
    .join("");
  const grid = [0, 0.25, 0.5, 0.75, 1]
    .map((ratio) => {
      const gy = pad.top + (height - pad.top - pad.bottom) * ratio;
      return `<line class="grid-line" x1="${pad.left}" x2="${width - pad.right}" y1="${gy}" y2="${gy}" />`;
    })
    .join("");
  container.innerHTML = `<svg class="fallback-candles" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">${grid}${candles}</svg>`;
}

async function renderKline() {
  const container = document.querySelector("#klineChart");
  if (!container) return;
  container.innerHTML = `<div class="empty-state">正在读取本地 K 线数据...</div>`;
  const query = klineQuery();
  try {
    const payload = await fetchKlinePayload(query);
    state.kline.payload = payload;
    renderKlineSummary(payload);
    const bars = (payload.bars || []).map((bar) => ({
      ...bar,
      open: finite(bar.open),
      high: finite(bar.high),
      low: finite(bar.low),
      close: finite(bar.close),
      volume: finite(bar.volume),
    }));
    if (!bars.length) {
      container.innerHTML = `<div class="empty-state">没有匹配的 K 线记录</div>`;
      return;
    }
    if (state.kline.chart) {
      state.kline.chart.remove();
      state.kline.chart = null;
    }
    const hasLibrary = await ensureLightweightCharts();
    if (!hasLibrary || !window.LightweightCharts) {
      renderKlineFallback(container, bars);
      return;
    }
    container.innerHTML = "";
    const chart = LightweightCharts.createChart(container, {
      layout: {
        background: { type: "solid", color: "#0b1118" },
        textColor: "#c8d5dc",
      },
      grid: {
        vertLines: { color: "#1d2935" },
        horzLines: { color: "#1d2935" },
      },
      rightPriceScale: { borderColor: "#263241" },
      timeScale: {
        borderColor: "#263241",
        timeVisible: query.interval !== "1d",
        secondsVisible: false,
      },
      crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
    });
    const candleSeries = chart.addCandlestickSeries({
      upColor: colors.multifactor,
      downColor: colors.reversal_5,
      borderUpColor: colors.multifactor,
      borderDownColor: colors.reversal_5,
      wickUpColor: colors.multifactor,
      wickDownColor: colors.reversal_5,
    });
    candleSeries.setData(bars.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })));
    const volumeSeries = chart.addHistogramSeries({
      priceFormat: { type: "volume" },
      priceScaleId: "",
    });
    volumeSeries.priceScale().applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    });
    volumeSeries.setData(
      bars.map((bar) => ({
        time: bar.time,
        value: bar.volume,
        color: `${klineBarColor(bar)}66`,
      }))
    );
    chart.timeScale().fitContent();
    state.kline.chart = chart;
  } catch (error) {
    renderKlineSummary(null);
    container.innerHTML = `<div class="empty-state">K 线读取失败：${error.message}</div>`;
  }
}

function setupKlineControls() {
  if (state.kline.controlsReady) return;
  const refresh = document.querySelector("#klineRefresh");
  const symbol = document.querySelector("#klineSymbol");
  const interval = document.querySelector("#klineInterval");
  refresh?.addEventListener("click", renderKline);
  interval?.addEventListener("change", renderKline);
  symbol?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") renderKline();
  });
  window.addEventListener("resize", () => {
    if (!state.kline.chart) return;
    const container = document.querySelector("#klineChart");
    state.kline.chart.resize(container.clientWidth, container.clientHeight);
  });
  state.kline.controlsReady = true;
}

function renderLayerFlow() {
  const layers = [
    ["Data", "ashare API / SQLite", "字段标准化、复权价格、ST 过滤"],
    ["Market", "local K-line API", "日线 CSV、分钟 ZIP、Pages 样例兜底"],
    ["Features", "price + liquidity factors", "截面去极值、Z-score、复合分"],
    ["Strategy", "HS300 multifactor", "排序选股、流动性过滤、持仓上限"],
    ["Portfolio", "weighting", "等权 / 分数权重 / 单票封顶"],
    ["Execution", "SimulatedBroker", "成本、滑点、坏价格拒单"],
    ["Risk", "RiskAgent", "回撤、换手、负夏普扫描"],
    ["Publish", "static dashboard", "私有研究仓库 + 公开 Pages"],
  ];
  document.querySelector("#layerFlow").innerHTML = layers
    .map(
      ([key, title, note], index) => `<div class="layer-row">
        <div class="layer-index">${String(index + 1).padStart(2, "0")}</div>
        <div>
          <div class="layer-title">${key} · ${title}</div>
          <div class="layer-note">${note}</div>
        </div>
      </div>`
    )
    .join("");
}

function renderContracts() {
  const real = state.real;
  const deploy = state.deploy;
  const contracts = [
    ["Ashare API", "公开无 token", "http://43.103.51.239/ashare"],
    ["Local K-line", "本地优先", "/api/kline?symbol=000001.SZ&interval=1d"],
    ["Python Client", "daily/data envelope", "AshareAPI.daily()"],
    ["Backtest JSON", real ? "已读取" : "缺失", "dashboard/data/backtest_result.json"],
    ["Legacy Lab JSON", state.legacy ? "已读取" : "缺失", "dashboard/data/strategy_lab_results.json"],
    ["Pages Repo", "public", "jiaweioss/ziying-quant-dashboard-pages"],
    ["Deploy Info", deploy?.source_sha ? deploy.source_sha.slice(0, 7) : "本地预览", deploy?.deployed_at || "-"],
  ];
  document.querySelector("#contractList").innerHTML = contracts
    .map(
      ([name, status, detail]) => `<div class="contract-row">
        <span>${name}</span>
        <strong>${status}</strong>
        <em>${detail}</em>
      </div>`
    )
    .join("");
}

function renderWeightsHeatmap() {
  const rows = (state.legacy?.adaptive_factor_weights || []).filter((_, i) => i % 6 === 0).slice(-14);
  const factors = ["momentum", "value", "low_vol", "liquidity", "trend"];
  document.querySelector("#weightsHeatmap").innerHTML = rows.length
    ? rows
        .map((row) => {
          const cells = factors
            .map((factor) => {
              const value = finite(row[factor]);
              const alpha = 0.14 + Math.min(Math.max(value, 0), 1) * 0.78;
              return `<div class="heat-cell" title="${factorLabels[factor]} ${(value * 100).toFixed(1)}%" style="background: rgba(67,211,158,${alpha})"></div>`;
            })
            .join("");
          return `<div class="heat-row"><div class="heat-date">${fmtDate(row.date)}</div>${cells}</div>`;
        })
        .join("")
    : `<div class="empty-state">滚动 IC 权重待生成</div>`;
}

function renderRoadmap() {
  const roadmap = state.legacy?.roadmap || [
    { stage: "P0", title: "合同收口", items: ["API envelope", "strict JSON", "dashboard schema"] },
    { stage: "P1", title: "真实约束", items: ["涨跌停", "停牌", "退市和上市天数"] },
    { stage: "P2", title: "模型迭代", items: ["中性化", "IC/IR", "LightGBM"] },
    { stage: "P3", title: "发布闭环", items: ["私有研究", "公开看板", "定时重算"] },
  ];
  document.querySelector("#roadmap").innerHTML = roadmap
    .map(
      (stage) => `<div class="roadmap-item">
        <span>${stage.stage}</span>
        <strong>${stage.title}</strong>
        <em>${(stage.items || []).join(" · ")}</em>
      </div>`
    )
    .join("");
}

function renderDeployInfo() {
  const el = document.querySelector("#deployInfo");
  const info = state.deploy;
  if (!el) return;
  if (!info?.deployed_at) {
    el.textContent = "本地预览";
    return;
  }
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
  renderCommandStrip();
  renderEquityChart();
  renderSelectedDetail();
  renderDrawdownChart();
  renderYearlyChart();
  renderStrategyTable();
  renderLayerFlow();
  renderContracts();
  renderHoldings();
  renderRiskEvents();
  renderWeightsHeatmap();
  renderRoadmap();
  renderDeployInfo();
}

async function boot() {
  const [legacy, real, deploy] = await Promise.all([
    fetchJsonLoose(LEGACY_URL).catch(() => null),
    fetchJsonLoose(REAL_URL).catch(() => null),
    fetchJsonLoose(DEPLOY_INFO_URL).catch(() => null),
  ]);
  state.legacy = legacy;
  state.real = real;
  state.deploy = deploy;
  const legacyStrategies = (legacy?.strategies || []).map(normalizeLegacyStrategy);
  const realStrategies = normalizeRealPayload(real);
  state.strategies = [...legacyStrategies, ...realStrategies];
  if (!state.strategies.length) {
    document.body.innerHTML = `<main class="empty-state">暂无可展示的回测数据</main>`;
    return;
  }
  state.selectedId = historicalBest()?.id || state.strategies[0].id;
  renderSelect();
  renderAll();
  setupKlineControls();
  renderKline();
}

boot().catch((error) => {
  document.body.innerHTML = `<main class="empty-state">无法读取回测结果：${error.message}</main>`;
});
