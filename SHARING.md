# 分享给别人时请带上这些

## 必须带上

```
dsh-plugin-workbuddy-checkin/
├── package.json
├── cordis.patch.yml
├── lib/index.js
├── lib/engine/web_checkin.mjs
└── README.md
```

`package.json` 的 `files` 白名单已覆盖上述内容，所以：

```bash
npm pack
```

产出的 `dsh-plugin-workbuddy-checkin-1.0.0.tgz` 就是完整的可分发包。对方安装：

```bash
dsh plugin --profile <profile> add /绝对路径/to/dsh-plugin-workbuddy-checkin-1.0.0.tgz
```

## 不要带上

| 路径 | 原因 |
|---|---|
| `node_modules/` | 由安装方 pnpm 自动装 |
| `.browser-profile/` | **含完整登录凭据**，等于账号钥匙 |
| `~/.workbuddy-checkin/` | 同上，本机用户目录里的登录态 |

> 打包前确认没有把登录态混进去。`npm pack` 受 `files` 白名单限制，
> 不会带 `node_modules`；但仍建议发布前 `tar -tf` 看一眼内容。
>
> 如果确实把 `.browser-profile` 放进了包目录（不建议），发出去等于泄露账号。

## 推到 git 分享

```bash
cd dsh-plugin-workbuddy-checkin
git init
git add package.json cordis.patch.yml lib README.md INSTALL.md scripts .gitignore
git commit -m "dsh-plugin-workbuddy-checkin v1.0.0"
git remote add origin <你的仓库地址>
git push -u origin main
```

再打个 tag：

```bash
git tag v1.0.0 && git push --tags
```

对方就能：

```bash
dsh plugin --profile <profile> add github:<账号>/dsh-plugin-workbuddy-checkin
```

## 发到 npm

```bash
npm publish
```

`package.json` 里 `files` 白名单限制发布内容；`prepack` 未配置构建脚本，
因为没有需要编译的产物（纯 ESM JS）。

## 对方需要做的事

1. 装好 Chrome
2. `dsh plugin add ...`
3. 重启 DSH
4. 让 Agent 调 `workbuddy_login` 扫码一次
5. 之后每天自动领

对方**不需要**装 Python、不需要令牌、不需要自己准备引擎目录。
