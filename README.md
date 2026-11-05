# dsh-plugin-workbuddy-checkin

WorkBuddy 每日自动签到 / 领积分，做成一个 **DeepSeek Harness (DSH) 插件**。

装进 DSH 之后，你可以直接对 Agent 说「看看我 WorkBuddy 还有什么积分没领」「帮我把积分领了」，它会调用插件提供的工具去做，并把完成回执汇报给你。

**不需要任何 token，也不需要每天登录**：插件用一份**独立 Chrome 用户目录**保存 WorkBuddy 网页登录态，之后每次都以同源请求调用官方活动接口——和你在网页上点「签到」按钮是同一件事。登录一次，长期免登录。

---

## 它能领什么

| 来源 | 额度 | 说明 |
|---|---|---|
| 加油站每日签到 | 100/天，周期第 7 天 1000 | 幂等，签过不重复请求 |
| 成长中心任务 | 50–100/个 | **自动接取**全部任务；进度满了**自动领取** |
| 派猫猫旅行 | 5–10/次 | 已到达就领奖，空闲就再派一趟 |
| 连签里程碑兑换 | 7 / 14 / 28 天档位 | `available` 就自动兑换 |
| 积分抽奖 | 10 或 100/次 | 有次数就抽（每轮上限 20 次） |

> **边界（不夸大）**：成长中心任务的进度由服务端按真实行为记账，脚本不伪造。
> 它省掉的是「反复去任务页点领取」，省不掉「用产品」本身。

---

## 它提供哪 3 个工具

| 工具 | 作用 | 会不会领取 |
|---|---|---|
| `workbuddy_checkin_status` | 只读体检：今日是否已签、连签天数、任务待接取/待领取/进行中、派猫猫状态、抽奖次数 | ❌ 完全不领 |
| `workbuddy_claim_credits` | 正式领取五类来源，幂等 | ✅ 领取 |
| `workbuddy_login` | 打开专用 Chrome 窗口扫码登录一次 | ❌ 不领 |

---

## 安装

### 前置条件

1. **Google Chrome**（必须，插件用它保存登录态并调用接口）
2. **DSH** ≥ 0.2.1-rc.1
3. **pnpm**（DSH 的插件管理器用它装依赖；DSH 自带的运行时通常已经包含）

### 三种安装方式

**A. 从本地目录（开发/自用）**

```bash
dsh plugin --profile <你的profile名> add /绝对路径/to/dsh-plugin-workbuddy-checkin
```

**B. 从 git URL（分享给别人）**

```bash
dsh plugin --profile <你的profile名> add github:你的账号/dsh-plugin-workbuddy-checkin
```

**C. 从 npm（发布后）**

```bash
dsh plugin --profile <你的profile名> add dsh-plugin-workbuddy-checkin
```

装完**重启 DSH**（插件注册工具需要重新组合配置树）。

> `dsh plugin` 会把参数原样转发给 pnpm，所以 `add /绝对路径` 也可以写成 `add file:/绝对路径`。
> 本地目录必须是**绝对路径**。

### 装完确认

重启后在会话里问一句「看看我 WorkBuddy 还有什么积分没领」，应该会调用 `workbuddy_checkin_status` 并返回当前状态。

---

## 首次使用：登录一次

第一次用（或登录态过期）需要扫码一次：

> 对我说「登录 WorkBuddy 签到插件」，或直接说「先登录一下，然后再领积分」

Agent 会调用 `workbuddy_login`，弹出一个**独立的 Chrome 窗口**（不影响你日常浏览器）。在那个窗口里完成 WorkBuddy 登录即可，脚本检测到登录成功会自动保存 Cookie 并关闭窗口。

登录态保存在：

```
%USERPROFILE%\.workbuddy-checkin\browser-profile\
```

这个目录里是完整登录凭据，**不要提交 git、不要分享、不要放网盘**。删掉它就需要重新登录。

---

## 日常使用

```text
你：帮我领一下 WorkBuddy 积分
Agent → workbuddy_claim_credits
       本次获得 100 分（签到 100 / 任务 0 / 旅行 0 / 连签 0 / 抽奖 0）
```

```text
你：我还有哪些积分没领？
Agent → workbuddy_checkin_status（只读，不会领）
       今日已签到：是（连签 10 天）｜任务：共 18 个，待领取 1，进行中 15
```

