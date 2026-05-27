# Dashboard

静态量化研究看板，展示历史 Strategy Lab、最新真实数据回测、框架链路、风控事件、持仓、滚动 IC 权重和发布状态。

## 数据文件

```text
data/strategy_lab_results.json  # 历史 7 策略对比，当前历史最佳来自这里
data/backtest_result.json       # src.main real-backtest 输出的新框架结果
deploy-info.json                # Pages 发布时自动生成，本地预览可缺省
```

`app.js` 会同时读取历史实验和新框架结果；如果新框架 JSON 里存在旧版本遗留的 `NaN`，前端会做兼容解析，但新的 `real-backtest` 输出已经使用 strict JSON。

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
