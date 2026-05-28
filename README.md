# Dashboard

量化研究工作台，展示历史 Strategy Lab、最新真实数据回测、K 线看盘、框架链路、模块接口、风控事件、持仓、滚动 IC 权重和发布状态。

前端按流水线拆成独立页面：

```text
数据 -> 因子 -> 特征 -> 模型 -> 策略 -> 组合 -> 执行 -> 风控 -> 回测
```

每个页面都围绕同一份 `workbench_manifest` 渲染输入、输出、当前代码、控制项、缺口和下一步计划，避免 UI 和后端框架描述分叉。

## 数据文件

```text
data/strategy_lab_results.json  # 历史 7 策略对比，当前历史最佳来自这里
data/backtest_result.json       # src.main real-backtest 输出的新框架结果
data/kline_000001_*.json        # GitHub Pages 看盘兜底样例，来自本地日线/分钟线
data/workbench_manifest.json    # 研究工作台模块、接口、成熟度和下一步计划
data/company_blueprint.json     # 公司级控制台蓝图、工具链、接口产物、runbook
deploy-info.json                # Pages 发布时自动生成，本地预览可缺省
```

`app.js` 会同时读取历史实验和新框架结果；如果新框架 JSON 里存在旧版本遗留的 `NaN`，前端会做兼容解析，但新的 `real-backtest` 输出已经使用 strict JSON。

## 公司级蓝图页

`#blueprint` 页面把 `ARCHITECTURE.md` 里的核心思路落成可视化控制台：工具链选型、阶段路线、交易员操作台、接口产物和标准 runbook 都来自同一份 `company_blueprint`。页面里的模块按钮会直接跳到对应的“数据/因子/模型/策略/组合/执行/风控/回测”页面，方便团队按流水线逐步补真实实现。

当前借鉴方向：

```text
Qlib：研究闭环
LEAN：事件驱动回测和执行边界
MLflow：实验追踪与模型注册
Prefect：任务编排和可观测性
```

## 本地 K 线看盘

看盘页默认使用 TradingView 外部行情组件展示 A 股行情，不需要把大体量日线/分钟线复制到服务器。输入 `000001.SZ` 会映射为 `SZSE:000001`，输入 `600000.SH` 会映射为 `SSE:600000`。外部行情支持 `1m/5m/15m/30m/60m/1d` 快捷切换和全屏，实际实时性取决于 TradingView 与交易所授权，公网 A 股行情可能存在延迟。

切换到“本地K线”时，前端使用 TradingView Lightweight Charts 展示 K 线和成交量。浏览器会对同一股票/周期缓存 45 秒，以降低重复切换的延迟。数据统一为：

```json
{
  "meta": {
    "symbol": "000001.SZ",
    "name": "平安银行",
    "interval": "1d",
    "format": "lightweight-charts: {time, open, high, low, close, volume}"
  },
  "bars": [
    { "time": "2025-12-31", "open": 11.48, "high": 11.49, "low": 11.4, "close": 11.41, "volume": 590620.37 }
  ]
}
```

本地预览会优先请求：

```text
/api/workbench
/api/blueprint
/api/kline?symbol=000001.SZ&interval=1d&limit=260
/api/kline?symbol=000001.SZ&interval=1m&limit=320
```

支持周期：`1d`、`60m`、`30m`、`15m`、`5m`、`1m`。日线读取 `ASHARE_DAILY_DIR` 或默认本地日线目录；分钟线读取 `ASHARE_INTRADAY_ROOT` 或默认 `E:\BaiduNetdiskDownload\a股分时数据` 下的 ZIP 归档。GitHub Pages 没有本地磁盘访问能力，会自动降级到 `data/kline_000001_*.json` 样例。

## 本地预览

从仓库根目录运行：

```powershell
cd a_share_quant
python dashboard/serve.py --port 5177
```

打开：

```text
http://127.0.0.1:5177/
```

## 公开发布

当前公开地址：

```text
https://jiaweioss.github.io/ziying-quant-dashboard-pages/
```

私有研发仓库不会再使用旧的 `https://jiaweioss.github.io/ziying-quant-tool/` 作为主站。自动发布需要在私有仓库配置 `PUBLIC_PAGES_TOKEN`，让 `.github/workflows/pages.yml` 推送到公开仓库 `jiaweioss/ziying-quant-dashboard-pages`。
