/**
 * dsh-board —— 任务面板。
 *
 * 数据结构是两级的：
 *   大任务（一个项目，一张卡）
 *     └ 参与人一行（谁、负责什么、什么状态、留了什么话）
 *
 * 数据源只有 `Deviel\任务板.md`。读：无条件。写：只在改状态 / @人 上，每天留一份 .bak。
 * 面板不叫醒人——要叫醒，由 agent 调 proactive_set 设一条短唤醒。
 */
import fs from 'node:fs';
import path from 'node:path';

export const name = 'board';
export const inject = ['tools', 'webServer'];

const ROOT = 'D:\\AI\\DeepSeek';
const HOME = process.env.DSH_HOME || path.join(process.env.USERPROFILE || 'C:\\Users\\21068', '.dsh');
const BOARD = path.join(ROOT, 'Deviel', '任务板.md');
const REPORT_DIR = path.join(ROOT, 'Deviel', '05-报告');   // 2026-10-31 目录重排后的真路径（旧的是 Deviel\报告）
const TODO_DIR = path.join(ROOT, 'Deviel', '03-待办');
const PKG = path.join(ROOT, 'dsh-board', 'package.json');
const BUILD_BOARD = path.join(ROOT, 'Deviel', 'tools', 'build-board.mjs');
const NODE = 'C:\\Users\\21068\\.dsh\\dsh-runtimes\\dsh-primary-runtime\\dependencies\\node\\bin\\node.exe';

const STALE_MS = 6 * 3600 * 1000;
const LONG_STALE_MS = 48 * 3600 * 1000;

// Vera 2026-10-30 定：阶段统一五档，不许各写各的。
// 「执行」一个词盖住搭插件、写文、出图三种活；具体在干什么放「下一步」。
const STAGES = ['收集', '执行', '检测', '返修', '完成'];
// 卡在哪一类：面板上的实心色块
const STATUSES = ['待派', '在做', '等验收', '卡住', '完成'];

function readText(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return ''; }
}

/* ── 新版任务板（2026-11-02 起由 tools\build-board.mjs 生成）──
   结构是五个 `## ` 小节 + 每条一行 `- **谁** · 内容 · 第 N 小时 ← 源头`。
   面板不再改它——它每次重建都会覆盖，要改就去改源头那一行。 */
const AUTO_SECTIONS = ['正在做', '等验收', '卡住', '失踪', '陈旧未完成', '没活的', '活着吗'];

export function parseAutoBoard(md) {
  const lines = String(md || '').replace(/\r\n/g, '\n').split('\n');
  let generatedAt = '';
  const head = lines.find((l) => /生成时间/.test(l));
  if (head) {
    const m = head.match(/生成时间\s*([0-9/: ]+)/);
    if (m) generatedAt = m[1].trim();
  }
  const sections = [];
  let cur = null;
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    const h2 = line.match(/^##\s+(.*)$/);
    if (h2) {
      const title = h2[1].replace(/⚠/g, '').trim();
      cur = { title, items: [], note: '' };
      sections.push(cur);
      continue;
    }
    if (!cur) continue;
    if (/^\s*（.*）\s*$/.test(line)) { cur.note = line.trim(); continue; }
    const item = line.match(/^-\s+\*\*(.+?)\*\*\s*·\s*(.*)$/);
    if (item) {
      const rest = item[2];
      const src = (rest.match(/←\s*(\S+)$/) || [])[1] || '';
      const body = rest.replace(/←\s*\S+$/, '').trim().replace(/\s*·\s*$/, '');
      cur.items.push({ who: item[1].trim().replace(/\*\*/g, ''), body: body.replace(/\*\*/g, ''), src });
      continue;
    }
    if (/^-\s+/.test(line) && cur.title === '活着吗') {
      cur.items.push({ who: '', body: line.replace(/^-\s+/, '').trim(), src: '' });
    }
  }
  const counts = {};
  for (const s of sections) counts[s.title.replace(/（\d+）/, '')] = s.items.length;
  return { generatedAt, sections, counts };
}

/** 插件自己的信息：版本、构建时间、许可、数据源、运行环境（仿官方插件的信息区） */
export /* 自动归类（他 15:0x 定的）：不许靠手填，插件按「它是哪个插件的事」自己判。
   四类：流程（跨人的事）/ 插件（某个插件本身）/ 个人（个人养护，长线）/ 完结（做完了）。 */
