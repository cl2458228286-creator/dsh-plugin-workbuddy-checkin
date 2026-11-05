/**
 * 市场准入自检：按 dsh.so 「接受标准」逐条核对本地包。
 *
 * 这不是官方检查器（官方在服务端拉取仓库后扫描），但覆盖了同一组硬性条件，
 * 用来在提交前把明显会被打回的问题先修掉。
 *
 * 运行：node scripts/market-check.mjs
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

let fails = 0;
let warns = 0;
const ok = (l, d = '') => console.log(`  ok   ${l}${d ? ' — ' + d : ''}`);
const bad = (l, d) => { fails += 1; console.log(`  FAIL ${l} — ${d}`); };
const warn = (l, d) => { warns += 1; console.log(`  warn ${l} — ${d}`); };

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

console.log('\n[A] DSH 兼容信号（至少其一）');
const signals = [];
if (pkg.dsh) signals.push('package.json 的 dsh 字段');
if (pkg.cordis || pkg['agent.cordis'] || pkg['dsh.plugin']) signals.push('cordis/dsh.plugin manifest');
if ((pkg.keywords ?? []).includes('dsh-plugin')) signals.push('topic/keyword dsh-plugin');
if (signals.length > 0) ok('兼容信号', signals.join(' / '));
else bad('缺少 DSH 兼容信号', '需要 dsh 字段或 dsh-plugin 关键词');

console.log('\n[B] README 带安装说明');
const readme = join(ROOT, 'README.md');
if (existsSync(readme)) {
  const text = readFileSync(readme, 'utf8');
  const hasInstall = /##[^\n]*安装/.test(text) || /dsh plugin/.test(text);
  if (hasInstall) ok('README 含安装说明', `${Math.round(text.length / 1024)} KB`);
  else bad('README 缺安装说明', '需要一节安装指引');
} else bad('README 缺失', readme);

console.log('\n[C] 开源许可证（SPDX 可识别）');
if (typeof pkg.license === 'string' && /^(MIT|Apache-2\.0|BSD-[23]-Clause|GPL-[23]\.0|ISC|MPL-2\.0)$/.test(pkg.license)) {
  ok('license 字段', pkg.license);
} else bad('license 不合规', String(pkg.license));
if (existsSync(join(ROOT, 'LICENSE'))) ok('LICENSE 文件存在');
else warn('LICENSE 文件缺失', '建议补一个');

console.log('\n[D] 插件 id 规范 ^[a-z0-9]+(-[a-z0-9]+)*$');
const id = pkg.name;
if (/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id)) ok('包名合规', id);
else bad('包名不合规', id);

console.log('\n[E] 源码可扫描');
const scanRoots = ['lib', 'scripts'];
let srcCount = 0;
for (const r of scanRoots) {
  const p = join(ROOT, r);
  if (!existsSync(p)) continue;
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(m?js|cjs|ts)$/.test(entry)) srcCount += 1;
    }
  };
  walk(p);
}
if (srcCount >= 3) ok('可扫描源码', `${srcCount} 个 JS 文件`);
else warn('源码偏少', `${srcCount} 个文件，检查器可能认为不足以分析`);

console.log('\n[F] 安全扫描预检');
const exclude = ['node_modules', '.git', '.browser-profile', 'logs'];
const files = [];
const walkAll = (dir) => {
  for (const entry of readdirSync(dir)) {
    if (exclude.includes(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walkAll(full);
    else if (/\.(m?js|cjs|json|yml|yaml|md)$/.test(entry)) files.push(full);
  }
};
walkAll(ROOT);

const SECRET = /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}|-----BEGIN [A-Z ]+PRIVATE KEY|AKIA[0-9A-Z]{16}/;
const EXFIL = /(https?:\/\/[a-zA-Z0-9._-]+)/g;
const DESTRUCTIVE = /\b(rmSync|rmdirSync|unlinkSync)\s*\(|\brm\s+-rf\b|\bdel\s+\/f\b/;

let secretHits = 0;
let destructiveHits = 0;
const domains = new Set();

for (const f of files) {
  const text = readFileSync(f, 'utf8');
  if (SECRET.test(text)) { secretHits += 1; bad(`硬编码密钥 ${relative(ROOT, f)}`, '阻断级'); }
  if (DESTRUCTIVE.test(text)) { destructiveHits += 1; warn(`破坏性操作 ${relative(ROOT, f)}`, '需人工复核'); }
  for (const m of text.matchAll(EXFIL)) domains.add(new URL(m[1]).host);
}
if (secretHits === 0) ok('无硬编码密钥');
if (destructiveHits === 0) ok('无破坏性操作');
else warn('存在破坏性操作调用', `${destructiveHits} 处`);

const ALLOWED = new Set([
  'www.workbuddy.cn',       // 签到 / 积分官方接口
  'www.codebuddy.cn',       // 成长中心官方接口
  'github.com',             // 文档里的仓库与讨论链接
  'json.schemastore.org',   // package.json 的 $schema
  'www.dsh.so',             // 市场提交页
  'registry.npmjs.org',     // npm 发布源
  'registry.npmmirror.com', // 本机 ~/.npmrc 镜像，不会进发布包
]);
console.log('\n[G] 出站域名审计');
for (const d of [...domains].sort()) {
  if (ALLOWED.has(d)) ok(`域名 ${d}`, '已在白名单');
  else warn(`域名 ${d}`, '不在预期白名单，需说明用途');
}

console.log('\n[H] 不打包登录态');
const packed = (pkg.files ?? []);
if (packed.some((p) => /browser-profile|cookies|\.env/.test(p))) bad('files 白名单含敏感路径', packed.join(', '));
else ok('files 白名单不含登录态/环境文件');
if (existsSync(join(ROOT, '.gitignore'))) {
  const gi = readFileSync(join(ROOT, '.gitignore'), 'utf8');
  if (/browser-profile|session-cookies/.test(gi)) ok('.gitignore 排除登录态');
  else warn('.gitignore 未排除登录态', '可能误提交凭据');
} else warn('.gitignore 缺失', '');

console.log(`\n${fails === 0 ? 'market-check 通过' : `market-check 失败：${fails} 项阻断`}${warns ? `（${warns} 项警告）` : ''}`);
process.exit(fails === 0 ? 0 : 1);
