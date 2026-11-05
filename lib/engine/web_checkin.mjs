// WorkBuddy 每日签到 / 积分领取 —— 浏览器持久化登录态版
//
// 原理：不接触任何 token。用一份专用 Chrome 用户目录（.browser-profile）保存
// WorkBuddy 网页登录态的 Cookie；之后每次运行都在该 profile 里，分别以
// www.codebuddy.cn / www.workbuddy.cn 的同源 fetch 调用官方活动接口，
// 效果等同在网页里点「签到 / 领取 / 派猫猫」按钮。
//
// 用法：
//   node web_checkin.mjs --login   首次登录（弹出窗口，自己扫码登录，约 30 秒，只需一次）
//   node web_checkin.mjs --check   只读体检（不领取）
//   node web_checkin.mjs           正式领取（签到/任务/派猫猫/连签/抽奖）
//   node web_checkin.mjs --quiet   只输出一行结论（给计划任务用）
//
// 退出码：0 全部成功 / 1 有子步骤失败 / 2 未登录或网络失败
// 输出为脱敏 JSON，绝不包含 token 或 cookie 值。

import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROFILE_DIR = process.env.WB_BROWSER_PROFILE || path.join(HERE, '.browser-profile');
// 登录后主动导出的会话 Cookie（Chromium 的会话级 Cookie 默认不落盘，必须自己存）
const COOKIE_FILE = process.env.WB_COOKIE_FILE || path.join(PROFILE_DIR, 'session-cookies.json');
const CHROME = process.env.WB_CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BILLING_ORIGIN = (process.env.WB_BILLING_ORIGIN || 'https://www.codebuddy.cn').replace(/\/+$/, '');
// 实测：成长中心系列接口只在 www.codebuddy.cn 上认网页登录态；www.workbuddy.cn 全部 401
const ACT_ORIGIN = (process.env.WB_ACT_ORIGIN || 'https://www.codebuddy.cn').replace(/\/+$/, '');
const LOGIN_ORIGIN = (process.env.WB_LOGIN_ORIGIN || 'https://www.workbuddy.cn').replace(/\/+$/, '');
const VERSION = '1.1.0';

const ARGS = process.argv.slice(2);
const LOGIN = ARGS.includes('--login');
const CHECK = ARGS.includes('--check');
const QUIET = ARGS.includes('--quiet');

// 签到/积分账单类（codebuddy.cn）
const B = {
  status: '/v2/billing/meter/checkin-activity-status',
  claim: '/v2/billing/meter/daily-checkin',
};
// 成长中心活动类（workbuddy.cn）
const A = {
  tasks: '/v2/activity/growth/tasks',
  tasksAccept: '/activity/growth/tasks/accept',
  taskClaim: (c) => '/activity/growth/tasks/' + encodeURIComponent(c) + '/claim',
  travelStatus: '/activity/growth/buddy/travel/status',
  travelClaim: '/activity/growth/buddy/travel/claim',
  travelDepart: '/activity/growth/buddy/travel/depart',
  streak: '/activity/growth/streak',
  redeem: '/activity/growth/redeem',
  lotteryChances: '/activity/growth/lottery/chances',
  lotteryDraw: '/activity/growth/lottery/draw',
};

function note(...a) { if (!QUIET) console.error(...a); }
function uuid() { return crypto.randomUUID(); }
function dataOf(r) { return (r && r.json && r.json.data) || {}; }
function okOf(r) { return !!(r && r.status === 200 && r.json && r.json.code === 0); }
function msgOf(r) { return String((r && r.json && (r.json.msg || r.json.message)) || '').slice(0, 140); }

async function launch(headless) {
  fs.mkdirSync(PROFILE_DIR, { recursive: true });
  const useHeadless = process.env.WB_HEADFUL === '1' ? false : headless;
  // headless 模式默认 UA 带 HeadlessChrome，会被站点风控判成自动化 → 换成正常 Chrome UA
  const ua = process.env.WB_USER_AGENT ||
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36';
  return puppeteer.launch({
    executablePath: CHROME,
    headless: useHeadless ? 'new' : false,
    userDataDir: PROFILE_DIR,
    defaultViewport: null,
    args: [
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-features=ProfilePicker',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--lang=zh-CN',
      '--user-agent=' + ua,
      ...(useHeadless ? ['--disable-blink-features=AutomationControlled'] : []),
    ],
  });
}

