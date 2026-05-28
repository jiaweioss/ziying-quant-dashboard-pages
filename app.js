const LEGACY_URL = "./data/strategy_lab_results.json";
const REAL_URL = "./data/backtest_result.json";
const DEPLOY_INFO_URL = "./deploy-info.json";
const WORKBENCH_API_URL = "api/workbench";
const WORKBENCH_STATIC_URL = "./data/workbench_manifest.json";
const BLUEPRINT_API_URL = "api/blueprint";
const BLUEPRINT_STATIC_URL = "./data/company_blueprint.json";
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
const KLINECHARTS_URL = "https://cdn.jsdelivr.net/npm/klinecharts@9.8.12/dist/umd/klinecharts.min.js";
const TRADINGVIEW_WIDGET_URL = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
const LOCAL_KLINE_CACHE_MS = 45_000;

const INTERVAL_LABELS = {
  "1m": "1 分钟",
  "5m": "5 分钟",
  "15m": "15 分钟",
  "30m": "30 分钟",
  "60m": "60 分钟",
  "1d": "日线",
};

const PAGE_META = {
  overview: ["Research Pipeline", "量化研究工作台"],
  data: ["Data Console", "数据：原材料"],
  factors: ["Factor Lab", "因子：表达信息"],
  features: ["Feature Factory", "特征：标准化输入"],
  models: ["Model Lab", "模型：预测"],
  strategy: ["Strategy Desk", "策略：决策"],
  portfolio: ["Portfolio Studio", "组合：仓位"],
  execution: ["Execution Desk", "执行：落地"],
  risk: ["Risk Console", "风控：刹车"],
  backtest: ["Backtest Lab", "回测：定位问题"],
  market: ["Market Terminal", "A 股行情看盘"],
  blueprint: ["Company Blueprint", "量化公司控制台蓝图"],
  ops: ["Collaboration Ops", "接口、发布与路线"],
};

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
  workbench: null,
  blueprint: null,
  strategies: [],
  selectedId: null,
  activePage: "overview",
  kline: {
    payload: null,
    chart: null,
    controlsReady: false,
    scriptReady: null,
  },
  market: {
    mode: "external",
    source: "pro",
    widgetKey: null,
    proChart: null,
    proScriptReady: null,
    proPayload: null,
    proIndicators: new Set(["MA", "VOL"]),
    quantLayers: new Set(["signals", "score", "risk"]),
    cache: new Map(),
    inFlight: null,
    latencyMs: null,
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

async function fetchFirstJson(urls) {
  for (const url of urls) {
    try {
      const payload = await fetchJsonLoose(url);
      if (payload) return payload;
    } catch {
      // Try the next source; local API is optional on GitHub Pages.
    }
  }
  return null;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderTagList(items, klass = "tag") {
  return (items || []).map((item) => `<span class="${klass}">${escapeHtml(item)}</span>`).join("");
}

function statusLabel(value) {
  return (
    {
      now: "已接入",
      next: "下一步",
      design: "设计中",
      reference: "参考框架",
      later: "后续接入",
    }[value] || value || "待定"
  );
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

function moduleById(id) {
  return (state.workbench?.modules || []).find((module) => module.id === id);
}

function pageFromHash() {
  const candidate = decodeURIComponent((window.location.hash || "#overview").slice(1));
  return document.querySelector(`.page[data-page="${candidate}"]`) ? candidate : "overview";
}

function activatePage(pageId, options = {}) {
  const target = document.querySelector(`.page[data-page="${pageId}"]`);
  if (!target) return;
  state.activePage = pageId;
  document.querySelectorAll(".page").forEach((page) => {
    page.classList.toggle("active", page === target);
  });
  document.querySelectorAll(".nav-item").forEach((item) => {
    item.classList.toggle("active", item.dataset.page === pageId);
  });
  const module = moduleById(pageId);
  const [eyebrow, title] = PAGE_META[pageId] || [module?.role || "Research OS", module?.title || "量化研究工作台"];
  document.querySelector("#pageEyebrow").textContent = eyebrow;
  document.querySelector("#pageTitle").textContent = title;
  if (options.push && window.location.hash !== `#${pageId}`) {
    window.history.pushState(null, "", `#${pageId}`);
  } else if (!window.location.hash) {
    window.history.replaceState(null, "", `#${pageId}`);
  }
  document.querySelector(".workspace")?.scrollTo({ top: 0, behavior: options.instant ? "auto" : "smooth" });
  if (pageId === "market") {
    window.setTimeout(renderMarket, 80);
  } else if (state.kline.chart) {
    state.kline.chart.remove();
    state.kline.chart = null;
  }
}

function setupPageNavigation() {
  document.querySelectorAll(".nav-item[data-page]").forEach((item) => {
    item.addEventListener("click", (event) => {
      event.preventDefault();
      activatePage(item.dataset.page, { push: true });
    });
  });
  window.addEventListener("hashchange", () => activatePage(pageFromHash(), { instant: true }));
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
  document.querySelector("#overviewMetrics").innerHTML = cards
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

function maturityTone(value) {
  if (value >= 0.65) return "green";
  if (value >= 0.45) return "cyan";
  if (value >= 0.32) return "amber";
  return "rose";
}

function listItems(items, klass = "chip") {
  return (items || []).map((item) => `<span class="${klass}">${escapeHtml(item)}</span>`).join("");
}

function renderModuleDetail(module) {
  const percent = Math.round(finite(module.maturity) * 100);
  const tone = maturityTone(finite(module.maturity));
  const interfaceRows = (module.interfaces || [])
    .map(
      (contract) => `<div class="contract-spec">
        <strong>${escapeHtml(contract.name)}</strong>
        <code>${(contract.fields || []).map(escapeHtml).join(" · ")}</code>
      </div>`
    )
    .join("");
  return `
    <section class="module-hero tone-${tone}">
      <div>
        <p class="eyebrow">${String(module.order).padStart(2, "0")} · ${escapeHtml(module.role)}</p>
        <h2>${escapeHtml(module.title)}：${escapeHtml(module.subtitle)}</h2>
        <p>${escapeHtml(module.summary)}</p>
      </div>
      <div class="maturity-meter" style="--maturity:${percent}%">
        <span>${percent}%</span>
        <em>${escapeHtml(module.status)}</em>
      </div>
    </section>
    <section class="module-grid">
      <div class="panel">
        <div class="panel-head compact"><div><p class="eyebrow">Input</p><h2>输入</h2></div></div>
        <div class="chip-cloud">${listItems(module.inputs)}</div>
      </div>
      <div class="panel">
        <div class="panel-head compact"><div><p class="eyebrow">Output</p><h2>输出</h2></div></div>
        <div class="chip-cloud">${listItems(module.outputs, "chip output")}</div>
      </div>
      <div class="panel">
        <div class="panel-head compact"><div><p class="eyebrow">Controls</p><h2>成熟控制项</h2></div></div>
        <div class="check-list">${(module.controls || []).map((item) => `<div>✓ ${escapeHtml(item)}</div>`).join("")}</div>
      </div>
      <div class="panel">
        <div class="panel-head compact"><div><p class="eyebrow">Current Code</p><h2>当前实现</h2></div></div>
        <div class="file-list">${(module.current_files || []).map((file) => `<code>${escapeHtml(file)}</code>`).join("")}</div>
      </div>
      <div class="panel wide">
        <div class="panel-head compact"><div><p class="eyebrow">Interface</p><h2>接口契约</h2></div></div>
        <div class="contract-spec-list">${interfaceRows}</div>
      </div>
      <div class="panel wide">
        <div class="panel-head compact"><div><p class="eyebrow">Next Iteration</p><h2>下一步要补</h2></div></div>
        <div class="gap-list">${(module.gaps || []).map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div>
        <div class="next-list">${(module.next || []).map((item) => `<div>${escapeHtml(item)}</div>`).join("")}</div>
      </div>
    </section>`;
}

function renderWorkbenchPages() {
  (state.workbench?.modules || []).forEach((module) => {
    const container = document.querySelector(`#module-${module.id}`);
    if (container) container.innerHTML = renderModuleDetail(module);
  });
}

function renderPipelineMap() {
  const modules = state.workbench?.modules || [];
  const interfaces = state.workbench?.interfaces || [];
  const byId = Object.fromEntries(modules.map((module) => [module.id, module]));
  document.querySelector("#pipelineMap").innerHTML = interfaces
    .map((edge, index) => {
      const from = byId[edge.from];
      const to = byId[edge.to];
      return `<button class="pipeline-step" type="button" data-page="${escapeHtml(edge.to)}">
        <span>${String(index + 1).padStart(2, "0")}</span>
        <strong>${escapeHtml(from?.title || edge.from)} → ${escapeHtml(to?.title || edge.to)}</strong>
        <em>${escapeHtml(edge.artifact)}</em>
      </button>`;
    })
    .join("");
  document.querySelectorAll(".pipeline-step").forEach((button) => {
    button.addEventListener("click", () => activatePage(button.dataset.page, { push: true }));
  });
}

function renderIterationBoard() {
  const modules = (state.workbench?.modules || []).slice().sort((a, b) => finite(a.maturity) - finite(b.maturity));
  document.querySelector("#iterationBoard").innerHTML = modules
    .slice(0, 5)
    .map(
      (module) => `<button class="iteration-item" type="button" data-page="${escapeHtml(module.id)}">
        <span>${escapeHtml(module.title)} · ${Math.round(finite(module.maturity) * 100)}%</span>
        <strong>${escapeHtml((module.next || [])[0] || module.summary)}</strong>
        <em>${escapeHtml((module.gaps || []).slice(0, 3).join(" / "))}</em>
      </button>`
    )
    .join("");
  document.querySelectorAll(".iteration-item").forEach((button) => {
    button.addEventListener("click", () => activatePage(button.dataset.page, { push: true }));
  });
}

function renderModuleCards() {
  const modules = state.workbench?.modules || [];
  document.querySelector("#moduleCards").innerHTML = modules
    .map((module) => {
      const percent = Math.round(finite(module.maturity) * 100);
      return `<button class="module-card" type="button" data-page="${escapeHtml(module.id)}">
        <span>${String(module.order).padStart(2, "0")} · ${escapeHtml(module.role)}</span>
        <strong>${escapeHtml(module.title)}</strong>
        <em>${escapeHtml(module.status)}</em>
        <i><b style="width:${percent}%"></b></i>
      </button>`;
    })
    .join("");
  document.querySelectorAll(".module-card").forEach((button) => {
    button.addEventListener("click", () => activatePage(button.dataset.page, { push: true }));
  });
}

function renderFeatureFactory() {
  const items = [
    ["去极值", "winsorize", "降低极端值对截面排序的冲击"],
    ["标准化", "z-score", "把动量、成交额、波动率变成可比较分数"],
    ["缺失处理", "missing policy", "区分真实缺失、上市不足和停牌缺失"],
    ["中性化", "industry / size neutral", "下一步要加入行业和市值暴露控制"],
    ["泄露检查", "point-in-time", "所有标签必须来自未来，所有特征只能来自当时"],
  ];
  document.querySelector("#featureFactory").innerHTML = items
    .map(
      ([title, key, note]) => `<div class="factory-item">
        <span>${key}</span>
        <strong>${title}</strong>
        <em>${note}</em>
      </div>`
    )
    .join("");
}

function renderModelQueue() {
  const weights = state.legacy?.adaptive_factor_weights || [];
  const lastWeight = weights.at(-1) || {};
  const candidates = [
    ["Rolling IC", "已接入", `最近权重：动量 ${fmtPct(lastWeight.momentum)} / 价值 ${fmtPct(lastWeight.value)} / 低波 ${fmtPct(lastWeight.low_vol)}`],
    ["LightGBM 横截面收益", "下一批", "用 feature_matrix 预测未来 5/20 日收益，展示特征重要性和样本外 IC"],
    ["XGBoost 排名模型", "候选", "把股票排序转成 pairwise/listwise 目标，和传统 IC 权重对照"],
    ["组合约束优化", "联动", "模型预测不直接下单，先交给组合层做换手和风险约束"],
  ];
  document.querySelector("#modelQueue").innerHTML = candidates
    .map(
      ([title, status, note]) => `<div class="factory-item">
        <span>${status}</span>
        <strong>${title}</strong>
        <em>${note}</em>
      </div>`
    )
    .join("");
}

function renderExecutionLedger() {
  const items = [
    ["手续费", "src/backtest/cost.py", "买卖双边成本已抽象，后续要按券商费率和最低收费建模"],
    ["滑点", "SimulatedBroker", "当前是轻量假设，下一步接成交额和波动率估算冲击"],
    ["坏价格拒单", "stale_zero_or_nan_price", "已有测试覆盖 NaN/坏价格拒单"],
    ["涨跌停/停牌", "待接入", "这是实盘逼真度的关键缺口"],
  ];
  document.querySelector("#executionLedger").innerHTML = items
    .map(
      ([title, status, note]) => `<div class="factory-item">
        <span>${status}</span>
        <strong>${title}</strong>
        <em>${note}</em>
      </div>`
    )
    .join("");
}

function renderBacktestDiagnostics() {
  const best = historicalBest();
  const real = realStrategy();
  const rows = [
    ["历史最佳", best?.name || "-", best ? fmtPct(best.metrics.total_return, { signed: true }) : "-"],
    ["新框架收益", real?.name || "-", real ? fmtPct(real.metrics.total_return, { signed: true }) : "-"],
    ["最大回撤", currentStrategy()?.name || "-", fmtPct(currentStrategy()?.metrics?.max_drawdown)],
    ["问题定位", "优先看成本、换手、样本外和约束真实性", `${(state.real?.risk_events || []).length} 个风险事件`],
  ];
  document.querySelector("#backtestDiagnostics").innerHTML = rows
    .map(
      ([label, note, value]) => `<div class="diagnostic-item">
        <span>${label}</span>
        <strong>${value}</strong>
        <em>${note}</em>
      </div>`
    )
    .join("");
}

function renderInterfaceChain() {
  const modules = state.workbench?.modules || [];
  const byId = Object.fromEntries(modules.map((module) => [module.id, module]));
  document.querySelector("#interfaceChain").innerHTML = (state.workbench?.interfaces || [])
    .map(
      (edge) => `<div class="interface-row">
        <span>${escapeHtml(byId[edge.from]?.title || edge.from)}</span>
        <strong>${escapeHtml(edge.artifact)}</strong>
        <span>${escapeHtml(byId[edge.to]?.title || edge.to)}</span>
      </div>`
    )
    .join("");
}

function bindBlueprintPageButtons() {
  document.querySelectorAll("#blueprint [data-page]").forEach((button) => {
    button.addEventListener("click", () => activatePage(button.dataset.page, { push: true }));
  });
}

function referenceForTool(tool, references) {
  const haystack = `${tool.id || ""} ${tool.name || ""} ${tool.why || ""}`.toLowerCase();
  return (references || []).find((ref) => {
    const key = String(ref.name || "").toLowerCase();
    if (key.includes("qlib")) return haystack.includes("qlib");
    if (key.includes("lean")) return haystack.includes("lean");
    if (key.includes("mlflow")) return haystack.includes("mlflow");
    if (key.includes("prefect")) return haystack.includes("prefect");
    return false;
  });
}

function renderBlueprintHero() {
  const blueprint = state.blueprint || {};
  const phases = blueprint.phases || [];
  const current = phases.filter((phase) => ["next", "design"].includes(phase.status)).length;
  const interfaces = blueprint.interface_artifacts || [];
  const references = blueprint.references || [];
  const thesis = blueprint.thesis || "把量化交易拆成稳定接口，再让每一次研究、回测、风控和发布都可复现。";
  const hero = document.querySelector("#blueprintHero");
  const thesisNode = document.querySelector("#blueprintThesis");
  if (thesisNode) thesisNode.textContent = thesis;
  if (!hero) return;
  hero.innerHTML = [
    ["蓝图版本", blueprint.version || "-"],
    ["活跃阶段", `${current}/${phases.length || 0}`],
    ["接口产物", interfaces.length],
    ["参考框架", references.length],
  ]
    .map(
      ([label, value]) => `<div class="blueprint-stat">
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(value)}</strong>
      </div>`
    )
    .join("");
}

function renderToolchainGrid() {
  const blueprint = state.blueprint || {};
  const toolchain = blueprint.toolchain || [];
  const refs = blueprint.references || [];
  const el = document.querySelector("#toolchainGrid");
  if (!el) return;
  el.innerHTML = toolchain
    .map((tool) => {
      const ref = referenceForTool(tool, refs);
      const source = ref
        ? `<a class="source-link" href="${escapeHtml(ref.url)}" target="_blank" rel="noreferrer">${escapeHtml(ref.name)}</a>`
        : `<span class="source-link muted">内部实现</span>`;
      return `<div class="tool-card status-${escapeHtml(tool.status)}">
        <div class="tool-card-head">
          <span>${escapeHtml(tool.category)}</span>
          <em>${escapeHtml(statusLabel(tool.status))}</em>
        </div>
        <strong>${escapeHtml(tool.name)}</strong>
        <p>${escapeHtml(tool.why)}</p>
        <div class="chip-row">${renderTagList(tool.next || [], "chip")}</div>
        ${source}
      </div>`;
    })
    .join("");
}

function renderBlueprintPhases() {
  const phases = state.blueprint?.phases || [];
  const el = document.querySelector("#blueprintPhases");
  if (!el) return;
  el.innerHTML = phases
    .map(
      (phase, index) => `<div class="phase-card status-${escapeHtml(phase.status)}">
        <div class="phase-index">${String(index + 1).padStart(2, "0")}</div>
        <div class="phase-body">
          <div class="phase-topline">
            <span>${escapeHtml(statusLabel(phase.status))}</span>
            <button type="button" class="page-pill" data-page="${escapeHtml(phase.target_page)}">${escapeHtml(phase.target_page)}</button>
          </div>
          <strong>${escapeHtml(phase.title)}</strong>
          <p>${escapeHtml(phase.goal)}</p>
          <div class="artifact-tags">${renderTagList(phase.deliverables || [], "artifact-tag")}</div>
          <div class="acceptance-list">${(phase.acceptance || []).map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div>
        </div>
      </div>`
    )
    .join("");
  bindBlueprintPageButtons();
}

function renderOperatorSurfaces() {
  const surfaces = state.blueprint?.operator_surfaces || [];
  const el = document.querySelector("#operatorSurfaces");
  if (!el) return;
  el.innerHTML = surfaces
    .map(
      (surface) => `<button class="surface-card" type="button" data-page="${escapeHtml(surface.target_page)}">
        <span>${escapeHtml(surface.priority)} · ${escapeHtml(surface.target_page)}</span>
        <strong>${escapeHtml(surface.name)}</strong>
        <em>${renderTagList(surface.widgets || [], "surface-chip")}</em>
      </button>`
    )
    .join("");
  bindBlueprintPageButtons();
}

function renderBlueprintInterfaces() {
  const artifacts = state.blueprint?.interface_artifacts || [];
  const el = document.querySelector("#blueprintInterfaces");
  if (!el) return;
  el.innerHTML = artifacts
    .map(
      (artifact) => `<div class="artifact-row">
        <div>
          <span>${escapeHtml(artifact.owner)}</span>
          <strong>${escapeHtml(artifact.name)}</strong>
        </div>
        <div class="artifact-schema">${renderTagList(artifact.schema || [], "artifact-tag")}</div>
        <div class="artifact-flow">
          <span>${escapeHtml(artifact.producer)}</span>
          <b>→</b>
          <span>${escapeHtml(artifact.consumer)}</span>
        </div>
      </div>`
    )
    .join("");
}

function renderRunbooks() {
  const runbooks = state.blueprint?.runbooks || [];
  const el = document.querySelector("#runbookGrid");
  if (!el) return;
  el.innerHTML = runbooks
    .map(
      (book) => `<div class="runbook-card">
        <div class="phase-topline">
          <span>${escapeHtml(book.id)}</span>
          <button type="button" class="page-pill" data-page="${escapeHtml(book.target_page)}">${escapeHtml(book.target_page)}</button>
        </div>
        <strong>${escapeHtml(book.title)}</strong>
        <ol>${(book.steps || []).map((step) => `<li>${escapeHtml(step)}</li>`).join("")}</ol>
        <div class="done-list">${(book.done || []).map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div>
      </div>`
    )
    .join("");
  bindBlueprintPageButtons();
}

function fmtVolume(value) {
  if (!isFiniteNumber(value)) return "-";
  const number = Number(value);
  if (Math.abs(number) >= 100000000) return `${(number / 100000000).toFixed(2)}亿`;
  if (Math.abs(number) >= 10000) return `${(number / 10000).toFixed(2)}万`;
  return fmtMoney(number);
}

function setMarketLatency(text, tone = "neutral") {
  const el = document.querySelector("#marketLatency");
  if (!el) return;
  el.textContent = text;
  el.className = `latency-badge ${tone}`;
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

function ensureKLineCharts() {
  if (window.klinecharts || window.KLineCharts) return Promise.resolve(true);
  if (state.market.proScriptReady) return state.market.proScriptReady;
  state.market.proScriptReady = new Promise((resolve) => {
    const script = document.createElement("script");
    script.src = KLINECHARTS_URL;
    script.async = true;
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.head.appendChild(script);
  });
  return state.market.proScriptReady;
}

function klineChartsApi() {
  return window.klinecharts || window.KLineCharts;
}

function klineQuery() {
  const symbol = document.querySelector("#klineSymbol")?.value?.trim() || "000001.SZ";
  const interval = document.querySelector("#klineInterval")?.value || "1d";
  const limit = interval === "1d" ? 520 : interval === "1m" ? 960 : 640;
  const params = new URLSearchParams({ symbol, interval, limit: String(limit) });
  return { symbol, interval, limit, url: `${KLINE_API_URL}?${params.toString()}` };
}

async function fetchKlinePayload(query) {
  const cacheKey = `${query.symbol.toUpperCase()}|${query.interval}|${query.limit}`;
  const cached = state.market.cache.get(cacheKey);
  if (cached && Date.now() - cached.loadedAt < LOCAL_KLINE_CACHE_MS) {
    return {
      ...cached.payload,
      meta: {
        ...(cached.payload.meta || {}),
        cache_hit: true,
      },
    };
  }
  const fallbackUrl = KLINE_STATIC_URLS[query.interval] || KLINE_STATIC_URLS["1d"];
  const urls = [query.url, fallbackUrl];
  let lastError = null;
  const startedAt = performance.now();
  for (const url of urls) {
    try {
      const payload = await fetchJsonLoose(url);
      if (payload?.bars?.length) {
        const result = {
          ...payload,
          meta: {
            ...(payload.meta || {}),
            delivery: url === query.url ? "local-api" : "static-sample",
            load_ms: Math.round(performance.now() - startedAt),
          },
        };
        state.market.cache.set(cacheKey, { payload: result, loadedAt: Date.now() });
        return result;
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
  const loadNote = meta.cache_hit ? "缓存命中" : `${meta.load_ms ?? "-"} ms`;
  setMarketLatency(
    meta.delivery === "local-api"
      ? `本地缓存读取 · ${loadNote}`
      : `样例数据 · ${loadNote}`,
    meta.delivery === "local-api" ? "good" : "warn"
  );
  summary.innerHTML = last
    ? [
        ["标的", `${meta.symbol || "--"} ${meta.name || ""}`.trim(), `${meta.interval || "--"} · ${delivery}`],
        ["最新价", fmtNum(last.close, 2), last.label || last.time],
        ["涨跌", isFiniteNumber(change) ? fmtPct(change, { signed: true }) : "-", "相邻 K 线"],
        ["成交量", fmtVolume(last.volume), "原始本地字段"],
        ["延迟", loadNote, meta.source || "-"],
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

function normalizeMarketSymbol(symbol) {
  const raw = String(symbol || "000001.SZ").trim().toUpperCase();
  if (/^\d{6}\.SH$/i.test(raw) && raw.startsWith("000")) return `SSE:${raw.slice(0, 6)}`;
  if (/^\d{6}\.(SH|SS)$/i.test(raw)) return `SSE:${raw.slice(0, 6)}`;
  if (/^\d{6}\.SZ$/i.test(raw)) return `SZSE:${raw.slice(0, 6)}`;
  if (/^SH\d{6}$/i.test(raw)) return `SSE:${raw.slice(2)}`;
  if (/^SZ\d{6}$/i.test(raw)) return `SZSE:${raw.slice(2)}`;
  if (/^\d{6}$/.test(raw)) return raw.startsWith("6") ? `SSE:${raw}` : `SZSE:${raw}`;
  if (raw.includes(":")) return raw;
  return "SZSE:000001";
}

function normalizeAshareParts(symbol) {
  const raw = String(symbol || "000001.SZ").trim().toUpperCase();
  let code = "000001";
  let market = "SZ";
  if (/^\d{6}\.(SH|SS|SZ|BJ)$/i.test(raw)) {
    code = raw.slice(0, 6);
    market = raw.endsWith(".SS") ? "SH" : raw.slice(-2);
  } else if (/^(SH|SZ|BJ)\d{6}$/i.test(raw)) {
    market = raw.slice(0, 2);
    code = raw.slice(2, 8);
  } else if (/^\d{6}$/.test(raw)) {
    code = raw;
    market = raw.startsWith("6") || raw.startsWith("000") ? "SH" : "SZ";
  }
  return { code, market };
}

function displayAshareSymbol(symbol) {
  const { code, market } = normalizeAshareParts(symbol);
  return `${code}.${market}`;
}

function eastmoneySecid(symbol) {
  const { code, market } = normalizeAshareParts(symbol);
  return `${market === "SH" ? 1 : 0}.${code}`;
}

function eastmoneyKlt(interval) {
  return (
    {
      "1m": "1",
      "5m": "5",
      "15m": "15",
      "30m": "30",
      "60m": "60",
      "1d": "101",
    }[interval] || "101"
  );
}

function eastmoneyUrl(symbol) {
  const { code, market } = normalizeAshareParts(symbol);
  if ((market === "SH" && code.startsWith("000")) || code.startsWith("399")) {
    return `https://quote.eastmoney.com/zs${code}.html`;
  }
  return `https://quote.eastmoney.com/${market.toLowerCase()}${code}.html`;
}

function sinaUrl(symbol) {
  const { code, market } = normalizeAshareParts(symbol);
  return `https://finance.sina.com.cn/realstock/company/${market.toLowerCase()}${code}/nc.shtml`;
}

function tencentUrl(symbol) {
  const { code, market } = normalizeAshareParts(symbol);
  return `https://gu.qq.com/${market.toLowerCase()}${code}/gp`;
}

function tradingViewChartUrl(symbol) {
  return `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(normalizeMarketSymbol(symbol))}`;
}

function eastmoneyKlineApiUrl(symbol, interval) {
  const params = new URLSearchParams({
    secid: eastmoneySecid(symbol),
    fields1: "f1,f2,f3,f4,f5,f6",
    fields2: "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61",
    klt: eastmoneyKlt(interval),
    fqt: "1",
    beg: "0",
    end: "20500101",
    lmt: interval === "1m" ? "1000" : "800",
  });
  return `https://push2his.eastmoney.com/api/qt/stock/kline/get?${params.toString()}`;
}

function externalProviderUrl(source, symbol) {
  if (source === "sina") return sinaUrl(symbol);
  if (source === "tencent") return tencentUrl(symbol);
  if (source === "tradingview") return tradingViewChartUrl(symbol);
  return eastmoneyUrl(symbol);
}

function providerLabel(source) {
  return (
    {
      pro: "Pro开源终端",
      eastmoney: "东方财富基础",
      sina: "新浪财经",
      tencent: "腾讯证券",
      tradingview: "TradingView",
    }[source] || "东方财富"
  );
}

function parseEastmoneyTime(value, interval) {
  if (interval === "1d") return String(value).slice(0, 10);
  const iso = `${String(value).replace(" ", "T")}:00+08:00`;
  const ts = Date.parse(iso);
  return Number.isFinite(ts) ? Math.floor(ts / 1000) : String(value);
}

async function fetchEastmoneyKline(symbol, interval) {
  const cacheKey = `eastmoney|${displayAshareSymbol(symbol)}|${interval}`;
  const cached = state.market.cache.get(cacheKey);
  if (cached && Date.now() - cached.loadedAt < LOCAL_KLINE_CACHE_MS) {
    return {
      ...cached.payload,
      meta: { ...(cached.payload.meta || {}), cache_hit: true },
    };
  }
  const startedAt = performance.now();
  const url = eastmoneyKlineApiUrl(symbol, interval);
  const payload = await fetchJsonLoose(url);
  const data = payload?.data;
  if (!data?.klines?.length) {
    throw new Error(payload?.message || "东方财富没有返回 K 线数据");
  }
  const bars = data.klines
    .map((row) => String(row).split(","))
    .filter((parts) => parts.length >= 7)
    .map((parts) => ({
      time: parseEastmoneyTime(parts[0], interval),
      label: parts[0],
      date: parts[0].slice(0, 10).replaceAll("-", ""),
      open: finite(parts[1]),
      close: finite(parts[2]),
      high: finite(parts[3]),
      low: finite(parts[4]),
      volume: finite(parts[5]),
      amount: finite(parts[6]),
      amplitude: finite(parts[7], null),
      pct_chg: finite(parts[8], null),
      change: finite(parts[9], null),
      turnover: finite(parts[10], null),
    }));
  const result = {
    meta: {
      symbol: displayAshareSymbol(symbol),
      name: data.name || "",
      interval,
      source: "东方财富 push2his",
      provider: "eastmoney",
      count: bars.length,
      klt: eastmoneyKlt(interval),
      url,
      load_ms: Math.round(performance.now() - startedAt),
    },
    bars,
  };
  state.market.cache.set(cacheKey, { payload: result, loadedAt: Date.now() });
  return result;
}

function tradingViewInterval(interval) {
  return {
    "1d": "D",
    "60m": "60",
    "30m": "30",
    "15m": "15",
    "5m": "5",
    "1m": "1",
  }[interval] || "D";
}

function setMarketMode(mode) {
  state.market.mode = mode;
  document.querySelector("#externalMarketWidget")?.classList.toggle("hidden", mode !== "external");
  document.querySelector("#klineChart")?.classList.add("hidden");
}

function syncMarketSourceButtons() {
  document.querySelectorAll("#marketSourceButtons button").forEach((button) => {
    button.classList.toggle("active", button.dataset.source === state.market.source);
  });
}

function syncExternalOpenLink(url) {
  const link = document.querySelector("#marketOpenExternal");
  if (!link) return;
  if (url) {
    link.href = url;
    link.classList.remove("disabled");
    link.setAttribute("aria-disabled", "false");
  } else {
    link.href = "https://www.tradingview.com/";
    link.classList.add("disabled");
    link.setAttribute("aria-disabled", "true");
  }
}

function renderExternalMarketSummary(url = null) {
  const summary = document.querySelector("#klineSummary");
  const symbol = document.querySelector("#klineSymbol")?.value?.trim() || "000001.SZ";
  const interval = document.querySelector("#klineInterval")?.value || "1d";
  const source = state.market.source || "eastmoney";
  const provider = providerLabel(source);
  const tvSymbol = normalizeMarketSymbol(symbol);
  const isTradingView = source === "tradingview";
  setMarketLatency(
    isTradingView && interval !== "1d"
      ? "TradingView A股分钟级可能提示不支持，建议切东方财富/新浪"
      : `${provider} · 外部看盘工具`,
    isTradingView && interval !== "1d" ? "warn" : "good"
  );
  summary.innerHTML = [
    ["标的", symbol.toUpperCase(), isTradingView ? tvSymbol : normalizeAshareParts(symbol).market + normalizeAshareParts(symbol).code],
    ["外部源", provider, isTradingView ? "备选组件，保留官方署名" : "嵌入外部看盘页面"],
    ["周期", INTERVAL_LABELS[interval] || interval, isTradingView ? `widget interval ${tradingViewInterval(interval)}` : "在外部页面内切换分时/K线"],
    ["部署模式", "纯外部工具", "不读取本地 K 线，不占服务器磁盘"],
    ["打开方式", isTradingView ? "官方 widget + 新窗口" : "iframe + 新窗口", url || "官方组件"],
  ]
    .map(
      ([label, value, note]) => `<div class="summary-chip">
        <span>${label}</span>
        <strong>${value}</strong>
        <em>${note}</em>
      </div>`
    )
    .join("");
}

function renderEastmoneySummary(payload) {
  const summary = document.querySelector("#klineSummary");
  if (!summary) return;
  const bars = payload?.bars || [];
  const last = bars.at(-1);
  const prev = bars.length > 1 ? bars.at(-2) : null;
  const change = last && prev && finite(prev.close) !== 0 ? finite(last.close) / finite(prev.close) - 1 : null;
  const meta = payload?.meta || {};
  const loadNote = meta.cache_hit ? "缓存命中" : `${meta.load_ms ?? "-"} ms`;
  setMarketLatency(`东方财富K线 · ${loadNote}`, "good");
  summary.innerHTML = last
    ? [
        ["标的", `${meta.symbol || "--"} ${meta.name || ""}`.trim(), "东方财富公网行情"],
        ["最新价", fmtNum(last.close, 2), last.label || last.time],
        ["涨跌", isFiniteNumber(change) ? fmtPct(change, { signed: true }) : "-", `接口涨跌幅 ${isFiniteNumber(last.pct_chg) ? last.pct_chg.toFixed(2) + "%" : "-"}`],
        ["成交量", fmtVolume(last.volume), "外部接口字段"],
        ["周期", INTERVAL_LABELS[meta.interval] || meta.interval || "-", `klt ${meta.klt} · ${loadNote}`],
      ]
        .map(
          ([label, value, note]) => `<div class="summary-chip">
            <span>${label}</span>
            <strong class="${label === "涨跌" ? valueClass(change) : ""}">${value}</strong>
            <em>${note}</em>
          </div>`
        )
        .join("")
    : `<div class="empty-state">东方财富暂未返回 K 线数据</div>`;
}

function toKLineTimestamp(bar) {
  if (typeof bar.time === "number") return bar.time * 1000;
  const raw = String(bar.label || bar.time || "");
  if (raw.includes(":")) {
    const ts = Date.parse(`${raw.replace(" ", "T")}:00+08:00`);
    if (Number.isFinite(ts)) return ts;
  }
  const date = raw.slice(0, 10);
  const ts = Date.parse(`${date}T15:00:00+08:00`);
  return Number.isFinite(ts) ? ts : Date.now();
}

function toKLineChartsData(bars) {
  return (bars || []).map((bar) => ({
    timestamp: toKLineTimestamp(bar),
    open: finite(bar.open),
    high: finite(bar.high),
    low: finite(bar.low),
    close: finite(bar.close),
    volume: finite(bar.volume),
    turnover: finite(bar.amount),
  }));
}

function destroyProChart() {
  const api = klineChartsApi();
  const container = document.querySelector("#externalMarketWidget");
  try {
    if (api?.dispose && container) api.dispose(container);
  } catch {
    // KLineCharts disposal is best-effort; the container is cleared below.
  }
  state.market.proChart = null;
}

function syncMarketToolBar() {
  const isPro = state.market.source === "pro";
  document.querySelector("#marketToolBar")?.classList.toggle("hidden", !isPro);
  document.querySelectorAll("[data-indicator]").forEach((button) => {
    button.classList.toggle("active", state.market.proIndicators.has(button.dataset.indicator));
  });
  document.querySelectorAll("[data-quant-layer]").forEach((button) => {
    button.classList.toggle("active", state.market.quantLayers.has(button.dataset.quantLayer));
  });
}

function createProIndicators(chart) {
  const paneFor = {
    MA: { id: "candle_pane" },
    BOLL: { id: "candle_pane" },
    VOL: undefined,
    MACD: undefined,
    RSI: undefined,
  };
  state.market.proIndicators.forEach((name) => {
    try {
      chart.createIndicator(name, name === "MA" || name === "BOLL", paneFor[name]);
    } catch {
      // Indicator support varies by KLineCharts version; keep the terminal usable.
    }
  });
}

function sampleQuantEvents(payload) {
  const bars = payload?.bars || [];
  if (bars.length < 30) return [];
  const picks = [
    { index: Math.max(4, Math.floor(bars.length * 0.18)), side: "buy", text: "模型买入", score: 0.72 },
    { index: Math.max(8, Math.floor(bars.length * 0.48)), side: "risk", text: "风控减仓", score: 0.41 },
    { index: Math.max(12, Math.floor(bars.length * 0.74)), side: "sell", text: "信号卖出", score: 0.28 },
  ];
  return picks.map((event) => {
    const bar = bars[Math.min(event.index, bars.length - 1)];
    return {
      ...event,
      timestamp: toKLineTimestamp(bar),
      value: event.side === "buy" ? finite(bar.low) : finite(bar.high),
      price: finite(bar.close),
      label: bar.label || bar.time,
    };
  });
}

function renderQuantOverlayHtml(payload) {
  const container = document.querySelector("#externalMarketWidget");
  if (!container) return;
  container.querySelector(".quant-signal-layer")?.remove();
  if (!state.market.quantLayers.size) return;
  const events = sampleQuantEvents(payload);
  const layer = document.createElement("div");
  layer.className = "quant-signal-layer";
  layer.innerHTML = events
    .filter((event) => {
      if (event.side === "buy" || event.side === "sell") return state.market.quantLayers.has("signals");
      return state.market.quantLayers.has("risk");
    })
    .map((event, idx) => {
      const left = 12 + idx * 27;
      const tone = event.side === "buy" ? "buy" : event.side === "sell" ? "sell" : "risk";
      const score = state.market.quantLayers.has("score") ? `<em>score ${event.score.toFixed(2)}</em>` : "";
      return `<div class="quant-signal ${tone}" style="left:${left}%; top:${tone === "buy" ? 18 : tone === "sell" ? 32 : 46}%">
        <strong>${event.side === "buy" ? "B" : event.side === "sell" ? "S" : "R"}</strong>
        <span>${escapeHtml(event.text)}</span>
        ${score}
      </div>`;
    })
    .join("");
  container.appendChild(layer);
}

function createQuantOverlays(chart, payload) {
  const events = sampleQuantEvents(payload);
  events.forEach((event) => {
    if ((event.side === "buy" || event.side === "sell") && !state.market.quantLayers.has("signals")) return;
    if (event.side === "risk" && !state.market.quantLayers.has("risk")) return;
    try {
      chart.createOverlay({
        name: "simpleAnnotation",
        points: [{ timestamp: event.timestamp, value: event.value }],
        extendData: {
          text: event.side === "buy" ? "B" : event.side === "sell" ? "S" : "R",
          color: event.side === "buy" ? colors.multifactor : event.side === "sell" ? colors.reversal_5 : colors.amber,
        },
      });
    } catch {
      // HTML badges below still expose the model events if overlay names differ.
    }
  });
  if (state.market.quantLayers.has("risk")) {
    const last = payload?.bars?.at(-1);
    if (last) {
      try {
        chart.createOverlay({
          name: "priceLine",
          points: [{ timestamp: toKLineTimestamp(last), value: finite(last.close) * 0.97 }],
          extendData: { text: "风控线 -3%" },
        });
      } catch {
        // Optional overlay.
      }
    }
  }
}

async function renderProTerminal() {
  const container = document.querySelector("#externalMarketWidget");
  const symbol = document.querySelector("#klineSymbol")?.value?.trim() || "000001.SZ";
  const interval = document.querySelector("#klineInterval")?.value || "1d";
  syncExternalOpenLink(eastmoneyUrl(symbol));
  setMarketLatency("Pro终端读取外部细粒度行情...", "neutral");
  if (container) container.innerHTML = `<div class="empty-state">正在初始化开源 Pro 终端...</div>`;
  try {
    const [payload, hasLibrary] = await Promise.all([fetchEastmoneyKline(symbol, interval), ensureKLineCharts()]);
    if (!hasLibrary || !klineChartsApi()) {
      renderEastmoneySummary(payload);
      await renderExternalKlineChart(payload);
      return;
    }
    destroyProChart();
    container.innerHTML = "";
    const api = klineChartsApi();
    const chart = api.init(container, {
      styles: {
        grid: { horizontal: { color: "#1d2935" }, vertical: { color: "#1d2935" } },
        candle: {
          tooltip: { showRule: "always", showType: "standard" },
          bar: {
            upColor: colors.multifactor,
            downColor: colors.reversal_5,
            noChangeColor: "#c8d5dc",
          },
        },
      },
    });
    state.market.proChart = chart;
    state.market.proPayload = payload;
    chart.applyNewData(toKLineChartsData(payload.bars));
    createProIndicators(chart);
    createQuantOverlays(chart, payload);
    renderQuantOverlayHtml(payload);
    renderEastmoneySummary({
      ...payload,
      meta: { ...(payload.meta || {}), source: "KLineCharts + 东方财富", provider: "pro" },
    });
  } catch (error) {
    setMarketLatency(`Pro终端失败 · ${error.message}`, "bad");
    if (container) {
      container.innerHTML = `<div class="external-launch-panel">
        <strong>Pro 终端暂时不可用</strong>
        <p>${escapeHtml(error.message)}。已保留东财基础与 TradingView 备选，可切换继续看盘。</p>
      </div>`;
    }
  }
}

async function renderExternalKlineChart(payload) {
  const container = document.querySelector("#externalMarketWidget");
  if (!container) return;
  const bars = (payload.bars || []).map((bar) => ({
    ...bar,
    open: finite(bar.open),
    high: finite(bar.high),
    low: finite(bar.low),
    close: finite(bar.close),
    volume: finite(bar.volume),
  }));
  if (!bars.length) {
    container.innerHTML = `<div class="empty-state">外部接口没有返回可绘制 K 线</div>`;
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
      timeVisible: payload.meta?.interval !== "1d",
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
}

async function renderEastmoneyKline() {
  const symbol = document.querySelector("#klineSymbol")?.value?.trim() || "000001.SZ";
  const interval = document.querySelector("#klineInterval")?.value || "1d";
  const externalUrl = eastmoneyUrl(symbol);
  syncExternalOpenLink(externalUrl);
  setMarketLatency("东方财富K线读取中...", "neutral");
  const container = document.querySelector("#externalMarketWidget");
  if (container) container.innerHTML = `<div class="empty-state">正在读取东方财富外部 K 线...</div>`;
  try {
    const payload = await fetchEastmoneyKline(symbol, interval);
    renderEastmoneySummary(payload);
    await renderExternalKlineChart(payload);
  } catch (error) {
    setMarketLatency(`东方财富读取失败 · ${error.message}`, "bad");
    renderExternalMarketSummary(externalUrl);
    if (container) {
      container.innerHTML = `<div class="external-launch-panel">
        <strong>东方财富接口暂时不可用</strong>
        <p>${escapeHtml(error.message)}。可以用新窗口打开东方财富页面，或切换到 TradingView 备选源。</p>
        <a class="refresh-button link-button" href="${escapeHtml(externalUrl)}" target="_blank" rel="noreferrer">打开东方财富</a>
      </div>`;
    }
  }
}

function renderExternalLaunchPanel(source) {
  const container = document.querySelector("#externalMarketWidget");
  const symbol = document.querySelector("#klineSymbol")?.value?.trim() || "000001.SZ";
  const url = externalProviderUrl(source, symbol);
  syncExternalOpenLink(url);
  renderExternalMarketSummary(url);
  if (state.kline.chart) {
    state.kline.chart.remove();
    state.kline.chart = null;
  }
  if (!container) return;
  container.innerHTML = `<div class="external-launch-panel">
    <span>${escapeHtml(providerLabel(source))}</span>
    <strong>该外部站点不稳定支持嵌入</strong>
    <p>为避免 iframe 空白，已改为新窗口打开。默认东财 K 线仍会在本页直接绘制 1m/5m/15m/30m/60m/日线。</p>
    <a class="refresh-button link-button" href="${escapeHtml(url)}" target="_blank" rel="noreferrer">打开${escapeHtml(providerLabel(source))}</a>
  </div>`;
}

function renderExternalMarketWidget() {
  const container = document.querySelector("#externalMarketWidget");
  if (!container) return;
  const symbol = document.querySelector("#klineSymbol")?.value?.trim() || "000001.SZ";
  const interval = document.querySelector("#klineInterval")?.value || "1d";
  const source = state.market.source || "eastmoney";
  const provider = providerLabel(source);
  const externalUrl = externalProviderUrl(source, symbol);
  syncMarketSourceButtons();
  syncMarketToolBar();
  syncExternalOpenLink(externalUrl);
  if (source === "pro") {
    renderProTerminal();
    return;
  }
  if (source === "eastmoney") {
    destroyProChart();
    renderEastmoneyKline();
    return;
  }
  if (source !== "tradingview") {
    destroyProChart();
    renderExternalLaunchPanel(source);
    return;
  }
  destroyProChart();
  const tvSymbol = normalizeMarketSymbol(symbol);
  const widgetKey = `tradingview|${tvSymbol}|${interval}`;
  renderExternalMarketSummary(externalUrl);
  if (state.market.widgetKey === widgetKey && container.querySelector("iframe")) return;
  state.market.widgetKey = widgetKey;
  container.innerHTML = "";
  const script = document.createElement("script");
  script.src = TRADINGVIEW_WIDGET_URL;
  script.async = true;
  script.textContent = JSON.stringify({
    autosize: true,
    symbol: tvSymbol,
    interval: tradingViewInterval(interval),
    timezone: "Asia/Shanghai",
    theme: "dark",
    style: "1",
    locale: "zh_CN",
    enable_publishing: false,
    allow_symbol_change: true,
    calendar: false,
    support_host: "https://www.tradingview.com",
    hide_side_toolbar: false,
    details: true,
    hotlist: true,
    withdateranges: true,
    studies: ["Volume@tv-basicstudies"],
  });
  container.appendChild(script);
}

function renderMarket() {
  state.market.mode = "external";
  setMarketMode("external");
  syncIntervalButtons();
  if (state.kline.chart) {
    state.kline.chart.remove();
    state.kline.chart = null;
  }
  renderExternalMarketWidget();
}

function syncIntervalButtons() {
  const interval = document.querySelector("#klineInterval")?.value || "1d";
  document.querySelectorAll("#intervalButtons button").forEach((button) => {
    button.classList.toggle("active", button.dataset.interval === interval);
  });
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
  setMarketLatency("本地缓存读取中...", "neutral");
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
    setMarketLatency(`本地K线失败 · ${error.message}`, "bad");
    container.innerHTML = `<div class="empty-state">K 线读取失败：${error.message}</div>`;
  }
}

async function toggleMarketFullscreen() {
  const panel = document.querySelector("#marketPanel");
  if (!panel) return;
  try {
    if (panel.classList.contains("fullscreen")) {
      panel.classList.remove("fullscreen");
    } else if (!document.fullscreenElement && panel.requestFullscreen) {
      await panel.requestFullscreen();
    } else if (document.fullscreenElement && document.exitFullscreen) {
      await document.exitFullscreen();
    } else {
      panel.classList.toggle("fullscreen");
    }
  } catch {
    panel.classList.toggle("fullscreen");
  }
  syncFullscreenButton();
  window.setTimeout(renderMarket, 120);
}

function syncFullscreenButton() {
  const panel = document.querySelector("#marketPanel");
  const button = document.querySelector("#marketFullscreen");
  if (!panel || !button) return;
  const active = Boolean(document.fullscreenElement) || panel.classList.contains("fullscreen");
  button.textContent = active ? "退出全屏" : "全屏";
}

function setupKlineControls() {
  if (state.kline.controlsReady) return;
  const refresh = document.querySelector("#klineRefresh");
  const symbol = document.querySelector("#klineSymbol");
  const interval = document.querySelector("#klineInterval");
  const fullscreen = document.querySelector("#marketFullscreen");
  refresh?.addEventListener("click", renderMarket);
  interval?.addEventListener("change", () => {
    syncIntervalButtons();
    renderMarket();
  });
  symbol?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") renderMarket();
  });
  document.querySelectorAll("#intervalButtons button").forEach((button) => {
    button.addEventListener("click", () => {
      if (interval) interval.value = button.dataset.interval;
      syncIntervalButtons();
      renderMarket();
    });
  });
  document.querySelectorAll("#symbolRack button").forEach((button) => {
    button.addEventListener("click", () => {
      if (symbol) symbol.value = button.dataset.symbol;
      renderMarket();
    });
  });
  document.querySelectorAll("#marketSourceButtons button").forEach((button) => {
    button.addEventListener("click", () => {
      state.market.source = button.dataset.source || "eastmoney";
      state.market.widgetKey = null;
      renderMarket();
    });
  });
  document.querySelectorAll("[data-indicator]").forEach((button) => {
    button.addEventListener("click", () => {
      const name = button.dataset.indicator;
      if (state.market.proIndicators.has(name)) state.market.proIndicators.delete(name);
      else state.market.proIndicators.add(name);
      syncMarketToolBar();
      if (state.market.source === "pro") renderMarket();
    });
  });
  document.querySelectorAll("[data-quant-layer]").forEach((button) => {
    button.addEventListener("click", () => {
      const name = button.dataset.quantLayer;
      if (state.market.quantLayers.has(name)) state.market.quantLayers.delete(name);
      else state.market.quantLayers.add(name);
      syncMarketToolBar();
      if (state.market.source === "pro") renderMarket();
    });
  });
  document.querySelectorAll("[data-overlay]").forEach((button) => {
    button.addEventListener("click", () => {
      if (state.market.source !== "pro") {
        state.market.source = "pro";
        syncMarketSourceButtons();
      }
      const name = button.dataset.overlay;
      const chart = state.market.proChart;
      if (!chart) {
        renderMarket();
        return;
      }
      if (name === "remove") {
        try {
          chart.removeOverlay();
        } catch {
          // Optional API in the open-source chart runtime.
        }
        document.querySelector("#externalMarketWidget .quant-signal-layer")?.remove();
        return;
      }
      try {
        chart.createOverlay({ name, mode: "normal" });
        setMarketLatency(`画线工具已开启 · ${button.textContent}`, "good");
      } catch (error) {
        setMarketLatency(`当前画线工具不可用 · ${error.message}`, "warn");
      }
    });
  });
  fullscreen?.addEventListener("click", toggleMarketFullscreen);
  document.addEventListener("fullscreenchange", () => {
    syncFullscreenButton();
    window.setTimeout(renderMarket, 120);
  });
  window.addEventListener("resize", () => {
    const container = document.querySelector("#externalMarketWidget");
    if (state.kline.chart) {
      state.kline.chart.resize(container.clientWidth, container.clientHeight);
    }
    if (state.market.proChart?.resize) {
      state.market.proChart.resize();
    }
  });
  syncIntervalButtons();
  syncFullscreenButton();
  syncMarketToolBar();
  state.kline.controlsReady = true;
}

function renderLayerFlow() {
  const layers = (state.workbench?.modules || []).map((module) => [
    module.title,
    module.owner,
    `${module.role} · ${module.outputs?.[0] || module.status}`,
  ]);
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
    ["Workbench", state.workbench ? "已读取" : "缺失", "/api/workbench + data/workbench_manifest.json"],
    ["Blueprint", state.blueprint ? "已读取" : "缺失", "/api/blueprint + data/company_blueprint.json"],
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
  renderWorkbenchPages();
  renderMetricGrid();
  renderCommandStrip();
  renderPipelineMap();
  renderIterationBoard();
  renderModuleCards();
  renderEquityChart();
  renderSelectedDetail();
  renderDrawdownChart();
  renderYearlyChart();
  renderStrategyTable();
  renderFeatureFactory();
  renderModelQueue();
  renderExecutionLedger();
  renderBacktestDiagnostics();
  renderLayerFlow();
  renderContracts();
  renderInterfaceChain();
  renderBlueprintHero();
  renderToolchainGrid();
  renderBlueprintPhases();
  renderOperatorSurfaces();
  renderBlueprintInterfaces();
  renderRunbooks();
  renderHoldings();
  renderRiskEvents();
  renderWeightsHeatmap();
  renderRoadmap();
  renderDeployInfo();
}

async function boot() {
  const [legacy, real, deploy, workbench, blueprint] = await Promise.all([
    fetchJsonLoose(LEGACY_URL).catch(() => null),
    fetchJsonLoose(REAL_URL).catch(() => null),
    fetchJsonLoose(DEPLOY_INFO_URL).catch(() => null),
    fetchFirstJson([WORKBENCH_API_URL, WORKBENCH_STATIC_URL]).catch(() => null),
    fetchFirstJson([BLUEPRINT_API_URL, BLUEPRINT_STATIC_URL]).catch(() => null),
  ]);
  state.legacy = legacy;
  state.real = real;
  state.deploy = deploy;
  state.workbench = workbench;
  state.blueprint = blueprint;
  const legacyStrategies = (legacy?.strategies || []).map(normalizeLegacyStrategy);
  const realStrategies = normalizeRealPayload(real);
  state.strategies = [...legacyStrategies, ...realStrategies];
  if (!state.strategies.length) {
    document.body.innerHTML = `<main class="empty-state">暂无可展示的回测数据</main>`;
    return;
  }
  state.selectedId = historicalBest()?.id || state.strategies[0].id;
  setupPageNavigation();
  renderSelect();
  renderAll();
  setupKlineControls();
  activatePage(pageFromHash(), { instant: true });
}

boot().catch((error) => {
  document.body.innerHTML = `<main class="empty-state">无法读取回测结果：${error.message}</main>`;
});
