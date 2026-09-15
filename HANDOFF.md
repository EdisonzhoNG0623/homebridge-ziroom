# homebridge-ziroom — 交接摘要

Updated: 2026-09-15

## 目标

自如智能硬件的 Homebridge 插件，经 HomeKit Device 进 Home Assistant。重点把窗帘和空调补全。

## 当前状态

- **3.2.0 已发布**（2026-08-13）：`curtain01` 连续定位 + 仅开/关型号；`conditioner02` 模式/风速/摆风/屏显/室外温度；状态轮询、错误传播、并发/重试、Node 18–24。
- `main` 干净，跟踪 `origin/main`（GitHub）。另有 Gitea `edison/homebridge-ziroom`（`ssh://git@192.168.123.138:2212/...`）。
- 2026-08-28 另有会话「homebridge 和 ziroom 插件好像坏了」，**idle，没有后续 commit**。现场是否仍坏，本摘要未验证。

## 已拍板

- 配置里的 token/账密不要进 Git。
- HA 找不到桥：Homebridge 用 `ciao` mDNS，且和 HA 二层互通。

## 关键路径

- 能力说明：`README.md`
- 变更：`CHANGELOG.md` → 3.2.0
- schema：`config.schema.json`

## 下一件

若用户仍报「插件坏了」：在跑 Homebridge 的那台机上查日志/配对/token，不要在本仓重做 3.2.0 已落地的空调窗帘功能。功能补全任务已关闭。