// 每个源一个页面（同源 fetch 才能带上该源的 Cookie）
function makeClient(browser) {
  const pages = new Map();
  async function pageFor(origin) {
    if (pages.has(origin)) return pages.get(origin);
    const page = await browser.newPage();
    page.setDefaultTimeout(45000);
    await page.goto(origin + '/', { waitUntil: 'domcontentloaded' });
    pages.set(origin, page);
    return page;
  }
  async function call(origin, method, apiPath, body) {
    const page = await pageFor(origin);
    return page.evaluate(async ({ method, apiPath, body }) => {
      const init = {
        method,
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        credentials: 'include',
      };
      if (body !== undefined) init.body = JSON.stringify(body);
      const res = await fetch(apiPath, init);
      const text = await res.text();
      let json = null;
      try { json = JSON.parse(text); } catch { json = { _raw: text.slice(0, 160) }; }
      return { status: res.status, json };
    }, { method, apiPath, body });
  }
  return { call, pageFor, closePages: () => Promise.all([...pages.values()].map((p) => p.close())) };
}

async function authed(c) {
  const r = await c.call(BILLING_ORIGIN, 'POST', B.status, {});
  return { ok: okOf(r), http: r.status };
}

// ---------- 会话 Cookie 的导出 / 注入 ----------
function saveCookies(cookies) {
  const keep = cookies.filter((c) => /(^|\.)(workbuddy|codebuddy)\.(cn|ai)$/.test(c.domain) ||
    c.domain === 'www.workbuddy.cn' || c.domain === 'www.codebuddy.cn' ||
    c.domain === 'copilot.tencent.com');
  fs.mkdirSync(path.dirname(COOKIE_FILE), { recursive: true });
  fs.writeFileSync(COOKIE_FILE, JSON.stringify({ savedAt: new Date().toISOString(), cookies: keep }, null, 2), { mode: 0o600 });
  return keep.length;
}

async function restoreCookies(browser) {
  if (!fs.existsSync(COOKIE_FILE)) return 0;
  let obj;
  try { obj = JSON.parse(fs.readFileSync(COOKIE_FILE, 'utf8')); } catch { return 0; }
  const cookies = (obj.cookies || []).filter((c) => c && c.name && c.value);
  const page = await browser.newPage();
  await page.goto(LOGIN_ORIGIN + '/', { waitUntil: 'domcontentloaded' });
  let n = 0;
  for (const c of cookies) {
    try {
      await page.setCookie({
        name: c.name, value: c.value, domain: c.domain, path: c.path || '/',
        secure: !!c.secure, httpOnly: !!c.httpOnly,
        ...(c.expires && c.expires > 0 ? { expires: c.expires } : {}),
      });
      n++;
    } catch { /* 单个 cookie 失败不影响其它 */ }
  }
  await page.close();
  return n;
}

// ---------------- 登录 ----------------
async function doLogin() {
  const browser = await launch(false);
  try {
    const c = makeClient(browser);
    const page = await c.pageFor(LOGIN_ORIGIN + '').catch(() => null);
    if (!page) await c.pageFor(LOGIN_ORIGIN);
    note('已打开专用 Chrome 窗口（独立 profile，不影响你日常浏览器）。');
    note('请在这个窗口里完成 WorkBuddy 登录（微信/QQ 扫码或账号密码均可）。');
    note('检测到登录成功后窗口会自动关闭，之后每天免登录自动签到。');

    const deadline = Date.now() + 12 * 60 * 1000;
    let ok = false;
    let lastHttp = 0;
    let saved = 0;
    while (Date.now() < deadline) {
      try {
        const s = await authed(c);
        lastHttp = s.http;
        if (s.ok) {
          ok = true;
          // 登录成功：把会话 Cookie 落盘，供之后免登录使用
          saved = saveCookies(await browser.cookies());
          break;
        }
      } catch { /* 页面可能在跳转，重试 */ }
      await new Promise((r) => setTimeout(r, 2500));
    }
    console.log(JSON.stringify({
      version: VERSION,
      status: ok ? 'logged_in' : 'login_timeout',
      http: lastHttp,
      profile: PROFILE_DIR,
      cookies_saved: saved,
      cookie_file: COOKIE_FILE,
    }, null, 2));
    return ok ? 0 : 2;
  } finally {
    await browser.close();
  }
}

