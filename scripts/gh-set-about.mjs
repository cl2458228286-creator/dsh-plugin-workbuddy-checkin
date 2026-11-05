/**
 * 用 Git Credential Manager 已保存的凭据调用 GitHub API，
 * 给仓库写 description 和 topics（走 PATCH /repos/{owner}/{repo}）。
 *
 * 只做这两件事。凭据只从环境变量读取，绝不打印。
 *
 * 运行：powershell -File scripts/get-gh-credential.ps1 之后，
 *       node scripts/gh-set-about.mjs
 */

const OWNER = 'cl2458228286-creator';
const REPO = 'dsh-plugin-workbuddy-checkin';

const DESCRIPTION =
  'WorkBuddy daily auto check-in and credit claiming for DeepSeek Harness. '
  + 'Three agent tools (status / claim / login), bundled Chrome-driven engine, no tokens required.';

const TOPICS = [
  'dsh-plugin',
  'dsh',
  'deepseek-harness',
  'workbuddy',
  'checkin',
  'automation',
  'chrome',
  'cordis',
];

const token = process.env.GH_TOKEN_LOCAL;
if (!token) {
  console.error('缺少 GH_TOKEN_LOCAL。先运行 scripts/get-gh-credential.ps1（同一进程内）。');
  process.exit(2);
}

async function api(method, path, body) {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      'User-Agent': 'dsh-plugin-workbuddy-checkin',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* 非 JSON */ }
  return { status: res.status, json, text };
}

async function main() {
  // 0) 我是谁
  const me = await api('GET', '/user');
  console.log(`[0] 凭据身份: ${me.json?.login ?? 'unknown'} (HTTP ${me.status})`);
  if (me.status !== 200) {
    console.log('凭据无效或无权限，停止。');
    process.exit(1);
  }

  // 1) 当前状态
  const before = await api('GET', `/repos/${OWNER}/${REPO}`);
  console.log(`[1] 当前 description: ${JSON.stringify(before.json?.description ?? null)}`);
  console.log(`[1] 当前 topics: ${JSON.stringify(before.json?.topics ?? [])}`);

  // 2) PATCH description
  const patch = await api('PATCH', `/repos/${OWNER}/${REPO}`, { description: DESCRIPTION });
  console.log(`\n[2] 写 description: HTTP ${patch.status}`);
  if (patch.status === 200) {
    console.log(`    -> ${JSON.stringify(patch.json.description)}`);
  } else {
    console.log(`    -> ${patch.text.slice(0, 300)}`);
  }

  // 3) PUT topics
  const put = await api('PUT', `/repos/${OWNER}/${REPO}/topics`, { names: TOPICS });
  console.log(`\n[3] 写 topics: HTTP ${put.status}`);
  if (put.status === 200) {
    console.log(`    -> ${JSON.stringify(put.json.names)}`);
  } else {
    console.log(`    -> ${put.text.slice(0, 400)}`);
  }

  // 4) 复核
  const after = await api('GET', `/repos/${OWNER}/${REPO}`);
  console.log('\n[4] 复核');
  console.log(`    description: ${JSON.stringify(after.json?.description)}`);
  console.log(`    topics: ${JSON.stringify(after.json?.topics ?? [])}`);
}

main().catch((e) => { console.error('ERR', e.message); process.exit(1); });
