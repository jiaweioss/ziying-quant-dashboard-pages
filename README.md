# Dashboard

静态量化研究看板，展示历史 Strategy Lab、最新真实数据回测、框架链路、风控事件、持仓、滚动 IC 权重和发布状态。

## 数据文件

```text
data/strategy_lab_results.json  # 历史 7 策略对比，当前历史最佳来自这里
data/backtest_result.json       # src.main real-backtest 输出的新框架结果
data/kline_000001_*.json        # GitHub Pages 看盘兜底样例，来自本地日线/分钟线
deploy-info.json                # Pages 发布时自动生成，本地预览可缺省
```

`app.js` 会同时读取历史实验和新框架结果；如果新框架 JSON 里存在旧版本遗留的 `NaN`，前端会做兼容解析，但新的 `real-backtest` 输出已经使用 strict JSON。

## 本地 K 线看盘

前端使用 TradingView Lightweight Charts 展示 K 线和成交量。数据统一为：

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
