/**
 * 检查 GitHub 凭据的身份与权限范围。
 *
 * 输出：
 *   - 登录身份
 *   - X-OAuth-Scopes / X-Accepted-OAuth-Scopes（决定能否建 Release、写 Discussions、对别人的仓库开 PR）
 *
 * 绝不打印 token 本身。
 */

const token = process.env.GH_TOKEN_LOCAL;
if (!token) {
  console.error('缺少 GH_TOKEN_LOCAL');
  process.exit(2);
}

async function probe(label, url) {
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'dsh-plugin-workbuddy-checkin',
    },
  });
  const scopes = res.headers.get('x-oauth-scopes');
  const accepted = res.headers.get('x-accepted-oauth-scopes');
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* 非 JSON */ }
  return { label, status: res.status, scopes, accepted, json, text };
}

async function main() {
  const me = await probe('GET /user', 'https://api.github.com/user');
  console.log(`[身份] ${me.json?.login ?? '?'}  HTTP ${me.status}`);
  console.log(`  实际 scopes: ${me.scopes || '(未返回，可能是 GitHub App token)'}`);
  console.log(`  该接口要求: ${me.accepted || '(无)'}`);

  // 能否写 Discussions（GraphQL）
  const gql = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'dsh-plugin-workbuddy-checkin',
    },
    body: JSON.stringify({
      query: `query { viewer { login repository(name:"deepseek-harness", owner:"deepseek-ai") { discussionCategories(first:5){ nodes { id name } } hasDiscussionsEnabled } } }`,
    }),
  });
  const gqlJson = await gql.json();
  console.log(`\n[Discussions] HTTP ${gql.status}`);
  if (gqlJson.errors) {
    console.log('  错误:', JSON.stringify(gqlJson.errors).slice(0, 400));
  } else {
    const repo = gqlJson.data?.viewer?.repository;
    console.log('  hasDiscussionsEnabled:', repo?.hasDiscussionsEnabled);
    console.log('  分类:', (repo?.discussionCategories?.nodes ?? []).map((n) => n.name).join(', '));
  }

  // 能否对第三方仓库（awesome-dsh-plugin）发起 PR：需要能读、能 fork
  const third = await probe('GET /repos/awesome-dsh-plugin/awesome-dsh-plugin', 'https://api.github.com/repos/awesome-dsh-plugin/awesome-dsh-plugin');
  console.log(`\n[第三方仓库读取] HTTP ${third.status}  private=${third.json?.private}  default=${third.json?.default_branch}`);

  // 能否建 Release（用仓库信息判断权限，不实际创建）
  const repo = await probe('GET /repos/cl2458228286-creator/dsh-plugin-workbuddy-checkin', 'https://api.github.com/repos/cl2458228286-creator/dsh-plugin-workbuddy-checkin');
  console.log(`\n[本仓库权限] HTTP ${repo.status}`);
  console.log('  permissions:', JSON.stringify(repo.json?.permissions));
}

main().catch((e) => { console.error('ERR', e.message); process.exit(1); });