// ---------------- 只读体检 ----------------
async function doCheck(c) {
  const steps = {};
  const st = await c.call(BILLING_ORIGIN, 'POST', B.status, {});
  const d = dataOf(st);
  steps.checkin = {
    ok: okOf(st), http: st.status,
    today_checked_in: !!d.today_checked_in,
    streak_days: d.streak_days ?? null,
    daily_credit: d.daily_credit ?? null,
    activity_total_credits: d.total_credits ?? null,
  };
  const t = await c.call(ACT_ORIGIN, 'GET', A.tasks);
  const td = dataOf(t).tasks || [];
  steps.tasks = {
    ok: okOf(t), http: t.status, total: td.length,
    accept_pending: td.filter((x) => x.accept_status === 'not_accepted' && !x.locked).length,
    claim_pending: td.filter((x) => x.accept_status === 'completed').length,
    in_progress: td.filter((x) => x.accept_status === 'accepted').length,
    claimed: td.filter((x) => x.accept_status === 'claimed').length,
  };
  const tv = await c.call(ACT_ORIGIN, 'GET', A.travelStatus);
  steps.travel = { ok: okOf(tv), http: tv.status, state: dataOf(tv).state ?? null };
  const sk = await c.call(ACT_ORIGIN, 'GET', A.streak);
  steps.redeem = { ok: okOf(sk), http: sk.status };
  const lo = await c.call(ACT_ORIGIN, 'GET', A.lotteryChances);
  steps.lottery = { ok: okOf(lo), http: lo.status, chances: dataOf(lo).balance ?? null };
  return { status: steps.checkin.ok ? 'ready' : 'auth_failed', earned: 0, steps };
}

// ---------------- 正式领取 ----------------
async function doClaim(c) {
  const steps = {};
  const breakdown = { checkin: 0, tasks: 0, travel: 0, redeem: 0, lottery: 0 };
  let activityTotal = null;

  // 1) 每日签到
  try {
    const st = await c.call(BILLING_ORIGIN, 'POST', B.status, {});
    const d = dataOf(st);
    activityTotal = d.total_credits ?? null;
    if (d.today_checked_in) {
      steps.checkin = { ok: true, action: 'skip_already_signed', points: 0, streak_days: d.streak_days ?? null };
    } else {
      const r = await c.call(BILLING_ORIGIN, 'POST', B.claim, {});
      const rd = dataOf(r);
      if (okOf(r)) {
        const pts = rd.credit ?? d.daily_credit ?? 0;
        breakdown.checkin = pts;
        steps.checkin = { ok: true, action: 'claimed', points: pts, streak_days: rd.streak_days ?? d.streak_days ?? null };
      } else {
        const already = r.json && r.json.code === 10001;
        steps.checkin = { ok: already, action: already ? 'skip_already_signed' : 'failed', points: 0, http: r.status, msg: msgOf(r) };
      }
    }
  } catch (e) {
    steps.checkin = { ok: false, action: 'error', msg: String(e && e.message).slice(0, 140) };
  }

  // 2) 成长中心任务：先接取，再领已完成
  try {
    const list = await c.call(ACT_ORIGIN, 'GET', A.tasks);
    const tasks = dataOf(list).tasks || [];
    const toAccept = tasks.filter((x) => x.accept_status === 'not_accepted' && !x.locked).map((x) => x.task_code);
    let accepted = 0;
    for (let i = 0; i < toAccept.length; i += 10) {
      const r = await c.call(ACT_ORIGIN, 'POST', A.tasksAccept, { task_codes: toAccept.slice(i, i + 10) });
      accepted += (dataOf(r).results || []).filter((x) => x.status === 'accepted').length;
    }
    const toClaim = tasks.filter((x) => x.accept_status === 'completed').map((x) => x.task_code);
    let pts = 0;
    const failed = [];
    for (const code of toClaim) {
      const r = await c.call(ACT_ORIGIN, 'POST', A.taskClaim(code), {});
      if (okOf(r)) pts += (dataOf(r).credit ?? 0);
      else failed.push({ code, msg: msgOf(r) });
    }
    breakdown.tasks = pts;
    steps.tasks = {
      ok: failed.length === 0, accepted, claimed: toClaim.length - failed.length, points: pts,
      in_progress: tasks.filter((x) => x.accept_status === 'accepted').length,
      failed_count: failed.length, failed: failed.slice(0, 5),
    };
  } catch (e) {
    steps.tasks = { ok: false, msg: String(e && e.message).slice(0, 140) };
  }

  // 3) 派猫猫旅行
  try {
    const s = await c.call(ACT_ORIGIN, 'GET', A.travelStatus);
    const d = dataOf(s);
    let pts = 0;
    const actions = [];
    if (d.state === 'arrived') {
      const r = await c.call(ACT_ORIGIN, 'POST', A.travelClaim, {});
      if (okOf(r)) { pts += (dataOf(r).credit ?? 0); actions.push('claimed'); }
    }
    if (!d.daily_limit_reached && (d.state === 'idle' || d.state === 'arrived')) {
      const r = await c.call(ACT_ORIGIN, 'POST', A.travelDepart, {});
      if (okOf(r)) actions.push('departed');
    }
    breakdown.travel = pts;
    steps.travel = { ok: true, state: d.state ?? null, points: pts, actions };
  } catch (e) {
    steps.travel = { ok: false, msg: String(e && e.message).slice(0, 140) };
  }

  // 4) 连签里程碑兑换
  try {
    const s = await c.call(ACT_ORIGIN, 'GET', A.streak);
    const rs = dataOf(s).redemption_status || {};
    let pts = 0;
    const redeemed = [];
    for (const tier of ['7d', '14d', '28d']) {
      if (rs['tier_' + tier + '_status'] === 'available') {
        const r = await c.call(ACT_ORIGIN, 'POST', A.redeem, { tier, client_token: uuid() });
        if (okOf(r)) { pts += (dataOf(r).credit ?? 0); redeemed.push(tier); }
      }
    }
    breakdown.redeem = pts;
    steps.redeem = { ok: true, points: pts, redeemed };
  } catch (e) {
    steps.redeem = { ok: false, msg: String(e && e.message).slice(0, 140) };
  }

  // 5) 抽奖
  try {
    const ch = await c.call(ACT_ORIGIN, 'GET', A.lotteryChances);
    const balance = Math.min(dataOf(ch).balance ?? 0, 20);
    let pts = 0;
    let draws = 0;
    for (let i = 0; i < balance; i++) {
      const r = await c.call(ACT_ORIGIN, 'POST', A.lotteryDraw, { client_token: uuid() });
      if (okOf(r)) { pts += (dataOf(r).credit_amount ?? 0); draws++; } else break;
    }
    breakdown.lottery = pts;
    steps.lottery = { ok: true, draws, points: pts };
  } catch (e) {
    steps.lottery = { ok: false, msg: String(e && e.message).slice(0, 140) };
  }

  const earned = Object.values(breakdown).reduce((a, b) => a + b, 0);
  const anyFail = Object.keys(steps).some((k) => steps[k] && steps[k].ok === false);
  return {
    status: anyFail ? 'partial' : 'ok',
    dry_run: false,
    earned,
    earned_breakdown: breakdown,
    activity_total_credits: activityTotal,
    steps,
  };
}

