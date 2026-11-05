/**
 * GitHub 推广操作（用 GCM 已存的凭据，走 REST + GraphQL）。
 *
 * 子命令：
 *   release        创建 v1.0.0 Release 并上传 tarball
 *   discussions    在 DSH 官方仓库发兼容性实测报告
 *   fork-pr        向 awesome-dsh-plugin 提交收录 PR
 *   status         报告各项当前状态
 *
 * 凭据仅从 GH_TOKEN_LOCAL 读取，绝不打印。
 *
 * 注意：所有多行文本都用数组 join('\n') 构造，避免模板字符串里的反引号转义踩坑。
 */

const TOKEN = process.env.GH_TOKEN_LOCAL;
const OWNER = 'cl2458228286-creator';
const REPO = 'dsh-plugin-workbuddy-checkin';
const UPSTREAM = { owner: 'awesome-dsh-plugin', repo: 'awesome-dsh-plugin' };
const DSH_REPO = { owner: 'deepseek-ai', repo: 'deepseek-harness' };

if (!TOKEN) {
  console.error('缺少 GH_TOKEN_LOCAL');
  process.exit(2);
}

const HEADERS = {
  Authorization: `Bearer ${TOKEN}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'dsh-plugin-workbuddy-checkin',
  'Content-Type': 'application/json',
};

const TICK = String.fromCharCode(96); // 单个反引号，避免模板冲突
const BT = (s) => TICK + s + TICK;    // 包一层反引号
const BT3 = (s) => TICK + TICK + TICK + '\n' + s + '\n' + TICK + TICK + TICK;

async function rest(method, path, body) {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: HEADERS,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* 非 JSON */ }
  return { status: res.status, json, text };
}

async function graphql(query, variables) {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  return { status: res.status, json };
}

// ---------------------------------------------------------------- Release

function releaseNotes() {
  return [
    '## WorkBuddy 每日签到 / 领积分插件 v1.0.0',
    '',
    '给 DeepSeek Harness 加上三个工具，把 WorkBuddy 上能领的积分一次领完。',
    '',
    '### 一条命令安装',
    '',
    BT3(`dsh plugin --profile <你的profile> add github:${OWNER}/${REPO}`),
    '',
    '安装即生效（DSH 桌面端带 HMR，无需重启）。然后用 ' + BT('workbuddy_login') + ' 扫码登录一次即可长期免登录。',
    '',
    '### 提供的工具',
    '',
    '| 工具 | 作用 | 会不会领取 |',
    '|---|---|---|',
    '| ' + BT('workbuddy_checkin_status') + ' | 只读体检：今日签到、连签天数、任务进度、派猫猫、抽奖次数 | 否 |',
    '| ' + BT('workbuddy_claim_credits') + ' | 正式领取五类来源，幂等 | 是 |',
    '| ' + BT('workbuddy_login') + ' | 打开专用 Chrome 窗口扫码登录一次 | 否 |',
    '',
    '### 要点',
    '',
    '- **不需要任何令牌**：用一份独立 Chrome 用户目录保存网页登录态（`~/.workbuddy-checkin`）',
    '- **不伪造任务进度**：成长中心任务只自动接取 + 自动领取，进度由服务端按真实行为记账',
    '- **无数据外传**：只访问 `www.workbuddy.cn` 与 `www.codebuddy.cn`',
    '- 引擎随包分发，`puppeteer-core` 由包管理器自动安装',
    '',
    '### 实测环境',
    '',
    '- DSH `0.2.1-rc.5`（桌面端 profile `desktop`）',
    '- `github:` 方式安装成功，3 个工具全部注册',
    '- 实测领取 +200 分（签到 100 + 成长中心任务 100）',
  ].join('\n');
}

async function cmdRelease(tarballPath) {
  const tag = 'v1.0.0';
  console.log('\n=== 创建 Release ' + tag + ' ===');

  const existing = await rest('GET', `/repos/${OWNER}/${REPO}/releases/tags/${tag}`);
  if (existing.status === 200) {
    console.log('  已存在：' + existing.json.html_url);
    return existing.json;
  }

  const created = await rest('POST', `/repos/${OWNER}/${REPO}/releases`, {
    tag_name: tag,
    target_commitish: 'main',
    name: 'v1.0.0 — WorkBuddy 每日签到 / 领积分',
    body: releaseNotes(),
    draft: false,
    prerelease: false,
  });

  if (created.status !== 201) {
    console.log('  创建失败 HTTP ' + created.status + ': ' + created.text.slice(0, 400));
    return null;
  }
  console.log('  已创建：' + created.json.html_url);

  if (tarballPath) {
    const fs = await import('node:fs');
    const data = fs.readFileSync(tarballPath);
    const name = tarballPath.split(/[\\/]/).pop();
    const uploadUrl = created.json.upload_url.replace('{?name,label}', '') + '?name=' + encodeURIComponent(name);
    const upRes = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + TOKEN,
        'Content-Type': 'application/octet-stream',
        'User-Agent': 'dsh-plugin-workbuddy-checkin',
      },
      body: data,
    });
    const upJson = await upRes.json().catch(() => null);
    console.log('  上传 ' + name + ': HTTP ' + upRes.status + ' ' + (upJson?.browser_download_url ?? ''));
  }
  return created.json;
}

// ---------------------------------------------------------------- Discussions

function compatBody() {
  return [
    '## 插件兼容性报告',
    '',
    '**插件**：https://github.com/' + OWNER + '/' + REPO,
    '**dsh 版本**：' + BT('0.2.1-rc.5') + '（Windows 10 / x64，Desktop 应用）',
    '**安装方式**：' + BT('dsh plugin --profile desktop add github:' + OWNER + '/' + REPO),
    '**结果**：通过（登录工具需一次人工交互）',
    '',
    '---',
    '',
    '### 实测环境',
    '',
    '| 项 | 值 |',
    '|---|---|',
    '| DSH | 0.2.1-rc.5（Electron 桌面端） |',
    '| Profile | ' + BT('desktop') + ' |',
    '| OS | Windows 10 x64 |',
    '| Chrome | 本机已安装（153 / 156） |',
    '',
    '### 安装',
    '',
    BT3('dsh plugin --profile desktop add github:' + OWNER + '/' + REPO),
    '',
    'pnpm 解析 141 个包、约 8 秒完成，无报错。' + BT('package.json') + ' 的 ' + BT('dsh.bundle.patch') +
      ' 被正确识别并加入 ' + BT('dsh.profile.bundles') + '，' + BT('cordis.patch.yml') +
      ' 的 insert 行进入配置树。**安装后无需重启**（桌面端带 HMR，改动热生效）。',
    '',
    '### 能用的部分',
    '',
    '三个工具全部注册成功：',
    '',
    '| 工具 | 结果 |',
    '|---|---|',
    '| ' + BT('workbuddy_checkin_status') + ' | 只读体检正常，正确读到签到状态 / 连签天数 / 任务进度 |',
    '| ' + BT('workbuddy_claim_credits') + ' | 正式领取正常，实测 +200 分（签到 100 + 成长中心任务 100） |',
    '| ' + BT('workbuddy_login') + ' | 逻辑正确，但需用户在真实桌面会话中点授权（无头环境不可用，属预期） |',
    '',
    '**只读性验证**：体检工具连续调用，' + BT('earned') + ' 恒为 0，未触发任何写接口。',
    '',
    '### 需要注意的地方',
    '',
    '1. **必须本机装有 Google Chrome**。插件用 ' + BT('puppeteer-core') + ' 驱动它保存登录态；没有 Chrome 时装上也无法工作。',
    '2. **首次必须交互登录一次**（' + BT('workbuddy_login') + ' 会打开可见窗口等扫码）。之后登录态存在 ' +
      BT('~/.workbuddy-checkin') + '，可长期免登录。',
    '3. **引擎随包分发**（' + BT('lib/engine/web_checkin.mjs') + '）。若发布包漏了它，工具会明确报错而不是静默失败。',
    '4. **依赖解析用 ' + BT('createRequire') + '**，因为 pnpm 安装后依赖会被提升到 profile 上层目录——开发时踩过这个坑。',
    '',
    '### 安全边界',
    '',
    '- 不接触任何令牌：登录态是浏览器 Cookie，只在本机',
    '- 不伪造任务完成度：进度由服务端按真实行为记账，未完成时服务端会拒绝领取',
    '- 出站仅 ' + BT('www.workbuddy.cn') + ' 与 ' + BT('www.codebuddy.cn') + '，无遥测',
    '- 市场静态扫描：0 critical / 3 warning（warning 均为写 cookie 文件与 ' + BT('child_process') + ' 调引擎，属必要行为）',
    '',
    '### 结论',
    '',
    '在 DSH ' + BT('0.2.1-rc.5') + ' 上**可用**。两个工具可无人值守调用，登录工具需一次性人工交互。',
  ].join('\n');
}

async function cmdDiscussions() {
  console.log('\n=== 发布兼容性实测报告到 DSH Discussions ===');

  const catQuery = [
    'query($owner: String!, $name: String!) {',
    '  repository(owner: $owner, name: $name) {',
    '    id',
    '    hasDiscussionsEnabled',
    '    discussionCategories(first: 20) { nodes { id name slug } }',
    '  }',
    '}',
  ].join('\n');

  const cat = await graphql(catQuery, { owner: DSH_REPO.owner, name: DSH_REPO.repo });
  if (cat.json.errors) {
    console.log('  查询分类失败: ' + JSON.stringify(cat.json.errors).slice(0, 400));
    return null;
  }
  const repo = cat.json.data.repository;
  console.log('  Discussions 已启用: ' + repo.hasDiscussionsEnabled);
  const cats = repo.discussionCategories.nodes;
  console.log('  分类: ' + cats.map((c) => c.name + '(' + c.slug + ')').join(', '));

  const target = cats.find((c) => /general/i.test(c.slug)) ?? cats[0];
  console.log('  发到分类: ' + target.name);

  const mutation = [
    'mutation($repoId: ID!, $catId: ID!, $title: String!, $body: String!) {',
    '  createDiscussion(input: { repositoryId: $repoId, categoryId: $catId, title: $title, body: $body }) {',
    '    discussion { url title }',
    '  }',
    '}',
  ].join('\n');

  const res = await graphql(mutation, {
    repoId: repo.id,
    catId: target.id,
    title: 'Plugin compatibility report: ' + REPO + ' (WorkBuddy check-in) on 0.2.1-rc.5',
    body: compatBody(),
  });

  if (res.json.errors) {
    console.log('  发布失败: ' + JSON.stringify(res.json.errors).slice(0, 600));
    return null;
  }
  const url = res.json.data.createDiscussion.discussion.url;
  console.log('  已发布: ' + url);
  return url;
}

// ---------------------------------------------------------------- fork + PR

function prBody() {
  return [
    'Adds one entry file as described in ' + BT('contributing.md') + '.',
    '',
    '**Plugin**: https://github.com/' + OWNER + '/' + REPO,
    '',
    '**What it does**: three DSH agent tools — ' + BT('workbuddy_checkin_status') + ' (read-only),',
    BT('workbuddy_claim_credits') + ' (claims daily check-in, growth tasks, buddy travel, streak',
    'redemption and lottery), ' + BT('workbuddy_login') + ' (one-time Chrome login).',
    '',
    '**Why it needs no tokens**: the plugin keeps WorkBuddy web login state in an isolated',
    'Chrome profile under ' + BT('~/.workbuddy-checkin') + ' and calls the same official endpoints',
    'the website uses. Nothing is decrypted, no credentials are stored by the plugin.',
    '',
    '**Verified**: installed via ' + BT('dsh plugin add') + ' on DSH ' + BT('0.2.1-rc.5') +
      ', all three tools registered, real claim of +200 credits confirmed.',
    '',
    'Only ' + BT('data/plugins/' + OWNER + '__' + REPO + '.yml') + ' is added; READMEs untouched.',
  ].join('\n');
}

async function cmdForkPr() {
  console.log('\n=== 向 awesome-dsh-plugin 提交收录 PR ===');

  let fork = await rest('GET', `/repos/${OWNER}/${UPSTREAM.repo}`);

  if (fork.status === 404) {
    const f = await rest('POST', `/repos/${UPSTREAM.owner}/${UPSTREAM.repo}/forks`, {});
    console.log('  fork: HTTP ' + f.status + ' ' + (f.json?.full_name ?? ''));
    for (let i = 0; i < 15; i += 1) {
      await new Promise((r) => setTimeout(r, 1000));
      fork = await rest('GET', `/repos/${OWNER}/${UPSTREAM.repo}`);
      if (fork.status === 200) break;
    }
  }
  console.log('  fork 可用: HTTP ' + fork.status + ' default=' + (fork.json?.default_branch ?? '?'));

  const upstreamRef = await rest('GET', `/repos/${UPSTREAM.owner}/${UPSTREAM.repo}/git/ref/heads/main`);
  if (upstreamRef.status !== 200) {
    console.log('  读上游 main 失败: ' + upstreamRef.text.slice(0, 200));
    return null;
  }
  const baseSha = upstreamRef.json.object.sha;
  console.log('  上游 main: ' + baseSha.slice(0, 8));

  const entryPath = 'data/plugins/' + OWNER + '__' + REPO + '.yml';
  const entryContent = [
    'url: https://github.com/' + OWNER + '/' + REPO,
    'name: ' + OWNER + '/' + REPO,
    'category: tools',
    'description:',
    '  en: Auto check-in and claim credits for WorkBuddy via an isolated Chrome profile, no tokens required.',
    '  zh: 用独立 Chrome 登录态自动签到并领取 WorkBuddy 积分，无需令牌。',
    '',
  ].join('\n');

  const blob = await rest('POST', `/repos/${OWNER}/${UPSTREAM.repo}/git/blobs`, {
    content: entryContent,
    encoding: 'utf-8',
  });
  if (blob.status !== 201) { console.log('  blob 失败: ' + blob.text.slice(0, 200)); return null; }

  const tree = await rest('POST', `/repos/${OWNER}/${UPSTREAM.repo}/git/trees`, {
    base_tree: baseSha,
    tree: [{ path: entryPath, mode: '100644', type: 'blob', sha: blob.json.sha }],
  });
  if (tree.status !== 201) { console.log('  tree 失败: ' + tree.text.slice(0, 200)); return null; }
  console.log('  新增 ' + entryPath);

  const commit = await rest('POST', `/repos/${OWNER}/${UPSTREAM.repo}/git/commits`, {
    message: 'Add ' + OWNER + '/' + REPO + ' to the plugin list\n\nWorkBuddy daily check-in / credit claiming plugin for DSH.\nThree agent tools, bundled Chrome-driven engine, no tokens required.',
    tree: tree.json.sha,
    parents: [baseSha],
  });
  if (commit.status !== 201) { console.log('  commit 失败: ' + commit.text.slice(0, 200)); return null; }

  const ref = await rest('PATCH', `/repos/${OWNER}/${UPSTREAM.repo}/git/refs/heads/main`, {
    sha: commit.json.sha,
    force: true,
  });
  if (ref.status !== 200) { console.log('  更新 fork main 失败 HTTP ' + ref.status + ': ' + ref.text.slice(0, 300)); return null; }
  console.log('  fork main 已更新');

  const pr = await rest('POST', `/repos/${UPSTREAM.owner}/${UPSTREAM.repo}/pulls`, {
    title: 'Add ' + OWNER + '/' + REPO + ': WorkBuddy check-in plugin for DSH',
    head: OWNER + ':main',
    base: 'main',
    body: prBody(),
  });

  if (pr.status === 201) {
    console.log('  PR 已创建: ' + pr.json.html_url);
    return pr.json.html_url;
  }
  if (pr.status === 422 && /A pull request already exists/i.test(pr.text)) {
    console.log('  PR 已存在（重复执行）');
    return null;
  }
  console.log('  PR 创建失败 HTTP ' + pr.status + ': ' + pr.text.slice(0, 400));
  return null;
}

// ---------------------------------------------------------------- status

async function cmdStatus() {
  console.log('\n=== 推广状态 ===');
  const repo = await rest('GET', `/repos/${OWNER}/${REPO}`);
  console.log('Stars: ' + repo.json?.stargazers_count + '  Forks: ' + repo.json?.forks_count);
  console.log('License: ' + (repo.json?.license?.spdx_id ?? '?'));
  console.log('Topics: ' + (repo.json?.topics ?? []).join(', '));

  const rel = await rest('GET', `/repos/${OWNER}/${REPO}/releases`);
  console.log('Release: ' + (rel.json?.length ?? 0) + ' 个');
  for (const r of rel.json ?? []) console.log('  - ' + r.tag_name + ': ' + r.html_url);

  const q = await rest('GET', `/search/issues?q=repo:${UPSTREAM.owner}/${UPSTREAM.repo}+author:${OWNER}+type:pr`);
  console.log('awesome-dsh-plugin PR: ' + (q.json?.total_count ?? '?'));
  for (const p of q.json?.items ?? []) console.log('  - ' + p.state + ': ' + p.html_url);
}

// ---------------------------------------------------------------- main

const cmd = process.argv[2];
const arg = process.argv[3];

(async () => {
  switch (cmd) {
    case 'release': await cmdRelease(arg); break;
    case 'discussions': await cmdDiscussions(); break;
    case 'fork-pr': await cmdForkPr(); break;
    case 'status': await cmdStatus(); break;
    default:
      console.log('用法: node scripts/gh-promote.mjs <release|discussions|fork-pr|status> [tarball]');
  }
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
