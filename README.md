# dsh-plugin-workbuddy-checkin

WorkBuddy 每日自动签到 / 领积分，做成一个 **DeepSeek Harness (DSH) 插件**。

装好之后，你可以直接对 Agent 说「看看我 WorkBuddy 还有什么积分没领」「帮我把积分领了」。

**不需要任何令牌，也不需要每天登录。** 插件把 WorkBuddy 网页登录态保存在一份独立的 Chrome
用户目录里，之后每次都用同源请求调用官方活动接口——和你在网页上点「签到」是同一件事。

---

## 安装（复制一下，粘贴两下）

不用命令行、不用管什么 profile。**把下面这行复制走：**

```
https://github.com/cl2458228286-creator/dsh-plugin-workbuddy-checkin
```

然后打开 **DeepSeek Harness** → 左下角 **设置** → **插件** → **添加插件** → 粘贴 → 确认。

装完**不用重启**，直接生效。

<details>
<summary>然后登录一次（约 30 秒）</summary>

对 Agent 说「登录 WorkBuddy 签到插件」，它会打开一个独立的 Chrome 窗口。
在里面完成登录即可，脚本检测到成功会自动保存并关窗。之后长期免登录。

登录态在 `~/.workbuddy-checkin`，**别删**，删了要重登。
</details>

### 前置条件

| 依赖 | 说明 |
|---|---|
| **Google Chrome** | **必须**。插件用它保存登录态并调用接口，没有 Chrome 就无法工作 |
| DSH 桌面版 0.2.1-rc.1 以上 | 图形界面即可，不需要命令行工具 |

卸载：**设置** → **插件** → 找到本插件 → 卸载。

更多安装方式（含开发者的 `dsh` CLI 命令）见 [INSTALL.md](INSTALL.md)。

---

## 它能领什么

| 来源 | 额度 | 说明 |
|---|---|---|
| 加油站每日签到 | 100/天，周期第 7 天 1000 | 幂等，签过不重复请求 |
| 成长中心任务 | 50–100/个 | **自动接取**全部任务；进度满了**自动领取** |
| 派猫猫旅行 | 5–10/次 | 已到达就领奖，空闲就再派一趟 |
| 连签里程碑兑换 | 7 / 14 / 28 天档位 | `available` 就自动兑换 |
| 积分抽奖 | 10 或 100/次 | 有次数就抽（每轮上限 20 次） |

> **边界（不夸大）**：成长中心任务的进度由服务端按真实行为记账，本插件不伪造。
> 它省掉的是「反复去任务页点领取」，省不掉「用产品」本身。

---

## 三个工具

| 工具 | 作用 | 会不会领取 |
|---|---|---|
| `workbuddy_checkin_status` | 只读体检：今日签到、连签天数、任务进度、派猫猫、抽奖次数 | ❌ 完全不领 |
| `workbuddy_claim_credits` | 正式领取五类来源，幂等 | ✅ |
| `workbuddy_login` | 打开专用 Chrome 窗口扫码登录一次 | ❌ |

---

## 日常使用

```text
你：帮我领一下 WorkBuddy 积分
Agent → workbuddy_claim_credits
       本次获得 100 分（签到 100 / 任务 0 / 旅行 0 / 连签 0 / 抽奖 0）
```

```text
你：我还有哪些积分没领？
Agent → workbuddy_checkin_status（只读）
       今日已签到：是（连签 10 天）｜任务：共 18 个，待领取 1，进行中 15
```

想每天自动跑：

> 每天 8:50 自动帮我领 WorkBuddy 积分，然后告诉我结果

Agent 会用 DSH 的定时能力建一条每日任务。

---

## 配置（可选）

默认全自动，不需要配任何东西。非常规环境可在 profile patch 里加 config：

```yaml
- id: workbuddy-checkin
  name: 'dsh-plugin-workbuddy-checkin'
  config:
    chromePath: 'D:\Chrome\chrome.exe'       # Chrome 不在默认位置时
    nodeExecutable: 'C:\nodejs\node.exe'     # 想指定 node 时
```

环境变量：

| 变量 | 作用 |
|---|---|
| `WB_BROWSER_PROFILE` | 登录态目录（默认 `~/.workbuddy-checkin/browser-profile`） |
| `WB_COOKIE_FILE` | 会话 Cookie 文件 |
| `WB_CHROME_PATH` | Chrome 可执行文件 |
| `WORKBUDDY_NODE` | 运行引擎用的 node |

node 查找顺序：`config.nodeExecutable` → `WORKBUDDY_NODE` → WorkBuddy 自带 node → 宿主进程自身 → `PATH` 上的 `node`。

---

## 排错

| 现象 | 原因与处理 |
|---|---|
| 工具没出现 | 确认装进了**当前在用的 profile**；查 DSH 日志里的插件加载错误 |
| `无法解析依赖 puppeteer-core` | 依赖没装上。重新 `dsh plugin add`，或进包目录跑 `pnpm install` |
| `找不到包内引擎` | 只拷贝了部分文件。重装完整包（引擎在 `lib/engine/web_checkin.mjs`） |
| 返回 `not_logged_in` | 登录态缺失/过期。调 `workbuddy_login` 扫码一次 |
| 返回 `auth_failed` | 接口拒绝登录态。重新登录；仍失败确认账号是否正常 |
| 返回 `partial` | 有子步骤失败，多为任务进度未满（服务端正常拦截），次日再跑自然到账 |
| 弹不出登录窗口 | 确认本机装了 Chrome；无头环境不支持登录 |
| 引擎超时 | 网络慢或 Chrome 启动慢。重试一次 |

---

## 安全说明

- **不接触任何令牌**。登录态是浏览器 Cookie，存在本机独立目录，插件不读取其内容、不外传。
- 工具返回值只有**积分数量与状态**，不含 Cookie / token。
- 只访问 `www.workbuddy.cn` 与 `www.codebuddy.cn`。无遥测、无上传。
- 写操作仅限官方活动接口的领取类端点，**不**模拟点击、不逆向加密、不绕过风控。
- 免责声明见 [NOTICE.md](NOTICE.md)。

---

## 目录结构

```
dsh-plugin-workbuddy-checkin/
├── package.json              # dsh.bundle.patch 声明自己是 bundle
├── cordis.patch.yml          # 把插件挂进配置树
├── lib/
│   ├── index.js              # 插件本体：3 个工具
│   └── engine/
│       └── web_checkin.mjs   # 签到引擎（puppeteer 驱动 Chrome）
└── scripts/                  # 自测与发布工具
```

自测：

```bash
node scripts/selftest.mjs        # 契约合规（不需要登录）
node scripts/e2e.mjs             # 真实引擎跑一次体检（需要已登录）
node scripts/install-verify.mjs  # 从已安装副本验证
node scripts/market-check.mjs    # 市场收录标准自检
```

---

## 版本

当前 `1.0.0`。实测环境 DSH `0.2.1-rc.5`（Windows 10 / x64，桌面端 profile）。

## License

[MIT](LICENSE)
