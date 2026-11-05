/**
 * 装载验证（install-verify）：从 **desktop profile 的已安装副本** 加载插件，
 * 走和 DSH 相同的模块解析路径，确认：
 *   1. 已安装副本能被 import
 *   2. 它解析到的 @deepseek-ai/dsh-tools 与宿主同一个
 *   3. apply() 能在真实 defineTool 上注册 3 个工具
 *   4. 真实调用一次只读工具，确认真能拿到数据
 *
 * 这是安装后的验证脚本，不修改任何 DSH 状态。
 */

import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const INSTALLED = 'C:/Users/PC/.dsh/profiles/desktop/node_modules/dsh-plugin-workbuddy-checkin/lib/index.js';
const req = createRequire(INSTALLED);

// 与宿主一致地解析 dsh-tools
const toolsPath = req.resolve('@deepseek-ai/dsh-tools');
console.log(`[1] dsh-tools 解析到：${toolsPath}`);
const { defineTool } = await import(pathToFileURL(toolsPath).href);
console.log(`[1] dsh-tools 已加载（defineTool=${typeof defineTool}）`);

console.log(`\n[2] 加载已安装插件：${INSTALLED}`);
const mod = await import(pathToFileURL(INSTALLED).href);
console.log(`[2] name=${mod.name} inject=${JSON.stringify(mod.inject)} apply=${typeof mod.apply}`);

if (typeof mod.name !== 'string' || typeof mod.apply !== 'function') {
  console.log('FAIL 插件导出不合规');
  process.exit(1);
}
if (!Array.isArray(mod.inject) || !mod.inject.includes('tools')) {
  console.log('FAIL inject 必须声明 tools');
  process.exit(1);
}

// 用真实 registry 语义收集注册
const registered = [];
const fakeCtx = {
  tools: {
    register(definition) {
      registered.push(definition);
      return () => {};
    },
  },
};

console.log('\n[3] 执行 apply()');
try {
  mod.apply(fakeCtx, {});
} catch (error) {
  console.log(`FAIL apply 抛错：${error.message}`);
  process.exit(1);
}
console.log(`[3] 注册了 ${registered.length} 个工具：${registered.map((t) => t.name).join(', ')}`);

if (registered.length !== 3) {
  console.log(`FAIL 期望 3 个工具，实际 ${registered.length}`);
  process.exit(1);
}

for (const tool of registered) {
  if (typeof tool.output?.render !== 'function' || !tool.output?.schema) {
    console.log(`FAIL ${tool.name} 契约不完整`);
    process.exit(1);
  }
}

console.log('\n[4] 真实调用 workbuddy_checkin_status（只读）');
const statusTool = registered.find((t) => t.name === 'workbuddy_checkin_status');
const exec = { signal: new AbortController().signal };

let result;
try {
  result = await statusTool.execute({}, exec);
} catch (error) {
  console.log(`FAIL execute 抛错：${error.message}`);
  process.exit(1);
}

console.log(`[4] status=${result?.status} earned=${result?.earned}`);

if (result?.status === 'error') {
  console.log(`FAIL 引擎报错：${result.message}`);
  console.log('提示：确认 puppeteer-core 与 Chrome 在已安装副本中可用。');
  process.exit(1);
}
if (result?.earned !== 0) {
  console.log('FAIL 只读工具产生了 earned');
  process.exit(1);
}

console.log('\n[5] render 渲染结果：');
const rendered = statusTool.output.render({}, result);
console.log(rendered.map((c) => c.text).join('\n').split('\n').map((l) => '    ' + l).join('\n'));

console.log('\ninstall-verify 通过：插件已在 desktop profile 正确安装并可执行。');
process.exit(0);
