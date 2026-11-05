# 安装

## 一条命令

```bash
dsh plugin --profile <你的profile> add github:cl2458228286-creator/dsh-plugin-workbuddy-checkin
```

装完直接用，**不需要重启**（DSH 桌面端带 HMR，安装即生效）。

然后让 Agent 调一次 `workbuddy_login` 扫码登录，之后长期免登录。

---

## 其他安装方式

| 方式 | 命令 |
|---|---|
| 本地目录 | `dsh plugin --profile <p> add /绝对路径/to/dsh-plugin-workbuddy-checkin` |
| 发布包 | `dsh plugin --profile <p> add /绝对路径/to/dsh-plugin-workbuddy-checkin-1.0.0.tgz` |
| npm（未发布） | `dsh plugin --profile <p> add dsh-plugin-workbuddy-checkin` |

本地路径**必须是绝对路径**，也可以写成 `file:D:\path\to\pkg`。

---

## 前置条件

| 依赖 | 说明 |
|---|---|
| **Google Chrome** | **必须**。插件用它保存登录态并调用官方接口 |
| DSH ≥ 0.2.1-rc.1 | 插件用 `defineTool` 注册工具 |
| pnpm | DSH 插件管理器内部用它装依赖，DSH 自带运行时通常已包含 |

---

## 卸载

```bash
dsh plugin --profile <p> remove dsh-plugin-workbuddy-checkin
```

登录态目录 `~/.workbuddy-checkin` 不会自动删除，想彻底清干净手动删。

---

## 验证

```bash
node scripts/install-verify.mjs
```

从已安装副本加载插件、注册 3 个工具、真实调一次只读体检。看到 `install-verify 通过` 即装好。
