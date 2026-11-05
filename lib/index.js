/**
 * dsh-plugin-workbuddy-checkin — WorkBuddy 每日签到 / 领积分。
 *
 * 通过宿主提供的 @deepseek-ai/dsh-tools 的 defineTool 注册三个工具：
 *   - workbuddy_checkin_status  只读体检，不领取
 *   - workbuddy_claim_credits   正式领取（签到 / 任务 / 派猫猫 / 连签 / 抽奖）
 *   - workbuddy_login           首次或掉线后打开专用 Chrome 登录一次
 *
 * 引擎 lib/engine/web_checkin.mjs 随包分发，用 puppeteer-core 驱动本机 Chrome，
 * 以一份独立 profile 保存 WorkBuddy 网页登录态（不接触任何 token）。
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineTool } from '@deepseek-ai/dsh-tools';
import z from '@deepseek-ai/schemastery';

/** Cordis 插件身份。 */
export const name = 'workbuddy-checkin';

/** 依赖的宿主服务：只要工具注册表。 */
export const inject = ['tools'];

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(HERE, '..');
const ENGINE = join(HERE, 'engine', 'web_checkin.mjs');

/** 用户数据目录（登录态放这里，不放包内：包目录可能只读或在升级时被替换）。 */
const DATA_HOME = join(homedir(), '.workbuddy-checkin');
const PROFILE_DIR = process.env.WB_BROWSER_PROFILE || join(DATA_HOME, 'browser-profile');
const COOKIE_FILE = process.env.WB_COOKIE_FILE || join(PROFILE_DIR, 'session-cookies.json');

/**
 * 已有登录态的兼容回退：如果用户之前用独立脚本（例如
 * ~/.workbuddy-checkin 尚未初始化）已经在别的目录登录过，复用那份 profile，
 * 避免明明登录过却还要再扫一次码。只在默认目录尚不存在时启用。
 */
const LEGACY_PROFILE_CANDIDATES = [
  join(homedir(), '.workbuddy-checkin', 'browser-profile'),
  'D:\\project\\autoware\\workbuddy-checkin\\.browser-profile',
];

const DEFAULT_CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BUNDLED_NODE = join(homedir(), '.workbuddy', 'binaries', 'node', 'versions', '22.22.2-6', 'node.exe');

/** 引擎跑一次的最长等待（领取与体检）。 */
const RUN_TIMEOUT_MS = 3 * 60 * 1000;
/** 登录会一直等到用户扫完码，给足时间。 */
const LOGIN_CALL_TIMEOUT_MS = 15 * 60 * 1000;
const LOGIN_PROCESS_TIMEOUT_MS = 13 * 60 * 1000;

// ---------------------------------------------------------------- 运行时解析

function isFile(p) {
  try {
    return existsSync(p);
  } catch {
    return false;
  }
}

/**
 * puppeteer-core 的位置。
 *
 * 用 Node 的模块解析（而不是只看包内 node_modules），因为 pnpm 安装到 profile 后
 * 依赖会被提升到上层 node_modules（本包 node_modules 里可能没有实体目录）。
 *
 * @returns 解析到 package.json 的绝对路径；解析失败返回 undefined。
 */
function resolvePuppeteerManifest() {
  const requireFromHere = createRequire(import.meta.url);
  try {
    return requireFromHere.resolve('puppeteer-core/package.json');
  } catch {
    return undefined;
  }
}

/** 依次尝试：显式配置 → 环境变量 → WorkBuddy 自带 node → 系统 node。 */
function resolveNode(configured) {
  const candidates = [];
  if (typeof configured === 'string' && configured.trim() !== '') candidates.push(configured.trim());
  if (process.env.WORKBUDDY_NODE) candidates.push(process.env.WORKBUDDY_NODE.trim());
  candidates.push(BUNDLED_NODE);
  // 宿主自身就是 Node/Electron-as-node 时可以直接复用；否则退到 PATH 上的 node。
  candidates.push(process.execPath);
  for (const c of candidates) {
    if (c && isFile(c)) return c;
  }
  return 'node';
}

