/**
 * 通过 GitHub REST API 提交文件（git 直连不通时的兜底）。
 *
 * 用法：node scripts/api-commit.mjs <本地文件路径> <仓库内路径> "<提交信息>"
 */

import fs from 'node:fs';
import path from 'node:path';

const TOKEN = process.env.GH_TOKEN_LOCAL;
if (!TOKEN) { console.error('缺少 GH_TOKEN_LOCAL'); process.exit(2); }

const OWNER = 'cl2458228286-creator';
const REPO = 'dsh-plugin-workbuddy-checkin';
const [localPath, repoPath, message] = process.argv.slice(2);

if (!localPath || !repoPath) {
  console.error('用法: node scripts/api-commit.mjs <本地文件> <仓库内路径> "<信息>"');
  process.exit(2);
}

const H = {
  Authorization: 'Bearer ' + TOKEN,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'dsh-plugin-workbuddy-checkin',
  'Content-Type': 'application/json',
};

async function main() {
  const content = fs.readFileSync(localPath, 'utf8');

  // 1) 取远端当前文件（拿 sha；不存在则新建）
  const cur = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/contents/${repoPath}?ref=main`, { headers: H });
  let sha;
  if (cur.status === 200) {
    sha = (await cur.json()).sha;
    console.log('已存在，sha:', sha.slice(0, 8));
  } else {
    console.log('远端暂无此文件，将新建');
  }

  // 2) 提交
  const res = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/contents/${repoPath}`, {
    method: 'PUT',
    headers: H,
    body: JSON.stringify({
      message: message || `add ${repoPath}`,
      content: Buffer.from(content, 'utf8').toString('base64'),
      branch: 'main',
      ...(sha ? { sha } : {}),
    }),
  });
  const j = await res.json();
  if (res.status !== 200 && res.status !== 201) {
    console.log('提交失败:', res.status, j.message);
    process.exit(1);
  }
  console.log('提交成功:', j.commit.sha.slice(0, 8), '->', j.content.path);
}

main().catch((e) => { console.error('ERR', e.message); process.exit(1); });