想做成每天自动跑，可以对 Agent 说：

> 每天 8:50 自动帮我领 WorkBuddy 积分，然后告诉我结果

Agent 会用 DSH 的定时提醒能力建一条每日任务。

---

## 配置（可选）

插件默认全自动工作，不需要配任何东西。非常规环境可以在 DSH 的 profile patch 里给这行加 config：

```yaml
- id: workbuddy-checkin
  name: 'dsh-plugin-workbuddy-checkin'
  config:
    chromePath: 'D:\Chrome\chrome.exe'       # Chrome 不在默认位置时
    nodeExecutable: 'C:\nodejs\node.exe'     # 想指定 node 时
```

也可以用环境变量：

| 环境变量 | 作用 |
|---|---|
| `WB_BROWSER_PROFILE` | 登录态目录（默认 `~/.workbuddy-checkin/browser-profile`） |
| `WB_COOKIE_FILE` | 会话 Cookie 文件 |
| `WB_CHROME_PATH` | Chrome 可执行文件 |
| `WORKBUDDY_NODE` | 运行引擎用的 node |

node 的查找顺序：`config.nodeExecutable` → `WORKBUDDY_NODE` → WorkBuddy 自带 node → 宿主进程自身 → `PATH` 上的 `node`。

---

## 排错

| 现象 | 原因与处理 |
|---|---|
| 工具没出现 | 装完没重启 DSH；或 `dsh plugin` 装错了 profile。重启后仍没有就看 DSH 启动日志里的插件加载错误 |
| `缺少依赖 puppeteer-core` | 依赖没装上。进插件包目录跑 `pnpm install`，或重新 `dsh plugin add` |
| `找不到包内引擎` | 只拷贝了 `package.json`。插件必须连同 `lib/engine/web_checkin.mjs` 一起分发 |
| 返回 `not_logged_in` | 登录态缺失/过期。调用 `workbuddy_login` 扫码一次 |
| 返回 `auth_failed` | 接口拒绝登录态。先重新登录；仍失败确认账号是否正常 |
| 返回 `partial` | 有子步骤失败，多为任务进度未满（服务端正常拦截），次日再跑自然到账 |
| 弹不出登录窗口 | 确认本机装了 Chrome；无头环境下 `workbuddy_login` 不可用 |
| 引擎超时 | 网络慢或 Chrome 启动慢。重试一次；持续失败看 DSH 日志里的 stderr |

---

## 安全说明

- **不接触任何令牌**。登录态是浏览器 Cookie，存在本机独立目录，插件既不读取也不外传了它的内容。
- 工具返回值只有**积分数量与状态**，不含任何 Cookie / token 值。
- 只访问两个官方域名：`www.workbuddy.cn`、`www.codebuddy.cn`。没有遥测、没有上传。
- 写操作仅限官方活动接口的领取类端点，**不**模拟鼠标点击、不逆向加密、不绕过风控。

---

## 目录结构

```
dsh-plugin-workbuddy-checkin/
├── package.json              # dsh.bundle.patch 声明自己是 bundle
├── cordis.patch.yml          # 把插件挂进配置树
├── lib/
│   ├── index.js              # 插件本体：3 个工具的定义与执行
│   └── engine/
│       └── web_checkin.mjs   # 签到引擎（puppeteer 驱动 Chrome）
├── scripts/
│   ├── selftest.mjs          # 契约自测（不启动 DSH）
│   ├── e2e.mjs               # 端到端自测（打真实接口，只读）
│   └── mini-yaml.mjs         # 自测用极简 YAML 解析
└── README.md
```

自测：

```bash
node scripts/selftest.mjs   # 契约合规（快，不需要登录）
node scripts/e2e.mjs        # 真实引擎跑一次体检（需要已登录）
```

---

## 分享给别人

把这个目录打包发过去（或推到 git / 发到 npm），对方执行：

```bash
dsh plugin --profile <profile> add <包路径或 git URL 或 npm 名>
```

然后：

1. 重启 DSH
2. 让对方对 Agent 说「登录 WorkBuddy 签到插件」做一次扫码
3. 之后每天自动领积分

对方**不需要**准备引擎、不需要装 Python、不需要任何令牌。

---

## License

MIT
