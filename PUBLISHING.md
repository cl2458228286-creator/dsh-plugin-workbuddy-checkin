# 提交到 DSH 插件市场 —— 完整步骤

> 本文件是给**你（提交者）**看的操作清单。代码侧已经全部改到位，剩下的是「推到公开仓库」+
> 「点提交」这两步，都需要你的账号，我无法代做。

## 现状：代码已符合收录标准

已按 [dsh.so 接受标准](https://www.dsh.so/zh/submit/) 逐条核对，`node scripts/market-check.mjs` 全通过：

| 标准 | 状态 |
|---|---|
| DSH 兼容信号 | ✅ `package.json` 有 `dsh.bundle`，关键词含 `dsh-plugin` |
| README 带安装说明 | ✅ |
| 开源许可证（SPDX） | ✅ `MIT` + `LICENSE` 文件 |
| 插件 id 规范 `^[a-z0-9]+(-[a-z0-9]+)*$` | ✅ `dsh-plugin-workbuddy-checkin` |
| 源码可扫描 | ✅ 8 个 JS 文件 |
| 安全扫描通过 | ✅ 无硬编码密钥、无数据外传、无破坏性操作、无挖矿特征 |
| 出站域名 | ✅ 仅 `www.workbuddy.cn` / `www.codebuddy.cn` |

## 为什么我不能替你提交

本机情况：

- **没有 GitHub 登录态**（无 `gh` CLI、无 SSH 私钥、`cmdkey` 里没有 GitHub 凭据）
- **没有 npm 登录态**（`npm whoami` → `ENEEDAUTH`）
- 插件目录**还不是 git 仓库**

市场渠道只有两种，都需要公开可访问：

1. **GitHub / Gitee / GitLab 公开仓库**（推荐，元数据自动同步）
2. **npm 已发布包**（`npm publish`）

---

## 路线 A：走 GitHub（推荐）

### A1. 建仓库并推送（你来做，约 2 分钟）

先在 GitHub 网页建一个**公开**仓库，名字建议就用 `dsh-plugin-workbuddy-checkin`（id 规范要求仓库名符合 `^[a-z0-9]+(-[a-z0-9]+)*$`）。

然后在本机执行：

```powershell
cd D:\project\autoware\dsh-plugin-workbuddy-checkin

git init
git add -A
git commit -m "feat: WorkBuddy daily check-in plugin v1.0.0"
git branch -M main
git remote add origin https://github.com/<你的账号>/dsh-plugin-workbuddy-checkin.git
git push -u origin main
```

> ⚠️ **推送前先确认 `.browser-profile/` 没被带进去**。
> `.gitignore` 已排除它，但仍建议 `git status` 看一眼，确认里面没有 `*.json` 登录态。

推送后给仓库加话题标签 **`dsh-plugin`**（仓库首页 → ⚙️ Settings 旁边的 About 编辑框），市场会自动索引。

### A2. 到 dsh.so 提交（你来做，约 1 分钟）

1. 打开 <https://www.dsh.so/zh/submit/>
2. 粘贴仓库地址：`github.com/<你的账号>/dsh-plugin-workbuddy-checkin`
3. 类型选 **「dsh 插件（可通过 `dsh plugin add` 安装）」**
4. 点「开始检查」——它会自动拉取、校验、扫描
5. 通过后点 **「提交到 dsh.so」**，条目会以 Issue 形式进审核队列

### A3. 同时提交到 awesome-dsh-plugin 列表（可选，另一个渠道）

这个列表是数据文件驱动的，一个插件一个 YAML：

```powershell
# 在你的 fork 里新增一个文件：
#   data/plugins/<owner>__dsh-plugin-workbuddy-checkin.yml
```

内容：

```yaml
url: https://github.com/<你的账号>/dsh-plugin-workbuddy-checkin
name: <你的账号>/dsh-plugin-workbuddy-checkin
category: tools
description:
  en: Auto check-in and claim credits for WorkBuddy via an isolated Chrome profile, no tokens required.
  zh: 用独立 Chrome 登录态自动签到并领取 WorkBuddy 积分，无需令牌。
```

然后对 `awesome-dsh-plugin/awesome-dsh-plugin` 开 PR（只加这一个文件，别改 README，它们是生成的）。

---

## 路线 B：走 npm（没有 GitHub 也能收录）

```powershell
npm login          # 需要你输入账号
cd D:\project\autoware\dsh-plugin-workbuddy-checkin
npm publish
```

发布后到 <https://www.dsh.so/zh/submit/> 粘贴包名 `dsh-plugin-workbuddy-checkin` 即可。
纯 npm 条目元数据（星标、许可证、安装命令）全部来自发布包。

> 注意：你的 `~/.npmrc` 指向 `registry.npmmirror.com`（国内镜像）。
> **发布必须用官方源**，否则市场拉不到：
>
> ```powershell
> npm publish --registry https://registry.npmjs.org
> ```

---

## 提交后会发生什么

- 每次提交都会**服务端重新拉源码重新扫描**（不用缓存）
- 你的插件先以 **Declared（声明）** 兼容性收录；dsh.so 独立测试通过后才会标 **Verified**
- 想加速 Verified：按它给的模板在 [DSH Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions) 贴一份兼容性实测报告（我们实测过 DSH `0.2.1-rc.5`，可以直接写）

---

## 提交前最后一次自检

```powershell
cd D:\project\autoware\dsh-plugin-workbuddy-checkin
node scripts/market-check.mjs     # 市场准入
node scripts/selftest.mjs         # 插件契约
node scripts/install-verify.mjs   # 已安装副本可执行
```

三个都过就可以提交了。

---

## 一个提醒

市场收录后会有人装。他们的环境差异主要在两点，README 已经写明：

1. **必须有 Google Chrome**（插件用它保存登录态）
2. **首次要扫码登录一次**（`workbuddy_login` 会弹窗）

如果对方没有 Chrome，装上也用不了——这一点在 README 的「前置条件」里已经放在最前面。
