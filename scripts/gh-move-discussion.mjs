/**
 * 把已发布的 Discussion 移到更合适的分类（Show Your Plugins!）。
 *
 * 用 updateDiscussion mutation。
 */

const TOKEN = process.env.GH_TOKEN_LOCAL;
if (!TOKEN) { console.error('缺少 GH_TOKEN_LOCAL'); process.exit(2); }

const HEADERS = {
  Authorization: `Bearer ${TOKEN}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'dsh-plugin-workbuddy-checkin',
  'Content-Type': 'application/json',
};

async function graphql(query, variables) {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({ query, variables }),
  });
  return { status: res.status, json: await res.json() };
}

async function main() {
  // 1) 读仓库 + 分类 + 我们那条 discussion
  const q = [
    'query($owner: String!, $name: String!, $num: Int!) {',
    '  repository(owner: $owner, name: $name) {',
    '    id',
    '    discussionCategories(first: 20) { nodes { id name slug } }',
    '    discussion(number: $num) { id title category { id name slug } url }',
    '  }',
    '}',
  ].join('\n');

  const r = await graphql(q, { owner: 'deepseek-ai', name: 'deepseek-harness', num: 12227 });
  if (r.json.errors) { console.log('查询失败:', JSON.stringify(r.json.errors).slice(0, 400)); return; }

  const repo = r.json.data.repository;
  const disc = repo.discussion;
  console.log('当前分类:', disc.category.name, '(' + disc.category.slug + ')');
  console.log('标题:', disc.title);

  const target = repo.discussionCategories.nodes.find((c) => /show-your-plugins/i.test(c.slug));
  if (!target) { console.log('未找到 Show Your Plugins 分类'); return; }
  console.log('目标分类:', target.name, '(' + target.slug + ')');

  if (disc.category.id === target.id) { console.log('已经是目标分类，跳过'); return; }

  // 2) 移动
  const m = [
    'mutation($discussionId: ID!, $categoryId: ID!) {',
    '  updateDiscussion(input: { discussionId: $discussionId, categoryId: $categoryId }) {',
    '    discussion { url title category { name slug } }',
    '  }',
    '}',
  ].join('\n');

  const res = await graphql(m, { discussionId: disc.id, categoryId: target.id });
  if (res.json.errors) {
    console.log('移动失败:', JSON.stringify(res.json.errors).slice(0, 500));
    return;
  }
  const d = res.json.data.updateDiscussion.discussion;
  console.log('已移动 ->', d.category.name, '(' + d.category.slug + ')');
  console.log('URL:', d.url);
}

main().catch((e) => { console.error('ERR', e.message); process.exit(1); });