function autoCategory(f) {
  const t = String((f && f.text) || '') + ' ' + String((f && f.id) || '');
  if (f && f.done) return '完结';
  if (Array.isArray(f.steps) && f.steps.length && f.steps.every((x) => x.done)) return '完结';
  // 插件线索：标题里直接写了插件，或提到我们自己的插件名/面板
  if (/插件|面板|记忆|灵魂|飞书|声音|voice|board|memory|proactive/i.test(t)) return '插件';
  // 个人养护：长线/个人/口味/身体/作息那类
  if (/长线|个人|口味|作息|身体|养/.test(t)) return '个人';
  return '流程';
}
function aboutInfo() {
  let pkg = {};
  try { pkg = JSON.parse(readText(PKG)); } catch {}
  const files = [];
  for (const rel of ['package.json', 'lib/index.js', 'lib/client.js', 'cordis.patch.yml']) {
    const p = path.join(ROOT, 'dsh-board', rel);
    try {
      const st = fs.statSync(p);
      files.push({ path: rel, bytes: st.size, mtime: st.mtime.toISOString() });
    } catch {}
  }
  let board = { path: BOARD, exists: false, bytes: 0, mtime: null, auto: false, backups: 0 };
  try {
    const st = fs.statSync(BOARD);
    board = {
      path: BOARD, exists: true, bytes: st.size, mtime: st.mtime.toISOString(),
      auto: /自动生成/.test(readText(BOARD).slice(0, 400)),
      backups: fs.readdirSync(ROOT + '\\Deviel\\90-归档').filter((x) => /^任务板-手写版/.test(x)).length,
    };
  } catch {}
  return {
    ok: true,
    name: pkg.name || 'dsh-board',
    version: pkg.version || '0.0.0',
    description: pkg.description || '',
    license: pkg.license || '',
    author: pkg.author || 'Deviel 家里自己写的',
    main: pkg.main || 'lib/index.js',
    keywords: pkg.keywords || [],
    platform: (pkg.dsh && pkg.dsh.client && pkg.dsh.client.platform) || 'web',
    builtAt: files.find((f) => f.path === 'lib/client.js')?.mtime || null,
    homepage: pkg.homepage || '',
    files,
    data: board,
    runtime: {
      node: process.version,
      platform: process.platform,
      pid: process.pid,
      uptimeSec: Math.round(process.uptime()),
      hasBuildScript: fs.existsSync(BUILD_BOARD),
    },
  };
}

