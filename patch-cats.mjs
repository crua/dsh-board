import fs from 'node:fs';

const P = 'D:/AI/DeepSeek/dsh-board/lib/client.js';
let s = fs.readFileSync(P, 'utf8');
const must = (n) => { if (!s.includes(n)) { console.log('缺锚：' + n.slice(0, 70)); process.exit(1); } };

/* ---------- 文案：把「没记录 / 这步完了」这类怪词换掉 ---------- */
s = s.split('"没记录"').join('"还没动"');
s = s.split('text: "没记录"').join('text: "还没动"');
s = s.split('text: "这步完了"').join('text: "已完成"');
s = s.split('text: "停了 24h+"').join('text: "停了 24 小时"');
s = s.split('text: "停了 12h+"').join('text: "停了半天"');
s = s.split('text: "没记录"').join('text: "还没动"');
s = s.split('kind === "unknown" ? "unknown" : ""').join('kind === "unknown" ? "unknown" : ""');

/* ---------- 「还没动」用灰色，不再是黑灰混在一起 ---------- */
must('      ".dbw-st{');
s = s.replace('      ".dbw-st{',
  '      ".dbw-st.warm{background:rgba(201,154,60,.14)}",\n      ".dbw-st.late{background:rgba(217,92,92,.14)}",\n      ".dbw-st.doing{background:rgba(91,143,214,.14)}",\n      ".dbw-st.waiting{background:rgba(157,140,224,.16)}",\n      ".dbw-st.done{background:rgba(95,174,112,.16)}",\n      ".dbw-st{');

/* 行内状态带上 kind 类名，好上底色 */
must('            h("span", { className: "dbw-st" + (kind === "unknown" ? " unknown" : "") }, waitText));');
s = s.replace('            h("span", { className: "dbw-st" + (kind === "unknown" ? " unknown" : "") }, waitText));',
  '            h("span", { className: "dbw-st " + kind }, waitText));');

/* ---------- 短线 / 常驻 徽章上色 ---------- */
must('      ".dbw-badge.short{');
s = s.replace('      ".dbw-badge.short{',
  '      ".dbw-badge.short{background:rgba(91,143,214,.14);color:#6fa3e0}",\n      ".dbw-badge.short__old{');
s = s.replace('      ".dbw-badge.long{background:rgba(91,143,214,.18);color:#6fa3e0}",',
  '      ".dbw-badge.long{background:rgba(95,174,112,.16);color:#5fae70}",');

/* ---------- 大类框（可折叠）：按 category 分组 ---------- */
must('          const GROUPS = [');
const groupBlockStart = s.indexOf('          const GROUPS = [');
const groupBlockEnd = s.indexOf('          return out;', groupBlockStart);
if (groupBlockEnd < 0) { console.log('分组块尾没找到'); process.exit(1); }

const newBlock = [
  '          // 大类框（他 14:5x 要的）：任务板先按种类分框，框可折叠，已完成默认折叠。',
  '          const catOf = (t) => {',
  '            const c = String(t.category || "").trim();',
  '            if (c) return c;',
  '            const meta = t.meta || {};',
  '            if (analyze(t).stage === "完成") return "已完成";',
  '            if (/插件/.test(t.title)) return "插件";',
  '            if (/长线|常驻/.test(String(meta["类型"] || ""))) return "长线";',
  '            return "短线";',
  '          };',
  '          const CAT_ORDER = ["短线", "长线", "插件", "已完成"];',
  '          const buckets = {};',
  '          for (const t of sorted) {',
  '            const k = catOf(t);',
  '            (buckets[k] = buckets[k] || []).push(t);',
  '          }',
  '          const cats = [...Object.keys(buckets)].sort((x, y) => {',
  '            const ix = CAT_ORDER.indexOf(x), iy = CAT_ORDER.indexOf(y);',
  '            return (ix < 0 ? 99 : ix) - (iy < 0 ? 99 : iy);',
  '          });',
  '          const out = [];',
  '          for (const c of cats) {',
  '            const list = buckets[c];',
  '            const openCnt = list.filter((t) => analyze(t).stage !== "完成").length;',
  '            const collapsed = c === "已完成" ? !doneOpen : !!catClosed[c];',
  '            out.push(h("div", { className: "dbw-cat" + (collapsed ? " closed" : ""), key: "cat-" + c },',
  '              h("div", { className: "dbw-cat-h", onClick: () => toggleCat(c) },',
  '                h("span", { className: "arrow" }, collapsed ? "▸" : "▾"),',
  '                h("span", { className: "t" }, c),',
  '                h("span", { className: "n" }, list.length + " 个任务"),',
  '                h("span", { className: "n" }, openCnt ? openCnt + " 个没做完" : "都做完"),',
  '                collapsed ? h("span", { className: "peek" }, list.slice(0, 3).map((t) => t.id || t.title).join(" · ")) : null)));',
  '            if (collapsed) continue;',
  '            for (const t of list) out.push(h(TaskCard, { key: t.id || t.title, task: t, srcText, srcOpen: srcOpen === t.title, onToggleSrc: toggleSrc, showHints, onToggleHints: () => setShowHints(!showHints) }));',
  '          }',
  '',
].join('\n');

s = s.slice(0, groupBlockStart) + newBlock + s.slice(groupBlockEnd);

/* 折叠状态 */
must('      const [showHints, setShowHints] = useState(false);');
s = s.replace('      const [showHints, setShowHints] = useState(false);',
  '      const [showHints, setShowHints] = useState(false);\n      const [catClosed, setCatClosed] = useState({});   // 大类框折叠状态（已完成的默认折叠走 doneOpen）\n      const toggleCat = (c) => setCatClosed((m) => ({ ...m, [c]: !m[c] }));');

/* 大类框样式 */
must('      ".dbw-group{');
s = s.replace('      ".dbw-group{',
  [
    '      ".dbw-cat{margin-top:16px;border:.5px solid var(--dsw-alias-border-l2);border-radius:12px;overflow:hidden;background:var(--dsw-alias-bg-layer-1,transparent)}",',
    '      ".dbw-cat-h{display:flex;align-items:center;gap:9px;padding:10px 14px;cursor:pointer;background:var(--dsw-alias-bg-layer-2,transparent)}",',
    '      ".dbw-cat-h:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.08))}",',
    '      ".dbw-cat-h .arrow{font-size:10px;color:var(--dsw-alias-label-tertiary)}",',
    '      ".dbw-cat-h .t{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary)}",',
    '      ".dbw-cat-h .n{font-size:10.5px;padding:1px 8px;border-radius:999px;background:rgba(127,127,127,.14);color:var(--dsw-alias-label-tertiary)}",',
    '      ".dbw-cat-h .peek{margin-left:auto;font-size:10.5px;color:var(--dsw-alias-label-tertiary);font-family:ui-monospace,monospace}",',
    '      ".dbw-cat .dbw-proj{margin:10px 12px}",',
    '      ".dbw-group{',
  ].join('\n'));

fs.writeFileSync(P, s, 'utf8');
console.log('大类框 / 文案 / 状态色 都改了');
