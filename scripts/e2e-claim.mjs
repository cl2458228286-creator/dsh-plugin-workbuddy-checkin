/**
 * 领取工具端到端验证：真实调用 workbuddy_claim_credits。
 *
 * 只在明确需要时运行（会真的领取积分）。默认打印将要做的事然后退出；
 * 加 --yes 才真跑。
 *
 * 运行：node scripts/e2e-claim.mjs --yes
 */

import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const INSTALLED = 'C:/Users/PC/.dsh/profiles/desktop/node_modules/dsh-plugin-workbuddy-checkin/lib/index.js';
const RUN = process.argv.includes('--yes');

const req = createRequire(INSTALLED);
const { default: _ } = await import(pathToFileURL(req.resolve('@deepseek-ai/dsh-tools')).href).catch(() => ({}));
const mod = await import(pathToFileURL(INSTALLED).href);

const registered = [];
mod.apply({ tools: { register: (d) => { registered.push(d); return () => {}; } } }, {});

const claimTool = registered.find((t) => t.name === 'workbuddy_claim_credits');
if (!claimTool) {
  console.log('FAIL 没找到 workbuddy_claim_credits');
  process.exit(1);
}

if (!RUN) {
  console.log('未实际领取。加 --yes 才会真的调用 workbuddy_claim_credits。');
  process.exit(0);
}

console.log('[e2e-claim] 真实调用 workbuddy_claim_credits …\n');
const exec = { signal: new AbortController().signal };
let result;
try {
  result = await claimTool.execute({}, exec);
} catch (error) {
  console.log(`FAIL execute 抛错：${error.message}`);
  process.exit(1);
}

console.log(JSON.stringify(result, null, 2));
console.log('\n[e2e-claim] 渲染：');
console.log(claimTool.output.render({}, result).map((c) => c.text).join('\n'));

if (result?.status === 'error') {
  console.log('\nFAIL 引擎报错。');
  process.exit(1);
}
if (result?.status === 'partial') {
  console.log('\n部分子步骤失败（属常见，例如任务进度未满）。');
}
console.log('\n[e2e-claim] 通过。');
process.exit(0);
