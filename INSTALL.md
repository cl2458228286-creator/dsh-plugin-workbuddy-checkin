# 安装（图形界面，真正的一键）

不用命令行、不用管 profile 名。**两步。**

## 第 1 步：复制这一行

```
https://github.com/cl2458228286-creator/dsh-plugin-workbuddy-checkin
```

## 第 2 步：粘贴进 DSH

1. 打开 **DeepSeek Harness**
2. 左下角 **设置** → **插件**
3. 点 **添加插件**（Add plugin）
4. 把上面那行 URL 粘进输入框
5. 点确认

装完**不用重启**，直接生效。

## 第 3 步：登录一次（约 30 秒）

回到对话，对 Agent 说：

> 登录 WorkBuddy 签到插件

它会打开一个独立的 Chrome 窗口。你在里面完成 WorkBuddy 登录即可，脚本检测到成功会自动关窗。
之后长期免登录。

---

## 前置条件

**需要 Google Chrome。** 没有装的话插件无法工作（它用 Chrome 保存登录态并调用官方接口）。

---

## 验证装好了

对 Agent 说：

> 看看我还有哪些 WorkBuddy 积分没领

如果它调用了 `workbuddy_checkin_status` 并给出签到状态、连签天数、任务进度，就装好了。
这个工具**只读**，不会领任何东西。

---

## 卸载

**设置** → **插件** → 找到 `dsh-plugin-workbuddy-checkin` → **卸载**。

登录态目录 `~/.workbuddy-checkin` 不会自动删除；想彻底清干净手动删掉。

---

## 命令行方式（进阶，可选）

DSH 桌面版自带命令行，路径是：

```
%LOCALAPPDATA%\..\..\software\deepseekharness\resources\app.asar
```

算了，这个路径因安装位置而异，不推荐。**用图形界面就好**，上面两步就够。

> 如果你确实在用 `dsh` CLI（开发环境才装），命令是：
> `dsh plugin --profile <你的profile> add github:cl2458228286-creator/dsh-plugin-workbuddy-checkin`
> `--profile` 的值就是 `~/.dsh/profiles/` 下你实际在用的那个目录名（桌面端固定是 `desktop`）。
> 但普通用户没有 `dsh` 命令，忽略这部分。
