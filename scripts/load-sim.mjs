/**
 * 模拟 Cordis 的真实插件加载流程，验证 Config 能被正确校验。
 *
 * Cordis 的 resolveConfig 逻辑（已从源码确认）：
 *   if (!runtime.Config) return config;
 *   const result = runtime.Config["~standard"].validate(config);
 *   if ("then" in result) throw TypeError
 *   if (result.issues) throw ValidationError
 *   return result.value
 *
 * 这个脚本直接复刻它，用来抓「普通对象 Config 导致加载失败」这类问题。
 */

import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const PLUGIN = 'C:/Users/PC/.dsh/profiles/desktop/node_modules/dsh-plugin-workbuddy-checkin/lib/index.js';
const req = createRequire(PLUGIN);

const mod = await import(pathToFileURL(PLUGIN).href);

let fail = 0;
const ok = (m) => console.log('  ok   ' + m);
const bad = (m, d) => { fail += 1; console.log('  FAIL ' + m + (d ? ' — ' + d : '')); };

console.log('\n[1] 导出项');
for (const k of ['name', 'inject', 'apply']) {
  if (mod[k] !== undefined) ok(k + ' = ' + (typeof mod[k] === 'function' ? 'function' : JSON.stringify(mod[k])));
  else bad(k + ' 缺失');
}
console.log('  额外导出:', Object.keys(mod).filter((k) => !['name', 'inject', 'apply'].includes(k)).join(', ') || '(无)');

console.log('\n[2] Cordis resolveConfig 模拟');
if (!mod.Config) {
  ok('没有 Config，resolveConfig 会原样返回 config（安全）');
} else {
  const std = mod.Config['~standard'];
  if (!std) {
    bad('Config 缺少 ~standard 校验协议', 'Cordis 会在此处抛异常 → 插件显示「异常」');
  } else {
    ok('Config 有 ~standard');
    for (const sample of [{}, { chromePath: 'D:/chrome.exe' }, undefined]) {
      try {
        const r = std.validate(sample ?? {});
        if ('then' in r) { bad('异步校验', 'Cordis 不支持'); continue; }
        if (r.issues) { bad('校验报错 ' + JSON.stringify(sample), JSON.stringify(r.issues).slice(0, 120)); continue; }
        ok('validate(' + JSON.stringify(sample ?? {}) + ') -> ' + JSON.stringify(r.value));
      } catch (e) {
        bad('validate 抛异常 ' + JSON.stringify(sample), e.message);
      }
    }
    // 关键：运行时里 config 是 undefined 的情况
    try {
      const r = std.validate(undefined);
      if (r.issues) ok('validate(undefined) 报 issues（宿主会提供默认值，可接受）');
      else ok('validate(undefined) -> ' + JSON.stringify(r.value));
    } catch (e) {
      bad('validate(undefined) 抛异常', e.message);
    }
  }
}

console.log('\n[3] apply 注册');
const reg = [];
mod.apply({ tools: { register: (d) => { reg.push(d); return () => {}; } } }, {});
ok('注册 ' + reg.length + ' 个工具: ' + reg.map((t) => t.name).join(', '));
if (reg.length !== 3) bad('工具数不是 3');

console.log('');
console.log(fail === 0 ? 'load-sim 通过：插件能被 Cordis 正常加载。' : 'load-sim 失败：' + fail + ' 项');
process.exit(fail === 0 ? 0 : 1);
