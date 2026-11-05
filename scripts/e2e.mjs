/**
 * 端到端自测：用真实 engine 跑一次 --check，验证工具真的能产出符合 schema 的结果。
 *
 * 不启动 DSH，只模拟 ctx.tools.register 收集定义，然后直接调用 execute。
 * 需要本机已登录（否则会得到 not_logged_in，这是合法结果，不算失败）。
 *
 * 运行：node scripts/e2e.mjs
 */

import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const asUrl = (p) => pathToFileURL(p).href;

const mod = await import(asUrl(join(ROOT, 'lib', 'index.js')));

const registered = [];
const ctx = {
  tools: {
    register(definition) {
      registered.push(definition);
      return () => {};
    },
  },
};

mod.apply(ctx, {});

const statusTool = registered.find((t) => t.name === 'workbuddy_checkin_status');
const claimTool = registered.find((t) => t.name === 'workbuddy_claim_credits');

if (!statusTool) {
  console.log('FAIL 没找到 workbuddy_checkin_status');
  process.exit(1);
}

const exec = { signal: new AbortController().signal, agent: undefined };

console.log('[e2e] 调用 workbuddy_checkin_status（真实引擎，只读）…');
const started = Date.now();
let result;
try {
  result = await statusTool.execute({}, exec);
} catch (error) {
  console.log(`FAIL execute 抛错：${error.message}`);
  process.exit(1);
}
const elapsed = Date.now() - started;

console.log(`[e2e] 耗时 ${elapsed}ms`);
console.log(JSON.stringify(result, null, 2));

// 校验返回是否满足自己的 output schema 里必填的 status
if (typeof result?.status !== 'string') {
  console.log('FAIL 返回缺少 status 字段');
  process.exit(1);
}

if (result.status === 'error') {
  console.log('\nFAIL 引擎报错，插件未就绪：');
  console.log(`  ${result.message}`);
  process.exit(1);
}

console.log('\n[e2e] 通过：体检工具返回了合法结果。');
console.log(`[e2e] 当前状态：${result.status}｜今日已签到：${result.checkedIn}｜连签 ${result.streakDays} 天`);

// 只读性验证：体检不应产生 earned
if (result.earned !== 0) {
  console.log(`\nFAIL 体检工具返回了 earned=${result.earned}，只读工具必须为 0`);
  process.exit(1);
}
console.log('[e2e] 通过：体检工具 earned 为 0（未触发领取）。');

if (claimTool) {
  console.log('\n[e2e] workbuddy_claim_credits 已注册（本次不实际执行，避免重复领取）。');
}
process.exit(0);
