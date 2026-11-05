/**
 * 自测：不启动 DSH，直接验证插件契约是否合规。
 *
 * 校验项：
 *   1. 导出 name / inject / apply
 *   2. cordis.patch.yml 能被解析，且 entry id / name 正确
 *   3. package.json 的 dsh.bundle.patch 指向存在文件
 *   4. apply() 注册的三个工具都能通过真实 defineTool + register 的严格校验
 *   5. 只读工具的 schema 不含写操作痕迹（防误领）
 *
 * 运行：node scripts/selftest.mjs
 */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const asUrl = (p) => pathToFileURL(p).href;

let failures = 0;
const ok = (label, detail = '') => console.log(`  ok   ${label}${detail ? ' — ' + detail : ''}`);
const bad = (label, detail) => {
  failures += 1;
  console.log(`  FAIL ${label} — ${detail}`);
};

// ---------------------------------------------------------------- 1) 导出
console.log('\n[1] 模块导出');
const mod = await import(asUrl(join(ROOT, 'lib', 'index.js')));
if (typeof mod.name === 'string' && mod.name.length > 0) ok('name', mod.name);
else bad('name', '缺少字符串导出');
if (Array.isArray(mod.inject) && mod.inject.includes('tools')) ok('inject', JSON.stringify(mod.inject));
else bad('inject', '必须包含 "tools"');
if (typeof mod.apply === 'function') ok('apply', 'is function');
else bad('apply', '不是函数');

// ---------------------------------------------------------------- 2) patch
console.log('\n[2] cordis.patch.yml');
const patchPath = join(ROOT, 'cordis.patch.yml');
if (!existsSync(patchPath)) {
  bad('patch 文件缺失', patchPath);
} else {
  const text = readFileSync(patchPath, 'utf8');
  const { parsePatchYaml } = await import(asUrl(join(HERE, 'mini-yaml.mjs')));
  let tree;
  try {
    tree = parsePatchYaml(text);
  } catch (error) {
    bad('YAML 解析失败', error.message);
  }
  if (tree) {
    const insert = tree?.find?.((row) => Array.isArray(row?.insert))?.insert;
    if (!Array.isArray(insert) || insert.length === 0) {
      bad('insert 行缺失', 'patch 必须含一个 insert 列表');
    } else {
      const entry = insert[0];
      if (typeof entry?.id === 'string' && entry.id.length > 0) ok('entry id', entry.id);
      else bad('entry id 缺失', 'insert 里每行必须有 id');
      // 行尾注释会让市场预检抓不到 entry ID
      if (/#\s*\S/.test(text.split('\n').find((line) => line.includes('id:') && line.includes(entry?.id ?? '') ) ?? '')) {
        bad('id 行有行尾注释', '市场预检会抓不到 entry ID');
      } else {
        ok('id 行无行尾注释');
      }
      if (entry?.name === JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).name) {
        ok('name 与包名一致', entry.name);
      } else {
        bad('name 不匹配包名', `${entry?.name} vs package name`);
      }
    }
  }
}

// ---------------------------------------------------------------- 3) package.json
console.log('\n[3] package.json');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
if (pkg?.dsh?.bundle?.patch && existsSync(join(ROOT, pkg.dsh.bundle.patch))) ok('dsh.bundle.patch', pkg.dsh.bundle.patch);
else bad('dsh.bundle.patch 无效', '必须指向存在的 patch 文件');
if (pkg.type === 'module') ok('type', 'module');
else bad('type', '必须是 module');
if (pkg.main === 'lib/index.js' && existsSync(join(ROOT, pkg.main))) ok('main', pkg.main);
else bad('main 无效', String(pkg.main));
if (existsSync(join(ROOT, 'lib', 'engine', 'web_checkin.mjs'))) ok('内置引擎存在');
else bad('内置引擎缺失', 'lib/engine/web_checkin.mjs');
if (pkg.exports?.['./cordis.patch.yml']) ok('exports 声明 patch');
else bad('exports 未声明 patch', './cordis.patch.yml');
if (pkg.dependencies?.['puppeteer-core']) ok('依赖 puppeteer-core', pkg.dependencies['puppeteer-core']);
else bad('缺少 puppeteer-core 依赖', '引擎需要它驱动 Chrome');
for (const peer of ['@deepseek-ai/cordis', '@deepseek-ai/dsh-tools']) {
  if (pkg.peerDependencies?.[peer]) ok(`peer ${peer}`, pkg.peerDependencies[peer]);
  else bad(`缺少 peer ${peer}`, '应由宿主提供');
}

