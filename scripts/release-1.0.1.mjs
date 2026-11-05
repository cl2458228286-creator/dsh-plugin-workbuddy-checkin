/**
 * 创建 v1.0.1 Release（修复「异常」显示）并上传 tarball。
 * 幂等：已存在则跳过。
 */

import fs from 'node:fs';

const TOKEN = process.env.GH_TOKEN_LOCAL;
if (!TOKEN) { console.error('缺少 GH_TOKEN_LOCAL'); process.exit(2); }

const OWNER = 'cl2458228286-creator';
const REPO = 'dsh-plugin-workbuddy-checkin';
const TAG = 'v1.0.1';
const TICK = String.fromCharCode(96);
const BT = (s) => TICK + s + TICK;
const BT3 = (s) => TICK + TICK + TICK + '\n' + s + '\n' + TICK + TICK + TICK;

const H = {
  Authorization: 'Bearer ' + TOKEN,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'dsh-plugin-workbuddy-checkin',
  'Content-Type': 'application/json',
};

const notes = [
  '## v1.0.1 — 修复插件显示「异常」',
  '',
  '**如果你装了 1.0.0 并在 设置 → 插件 里看到状态为「异常」，这个版本修好了它。**',
  '',
  '### 修了什么',
  '',
  '根因：插件导出的 ' + BT('Config') + ' 是个普通对象。Cordis 加载插件时会调用',
  BT('Config["~standard"].validate(config)') + '，普通对象没有这个校验协议，',
  '于是加载阶段直接抛异常 —— UI 就显示成「异常」。',
  '',
  '现在改为 schemastery 的 ' + BT('z.object({ nodeExecutable, chromePath })') + '，',
  '并把 ' + BT('@deepseek-ai/schemastery') + ' 加进 peerDependencies。',
  '',
  '### 升级方式',
  '',
  '**设置 → 插件** 里卸载本插件，再用同一个 URL 重新添加（版本号已升到 1.0.1，不会被缓存挡住）：',
  '',
  BT3('https://github.com/' + OWNER + '/' + REPO),
  '',
  '### 顺带',
  '',
  '新增 ' + BT('scripts/load-sim.mjs') + '：复刻 Cordis 的 ' + BT('resolveConfig') + ' 流程，',
  '用来在发布前抓住这类「能 import 但加载即失败」的问题。',
].join('\n');

async function main() {
  const existing = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/releases/tags/${TAG}`, { headers: H });
  if (existing.status === 200) {
    const j = await existing.json();
    console.log('Release 已存在:', j.html_url);
    return;
  }

  const res = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/releases`, {
    method: 'POST',
    headers: H,
    body: JSON.stringify({
      tag_name: TAG,
      target_commitish: 'main',
      name: 'v1.0.1 — 修复插件显示「异常」',
      body: notes,
      draft: false,
      prerelease: false,
    }),
  });
  const j = await res.json();
  console.log('Release:', res.status, j.html_url ?? j.message);
  if (res.status !== 201) return;

  const tgz = 'dsh-plugin-workbuddy-checkin-1.0.1.tgz';
  if (!fs.existsSync(tgz)) { console.log('tarball 不存在，跳过上传'); return; }

  const data = fs.readFileSync(tgz);
  const up = await fetch(j.upload_url.replace('{?name,label}', '') + '?name=' + encodeURIComponent(tgz), {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + TOKEN,
      'Content-Type': 'application/octet-stream',
      'User-Agent': 'dsh-plugin-workbuddy-checkin',
    },
    body: data,
  });
  const uj = await up.json();
  console.log('附件:', up.status, uj.browser_download_url ?? uj.message);
}

main().catch((e) => { console.error('ERR', e.message); process.exit(1); });