function resolveChrome(configured) {
  if (typeof configured === 'string' && configured.trim() !== '') return configured.trim();
  if (process.env.WB_CHROME_PATH) return process.env.WB_CHROME_PATH.trim();
  return DEFAULT_CHROME;
}

/** 保证数据目录存在（首次运行）；默认目录为空时先尝试复用已有登录态。 */
function ensureDataDirs() {
  try {
    mkdirSync(PROFILE_DIR, { recursive: true });
  } catch (error) {
    throw new Error(
      `workbuddy-checkin: 无法创建登录态目录 ${PROFILE_DIR}（${error?.code ?? error}）。` +
      ' 检查该路径的写权限，或用环境变量 WB_BROWSER_PROFILE 指向一个可写目录。',
    );
  }
}

/** 实际生效的登录态目录：默认目录里没有 cookie 文件时，回退到已有的旧目录。 */
function effectiveProfile() {
  const explicit = process.env.WB_BROWSER_PROFILE;
  if (explicit) return { profile: explicit, cookie: process.env.WB_COOKIE_FILE || join(explicit, 'session-cookies.json') };

  const defaultCookie = join(PROFILE_DIR, 'session-cookies.json');
  if (isFile(defaultCookie)) return { profile: PROFILE_DIR, cookie: defaultCookie };

  for (const candidate of LEGACY_PROFILE_CANDIDATES) {
    const cookie = join(candidate, 'session-cookies.json');
    if (isFile(cookie)) return { profile: candidate, cookie };
  }
  return { profile: PROFILE_DIR, cookie: defaultCookie };
}

// ---------------------------------------------------------------- 引擎调用

/**
 * 跑一次引擎，拿到它 stdout 的 JSON（或 --quiet 的单行摘要）。
 *
 * @param {string[]} argv 引擎参数。
 * @param {object} options 运行时选项。
 * @param {number} options.timeoutMs 进程超时。
 * @param {AbortSignal} [options.signal] 调用方取消信号。
 * @param {boolean} [options.raw] 是否需要非 JSON 原始输出（登录模式）。
 */
