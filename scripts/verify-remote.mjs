/**
 * 校验远端 main 是否包含「异常」修复所需的全部内容，并列出 releases。
 */

const TOKEN = process.env.GH_TOKEN_LOCAL;
if (!TOKEN) { console.error('缺少 GH_TOKEN_LOCAL'); process.exit(2); }

const OWNER = 'cl2458228286-creator';
const REPO = 'dsh-plugin-workbuddy-checkin';

const H = {
  Authorization: 'Bearer ' + TOKEN,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'dsh-plugin-workbuddy-checkin',
};

async function fileText(p) {
  const r = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/contents/${p}?ref=main`, { headers: H });
  if (r.status !== 200) return null;
  const j = await r.json();
  return Buffer.from(j.content, 'base64').toString('utf8');
}

async function main() {
  const pkgText = await fileText('package.json');
  const idxText = await fileText('lib/index.js');

  console.log('=== 远端 main 校验 ===');
  if (!pkgText) { console.log('package.json 读取失败'); return; }
  const pkg = JSON.parse(pkgText);
  console.log('version:', pkg.version);
  console.log('peerDependencies:', JSON.stringify(pkg.peerDependencies));

  if (!idxText) { console.log('lib/index.js 读取失败'); return; }
  const hasImport = idxText.includes("@deepseek-ai/schemastery");
  const hasSchemasteryConfig = idxText.includes('export const Config = z.object(');
  const hasPlainConfig = /export const Config = \{/.test(idxText);

  console.log('import schemastery:', hasImport ? 'YES' : 'NO');
  console.log('Config 用 z.object:', hasSchemasteryConfig ? 'YES' : 'NO');
  console.log('残留普通对象 Config:', hasPlainConfig ? 'YES（有问题）' : 'NO（已清理）');

  const i = idxText.indexOf('export const Config');
  console.log('\n=== Config 片段 ===');
  console.log(idxText.slice(Math.max(0, i - 30), i + 200));

  const rel = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/releases`, { headers: H }).then((r) => r.json());
  console.log('=== releases ===', rel.map((r) => r.tag_name).join(', '));
  for (const r of rel) {
    console.log(`  ${r.tag_name}: ${(r.assets ?? []).map((a) => a.name).join(', ') || '(无附件)'}`);
  }
}

main().catch((e) => { console.error('ERR', e.message); process.exit(1); });
