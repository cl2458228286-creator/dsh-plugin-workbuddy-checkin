# 安装 dsh-plugin-workbuddy-checkin

三种方式，选一种。装完**必须重启 DSH**。

## 前置

| 依赖 | 说明 |
|---|---|
| Google Chrome | 必须。插件用它保存登录态并调用官方接口 |
| DSH ≥ 0.2.1-rc.1 | 插件用 `defineTool` 注册工具 |
| pnpm | DSH 插件管理器内部用它装依赖，通常 DSH 自带的运行时已包含 |

## 方式 A：本地目录

```bash
dsh plugin --profile <你的profile> add /绝对路径/to/dsh-plugin-workbuddy-checkin
```

Windows 例：

```powershell
dsh plugin --profile desktop add "file:D:\path\to\dsh-plugin-workbuddy-checkin"
```

## 方式 B：git 仓库

```bash
dsh plugin --profile <profile> add github:<账号>/dsh-plugin-workbuddy-checkin
```

## 方式 C：npm

```bash
dsh plugin --profile <profile> add dsh-plugin-workbuddy-checkin
```

## 装完

1. **重启 DSH**（重新组合配置树才会注册工具）
2. 对 Agent 说：`登录 WorkBuddy 签到插件` → 弹出独立 Chrome 窗口扫码一次
3. 之后说 `帮我领一下 WorkBuddy 积分` 即可

## 卸载

```bash
dsh plugin --profile <profile> remove dsh-plugin-workbuddy-checkin
```

登录态目录 `~/.workbuddy-checkin` 不会自动删除；想彻底清干净手动删掉它。

## 验证安装

```bash
node scripts/install-verify.mjs
```

它会从已安装副本加载插件、注册工具、真实调用一次只读体检。看到 `install-verify 通过` 即装好。
