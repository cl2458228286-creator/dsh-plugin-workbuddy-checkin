// 提交到 dsh.so，自动处理 429 upstream-rate-limited（等服务端 retryAfter 再重试）。
//
// 429 来自上游（多半是 GitHub API 的频率限制），不是本地问题。策略：
// 每次失败读 retryAfter（默认 60s），等待后重新走一遍「检查 → 提交」。

import puppeteer from 'puppeteer-core';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PROFILE = 'D:\\project\\autoware\\workbuddy-checkin\\.browser-profile';
const REPO = 'github.com/cl2458228286-creator/dsh-plugin-workbuddy-checkin';
const MAX_ATTEMPTS = 8;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  userDataDir: PROFILE,
  args: ['--no-first-run', '--no-default-browser-check', '--lang=zh-CN',
    '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36'],
});

try {
  const page = await browser.newPage();

  // 用页面自己的 fetch 提交（保持同源与任何需要的头）
  let lastResponse = null;
  page.on('response', async (res) => {
    if (res.url().endsWith('/api/submit') && res.request().method() === 'POST') {
      try { lastResponse = { status: res.status(), body: await res.text() }; } catch { /* ignore */ }
    }
  });

  async function runAttempt(attempt) {
    lastResponse = null;
    await page.goto('https://www.dsh.so/zh/submit/', { waitUntil: 'networkidle2', timeout: 60000 });
    await page.waitForSelector('#ps-repo-input', { timeout: 20000 });
    await page.click('#ps-repo-input');
    await page.type('#ps-repo-input', REPO, { delay: 40 });
    const radios = await page.$$('input[name="ps-kind"]');
    if (radios.length > 0) await radios[0].click();

    await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll('button, [role="button"]'))
        .find((el) => /开始检查/.test((el.textContent || '').trim()));
      if (b) b.click();
    });

    for (let i = 0; i < 120; i += 1) {
      await sleep(1500);
      const st = await page.evaluate(() => {
        const t = document.body.innerText || '';
        return { still: /检查中|Checking/.test(t), canSubmit: /提交到 dsh\.so/.test(t) };
      });
      if (!st.still && st.canSubmit) break;
      if (i === 119) return { ok: false, reason: 'check-timeout' };
    }

    await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll('button, [role="button"]'))
        .find((el) => /提交到 dsh\.so/.test((el.textContent || '').trim()));
      if (b) { b.scrollIntoView({ block: 'center' }); b.click(); }
    });

    // 等提交请求返回
    for (let i = 0; i < 80; i += 1) {
      await sleep(1000);
      if (lastResponse) break;
    }
    return { ok: lastResponse?.status === 200, response: lastResponse };
  }

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    console.log(`\n[尝试 ${attempt}/${MAX_ATTEMPTS}]`);
    const r = await runAttempt(attempt);
    console.log('  结果：', r.reason ?? `HTTP ${r.response?.status}`);
    console.log('  响应：', (r.response?.body ?? '').slice(0, 700));

    if (r.ok) {
      console.log('\n✅ 提交成功');
      process.exitCode = 0;
      break;
    }

    // 429 → 按 retryAfter 等待
    let wait = 70;
    try {
      const j = JSON.parse(r.response?.body ?? '{}');
      if (typeof j.retryAfter === 'number') wait = j.retryAfter + 15;
    } catch { /* 用默认 */ }
    if (attempt === MAX_ATTEMPTS) { console.log('\n❌ 达到最大重试次数'); process.exitCode = 1; break; }
    console.log(`  等待 ${wait}s 后重试…`);
    await sleep(wait * 1000);
  }
} finally {
  await browser.close();
}