function summaryLine(r, label) {
  const b = r.earned_breakdown || {};
  return label + ' status=' + r.status + ' earned=' + (r.earned || 0) +
    ' (checkin ' + (b.checkin || 0) + ' / tasks ' + (b.tasks || 0) + ' / travel ' + (b.travel || 0) +
    ' / redeem ' + (b.redeem || 0) + ' / lottery ' + (b.lottery || 0) + ')' +
    ' activity_total=' + (r.activity_total_credits ?? 'n/a');
}

async function main() {
  if (LOGIN) return doLogin();

  const browser = await launch(true);
  try {
    // 先把登录时导出的会话 Cookie 注入新 profile（Chromium 会话级 Cookie 不会自动落盘）
    const restored = await restoreCookies(browser);
    const c = makeClient(browser);
    const probe = await authed(c);
    if (!probe.ok) {
      console.log(JSON.stringify({
        version: VERSION,
        status: 'not_logged_in',
        http: probe.http,
        cookies_restored: restored,
        cookie_file_exists: fs.existsSync(COOKIE_FILE),
        hint: '登录态缺失或已过期，请重新运行：node web_checkin.mjs --login',
        dry_run: CHECK, earned: 0, steps: {},
      }, null, 2));
      return 2;
    }
    // 体检同时刷新一次落盘 Cookie，尽量延长免登录周期
    try { saveCookies(await browser.cookies()); } catch { /* 非关键 */ }
    const result = CHECK ? await doCheck(c) : await doClaim(c);
    result.version = VERSION;
    result.at = new Date().toISOString();
    if (QUIET) console.log(summaryLine(result, CHECK ? '[check]' : '[claim]'));
    else console.log(JSON.stringify(result, null, 2));
    return (result.status === 'ok' || result.status === 'ready') ? 0 : 1;
  } finally {
    await browser.close();
  }
}

main()
  .then((code) => process.exit(typeof code === 'number' ? code : 0))
  .catch((e) => {
    console.log(JSON.stringify({ version: VERSION, status: 'error', msg: String(e && e.message).slice(0, 200) }, null, 2));
    process.exit(1);
  });
