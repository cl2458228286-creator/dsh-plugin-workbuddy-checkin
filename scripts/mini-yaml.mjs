/**
 * 极简 YAML 子集解析器：只覆盖 cordis.patch.yml 用到的形状
 * （顶层数组、insert 列表、标量键值）。避免为自测引入 yaml 依赖。
 *
 * 支持：
 *   - insert:
 *       - id: xxx
 *         name: 'yyy'
 *   - id: xxx
 *     name: yyy
 *     config: ...
 *
 * 不支持嵌套 map/list（本插件用不到）。
 */

export function parsePatchYaml(text) {
  const rows = [];
  let current = null;
  let insert = null;
  let inInsert = false;

  for (const raw of text.split('\n')) {
    if (raw.trim() === '' || raw.trimStart().startsWith('#')) continue;
    const indent = raw.length - raw.trimStart().length;
    const line = raw.trim();

    if (/^- insert:\s*$/.test(line)) {
      insert = [];
      rows.push({ insert });
      inInsert = true;
      current = null;
      continue;
    }

    if (inInsert) {
      // insert 内的子项：缩进 4 的 "- id: x"
      const m = /^- ([\w$-]+):\s*(.*)$/.exec(line);
      if (m && indent >= 4) {
        current = { [m[1]]: stripValue(m[2]) };
        insert.push(current);
        continue;
      }
      // insert 内的续行："name: x"
      const kv = /^([\w$-]+):\s*(.*)$/.exec(line);
      if (kv && indent >= 6 && current) {
        current[kv[1]] = stripValue(kv[2]);
        continue;
      }
    }

    // 顶层行
    const top = /^- ([\w$-]+):\s*(.*)$/.exec(line);
    if (top && indent === 0) {
      current = { [top[1]]: stripValue(top[2]) };
      rows.push(current);
      inInsert = false;
      continue;
    }
    const topkv = /^([\w$-]+):\s*(.*)$/.exec(line);
    if (topkv && indent === 0) {
      if (!current) {
        current = {};
        rows.push(current);
      }
      current[topkv[1]] = stripValue(topkv[2]);
    }
  }

  // 清理空对象
  return rows.filter((r) => Object.keys(r).length > 0);
}

function stripValue(raw) {
  let v = raw.trim();
  if (v === '') return undefined;
  // 去掉行尾注释（不在引号内的 #）
  let inQuote = null;
  for (let i = 0; i < v.length; i += 1) {
    const ch = v[i];
    if (inQuote) {
      if (ch === inQuote) inQuote = null;
    } else if (ch === '"' || ch === "'") {
      inQuote = ch;
    } else if (ch === '#' && (i === 0 || /\s/.test(v[i - 1]))) {
      v = v.slice(0, i).trim();
      break;
    }
  }
  if ((v.startsWith("'") && v.endsWith("'")) || (v.startsWith('"') && v.endsWith('"'))) {
    return v.slice(1, -1);
  }
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v === 'null' || v === '~') return null;
  if (/^-?\d+$/.test(v)) return Number(v);
  return v;
}