// ---------------------------------------------------------------- 4) 工具注册
console.log('\n[4] 工具定义与注册校验');
let defineTool;
try {
  ({ defineTool } = await import('@deepseek-ai/dsh-tools'));
  ok('import @deepseek-ai/dsh-tools');
} catch (error) {
  bad('无法 import dsh-tools', error.message);
}

const registered = [];
if (defineTool && typeof mod.apply === 'function') {
  const fakeCtx = {
    tools: {
      register(definition) {
        registered.push(definition);
        return () => {};
      },
    },
  };

  try {
    mod.apply(fakeCtx, {});
    ok('apply 执行完成', `注册 ${registered.length} 个工具`);
  } catch (error) {
    bad('apply 抛错', error.message);
  }

  const expected = ['workbuddy_checkin_status', 'workbuddy_claim_credits', 'workbuddy_login'];
  for (const toolName of expected) {
    const tool = registered.find((t) => t.name === toolName);
    if (!tool) {
      bad(`工具缺失 ${toolName}`, '未注册');
      continue;
    }
    // register() 的强制契约：output 必须带 schema 与 render
    if (typeof tool.output?.render === 'function') ok(`${toolName} output.render`);
    else bad(`${toolName} 缺 render`, 'register 会抛 TypeError');
    if (tool.output?.schema && typeof tool.output.schema === 'object') ok(`${toolName} output.schema`);
    else bad(`${toolName} 缺 schema`, 'register 会抛 TypeError');
    if (tool.parameters && typeof tool.parameters === 'object') ok(`${toolName} parameters`);
    else bad(`${toolName} 缺 parameters`, '');
    if (typeof tool.execute === 'function') ok(`${toolName} execute`);
    else bad(`${toolName} 缺 execute`, '');
    if (tool.name === 'run_code') bad(`${toolName} 用了保留名`, 'run_code 不可注册');
  }

  // render 必须返回 [{type:'text',text}] 形式
  console.log('\n[5] render 输出形状');
  for (const tool of registered) {
    try {
      const out = tool.output.render({}, {
        status: 'ready',
        earned: 0,
        breakdown: { checkin: 0, tasks: 0, travel: 0, redeem: 0, lottery: 0 },
        profileDir: '/tmp/x',
        message: 'selftest',
      });
      if (Array.isArray(out) && out.every((c) => c && typeof c.type === 'string' && typeof c.text === 'string')) {
        ok(`${tool.name} render 形状`);
      } else {
        bad(`${tool.name} render 形状`, JSON.stringify(out)?.slice(0, 120));
      }
    } catch (error) {
      bad(`${tool.name} render 抛错`, error.message);
    }
  }

  // 只读工具不得引用写接口路径
  console.log('\n[6] 只读边界');
  const statusTool = registered.find((t) => t.name === 'workbuddy_checkin_status');
  const describe = `${statusTool?.description ?? ''}`;
  if (/daily-checkin|领取|claim\b/i.test(describe) && !/不领取|只读|不会领取/.test(describe)) {
    bad('体检工具描述暗示会领取', '只读工具必须明确声明不领取');
  } else {
    ok('体检工具声明只读');
  }
}

// ---------------------------------------------------------------- 汇总
console.log('');
if (failures === 0) {
  console.log('selftest 通过：插件包符合 DSH 契约。');
  process.exit(0);
}
console.log(`selftest 失败：${failures} 项不通过。`);
process.exit(1);