function runEngine(argv, options) {
  const node = resolveNode(options.nodeExecutable);
  const chrome = resolveChrome(options.chromePath);
  const { profile, cookie } = effectiveProfile();
  const env = {
    ...process.env,
    WB_BROWSER_PROFILE: profile,
    WB_COOKIE_FILE: cookie,
    WB_CHROME_PATH: chrome,
  };

  return new Promise((resolvePromise, rejectPromise) => {
    let child;
    try {
      child = spawn(node, [ENGINE, ...argv], { env, windowsHide: true });
    } catch (error) {
      rejectPromise(error);
      return;
    }

    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (options.signal) options.signal.removeEventListener('abort', onAbort);
      if (error) rejectPromise(error);
      else resolvePromise(value);
    };

    const kill = (reason) => {
      try {
        child.kill();
      } catch {
        /* 已经退出 */
      }
      finish(new Error(reason));
    };

    const timer = setTimeout(
      () => kill(`workbuddy-checkin: 引擎超时（超过 ${Math.round(options.timeoutMs / 1000)} 秒）。`),
      options.timeoutMs,
    );

    const onAbort = () => kill('workbuddy-checkin: 调用已取消。');
    if (options.signal) {
      if (options.signal.aborted) {
        kill('workbuddy-checkin: 调用已取消。');
        return;
      }
      options.signal.addEventListener('abort', onAbort, { once: true });
    }

    child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
    child.on('error', (error) => {
      finish(new Error(`workbuddy-checkin: 无法启动 node（${node}）：${error.message}`));
    });
    child.on('close', (code) => {
      finish(null, { code: code ?? -1, stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}

/** 把引擎输出解析成对象；失败时给出可读诊断。 */
function parseEngineOutput(run, argv) {
  const { code, stdout, stderr } = run;

  if (stdout.startsWith('{')) {
    try {
      return { ok: true, exitCode: code, result: JSON.parse(stdout) };
    } catch {
      return {
        ok: false,
        exitCode: code,
        result: null,
        detail: '引擎返回了无法解析的 JSON。',
      };
    }
  }

  // 引擎在依赖/环境问题时会写 stderr 并给非 0 退出码。
  const firstLine = stdout.split('\n').map((l) => l.trim()).find(Boolean) || '';
  const detail = [stderr, firstLine].filter(Boolean).join(' | ').slice(0, 400);
  return { ok: false, exitCode: code, result: null, detail: detail || `引擎退出码 ${code}，没有输出。` };
}

/** 引擎的输出永远不含凭据；这里只按白名单取出要回给模型的字段。 */
function pickSteps(result) {
  const steps = result?.steps;
  if (!steps || typeof steps !== 'object') return null;
  const out = {};
  for (const key of ['checkin', 'tasks', 'travel', 'redeem', 'lottery']) {
    const step = steps[key];
    if (!step || typeof step !== 'object') continue;
    out[key] = step;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** 常见问题的下一步提示。 */
function nextStepFor(result) {
  const status = result?.status;
  if (status === 'not_logged_in') {
    return '登录态缺失或已过期：调用 workbuddy_login 在弹出的 Chrome 窗口里扫码登录一次，之后可长期免登录。';
  }
  if (status === 'auth_failed') {
    return '接口拒绝当前登录态：先调用 workbuddy_login 重新登录；仍失败则确认账号是否正常。';
  }
  if (status === 'partial') {
    return '有子步骤失败，见 steps 里 ok=false 的项；多数是任务进度未满（属正常拦截）或登录态半失效。';
  }
  return undefined;
}

// ---------------------------------------------------------------- 输出渲染

function renderReport(label, value) {
  const lines = [];
  const b = value.breakdown ?? {};
  if (value.status === 'not_logged_in') {
    lines.push(`${label}：未登录（HTTP ${value.http ?? 'n/a'}）。`);
  } else {
    lines.push(`${label}：status=${value.status} 本次获得 ${value.earned ?? 0} 分`);
    lines.push(
      `  签到 ${b.checkin ?? 0} ｜ 任务 ${b.tasks ?? 0} ｜ 旅行 ${b.travel ?? 0} ｜ ` +
      `连签 ${b.redeem ?? 0} ｜ 抽奖 ${b.lottery ?? 0}`,
    );
    if (value.activityTotal !== null && value.activityTotal !== undefined) {
      lines.push(`  加油站活动累计：${value.activityTotal}（不是账户余额）`);
    }
    if (value.checkedIn !== undefined) {
      lines.push(`  今日已签到：${value.checkedIn ? '是' : '否'}${value.streakDays != null ? `（连签 ${value.streakDays} 天）` : ''}`);
    }
    if (value.tasks) {
      const t = value.tasks;
      const parts = [];
      if (t.total != null) parts.push(`共 ${t.total} 个`);
      if (t.acceptPending != null) parts.push(`待接取 ${t.acceptPending}`);
      if (t.claimPending != null) parts.push(`待领取 ${t.claimPending}`);
      if (t.inProgress != null) parts.push(`进行中 ${t.inProgress}`);
      if (t.claimed != null) parts.push(`已领 ${t.claimed}`);
      if (parts.length) lines.push(`  成长中心任务：${parts.join('，')}`);
    }
    if (value.travelState) lines.push(`  派猫猫状态：${value.travelState}`);
    if (value.lotteryChances != null) lines.push(`  抽奖次数：${value.lotteryChances}`);
  }
  if (value.message) lines.push(`  ${value.message}`);
  if (value.nextStep) lines.push(`  → ${value.nextStep}`);
  return [{ type: 'text', text: lines.join('\n') }];
}

// ---------------------------------------------------------------- 工具定义

/**
 * 注册三个 WorkBuddy 工具。
 *
 * @param ctx 承载 `tools` 注册表的上下文。
 * @param config 部署配置。
 */
export function apply(ctx, config = {}) {
  const runtime = {
    nodeExecutable: config.nodeExecutable,
    chromePath: config.chromePath,
  };

  /** 引擎前置检查：包内引擎与依赖是否就位。 */
  const assertReady = () => {
    if (!isFile(ENGINE)) {
      throw new Error(
        `workbuddy-checkin: 找不到包内引擎 ${ENGINE}。` +
        ' 这个包必须连同 lib/engine/web_checkin.mjs 一起分发；若只拷贝了 package.json 请重新安装完整包。',
      );
    }
    if (resolvePuppeteerManifest() === undefined) {
      throw new Error(
        'workbuddy-checkin: 无法解析依赖 puppeteer-core。' +
        ` 请在 DSH profile 目录（或本包目录 ${PKG_ROOT}）运行包管理器安装后重试，` +
        '或重新执行 dsh plugin add。',
      );
    }
    ensureDataDirs();
  };

  const commonOutput = (dataSchemaExtra = {}) => ({
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        status: {
          type: 'string',
          required: true,
          description: 'ready / ok / partial / not_logged_in / auth_failed / error',
        },
        earned: { type: 'integer', description: '本次服务端确认发放的积分之和' },
        breakdown: {
          type: 'object',
          additionalProperties: false,
          description: '按来源拆分的明细',
          properties: {
            checkin: { type: 'integer' },
            tasks: { type: 'integer' },
            travel: { type: 'integer' },
            redeem: { type: 'integer' },
            lottery: { type: 'integer' },
          },
        },
        activityTotal: { type: 'integer', description: '加油站活动累计（不是账户余额）' },
        ...dataSchemaExtra,
        message: { type: 'string', description: '一句人话结论' },
        nextStep: { type: 'string', description: '需要用户做什么时给出' },
      },
    },
  });

  // ---- 1) 只读体检 ----
  ctx.tools.register(defineTool({
    name: 'workbuddy_checkin_status',
    description:
      '只读体检 WorkBuddy 的签到与积分状态：今日是否已签到、连签天数、成长中心任务的'
      + '待接取/待领取/进行中数量、派猫猫状态、连签可兑换档位、抽奖次数。'
      + '完全不领取任何积分，也不会触发写接口。结果不含任何凭据。',
    parameters: {},
    output: {
      ...commonOutput({
        checkedIn: { type: 'boolean', description: '今日是否已签到' },
        streakDays: { type: 'integer', description: '连签天数' },
        tasks: {
          type: 'object',
          additionalProperties: false,
          properties: {
            total: { type: 'integer' },
            acceptPending: { type: 'integer' },
            claimPending: { type: 'integer' },
            inProgress: { type: 'integer' },
            claimed: { type: 'integer' },
          },
        },
        travelState: { type: 'string', description: 'idle / traveling / arrived' },
        lotteryChances: { type: 'integer' },
      }),
      render: (_args, value) => renderReport('WorkBuddy 体检', value),
    },
    timeoutMs: RUN_TIMEOUT_MS,
    async execute(_args, exec) {
      assertReady();
      const run = await runEngine(['--check'], { ...runtime, timeoutMs: RUN_TIMEOUT_MS, signal: exec.signal });
      const parsed = parseEngineOutput(run, ['--check']);
      if (!parsed.ok) {
        return { status: 'error', earned: 0, message: parsed.detail, nextStep: '查看 DSH 日志中的 workbuddy-checkin 输出。' };
      }

      const r = parsed.result;
      const steps = pickSteps(r) ?? {};
      const checkin = steps.checkin ?? {};
      const tasks = steps.tasks ?? {};
      const travel = steps.travel ?? {};
      const lottery = steps.lottery ?? {};

      return {
        status: r.status ?? 'error',
        earned: 0,
        breakdown: { checkin: 0, tasks: 0, travel: 0, redeem: 0, lottery: 0 },
        activityTotal: checkin.activity_total_credits ?? undefined,
        checkedIn: checkin.today_checked_in ?? undefined,
        streakDays: checkin.streak_days ?? undefined,
        tasks: tasks.ok || tasks.http === 200
          ? {
            total: tasks.total,
            acceptPending: tasks.accept_pending,
            claimPending: tasks.claim_pending,
            inProgress: tasks.in_progress,
            claimed: tasks.claimed,
          }
          : undefined,
        travelState: travel.state ?? undefined,
        lotteryChances: lottery.chances ?? undefined,
        message: r.status === 'ready' ? '登录态有效，可以领取。' : `体检状态 ${r.status}。`,
        nextStep: nextStepFor(r),
      };
    },
  }));

  // ---- 2) 正式领取 ----
  ctx.tools.register(defineTool({
    name: 'workbuddy_claim_credits',
    description:
      '执行 WorkBuddy 每日积分领取：加油站签到、成长中心任务（自动接取 + 领取已完成）、'
      + '派猫猫旅行、连签里程碑兑换、积分抽奖，一次跑完。幂等：已领过的自动跳过，不会重复发放。'
      + '需要在会话里说明用户已授权领取。结果不含任何凭据。',
    parameters: {},
    output: {
      ...commonOutput({
        steps: {
          type: 'object',
          additionalProperties: true,
          description: '各来源的原始步骤结果（ok / action / points 等）',
        },
      }),
      render: (_args, value) => renderReport('WorkBuddy 领积分', value),
    },
    timeoutMs: RUN_TIMEOUT_MS,
    async execute(_args, exec) {
      assertReady();
      const run = await runEngine([], { ...runtime, timeoutMs: RUN_TIMEOUT_MS, signal: exec.signal });
      const parsed = parseEngineOutput(run, []);
      if (!parsed.ok) {
        return { status: 'error', earned: 0, message: parsed.detail, nextStep: '查看 DSH 日志中的 workbuddy-checkin 输出。' };
      }

      const r = parsed.result;
      const steps = pickSteps(r) ?? {};
      if (r.status === 'not_logged_in') {
        return {
          status: 'not_logged_in',
          earned: 0,
          message: '未登录，没有执行任何领取。',
          nextStep: '调用 workbuddy_login 登录一次后重试。',
        };
      }

      return {
        status: r.status ?? 'error',
        earned: r.earned ?? 0,
        breakdown: {
          checkin: r.earned_breakdown?.checkin ?? 0,
          tasks: r.earned_breakdown?.tasks ?? 0,
          travel: r.earned_breakdown?.travel ?? 0,
          redeem: r.earned_breakdown?.redeem ?? 0,
          lottery: r.earned_breakdown?.lottery ?? 0,
        },
        activityTotal: r.activity_total_credits ?? undefined,
        steps,
        message: (r.earned ?? 0) > 0 ? `本次确认获得 ${r.earned} 分。` : '本次没有新增积分（多数项已领过或进度未满）。',
        nextStep: nextStepFor(r),
      };
    },
  }));

  // ---- 3) 登录 ----
  ctx.tools.register(defineTool({
    name: 'workbuddy_login',
    description:
      '打开一个专用 Chrome 窗口让用户完成 WorkBuddy 登录（扫码或账号密码），登录成功后自动保存登录态并关闭窗口。'
      + '只在首次使用或登录态失效时需要。会弹出可见浏览器窗口，可能阻塞数分钟直到用户完成登录。'
      + '登录态保存在用户目录 ~/.workbuddy-checkin，不涉及任何令牌。',
    parameters: {
      wait_seconds: {
        type: 'number',
        description: '最多等待用户完成登录的秒数；默认 600，允许 60–720。',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          status: { type: 'string', required: true, description: 'logged_in / login_timeout / error' },
          cookiesSaved: { type: 'integer', description: '保存的会话 cookie 条数' },
          profileDir: { type: 'string', required: true, description: '登录态目录' },
          message: { type: 'string' },
          nextStep: { type: 'string' },
        },
      },
      render: (_args, value) => {
        const head = value.status === 'logged_in'
          ? '✅ WorkBuddy 登录成功，之后可长期免登录签到。'
          : `⚠️ 登录未完成（${value.status}）。`;
        const lines = [head, `  登录态目录：${value.profileDir}`];
        if (value.cookiesSaved != null) lines.push(`  已保存会话 Cookie：${value.cookiesSaved} 条`);
        if (value.message) lines.push(`  ${value.message}`);
        if (value.nextStep) lines.push(`  → ${value.nextStep}`);
        return [{ type: 'text', text: lines.join('\n') }];
      },
    },
    timeoutMs: LOGIN_CALL_TIMEOUT_MS,
    async execute(args, exec) {
      assertReady();
      const waitSeconds = Math.min(720, Math.max(60, Number(args?.wait_seconds ?? 600)));

      const env = { ...process.env, WB_HEADFUL: '1' };
      const { profile, cookie } = effectiveProfile();
      // 登录必须有可见窗口：引擎用 WB_HEADFUL=1 打开有头浏览器。
      const node = resolveNode(runtime.nodeExecutable);
      const chrome = resolveChrome(runtime.chromePath);

      const run = await new Promise((resolvePromise, rejectPromise) => {
        let child;
        try {
          child = spawn(node, [ENGINE, '--login'], {
            env: {
              ...env,
              WB_BROWSER_PROFILE: profile,
              WB_COOKIE_FILE: cookie,
              WB_CHROME_PATH: chrome,
            },
            windowsHide: false,
          });
        } catch (error) {
          rejectPromise(error);
          return;
        }

        let stdout = '';
        let stderr = '';
        let settled = false;
        const timer = setTimeout(() => {
          try { child.kill(); } catch { /* 已退出 */ }
          if (!settled) {
            settled = true;
            resolvePromise({ code: -1, stdout, stderr, timedOut: true });
          }
        }, LOGIN_PROCESS_TIMEOUT_MS);

        const onAbort = () => {
          try { child.kill(); } catch { /* 已退出 */ }
        };
        if (exec.signal) {
          if (exec.signal.aborted) onAbort();
          else exec.signal.addEventListener('abort', onAbort, { once: true });
        }

        child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
        child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
        child.on('error', (error) => {
          clearTimeout(timer);
          if (settled) return;
          settled = true;
          rejectPromise(new Error(`workbuddy-checkin: 无法启动 node（${node}）：${error.message}`));
        });
        child.on('close', (code) => {
          clearTimeout(timer);
          if (settled) return;
          settled = true;
          resolvePromise({ code: code ?? -1, stdout, stderr, timedOut: false });
        });
      });

      const parsed = parseEngineOutput(run, ['--login']);
      if (!parsed.ok) {
        return {
          status: 'error',
          profileDir: effectiveProfile().profile,
          message: parsed.detail,
          nextStep: '确认本机已安装 Google Chrome；或在插件配置里设置 chromePath。',
        };
      }

      const r = parsed.result;
      const saved = r.cookies_saved ?? r.cookiesSaved;
      return {
        status: r.status ?? 'error',
        cookiesSaved: typeof saved === 'number' ? saved : undefined,
        profileDir: r.profile ?? effectiveProfile().profile,
        message: r.status === 'logged_in'
          ? `登录成功，已保存 ${typeof saved === 'number' ? saved : '若干'} 条会话 Cookie。`
          : (run.timedOut ? '等待登录超时，窗口已关闭。' : '登录超时或未完成。'),
        nextStep: r.status === 'logged_in'
          ? '可以直接调用 workbuddy_claim_credits 领取了。'
          : '重新调用 workbuddy_login，并在弹出的 Chrome 窗口里完成扫码登录。',
      };
    },
  }));
}

/** 插件配置：全部可选，用于非常规安装位置。
 *
 * 必须用 schemastery 的 z.object（实现 `~standard` 校验协议）。
 * Cordis 的 resolveConfig 会调用 `Config["~standard"].validate(config)`，
 * 若导出成普通对象则没有该属性，插件加载时直接抛异常 → UI 显示「异常」。
 */
export const Config = z.object({
  nodeExecutable: z.string().description('运行引擎用的 node 绝对路径；留空则自动查找'),
  chromePath: z.string().description('Chrome 可执行文件绝对路径；留空则用默认位置'),
});