/** 解析「现在的活」这一节：### 大任务 / - **键**：值 / 四列表格 */
export function parseProjects(md) {
  const lines = String(md || '').replace(/\r\n/g, '\n').split('\n');
  let inSection = false;
  const projects = [];
  let cur = null;

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (/^##\s*现在的活/.test(line)) { inSection = true; continue; }
    if (inSection && /^##\s/.test(line)) break;
    if (!inSection) continue;

    const h3 = line.match(/^###\s+(.*)$/);
    if (h3) {
      cur = { title: h3[1].replace(/\*\*/g, '').trim(), meta: {}, rows: [] };
      projects.push(cur);
      continue;
    }
    if (!cur) continue;

    const meta = line.match(/^-\s*\*\*([^*]+)\*\*\s*[：:]\s*(.*)$/);
    if (meta) { cur.meta[meta[1].trim()] = meta[2].trim(); continue; }

    const t = line.trim();
    if (!/^\|/.test(t)) continue;
    if (/^\|[\s:|-]+\|?$/.test(t)) continue;
    const cells = t.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
    if (!cells.length) continue;
    if (cells[0] === '参与人' || cells[0] === '') continue;
    // 列：参与人 / 阶段（他现在在哪一步）/ 状态 / 下一步
    cur.rows.push({ who: cells[0], stage: cells[1] || '', status: cells[2] || '待派', next: cells[3] || '' });
  }
  return projects;
}

/** 给一份报告补上标题和一句话结论 */
function withConclusion(best) {
  const mdx = readText(best.path).replace(/\r\n/g, '\n');
  const lines = mdx.split('\n');
  let conclusion = '';
  let inFence = false;
  for (const raw of lines) {
    const l = raw.trim();
    if (/^```/.test(l)) { inFence = !inFence; continue; }
    if (inFence) continue;
    if (!l) continue;
    if (/^#{1,6}\s/.test(l)) continue;
    if (/^>/.test(l)) continue;
    if (/^\|/.test(l)) continue;
    if (/^\d{4}-\d{2}-\d{2}/.test(l)) continue;
    if (/^[-*+]\s/.test(l)) { conclusion = l.replace(/^[-*+]\s+/, ''); break; }
    conclusion = l;
    break;
  }
  return { name: best.name, mtime: best.mtime, file: best.path, conclusion: conclusion.replace(/\*\*/g, '').slice(0, 180) };
}

/** 这个人最新那份报告（面板上贴在留言下面的一句话结论） */
function latestOf(who) {
  let best = null;
  try {
    const dir = path.join(REPORT_DIR, who);
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!/\.md$/i.test(e.name)) continue;
      const p = path.join(dir, e.name);
      const st = fs.statSync(p);
      if (!best || st.mtimeMs > best.mtime) best = { path: p, name: e.name, mtime: st.mtimeMs };
    }
  } catch { return null; }
  return best ? withConclusion(best) : null;
}

/** 一个人最近动过没有 */
function lastTouch(who) {
  let t = 0;
  try {
    const dir = path.join(REPORT_DIR, who);
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!/\.md$/i.test(e.name)) continue;
      t = Math.max(t, fs.statSync(path.join(dir, e.name)).mtimeMs);
    }
  } catch {}
  try { t = Math.max(t, fs.statSync(path.join(TODO_DIR, who + '.md')).mtimeMs); } catch {}
  return t || 0;
}

export function build() {
  const projects = parseProjects(readText(BOARD));
  const now = Date.now();

  const out = projects.map((p) => {
    const kind = (p.meta['类型'] || '短线').replace(/\*\*/g, '').trim();
    const isLong = /长线|常驻/.test(kind);
    // Vera 定：短线 6 小时（他当天要看），长线 48 小时（常驻，一天没动是正常的）
    const limitMs = isLong ? LONG_STALE_MS : STALE_MS;

    const rows = p.rows.map((r) => {
      const touched = lastTouch(r.who);
      const idleMs = touched ? now - touched : null;
      return {
        ...r,
        idleHours: idleMs === null ? null : Math.round((idleMs / 3600000) * 10) / 10,
        // 长线判的是「有没有在留痕迹」，不是「多久没交东西」
        stale: idleMs !== null && idleMs > limitMs && !/完成/.test(r.status || ''),
        limitHours: limitMs / 3600000,
        report: latestOf(r.who),
      };
    });

    let status = '待派';
    if (rows.some((r) => /卡住/.test(r.status))) status = '卡住';
    else if (rows.some((r) => /等验收/.test(r.status))) status = '等验收';
    else if (rows.some((r) => /在做/.test(r.status))) status = '在做';
    else if (rows.length && rows.every((r) => /完成/.test(r.status))) status = '完成';

    return {
      title: p.title,
      meta: p.meta,
      kind,
      isLong,
      limitHours: limitMs / 3600000,
      rows,
      status,
      staleCount: rows.filter((r) => r.stale).length,
      staleWho: rows.filter((r) => r.stale).map((r) => r.who),
      lastAt: rows.reduce((m, r) => Math.max(m, lastTouch(r.who)), 0),
    };
  });

  const md = readText(BOARD);
  const auto = md.indexOf('## 正在做') >= 0 ? parseAutoBoard(md) : null;
  // 任务卡（按任务看不按人看）：从 _state.json 取，build-board 已经分好组
  let taskGroups = [];
  let flowGroups = [];
  try {
    const st = JSON.parse(readText(path.join(TODO_DIR, '_state.json')) || '{}');
    taskGroups = Array.isArray(st.taskGroups) ? st.taskGroups : [];
    flowGroups = Array.isArray(st.flows) ? st.flows : [];
  } catch {}

  // 幻觉反制（T-104-a 教训 / T-104-b 承诺对账）：面板上要能看见这两类的对账结果
  const hygiene = { lessonsOpen: 0, promisesOpen: 0, promises: [], lessons: [] };
  try {
    const les = readText(path.join(HOME, '.dsh', 'vera', 'topics', '教训.md'));
    const lesLines = les.split('\n').filter((l) => l.startsWith('- [教训 '));
    const days = new Set();
    for (const l of les.split('\n')) { const m = l.match(/^- \[(?:适用|不适用)\s+(\d{2}-\d{2})\]/); if (m) days.add(m[1]); }
    const openLes = lesLines.filter((l) => { const d = l.match(/\[教训 \d{4}-(\d{2}-\d{2})\]/); return !(d && days.has(d[1])); });
    hygiene.lessonsOpen = openLes.length;
    hygiene.lessons = openLes.slice(-3).map((l) => l.replace(/^- \[教训 [^\]]+\]\s*/, '').slice(0, 90));
    const pro = readText(path.join(HOME, '.dsh', 'vera', 'topics', '承诺.md'));
    const proLines = pro.split('\n').filter((l) => l.startsWith('- [没做痕迹 '));
    hygiene.promisesOpen = proLines.length;
    hygiene.promises = proLines.slice(-3).map((l) => l.replace(/^- \[没做痕迹 [^\]]+\]\s*/, '').slice(0, 90));
    // 覆盖面检查（2026-11-02 16:53 他点破的"测试全过但内容漏"）：从 90-归档\覆盖面检查.json 取
    try {
      const cov = JSON.parse(readText(path.join(ROOT, 'Deviel', '90-归档', '覆盖面检查.json')) || '{}');
      hygiene.coverageMissing = cov.missingCount || 0;
      hygiene.coverage = (cov.missing || []).slice(0, 3).map((m) => m.text);
    } catch {}
  } catch {}
  // 每条大流程自动长成一张任务卡（不用手写 _任务.md）
  const cardsFromFlows = flowGroups.map((f) => {
    const steps = Array.isArray(f.steps) ? f.steps : [];
    const doneN = steps.filter((x) => x.done).length;
    // 步骤没有各自的时间戳，就借这条流程的最后活动时间（宁可标粗也不能编）。
    // 米拉 19:33 ②：Q-01~Q-05 这种一句话的事没有步骤，就**用它自己的那句当唯一一步**，
    // 别显示「（这条还没拆步骤）」那种空壳——一张卡顶不起信息，反而占版面。
    const rows = steps.length
      ? steps.map((st) => ({
          who: st.who || '待认领',
          body: st.text,
          ageHours: st.done ? 0 : (f.ageHours || null),
          done: !!st.done,
        }))
      : [{
          who: (f.people && f.people[0]) || '待认领',
          body: f.text || '（这条还没写清要做什么）',
          ageHours: f.done ? 0 : (f.ageHours || null),
          done: !!f.done,
        }];
    const openN = steps.length ? steps.length - doneN : (f.done ? 0 : 1);
    const isLate = !f.done && (f.ageHours || 0) > 24;
    return {
      id: f.id,
      title: f.id + '　' + f.text,
      status: f.done ? '完成' : (isLate ? '卡住' : '在做'),
      open: openN,
      total: steps.length || 1,
      doneN,
      oldest: f.ageHours || 0,
      late: isLate ? openN : 0,
      meta: {
        '类型': '大流程',
        '起止': f.span || '—',
        '简介': '全家同一份 _现在.md 里的流程（改它不用改这里）',
        '验收': f.how || '',
        '验': f.verify || '',
        '已验': f.verified || '',
        '授权': f.auth || '',
      },
      rows,
      src: f.from,
      category: autoCategory(f),
      parentId: (/^(T-\d+)-[a-z]$/.test(String(f.id || '')) ? String(f.id).replace(/-[a-z]$/, '') : ''),
    };
  });
  /* 子项跟随父卡的类别（他 18:52 说的：T-104-a/b 本质是灵魂插件的事，不该自成一类）；
     做完的卡一律进「完结」，不管它属于谁。 */
  {
    const byId = Object.create(null);
    for (const c of cardsFromFlows) byId[c.id] = c;
    for (const c of cardsFromFlows) {
      if (c.parentId && byId[c.parentId]) c.category = byId[c.parentId].category;
    }
    for (const c of cardsFromFlows) {
      if (c.status === '完成') c.category = '完结';
    }
  }

  return {
    ok: true,
    view: auto ? 'auto' : 'classic',   // auto = 从数据生成的新版；classic = 旧的手写大任务表
    taskGroups: [...cardsFromFlows, ...taskGroups],
    flowGroups,
    auto,
    about: aboutInfo(),
    generatedAt: now,
    boardPath: BOARD,
    staleHours: STALE_MS / 3600000,
    longStaleHours: LONG_STALE_MS / 3600000,
    stages: STAGES,
    statuses: STATUSES,
    total: out.length,
    projects: out,
  };
}

// ── 写入 ───────────────────────────────────────────────────

function backupBoard() {
  try {
    const d = new Date();
    const p = (x) => String(x).padStart(2, '0');
    const keep = BOARD + '.bak-' + `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
    if (fs.existsSync(keep)) return;
    fs.copyFileSync(BOARD, keep);
  } catch {}
}

/** 改某个大任务里某一行人的状态（第 3 列） */
export function setRowStatus(projectTitle, who, status) {
  backupBoard();
  const lines = readText(BOARD).replace(/\r\n/g, '\n').split('\n');
  let inSection = false;
  let curTitle = '';
  let hit = false;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^##\s*现在的活/.test(l)) { inSection = true; continue; }
    if (inSection && /^##\s/.test(l)) break;
    if (!inSection) continue;
    const h3 = l.match(/^###\s+(.*)$/);
    if (h3) { curTitle = h3[1].replace(/\*\*/g, '').trim(); continue; }
    if (projectTitle && curTitle !== projectTitle) continue;
    const t = l.trim();
    if (!/^\|/.test(t)) continue;
    if (/^\|[\s:|-]+\|?$/.test(t)) continue;
    const cells = t.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
    if (cells[0] !== who) continue;
    while (cells.length < 4) cells.push('—');
    cells[2] = status;
    lines[i] = '| ' + cells.join(' | ') + ' |';
    hit = true;
    break;
  }
  if (!hit) throw new Error('任务板里没找到：' + (projectTitle || '任意项目') + ' / ' + who);
  fs.writeFileSync(BOARD, lines.join('\n'), 'utf8');
  return true;
}

/** 改某一行人的「阶段」和「下一步」（第 2、4 列）；只传一个就只改一个 */
export function setRowFields(projectTitle, who, patch = {}) {
  backupBoard();
  const lines = readText(BOARD).replace(/\r\n/g, '\n').split('\n');
  let inSection = false;
  let curTitle = '';
  let hit = false;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^##\s*现在的活/.test(l)) { inSection = true; continue; }
    if (inSection && /^##\s/.test(l)) break;
    if (!inSection) continue;
    const h3 = l.match(/^###\s+(.*)$/);
    if (h3) { curTitle = h3[1].replace(/\*\*/g, '').trim(); continue; }
    if (projectTitle && curTitle !== projectTitle) continue;
    const t = l.trim();
    if (!/^\|/.test(t)) continue;
    if (/^\|[\s:|-]+\|?$/.test(t)) continue;
    const cells = t.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
    if (cells[0] !== who) continue;
    while (cells.length < 4) cells.push('—');
    if (patch.stage !== undefined && patch.stage !== '') cells[1] = String(patch.stage).replace(/\|/g, '／');
    if (patch.next !== undefined && patch.next !== '') cells[3] = String(patch.next).replace(/\|/g, '／');
    lines[i] = '| ' + cells.join(' | ') + ' |';
    hit = true;
    break;
  }
  if (!hit) throw new Error('任务板里没找到：' + (projectTitle || '任意项目') + ' / ' + who);
  fs.writeFileSync(BOARD, lines.join('\n'), 'utf8');
  return true;
}

/** 新建一个大任务（前端填表 → 写回任务板） */
export function addProject({ title, kind = '短线', intro, goal, span, accept, members = [] }) {
  if (!title) throw new Error('缺大任务名');
  // Vera 定的硬规矩：验收写得出来，一个任务才成立；写不出来那是个想法，先放待办。
  if (!accept || !String(accept).trim()) {
    throw new Error('没有验收标准，这条活不建。验收写得出来它才是任务，写不出来那是个想法，先放待办里。');
  }
  backupBoard();
  const lines = readText(BOARD).replace(/\r\n/g, '\n').split('\n');

  // 找「现在的活」段的结尾（下一个 ## 之前），在它前面插
  let start = -1;
  let end = lines.length;
  for (let i = 0; i < lines.length; i++) {
    if (/^##\s*现在的活/.test(lines[i])) { start = i; continue; }
    if (start >= 0 && i > start && /^##\s/.test(lines[i])) { end = i; break; }
  }
  const block = [];
  block.push('');
  block.push('### ' + String(title).replace(/\*\*/g, '').trim());
  block.push('');
  if (kind) block.push('- **类型**：' + kind);
  if (intro) block.push('- **简介**：' + intro);
  if (goal) block.push('- **目标**：' + goal);
  if (span) block.push('- **起止**：' + span);
  if (accept) block.push('- **验收**：' + accept);
  block.push('');
  block.push('| 参与人 | 阶段 | 状态 | 下一步 |');
  block.push('|---|---|---|---|');
  if (members.length) {
    for (const m of members) {
      block.push('| ' + [m.who || '—', m.stage || '—', m.status || '待派', m.next || '—'].join(' | ') + ' |');
    }
  } else {
    block.push('| — | — | 待派 | — |');
  }
  block.push('');

  if (start < 0) {
    // 没有这一节就补一个
    lines.push('## 现在的活');
    lines.push(...block);
  } else {
    lines.splice(end, 0, ...block);
  }
  fs.writeFileSync(BOARD, lines.join('\n'), 'utf8');
  return { title, kind, members: members.length };
}

/** 往「流水」追加一行 */
export function appendLog(line) {
  backupBoard();
  let mdx = readText(BOARD).replace(/\r\n/g, '\n');
  const d = new Date();
  const p = (x) => String(x).padStart(2, '0');
  const head = `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  const row = `- ${head} ${String(line).trim()}`;
  if (mdx.indexOf('## 流水') < 0) mdx += '\n\n## 流水\n\n' + row + '\n';
  else mdx = mdx.trimEnd() + '\n' + row + '\n';
  fs.writeFileSync(BOARD, mdx, 'utf8');
  return row;
}

const outText = {
  schema: { type: 'string' },
  render: (_args, value) => [{ type: 'text', text: value }],
};

export function apply(ctx) {
  ctx.tools.register({
    name: 'board_update',
    description: '改任务面板上某个人在某个大任务里的状态（待派 / 在做 / 等验收 / 卡住 / 完成）。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        project: { type: 'string', description: '大任务名，如「制作「声音」插件」' },
        who: { type: 'string', description: '谁，如 Vigil' },
        status: { type: 'string', description: '新状态' },
        note: { type: 'string', description: '顺带在流水记一句' },
      },
      required: ['who', 'status'],
    },
    output: outText,
    async execute(args) {
      setRowStatus(args?.project || '', args?.who, args?.status);
      appendLog(`${args?.who} 在「${args?.project || '任务'}」里改成「${args?.status}」${args?.note ? '（' + args.note + '）' : ''}`);
      return `${args?.who} → ${args?.status}`;
    },
  });

  ctx.tools.register({
    name: 'board_ping',
    description: '在流水里 @ 一个人（待验收 / 需要帮助 / 进度同步），并提示下一步要设唤醒。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        who: { type: 'string', description: '@ 谁' },
        why: { type: 'string', description: '待验收 / 需要帮助 / 进度同步 / 其他' },
        message: { type: 'string', description: '一句话说清楚' },
      },
      required: ['who', 'message'],
    },
    output: outText,
    async execute(args) {
      const why = args?.why ? '[' + args.why + '] ' : '';
      appendLog(`@${args?.who} ${why}${args?.message}`);
      return `已记：@${args?.who} ${why}${args?.message}\n\n` +
        `下一步（必须做）：调 proactive_set 给 ${args?.who} 设一条 after_seconds: 180 的唤醒，` +
        `prompt 写「读任务板，${args?.who} 有一条待处理：${args?.message}」。不设的话对方不会知道。`;
    },
  });

  const server = (() => {
    try { return ctx.get('webServer', false) || ctx.webServer; } catch { return undefined; }
  })();
  if (!server || typeof server.register !== 'function') {
    try { ctx.logger?.warn?.('[board] 没有 webServer，面板起不来'); } catch {}
    return;
  }

  const readJson = (req) => new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => { b += c; if (b.length > 1e6) req.destroy(); });
    req.on('end', () => resolve(b));
  });
  const send = (res, code, obj) => {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(obj));
  };

  server.register({
    kind: 'exact',
    path: '/board/api/data',
    handler: async (req, res) => {
      try { send(res, 200, build()); } catch (e) { send(res, 500, { ok: false, error: String(e?.message || e) }); }
    },
  });

  // 插件信息（面板上「关于」那一块读它）：版本、构建时间、文件、数据源、运行环境
  server.register({
    kind: 'exact',
    path: '/board/api/about',
    handler: async (req, res) => {
      try { send(res, 200, aboutInfo()); } catch (e) { send(res, 500, { ok: false, error: String(e?.message || e) }); }
    },
  });

  // 新建任务卡（2026-11-02 他要求：面板要能手动建任务）：
  // 往 03-待办\_任务.md 的「## 活」里追加一张卡，然后重建板子。
  server.register({
    kind: 'exact',
    path: '/board/api/task',
    handler: async (req, res) => {
      if (req.method !== 'POST') { send(res, 405, { ok: false }); return; }
      try {
        const raw = await new Promise((resolve) => {
          let b = '';
          req.on('data', (c) => { b += c; if (b.length > 1e6) req.destroy(); });
          req.on('end', () => resolve(b));
        });
        let body = {};
        try { body = JSON.parse(raw || '{}'); } catch {}
        const title = String(body.title || '').trim();
        if (!title) { send(res, 400, { ok: false, error: '任务名不能空' }); return; }
        if (!String(body.accept || '').trim()) { send(res, 400, { ok: false, error: '验收标准不能空——写不出来它就还不是任务' }); return; }
        // 新建任务卡的落点：_现在.md（唯一源）。以前写 _任务.md，没人读，等于白写。
        const file = path.join(TODO_DIR, '_现在.md');
        let md = readText(file);
        // 分配编号：取现有最大的 T-<数字> 再 +1
        const nums = [...md.matchAll(/T-(\d+)/g)].map((m) => Number(m[1])).filter((n) => n > 0);
        const nextId = 'T-' + String((nums.length ? Math.max(...nums) : 100) + 1);
        const members = Array.isArray(body.members) ? body.members.filter((m) => m && m.who && m.what) : [];
        const stepsArr = members.map((m) => ({ who: m.who, what: m.what }));
        const fixed = '- [ ] ' + nextId + ' ' + title +
          ' ｜人:' + (stepsArr.map((x) => x.who).join(',') || 'Vigil') +
          (String(body.span || '').trim() ? ' ｜期:' + String(body.span).trim() : '') +
          ' ｜验:' + String(body.verify || 'Mira').trim() +
          ' ｜算过:' + String(body.accept).trim();
        const block = ['', '### ' + nextId + '　' + title, '', fixed];
        for (const st of stepsArr) block.push('  - [ ] ' + st.what + ' @' + st.who);
        block.push('');
        if (String(body.intro || '').trim()) block.push('**问题**：' + String(body.intro).trim(), '');
        md = md.replace(/\s*$/, '') + '\n' + block.join('\n');
        fs.writeFileSync(file, md, 'utf8');
        const { spawnSync } = await import('node:child_process');
        const r = spawnSync(NODE, [BUILD_BOARD], { encoding: 'utf8', timeout: 60000 });
        send(res, r.status === 0 ? 200 : 500, {
          ok: r.status === 0,
          output: ((r.stdout || '') + (r.stderr || '')).trim().slice(-400),
          data: r.status === 0 ? build() : null,
        });
      } catch (e) { send(res, 500, { ok: false, error: String(e?.message || e) }); }
    },
  });

  // 面板渲染出错时，前端把错误发到这里落盘——白屏时我能看到是哪一行炸的
  server.register({
    kind: 'exact',
    path: '/board/api/err',
    handler: async (req, res) => {
      try {
        const b = await new Promise((resolve) => { let x = ''; req.on('data', (c) => { x += c; }); req.on('end', () => resolve(x)); });
        fs.writeFileSync(path.join(process.env.USERPROFILE || 'C:\\Users\\21068', '.dsh', 'dsh-board-last-error.txt'),
          new Date().toISOString() + '\n' + String(b || '').slice(0, 4000), 'utf8');
        send(res, 200, { ok: true });
      } catch (e) { send(res, 500, { ok: false }); }
    },
  });
  // 导出静态页（他 11-03 07:24 定的「看得见界面」）：同一份数据、同一套配色，
  // 生成一个纯文件给人和截图看——不碰认证，也不改面板本身。
  server.register({
    kind: 'exact',
    path: '/board/api/export',
    handler: async (req, res) => {
      try {
        const d = build();
        const outDir = path.join(ROOT, 'outputs', 'board');
        fs.mkdirSync(outDir, { recursive: true });
        const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const file = path.join(outDir, 'board-' + stamp + '.html');
        const esc = (x) => String(x == null ? '' : x).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
        // 米拉 07:40：导出页画 21 张、真面板只画 19 张——差别是面板把 Q-01~Q-05 收成
        // 一张「随手做」，导出却一张一张画。现在两边口径对齐：Q 类单独一节，页眉写清这是导出视图。
        const all = d.taskGroups || [];
        const cards = all.filter((t) => !/^Q-/.test(String(t.id || '')));
        const quicks = all.filter((t) => /^Q-/.test(String(t.id || '')));
        // Vera 12:58 派的三条：①卡头状态色条 ②一屏 4 张 ③列宽不许挤成两行。
        // 导出页是 Vera 唯一验得到的视图，所以这三条**也在导出页上如实呈现**（面板那边同一色系）。
        const STAGE_COLOR = { 完成: '#8a8f98', 卡住: '#c0554d', 等别人: '#b98a3c', 有卡点: '#c98a3c', 进行中: '#4a7fb5', 未开始: '#9aa0a8' };
        const stageOf = (t) => {
          const rows2 = t.rows || [];
          const open2 = rows2.filter((r) => !r.done);
          if (!rows2.length) return '未开始';
          if (!open2.length) return '完成';
          if (open2.every((r) => /^(待认领|\?|未指派)$/.test(String(r.who || '').trim()))) return '有卡点';
          return '进行中';
        };
        const body = cards.map((t) => {
          const st = stageOf(t);
          // ② 一屏 4 张：默认只摊开前 3 步，剩下的折进「还有 N 步」（点开看全）——信息不丢，密度上来
          const rowHtml = (r) => '<tr><td class="w">' + esc(r.who) + '</td><td>' + esc(r.body) + '</td><td class="a">' + (r.ageHours != null ? r.ageHours + ' h' : '—') + '</td><td class="s">' + (r.done ? '已完成' : '在做') + '</td></tr>';
          const allRows = (t.rows || []);
          const headRows = allRows.slice(0, 3).map(rowHtml).join('');
          const moreRows = allRows.slice(3).map(rowHtml).join('');
          const rows = headRows + (moreRows
            ? '<tr class="more"><td colspan="4"><details><summary>还有 ' + (allRows.length - 3) + ' 步</summary><table><tbody>' + moreRows + '</tbody></table></details></td></tr>'
            : '');
          return '<section class="card" style="border-left:4px solid ' + (STAGE_COLOR[st] || STAGE_COLOR['未开始']) + '"><h3>' + esc(t.title) +
            (t.parentId ? ' <em>子卡 · ' + esc(t.parentId) + ' 的</em>' : '') +
            ' <span class="st" style="color:' + (STAGE_COLOR[st] || STAGE_COLOR['未开始']) + '">' + st + '</span></h3>' +
            '<div class="meta">分类 ' + esc(t.category || '—') + ' · 进度 ' + (t.doneN || 0) + '/' + (t.total || (t.rows || []).length) + ' 步' +
            (t.meta && t.meta['验收'] ? ' · 算过：' + esc(t.meta['验收']) : '') + '</div>' +
            '<table><thead><tr><th>谁</th><th>这一步</th><th>停了多久</th><th>状态</th></tr></thead><tbody>' + rows + '</tbody></table></section>';
        }).join('') + (quicks.length
          ? '<section class="card quick"><h3>随手做 <em>' + quicks.length + ' 条</em></h3><div class="meta">凑一批一次处理，不单独占卡（和面板上那张虚线卡口径一致）</div><table><tbody>' +
            quicks.map((q) => '<tr><td>' + esc(q.id) + '</td><td>' + esc(String(q.title || '').replace(/^Q-\d+\s*/, '')) + '</td><td>' + esc((q.rows && q.rows[0] && q.rows[0].who) || '待认领') + '</td></tr>').join('') +
            '</tbody></table></section>'
          : '');
        const html = '<!doctype html><meta charset="utf-8"><title>任务面板导出 ' + stamp + '</title>' +
          '<style>body{font:14px/1.6 -apple-system,"Segoe UI",sans-serif;background:#f6f7f9;color:#1b1d21;margin:0;padding:28px}' +
          'h1{font-size:20px;margin:0 0 4px}.stamp{color:#6b7280;font-size:12px;margin-bottom:18px}' +
          // ② 一屏 4 张：卡片压紧（上下 10px、间距 8px、字号小一档）
          '.card{background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:8px 10px;margin:6px 0}' +
          '.card h3{margin:0 0 4px;font-size:14px;line-height:20px}.card em{font-style:normal;color:#b45309;font-size:12px}' +
          '.card .st{font-size:11px;font-weight:500;margin-left:6px}' +
          '.meta{color:#6b7280;font-size:11.5px;margin-bottom:5px}' +
          // ③ 列宽：谁/停了多久/状态三列 nowrap，不许把「待认领」「停了多久」挤成两行
          'table{border-collapse:collapse;width:100%;font-size:12.5px;table-layout:auto}' +
          'td,th{border-bottom:1px solid #eee;padding:2px 6px;text-align:left;vertical-align:top}' +
          'td.w,td.a,td.s,th:first-child,th:nth-child(3),th:nth-child(4){white-space:nowrap}' +
          // ② 一屏 4 张：正文最多两行，超出折叠（鼠标悬停看全文），行高再压一档
          '.card .more details summary{cursor:pointer;color:#6b7280;font-size:11.5px;padding:2px 0}' +
          'td:nth-child(2){display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;line-height:15px;max-width:760px}' +
          '.card h3{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
          'th{color:#9ca3af;font-weight:500}' +
          '.chip{display:inline-block;background:#eef1f5;border-radius:999px;padding:2px 10px;margin-right:8px;font-size:12px}</style>' +
          '<h1>任务面板（导出视图）</h1>' +
          '<div class="stamp">导出时间 ' + new Date().toLocaleString('zh-CN', { hour12: false }) +
          ' · 面板版本 v' + (d.about && d.about.version) + ' · 卡片 ' + cards.length + ' 张 + 随手做 ' + quicks.length + ' 条' +
          ' · 待认领 ' + cards.reduce((n, t) => n + (t.rows || []).filter((r) => /待认领|\?/.test(String(r.who || ''))).length, 0) + ' 步</div>' +
          '<p style="color:#b45309;font-size:12px;margin:0 0 14px">这是**导出视图**：同一份数据、同样的卡片口径，但排版是服务端另写的，' +
          '不是面板截图的像素复刻。用它验数据（步数 / 待认领 / 分组 / 子卡）可以，别拿它当"面板长这样"的证据。</p>' +
          '<div><span class="chip">卡住 ' + (cards.filter((t) => t.status === '卡住').length) + '</span>' +
          '<span class="chip">完结 ' + (cards.filter((t) => t.status === '完成').length) + '</span>' +
          // 米拉 11-05：导出页也要能看见「判不出」——否则她验的时候只看到干净的 0
          '<span class="chip">判不出多久没动 ' + (cards.filter((t) => t.status !== '完成' && !(t.rows || []).some((r) => r.ageHours != null && !r.done)).length) + ' 张</span>' +
          '<span class="chip">大类 ' + [...new Set(cards.map((t) => t.category || '—'))].join(' / ') + '</span></div>' +
          body;
        fs.writeFileSync(file, html, 'utf8');
        send(res, 200, { ok: true, file, bytes: Buffer.byteLength(html), cards: cards.length });
      } catch (e) { send(res, 500, { ok: false, error: String(e?.message || e) }); }
    },
  });

  // 读任务卡原文：面板上「看原文」就地展开（仿旧看板：看到这条 → 读原文一步到位）
  // 2026-11-02 16:5x 修：卡片数据来自 `_现在.md`，这里却读 `_任务.md`，所以全「没找到这一节」。
  server.register({
    kind: 'exact',
    path: '/board/api/taskfile',
    handler: async (req, res) => {
      try {
        const file = path.join(TODO_DIR, '_现在.md');
        send(res, 200, { ok: true, path: file, text: readText(file) });
      } catch (e) { send(res, 500, { ok: false, error: String(e?.message || e) }); }
    },
  });
  // 重建任务板：跑一次 tools\build-board.mjs（新版板子是从数据生成的，面板上给个按钮省得他去终端）
  server.register({
    kind: 'exact',
    path: '/board/api/rebuild',
    handler: async (req, res) => {
      if (req.method !== 'POST') { send(res, 405, { ok: false }); return; }
      try {
        if (!fs.existsSync(BUILD_BOARD)) { send(res, 400, { ok: false, error: '找不到 tools\\build-board.mjs' }); return; }
        const { spawnSync } = await import('node:child_process');
        const r = spawnSync(NODE, [BUILD_BOARD], { encoding: 'utf8', timeout: 60000 });
        const out = ((r.stdout || '') + (r.stderr || '')).trim();
        send(res, r.status === 0 ? 200 : 500, {
          ok: r.status === 0,
          code: r.status,
          output: out.slice(-600),
          data: r.status === 0 ? build() : null,
        });
      } catch (e) { send(res, 500, { ok: false, error: String(e?.message || e) }); }
    },
  });

  server.register({
    kind: 'exact',
    path: '/board/api/status',
    handler: async (req, res) => {
      if (req.method !== 'POST') { send(res, 405, { ok: false }); return; }
      try {
        const body = JSON.parse((await readJson(req)) || '{}');
        setRowStatus(body.project || '', body.who, body.status);
        appendLog(`（面板）${body.who} 在「${body.project || '任务'}」里改成「${body.status}」`);
        send(res, 200, { ok: true, data: build() });
      } catch (e) { send(res, 500, { ok: false, error: String(e?.message || e) }); }
    },
  });

  // 面板上「新建大任务」：填表 → 写回任务板
  server.register({
    kind: 'exact',
    path: '/board/api/project',
    handler: async (req, res) => {
      if (req.method !== 'POST') { send(res, 405, { ok: false }); return; }
      try {
        const body = JSON.parse((await readJson(req)) || '{}');
        const r = addProject({
          title: body.title,
          kind: body.kind === '长线' ? '长线' : '短线',
          intro: body.intro,
          goal: body.goal,
          span: body.span,
          accept: body.accept,
          members: Array.isArray(body.members) ? body.members.filter((m) => m && m.who) : [],
        });
        appendLog(`（面板）新建大任务「${r.title}」（${r.kind}，${r.members} 人）`);
        send(res, 200, { ok: true, title: r.title, data: build() });
      } catch (e) { send(res, 500, { ok: false, error: String(e?.message || e) }); }
    },
  });

  // 面板上改某一行的「阶段」和「下一步」
  server.register({
    kind: 'exact',
    path: '/board/api/row',
    handler: async (req, res) => {
      if (req.method !== 'POST') { send(res, 405, { ok: false }); return; }
      try {
        const body = JSON.parse((await readJson(req)) || '{}');
        setRowFields(body.project || '', body.who, { stage: body.stage, next: body.next });
        appendLog(`（面板）${body.who} 的阶段/下一步更新了`);
        send(res, 200, { ok: true, data: build() });
      } catch (e) { send(res, 500, { ok: false, error: String(e?.message || e) }); }
    },
  });
}
