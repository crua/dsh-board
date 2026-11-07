/**
 * dsh-board —— 客户端半边：DSH「设置」里的「任务面板」。
 *
 * v0.7（2026-11-02）：按任务排；一个任务一张卡。
 * 视觉分层（Vera + Mira 09:37 的意见都进来了）：
 *   · 卡头色带 + 卡头淡底色 = **整条任务的阶段**（还没开工 / 进行中 / 有人停了 / 等别人 / 卡住 / 完成）
 *   · 人那一行的「这一步」= 这个人停在哪，只描边不填底，跟卡头分开
 *   · 顶栏三个自动数：卡住几条、最久没动静多少小时、超期最多几天
 *   · 顶部一行「现在最该看的是谁 · 哪张 · 欠了多久」
 *   · 排序：超期 → 卡住 → 最久没动静（Vera：自己欠的比等别人更要命）
 *   · 短线和长线两种卡：短线挂到期日/超期天数；长线挂「上次动静 N 天前」（不写周期，周期会骗人）
 */
window.__ModuleLoader__.load({
  id: "dsh-board",
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    const React = require("react");
    const { createElement: h, useEffect, useState } = React;

    const API = "/board/api";
    const CSS_TAG = "dsh-board/section.css";

    const PERSON_COLOR = {
      Vera: "#c98bc4", Vigil: "#7fb3ff", Mira: "#8fd0c0",
      Ink: "#e0a04a", Verse: "#9d8ce0", Drift: "#7fc08a", Vero: "#e06a6a",
    };
    const dotColor = (who) => PERSON_COLOR[String(who || "").trim()] || "rgba(140,148,158,.85)";
    const CAT_COLOR = {
      流程: "rgba(91,143,214,.95)",
      插件: "rgba(157,140,224,.95)",
      个人: "rgba(95,174,112,.95)",
      完结: "rgba(140,148,158,.95)",
    };
    const PEOPLE = ["Vera", "Vigil", "Mira", "Ink", "Verse", "Drift", "Vero"];

    /* 任务阶段：卡头用这一套；跟「这一步」是两回事 */
    const STAGE = {
      未开始: { color: "rgba(140,148,158,.95)", cls: "stage-idle", text: "还没开工", rank: 5 },
      进行中: { color: "rgba(91,143,214,.95)", cls: "stage-doing", text: "进行中", rank: 3 },
      有卡点: { color: "rgba(201,154,60,.95)", cls: "stage-warm", text: "有人停了", rank: 2 },
      等别人: { color: "rgba(157,140,224,.95)", cls: "stage-wait", text: "在等别人", rank: 1 },
      卡住: { color: "rgba(217,92,92,.95)", cls: "stage-late", text: "卡住", rank: 0 },
      完成: { color: "rgba(95,174,112,.95)", cls: "stage-done", text: "完成", rank: 9 },
    };

    /* 人这一行的「这一步」：只描边，不填底 */
    const PARTS = {
      late: { color: "#d95c5c", text: "停了 24 小时" },
      warm: { color: "#c99a3c", text: "停了半天" },
      doing: { color: "rgba(91,143,214,.95)", text: "在做" },
      waiting: { color: "rgba(157,140,224,.95)", text: "在等" },
      done: { color: "#5fae70", text: "已完成" },
      unknown: { color: "rgba(140,148,158,.9)", text: "还没动" },
    };

    const isWait = (body) => /(等验收|待验收|等[^\s，。]{0,6}(点头|回复|回话|确认|结果|素材|原文)|在等)/.test(String(body || ""));
    const waitWho = (body) => {
      const m = String(body || "").match(/等\s*(Vera|Mira|Ink|Verse|Drift|Vigil|Vero)/);
      return m ? m[1] : "";
    };
    const parseDue = (span) => {
      const m = String(span || "").match(/(\d{1,2}-\d{1,2})\s*(?:→|->|~|到)\s*(\d{1,2}-\d{1,2})/);
      if (!m) return null;
      const [mm, dd] = m[2].split("-").map(Number);
      const now = new Date();
      const d = new Date(now.getFullYear(), mm - 1, dd, 23, 59, 59);
      if (d.getTime() < now.getTime() - 300 * 86400000) d.setFullYear(now.getFullYear() + 1);
      return d.getTime();
    };

    const CSS = [
      ".dbw{max-width:900px;color:var(--dsw-alias-label-primary);display:flex;flex-direction:column;background:var(--dsw-alias-bg-base,transparent)}",
      ".dbw-h1{margin:0;font-size:16px;font-weight:600;line-height:24px;letter-spacing:.2px}",
      ".dbw-lead{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;margin:5px 0 0}",
      ".dbw-topbar{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-top:14px;flex-wrap:wrap}",
      ".dbw-chips{display:flex;gap:8px;flex-wrap:wrap}",
      ".dbw-chip{font-size:11.5px;line-height:18px;padding:2px 10px;border-radius:999px;border:.5px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);display:inline-flex;gap:6px;align-items:center;background:var(--dsw-alias-bg-layer-1,transparent)}",
      ".dbw-chip b{font-weight:600;color:var(--dsw-alias-label-primary)}",
      ".dbw-chip.bad{border-color:rgba(217,92,92,.55);color:#d95c5c}",
      ".dbw-chip.warn{border-color:rgba(201,154,60,.5);color:#c99a3c}",
      ".dbw-btns{display:flex;gap:8px}",
      ".dbw-btn{background:transparent;border:.5px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);border-radius:6px;font-size:12px;height:28px;padding:0 12px;cursor:pointer;white-space:nowrap}",
      ".dbw-btn.pri{background:var(--dsw-alias-brand-primary);border:none;color:var(--dsw-alias-bg-base,#fff)}",
      ".dbw-btn:disabled{opacity:.45;cursor:default}",
      ".dbw-btn.sm{height:24px;font-size:11.5px;padding:0 9px}",

      ".dbw-topline{margin-top:12px;font-size:12.5px;line-height:19px;color:var(--dsw-alias-label-secondary);border-left:3px solid rgba(217,92,92,.75);padding:7px 12px;background:rgba(217,92,92,.06);border-radius:0 8px 8px 0}",
      ".dbw-topline.calm{border-left-color:rgba(95,174,112,.75);background:rgba(95,174,112,.06)}",
      ".dbw-topline b{color:var(--dsw-alias-label-primary);font-weight:600}",
      ".dbw-help{width:20px;height:20px;border-radius:50%;border:.5px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:18px;cursor:pointer;padding:0;flex:none}",
      ".dbw-help:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.08));color:var(--dsw-alias-label-primary)}",
      ".dbw-legend{display:flex;gap:14px;flex-wrap:wrap;align-items:center;margin-top:10px;font-size:11px;color:var(--dsw-alias-label-tertiary)}",
      ".dbw-legend i{display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:5px;vertical-align:-1px}",

      ".dbw-form{margin-top:14px;border:.5px solid var(--dsw-alias-border-l2);border-radius:12px;padding:14px 16px;background:var(--dsw-alias-bg-layer-1,var(--dsw-alias-bg-base,transparent))}",
      ".dbw-form-title{font-size:13px;font-weight:600;margin-bottom:4px}",
      ".dbw-grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px}",
      ".dbw-grid3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px}",
      ".dbw-field{display:flex;flex-direction:column;gap:4px;margin-top:10px}",
      ".dbw-flabel{font-size:11px;color:var(--dsw-alias-label-tertiary)}",
      ".dbw-input{font:inherit;font-size:12px;padding:6px 9px;border-radius:6px;border:.5px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary)}",
      ".dbw-mem{display:grid;grid-template-columns:120px 1fr auto;gap:8px;align-items:end;margin-top:8px}",
      ".dbw-x{background:transparent;border:none;color:var(--dsw-alias-label-tertiary);cursor:pointer;font-size:14px;padding:0 4px}",
      ".dbw-form-foot{display:flex;gap:8px;margin-top:14px}",

      ".dbw-proj{margin-top:10px;border:.5px solid var(--dsw-alias-border-l2);border-radius:10px;overflow:hidden;background:var(--dsw-alias-bg-layer-1,var(--dsw-alias-bg-base,transparent))}",
      ".dbw-proj-head{display:flex;align-items:flex-start;gap:10px;padding:10px 12px 9px;border-bottom:.5px solid var(--dsw-alias-border-l2)}",
      ".dbw-proj.stage-late{border-color:rgba(217,92,92,.55)}",
      ".dbw-proj.stage-late .dbw-proj-head{background:rgba(217,92,92,.10)}",
      ".dbw-proj.stage-warm{border-color:rgba(201,154,60,.45)}",
      ".dbw-proj.stage-warm .dbw-proj-head{background:rgba(201,154,60,.10)}",
      ".dbw-proj.stage-wait{border-color:rgba(157,140,224,.45)}",
      ".dbw-proj.stage-wait .dbw-proj-head{background:rgba(157,140,224,.10)}",
      ".dbw-proj.stage-doing .dbw-proj-head{background:rgba(91,143,214,.08)}",
      ".dbw-proj.stage-done .dbw-proj-head{background:rgba(95,174,112,.08)}",
      ".dbw-proj.stage-idle .dbw-proj-head{background:rgba(127,127,127,.06)}",
      ".dbw-bar{width:3px;border-radius:2px;align-self:stretch;flex:none;min-height:38px}",
      ".dbw-catdot{display:inline-block;width:6px;height:6px;border-radius:50%;margin-right:6px;vertical-align:1px}",
      ".dbw-title{font-size:14px;font-weight:600;line-height:20px}",
      ".dbw-sub{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary);margin-top:4px;display:flex;gap:10px;flex-wrap:wrap;align-items:center}",
      ".dbw-sub b{color:var(--dsw-alias-label-secondary);font-weight:500}",
      ".dbw-badge{font-size:10.5px;padding:1px 7px;border-radius:4px;margin-left:6px;vertical-align:1px}",
      ".dbw-badge.short{background:rgba(91,143,214,.14);color:#6fa3e0}",
      ".dbw-badge.short2{background:rgba(127,127,127,.16);color:var(--dsw-alias-label-secondary)}",
      ".dbw-badge.long{background:rgba(95,174,112,.16);color:#5fae70}",
      ".dbw-badge.sub{background:rgba(201,154,60,.16);color:#c99a3c}",
      ".dbw-badge.due{background:rgba(217,92,92,.16);color:#d95c5c}",
      ".dbw-proj-state{margin-left:auto;flex:none;font-size:11px;padding:3px 10px;border-radius:999px;border:1px solid currentColor;white-space:nowrap}",
      ".dbw-metaFold{display:flex;gap:22px;flex-wrap:wrap;padding:10px 16px;border-bottom:.5px solid var(--dsw-alias-border-l2)}",
      ".dbw-metaFold .k{font-size:10.5px;color:var(--dsw-alias-label-tertiary);letter-spacing:.04em}",
      ".dbw-metaFold .v{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);margin-top:2px;max-width:560px}",
      ".dbw-quick{margin-top:16px;border:.5px dashed var(--dsw-alias-border-l2);border-radius:12px;background:rgba(127,127,127,.04);overflow:hidden}",
      ".dbw-quick-h{display:flex;align-items:center;gap:9px;padding:9px 14px;border-bottom:.5px dashed rgba(127,127,127,.2)}",
      ".dbw-quick-h .t{font-size:12.5px;font-weight:600}",
      ".dbw-quick-h .n{font-size:10.5px;padding:1px 8px;border-radius:999px;background:rgba(127,127,127,.14);color:var(--dsw-alias-label-tertiary)}",
      ".dbw-quick-h .hint{font-size:10.5px;color:var(--dsw-alias-label-tertiary)}",
      ".dbw-quick-row{display:grid;grid-template-columns:64px minmax(0,1fr) 72px;gap:10px;align-items:center;padding:6px 14px;font-size:12px;color:var(--dsw-alias-label-secondary)}",
      ".dbw-quick-row .id{font-family:ui-monospace,monospace;font-size:10.5px;color:var(--dsw-alias-label-tertiary)}",
      ".dbw-quick-row .txt{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
      ".dbw-quick-row .who{font-size:10.5px;color:var(--dsw-alias-label-tertiary);text-align:right}",
      ".dbw-quick-row.done .txt{text-decoration:line-through;opacity:.6}",
      ".dbw-verifyline{margin:8px 16px 0;font-size:11.5px;line-height:18px;color:var(--dsw-alias-label-tertiary)}",
      ".dbw-authline{margin:4px 16px 0;font-size:11.5px;line-height:18px;color:#c99a3c}",
      ".dbw-subhead{display:flex;align-items:center;gap:8px;padding:7px 16px;background:rgba(127,127,127,.05);border-bottom:.5px solid rgba(127,127,127,.12);font-size:10.5px;letter-spacing:.05em;color:var(--dsw-alias-label-tertiary)}",
      ".dbw-subhead .tag{font-size:10px;padding:0 6px;border-radius:4px;background:rgba(127,127,127,.14);letter-spacing:0}",
      ".dbw-thead{display:grid;grid-template-columns:96px minmax(0,1fr) 84px 92px;gap:10px;padding:8px 16px;border-bottom:.5px solid var(--dsw-alias-border-l2)}",
      ".dbw-th{font-size:10.5px;color:var(--dsw-alias-label-tertiary);letter-spacing:.06em}",
      ".dbw-row{display:grid;grid-template-columns:88px minmax(0,1fr) 62px 84px;align-items:start;gap:10px;padding:9px 16px;border-bottom:.5px solid rgba(127,127,127,.10)}",
      ".dbw-row:last-child{border-bottom:none}",
      ".dbw-row:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.07))}",
      ".dbw-cell{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);word-break:break-word;overflow-wrap:anywhere}",
      ".dbw-who{font-size:12px;line-height:18px;display:flex;align-items:center;gap:6px;white-space:nowrap}",
      ".dbw-tdot{width:7px;height:7px;border-radius:50%;flex:none}",
      ".dbw-num{font-size:11.5px;line-height:18px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;white-space:nowrap}",
      ".dbw-num.late{color:#d95c5c}",
      ".dbw-num.warm{color:#c99a3c}",
      ".dbw-st.warm{color:#c99a3c}",
      ".dbw-st.late{color:#d95c5c}",
      ".dbw-st.doing{color:#6fa3e0}",
      ".dbw-st.waiting{color:#8f7fd8}",
      ".dbw-st.done{color:#5fae70}",
      ".dbw-st{font-size:12px;line-height:18px;padding:0;border:none;background:transparent;display:inline-block;white-space:nowrap}",
      ".dbw-kids{padding:8px 16px 10px;border-bottom:.5px solid rgba(127,127,127,.12);background:rgba(127,127,127,.03)}",
      ".dbw-kids-h{font-size:10.5px;color:var(--dsw-alias-label-tertiary);margin-bottom:4px}",
      ".dbw-kid{display:flex;align-items:center;gap:8px;font-size:11.5px;line-height:18px;color:var(--dsw-alias-label-secondary);padding:2px 0}",
      ".dbw-kid .id{font-family:ui-monospace,monospace;color:var(--dsw-alias-label-tertiary)}",
      ".dbw-kid .t{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
      ".dbw-kid .st{font-size:10.5px;color:#c99a3c}",
      ".dbw-kid.done .st{color:#5fae70}",
      ".dbw-cat{margin-top:16px;border:.5px solid var(--dsw-alias-border-l2);border-radius:12px;overflow:hidden;background:var(--dsw-alias-bg-layer-1,transparent)}",
      ".dbw-cat-h{display:flex;align-items:center;gap:9px;padding:10px 14px;cursor:pointer;background:var(--dsw-alias-bg-layer-2,transparent)}",
      ".dbw-cat-h:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.08))}",
      ".dbw-cat-h .bar{width:3px;height:18px;border-radius:2px;flex:none}",
      ".dbw-cat-h .desc{font-size:10.5px;color:var(--dsw-alias-label-tertiary)}",
      ".dbw-cat-empty{font-size:11.5px;color:var(--dsw-alias-label-tertiary);padding:14px 16px;border-top:.5px dashed rgba(127,127,127,.2);margin:0 12px 10px}",
      ".dbw-cat-h .arrow{font-size:10px;color:var(--dsw-alias-label-tertiary)}",
      ".dbw-cat-h .t{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary)}",
      ".dbw-cat-h .n{font-size:10.5px;padding:1px 8px;border-radius:999px;background:rgba(127,127,127,.14);color:var(--dsw-alias-label-tertiary)}",
      ".dbw-cat-h .peek{margin-left:auto;font-size:10.5px;color:var(--dsw-alias-label-tertiary);font-family:ui-monospace,monospace}",
      ".dbw-cat .dbw-proj{margin:10px 12px}",
      ".dbw-group{margin-top:18px}",
      ".dbw-group-h{display:flex;align-items:center;gap:9px;padding:6px 2px 8px;font-size:12px;color:var(--dsw-alias-label-secondary);border-bottom:.5px solid var(--dsw-alias-border-l2);margin-bottom:2px}",
      ".dbw-group-h .dotbar{width:3px;height:14px;border-radius:2px;flex:none}",
      ".dbw-group-h .t{font-weight:600;color:var(--dsw-alias-label-primary)}",
      ".dbw-group-h .n{font-size:10.5px;padding:0 7px;border-radius:999px;background:rgba(127,127,127,.14);color:var(--dsw-alias-label-tertiary)}",
      ".dbw-group-h .hint{font-size:11px;color:var(--dsw-alias-label-tertiary)}",
      ".dbw-group-h .toggle{margin-left:auto;font-size:11px;color:var(--dsw-alias-label-tertiary)}",
      ".dbw-grouppad{height:2px}",
      ".dbw-progress{display:inline-flex;align-items:center;gap:6px}",
      ".dbw-progress .bar{width:56px;height:5px;border-radius:3px;background:rgba(127,127,127,.18);overflow:hidden;display:inline-block}",
      ".dbw-progress .fill{display:block;height:100%;border-radius:3px;opacity:.85}",
      ".dbw-progress .txt{font-size:10.5px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}",
      ".dbw-date{display:inline-flex;align-items:center;gap:5px;font-size:10.5px;padding:1px 8px;border-radius:999px;background:rgba(127,127,127,.10);color:var(--dsw-alias-label-secondary)}",
      ".dbw-date i{font-style:normal;font-size:10px;opacity:.8}",
      ".dbw-date.due-soon{background:rgba(201,154,60,.16);color:#c99a3c}",
      ".dbw-date.due-late{background:rgba(217,92,92,.16);color:#d95c5c}",
      ".dbw-tag{font-size:10.5px;padding:1px 8px;border-radius:999px}",
      ".dbw-tag.wait{background:rgba(157,140,224,.16);color:#8f7fd8}",
      ".dbw-tag.ok{background:rgba(95,174,112,.16);color:#5fae70}",
      ".dbw-tag.todo{background:rgba(201,154,60,.16);color:#c99a3c}",
      ".dbw-tag.late{background:rgba(217,92,92,.14);color:#d95c5c}",
      ".dbw-badge .mark{font-style:normal;margin-right:4px;font-size:9px;vertical-align:1px}",
      ".dbw-meta{display:grid;grid-template-columns:1fr;gap:0;border-bottom:.5px solid var(--dsw-alias-border-l2)}",
      ".dbw-meta-item{padding:9px 16px 10px}",
      ".dbw-meta-item + .dbw-meta-item{border-top:.5px dashed rgba(127,127,127,.18)}",
      ".dbw-meta-item.intro{background:rgba(127,127,127,.03)}",
      ".dbw-meta-item.accept{background:rgba(95,174,112,.05)}",
      ".dbw-meta-item .k{font-size:10.5px;letter-spacing:.04em;color:var(--dsw-alias-label-tertiary);display:flex;align-items:center;gap:5px}",
      ".dbw-meta-item .k .mk{font-style:normal;font-size:10px;opacity:.9}",
      ".dbw-meta-item .k .mk.ok{color:#5fae70}",
      ".dbw-meta-item .v{font-size:12px;line-height:19px;color:var(--dsw-alias-label-secondary);margin-top:3px}",
      ".dbw-thead{background:rgba(127,127,127,.045)}",
      ".dbw-theadnote{padding:5px 16px 6px;font-size:10.5px;color:var(--dsw-alias-label-tertiary);background:rgba(127,127,127,.045);border-bottom:.5px solid rgba(127,127,127,.10)}",
      ".dbw-st.unknown{color:var(--dsw-alias-label-tertiary)}",
      ".dbw-foot{display:flex;align-items:center;gap:10px;padding:8px 16px;border-top:.5px solid rgba(127,127,127,.12);background:rgba(127,127,127,.02)}",
      ".dbw-linkbtn{background:transparent;border:.5px solid var(--dsw-alias-border-l2);border-radius:6px;color:var(--dsw-alias-label-secondary);font-size:11.5px;height:24px;padding:0 10px;cursor:pointer}",
      ".dbw-linkbtn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.08))}",
      ".dbw-foot-hint{font-size:10.5px;color:var(--dsw-alias-label-tertiary)}",
      ".dbw-srcbar{display:flex;align-items:center;gap:10px;padding:8px 16px 2px}",
      ".dbw-hint{font-size:11px;color:var(--dsw-alias-label-tertiary)}",
      ".dbw-srcblock{font-family:ui-monospace,monospace;font-size:11px;line-height:17px;white-space:pre-wrap;background:rgba(127,127,127,.07);border-radius:8px;margin:6px 16px 10px;padding:9px 11px;max-height:220px;overflow:auto;color:var(--dsw-alias-label-secondary)}",
      ".dbw-empty{font-size:12px;color:var(--dsw-alias-label-tertiary);line-height:19px;padding:12px 16px}",

      ".dbw-about{border:.5px solid var(--dsw-alias-border-l2);border-radius:12px;margin-top:22px;overflow:hidden;background:var(--dsw-alias-bg-layer-1,var(--dsw-alias-bg-base,transparent))}",
      ".dbw-about-head{display:flex;align-items:center;gap:8px;padding:11px 16px;cursor:pointer;font-size:12px;color:var(--dsw-alias-label-secondary)}",
      ".dbw-about-head:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.06))}",
      ".dbw-about-head .arrow{font-size:10px;color:var(--dsw-alias-label-tertiary)}",
      ".dbw-about-body{padding:2px 0 8px;border-top:.5px solid var(--dsw-alias-border-l2)}",
      ".dbw-kv{display:grid;grid-template-columns:110px 1fr;gap:4px 12px;font-size:12px;line-height:19px;padding:10px 16px}",
      ".dbw-kv .k{color:var(--dsw-alias-label-tertiary);font-size:11.5px}",
      ".dbw-kv .v{color:var(--dsw-alias-label-secondary);word-break:break-all}",
      ".dbw-code{font-family:ui-monospace,monospace;font-size:11.5px;background:rgba(127,127,127,.1);border-radius:5px;padding:1px 6px}",
      ".dbw-warnbox{font-size:11.5px;line-height:19px;color:#c99a3c;border-left:2px solid rgba(201,154,60,.55);padding:6px 0 6px 12px;margin:6px 16px 12px}",
      ".dbw-ok{color:#5fae70;font-size:12px;margin-top:12px}",
      ".dbw-err{color:var(--dsw-alias-state-error-primary);font-size:12px;margin-top:12px}",
      ".dbw-pre{font-family:ui-monospace,monospace;font-size:11px;line-height:17px;white-space:pre-wrap;background:rgba(127,127,127,.08);border-radius:6px;padding:8px 10px;margin:10px 16px;max-height:120px;overflow:auto}",
    ].join("");

    function useStyleOnce() {
      useEffect(() => {
        if (typeof document !== "undefined" && !document.getElementById(CSS_TAG)) {
          const el = document.createElement("style");
          el.id = CSS_TAG;
          el.textContent = CSS;
          document.head.appendChild(el);
        }
      }, []);
    }

    const chip = (label, value, tone) => h("span", { className: "dbw-chip" + (tone ? " " + tone : ""), key: label },
      h("span", null, label), value != null ? h("b", null, String(value)) : null);

    const Field = ({ label, value, onChange, placeholder }) => h("label", { className: "dbw-field" },
      label ? h("span", { className: "dbw-flabel" }, label) : null,
      h("input", { className: "dbw-input", value: value ?? "", placeholder: placeholder || undefined, onChange: (e) => onChange(e.target.value) }));

    /* 算一张卡的所有派生数：阶段、最久多久、超期、在等谁 */
    function analyze(task) {
      const m = task.meta || {};
      const rows = task.rows || [];
      const open = rows.filter((r) => !r.done);
      const maxAge = open.reduce((x, r) => Math.max(x, r.ageHours ?? 0), 0);
      const late = open.filter((r) => (r.ageHours ?? 0) >= 24).length;
      const waiting = open.filter((r) => isWait(r.body)).length;
      const isLong = /长线|常驻/.test(String(m["类型"] || ""));
      const due = parseDue(m["起止"]);
      const overdueDays = due && open.length ? Math.floor((Date.now() - due) / 86400000) : 0;
      const stage = !rows.length ? "未开始"
        : open.length === 0 ? "完成"
        : late ? "卡住"
        : waiting === open.length ? "等别人"
        : maxAge >= 12 ? "有卡点"
        : "进行中";
      // Vera 17:33 ③：`@?` 是「还没人认领」，得单独算出来给卡头挂个提醒
      const unclaimed = open.filter((r) => /^(待认领|\?|未指派)$/.test(String(r.who || "").trim())).length;
      return { m, rows, open, maxAge, late, waiting, unclaimed, isLong, due, overdueDays, stage, key: 0 };
    }

    /* 排序（Vera：超期 > 卡住 > 最久没动；完成沉底） */
    const urgency = (task) => {
      const a = analyze(task);
      if (a.stage === "完成") return 999;
      let score = 0;
      if (a.overdueDays > 0) score += 0;
      else if (a.stage === "卡住") score += 100;
      else if (a.stage === "等别人") score += 200;
      else if (a.stage === "有卡点") score += 300;
      else score += 400;
      return score + Math.min(99, Math.round(a.maxAge / 2));
    };

    function TaskCard({ task, srcText, srcOpen, onToggleSrc, showHints, onToggleHints }) {
      const a = analyze(task);
      const st = STAGE[a.stage];
      const total = task.total || a.rows.length || 1;
      const doneN = (typeof task.doneN === "number") ? task.doneN : a.rows.filter((r) => r.done).length;
      const pct = Math.round((doneN / total) * 100);
      const dueLabel = a.isLong ? null : (a.m["起止"] ? String(a.m["起止"]).split(/→|->|~|到/).pop().trim() : null);
      const dueTone = a.overdueDays > 0 ? "due-late" : (a.due && (a.due - Date.now()) < 2 * 86400000 ? "due-soon" : "");

      return h("div", { className: "dbw-proj " + st.cls },
        h("div", { className: "dbw-proj-head" },
          h("div", { className: "dbw-bar", style: { background: st.color } }),
          h("div", { style: { flex: 1, minWidth: 0 } },
            h("div", { className: "dbw-title" },
              (task && task.category && CAT_COLOR[task.category]) ? h("span", { className: "dbw-catdot", style: { background: CAT_COLOR[task.category] }, title: "分类 " + task.category }) : null,
              task.title,
              // 他 19:49：子卡得让人一眼认出来——它就是父卡里那条"走流程时冒出来的补足"，
              // 完成后会自动并回父卡、跟着父卡进「完结」。
              task.parentId ? h("span", { className: "dbw-badge sub" }, "子卡 · " + task.parentId + " 的") : null,
              h("span", { className: "dbw-badge " + (a.isLong ? "long" : "short") },
                h("i", { className: "mark" }, a.isLong ? "\u25c6" : "\u25cf"),
                a.isLong ? "常驻" : "短线"),
              a.overdueDays > 0 ? h("span", { className: "dbw-badge due" }, "超期 " + a.overdueDays + " 天") : null),

            h("div", { className: "dbw-sub" },
              h("span", { className: "dbw-progress", title: "完成 " + doneN + " / " + total + " 步" },
                h("span", { className: "bar" }, h("span", { className: "fill", style: { width: pct + "%", background: st.color } })),
                h("span", { className: "txt" }, doneN + " / " + total + " 步")),
              dueLabel
                ? h("span", { className: "dbw-date " + dueTone },
                    h("i", null, "\u25f4"), (a.isLong ? "上次动静 " : "到期 ") + dueLabel)
                : (a.isLong ? h("span", { className: "dbw-date" }, h("i", null, "\u25f4"), "上次动静 ", a.maxAge ? Math.floor(a.maxAge / 24) + " 天前" : "今天") : null),
              a.waiting ? h("span", { className: "dbw-tag wait" }, a.waiting + " 人在等别人") : null,
              a.late ? h("span", { className: "dbw-tag late" }, a.late + " 人停了 24h+") : null,
              // Vera 17:33 ②：面板要有「谁验的、验了没」——改的人和验的人是同一个，这个病现在看不出来
              a.m["验"]
                ? h("span", { className: "dbw-tag " + (a.m["已验"] ? "ok" : "todo") },
                    "验 " + a.m["验"] + (a.m["已验"] ? " · 已验 " + a.m["已验"] : " · 未验"))
                : h("span", { className: "dbw-tag todo" }, "没写验收人"),
              // Vera 17:33 ③：`@?` 是「还没有人认领」，得有个地方站
              a.unclaimed ? h("span", { className: "dbw-tag todo" }, a.unclaimed + " 步待认领") : null)),
          h("button", {
            className: "dbw-help",
            title: showHints ? "收起说明" : "看这条的说明 / 验收标准",
            onClick: () => onToggleHints && onToggleHints(),
          }, "?"),
          h("span", { className: "dbw-proj-state", style: { color: st.color } }, st.text)),

        (showHints && (a.m["简介"] || a.m["验收"]))
          ? h("div", { className: "dbw-meta" },
              a.m["简介"] ? h("div", { className: "dbw-meta-item intro" },
                h("div", { className: "k" }, h("i", { className: "mk" }, "\u25b8"), "这是什么"),
                h("div", { className: "v" }, a.m["简介"])) : null,
              a.m["验收"] ? h("div", { className: "dbw-meta-item accept" },
                h("div", { className: "k" }, h("i", { className: "mk ok" }, "\u2713"), "怎么算做完"),
                h("div", { className: "v" }, a.m["验收"])) : null)
          : null,

        // Vera 19:19：验收标准不该藏在「?」里——它是一张卡能不能收的唯一依据，放明面上
        a.m["验收"] ? h("div", { className: "dbw-verifyline" }, "算过：", a.m["验收"]) : null,
        // 授权表：这条要不要等他点头（`｜授权:他定` 之类）
        a.m["授权"] ? h("div", { className: "dbw-authline" }, "要他点头：", a.m["授权"]) : null,
        h("div", { className: "dbw-thead" },
          h("span", { className: "dbw-th" }, "参与人"),
          h("span", { className: "dbw-th" }, "这一步在做什么"),
          h("span", { className: "dbw-th" }, "停了多久"),
          h("span", { className: "dbw-th" }, "这一步")),
        showHints ? h("div", { className: "dbw-theadnote" }, "下面每行是一个步骤，括号里是这步归谁") : null,
        a.rows.map((r, i) => {
          const wait = isWait(r.body);
          const who = waitWho(r.body);
          const kind = r.done ? "done" : wait ? "waiting" : r.ageHours == null ? "unknown" : r.ageHours >= 24 ? "late" : r.ageHours >= 12 ? "warm" : "doing";
          const pp = PARTS[kind];
          const waitText = wait && who ? "等 " + who + (r.ageHours ? " " + r.ageHours + "h" : "") : pp.text;
          return h("div", { className: "dbw-row", key: i },
            h("span", { className: "dbw-who" },
              h("span", { className: "dbw-tdot", style: { background: dotColor(r.who) } }), r.who),
            h("span", { className: "dbw-cell" }, r.body),
            h("span", { className: "dbw-num " + (kind === "late" ? "late" : kind === "warm" ? "warm" : "") },
              r.ageHours != null ? r.ageHours + " h" : "\u2014"),
            h("span", { className: "dbw-st " + kind }, waitText));
        }),

        h("div", { className: "dbw-foot" },
          h("button", { className: "dbw-linkbtn", onClick: () => onToggleSrc && onToggleSrc(task.title) },
            srcOpen ? "收起原文" : "看这张卡的原文"),
          h("span", { className: "dbw-foot-hint" }, "就是 03-待办\\_现在.md 里这一节，不用另外翻文件")),
        srcOpen
          ? h("pre", { className: "dbw-srcblock" }, (() => {
              const t = String(srcText || "");
              if (!t) return "读取中…";
              // Mira 17:00 定位到根：卡上标题是「编号　正文」，原文标题是「编号　正文（括号备注）」，
              // 备注被剥过所以整串比不中。改成**只按编号找**——编号是唯一的。
              const id = String(task.id || String(task.title || "").split("\u3000")[0] || "").trim();
              if (!id) return "这张卡没有编号，没法回原文";
              const lines = t.split("\n");
              const at = lines.findIndex((l) => l.startsWith("### " + id));
              if (at < 0) return "在 _现在.md 里没找到 [" + id + "] 这一节（可能编号改过）";
              const keep = [lines[at]];
              for (let k = at + 1; k < lines.length; k++) {
                if (lines[k].startsWith("### ")) break;
                keep.push(lines[k]);
              }
              return keep.join("\n").trim();
            })())
          : null);
    }

    /* T-003：全家同一份 _现在.md 里的大流程，紧跟在任务卡后面 */
    function FlowList({ flows }) {
      if (!flows || !flows.length) return null;
      const open = flows.filter((f) => !f.done);
      return h("div", { className: "dbw-proj" },
        h("div", { className: "dbw-proj-head" },
          h("div", { className: "dbw-bar", style: { background: "rgba(140,148,158,.9)" } }),
          h("div", { style: { flex: 1, minWidth: 0 } },
            h("div", { className: "dbw-title" }, "全家的大流程", h("span", { className: "dbw-badge short" }, h("i", { className: "mark" }, "\u25a0"), "来自 _现在.md")),
            h("div", { className: "dbw-sub" }, h("span", null, open.length + " / " + flows.length + " 条没完成"))),
          h("span", { className: "dbw-proj-state", style: { color: open.length ? "rgba(91,143,214,.95)" : "#5fae70" } }, open.length ? "在做" : "完成")),
        h("div", { className: "dbw-thead" },
          h("span", { className: "dbw-th" }, "编号"),
          h("span", { className: "dbw-th" }, "这件事"),
          h("span", { className: "dbw-th" }, "谁验"),
          h("span", { className: "dbw-th" }, "算过：怎么算做完")),
        flows.map((f, i) => h("div", { className: "dbw-row", key: i },
          h("span", { className: "dbw-num" }, f.id),
          h("span", { className: "dbw-cell" }, f.text),
          h("span", { className: "dbw-cell" }, f.verify || "—"),
          h("span", { className: "dbw-cell", style: { fontSize: 11.5, color: "var(--dsw-alias-label-tertiary)" } }, f.how || "—"))));
    }
    /* 幻觉反制（T-104-a 教训 / T-104-b 承诺对账）：只报不拦，给他一个看得见的差集 */
    function HygieneCard({ h }) {
      if (!h) return null;
      const total = (h.lessonsOpen || 0) + (h.promisesOpen || 0);
      return h("div", { className: "dbw-cat", style: { marginTop: 16 } },
        h("div", { className: "dbw-cat-h" },
          h("span", { className: "bar", style: { background: total ? "rgba(201,154,60,.95)" : "rgba(95,174,112,.95)" } }),
          h("span", { className: "t" }, "幻觉反制"),
          h("span", { className: "n" }, "教训 " + (h.lessonsOpen || 0) + " 条没回"),
          h("span", { className: "n" }, "承诺 " + (h.promisesOpen || 0) + " 句没对上"),
          h("span", { className: "n" }, "覆盖面漏 " + (h.coverageMissing || 0) + " 条")),
        total ? h("div", { style: { padding: "6px 16px 12px" } },
          (h.lessons || []).map((t, i) => h("div", { className: "dbw-cell", key: "l" + i, style: { fontSize: 11.5, color: "var(--dsw-alias-label-tertiary)" } }, "· 教训：" + t)),
          (h.promises || []).map((t, i) => h("div", { className: "dbw-cell", key: "p" + i, style: { fontSize: 11.5, color: "var(--dsw-alias-label-tertiary)" } }, "· 承诺：" + t)))
          : h("div", { className: "dbw-cat-empty" }, "两类都干净：没有没回的教训，也没有说了没做的承诺。"));
    }
    /* 白屏自救：错误边界。以前一出错整块就没了，我只能靠猜；现在把错误显示出来并送到后端。 */
    class PanelBoundary extends React.Component {
      constructor(props) { super(props); this.state = { err: null }; }
      static getDerivedStateFromError(err) { return { err }; }
      componentDidCatch(err, info) {
        try {
          fetch(API + "/err", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message: String(err && err.message || err), stack: String(err && err.stack || ""), info: String(info && info.componentStack || "") }),
          });
        } catch {}
      }
      render() {
        if (!this.state.err) return this.props.children;
        return h("div", { className: "dbw-err" }, "这块面板渲染出错：" + String(this.state.err && this.state.err.message || this.state.err));
      }
    }
    function AboutFold({ about, open, onToggle, out }) {
      if (!about) return null;
      const kv = (k, v) => [h("div", { className: "k", key: "k" + k }, k), h("div", { className: "v", key: "v" + k }, v)];
      return h("div", { className: "dbw-about" },
        h("div", { className: "dbw-about-head", onClick: onToggle },
          h("span", { className: "arrow" }, open ? "\u25be" : "\u25b8"),
          h("span", null, "关于这块面板 · v" + about.version + " · 数据源 / 文件 / 环境"),
          h("span", { style: { marginLeft: "auto", fontSize: 10.5, color: "var(--dsw-alias-label-tertiary)" } }, open ? "收起" : "展开")),
        open ? h("div", { className: "dbw-about-body" },
          h("div", { className: "dbw-kv" },
            ...kv("插件", about.name),
            ...kv("版本", h("span", null, h("span", { className: "dbw-code" }, "v" + about.version), " · " + (about.license || "—"))),
            ...kv("用途", about.description || "—"),
            ...kv("最近构建", about.builtAt ? new Date(about.builtAt).toLocaleString("zh-CN", { hour12: false }) : "—"),
            ...kv("数据源", h("span", null, h("span", { className: "dbw-code" }, about.data.path),
              about.data.exists ? "　" + Math.round(about.data.bytes / 1024) + " KB" : "　（不存在）")),
            ...kv("格式", about.data.auto ? "自动生成（不手改）" : "手写版"),
            ...kv("运行时", h("span", null, about.runtime.node + " · " + about.runtime.platform + " · pid " + about.runtime.pid)),
            ...about.files.map((f) => [h("div", { className: "k", key: "kf" + f.path }, "文件"),
              h("div", { className: "v", key: "vf" + f.path }, h("span", { className: "dbw-code" }, f.path), "　" + f.bytes + " B")])),
          h("div", { className: "dbw-warnbox" },
            "这里没有编辑按钮：任务卡正文住在 03-待办\\_现在.md 里，这块只读；新建任务用上面的表单，改任务去改那个文件再重建。"),
          out ? h("div", { className: "dbw-pre" }, out) : null)
          : null);
    }

    const BoardSection = (props) => h(PanelBoundary, null, h(BoardInner, props));

    function BoardInner() {
      useStyleOnce();
      const [data, setData] = useState(null);
      const [busy, setBusy] = useState(false);
      const [msg, setMsg] = useState("");
      const [err, setErr] = useState("");
      const [out, setOut] = useState("");
      const [aboutOpen, setAboutOpen] = useState(false);
      const [srcOpen, setSrcOpen] = useState("");
      const [doneOpen, setDoneOpen] = useState(false);
      const [showHints, setShowHints] = useState(false);   // 默认收起「这是什么/怎么算做完」
      const [catClosed, setCatClosed] = useState({});      // 大类框折叠（已完成走 doneOpen）
      // 大类框折叠。注意：「完结」框的折叠走的是 doneOpen，不走 catClosed。
      // 2026-11-03 08:4x 他点不开完结界面——就是因为这里只改了 catClosed，doneOpen 永远是 false，
      // 于是一个"展开"的点击动作，等于什么都没发生。
      const toggleCat = (c) => {
        if (c === "完结") { setDoneOpen((v) => !v); return; }
        setCatClosed((m) => ({ ...m, [c]: !m[c] }));
      };
      const [srcText, setSrcText] = useState("");
      const [formOpen, setFormOpen] = useState(false);
      const [form, setForm] = useState({
        title: "", kind: "短线", span: "", intro: "", accept: "",
        members: [{ who: "Vigil", what: "" }],
      });

      async function load() {
        setBusy(true); setErr("");
        try {
          const r = await fetch(API + "/data");
          const j = await r.json();
          if (!j.ok) throw new Error(j.error || "读取失败");
          setData(j);
        } catch (e) { setErr("读不到任务板：" + (e?.message || e)); }
        setBusy(false);
      }
      useEffect(() => { load(); }, []);

      async function rebuild() {
        setBusy(true); setMsg(""); setOut("");
        try {
          const r = await fetch(API + "/rebuild", { method: "POST" });
          const j = await r.json();
          if (j.output) setOut(j.output);
          if (!j.ok) throw new Error(j.error || ("重建失败（退出码 " + j.code + "）"));
          if (j.data) setData(j.data);
          setMsg("已重建。");
        } catch (e) { setErr("重建失败：" + (e?.message || e)); }
        setBusy(false);
      }

      async function createTask() {
        if (!form.title.trim()) { setErr("先写任务名。"); return; }
        if (!form.accept.trim()) { setErr("验收标准不能空——写不出来它就还不是任务。"); return; }
        setBusy(true); setMsg(""); setErr("");
        try {
          const r = await fetch(API + "/task", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify(form),
          });
          const j = await r.json();
          if (!j.ok) throw new Error(j.error || "建卡失败");
          if (j.data) setData(j.data);
          setMsg("建好了，新卡在下面。");
          setFormOpen(false);
          setForm({ title: "", kind: "短线", span: "", intro: "", accept: "", members: [{ who: "Vigil", what: "" }] });
        } catch (e) { setErr("建卡失败：" + (e?.message || e)); }
        setBusy(false);
      }

      async function toggleSrc(title) {
        if (srcOpen === title) { setSrcOpen(""); return; }
        setSrcOpen(title);
        if (srcText) return;
        try {
          const r = await fetch(API + "/taskfile");
          const j = await r.json();
          if (j.ok) setSrcText(j.text || "");
        } catch {}
      }
      const tasks = (data && data.taskGroups) || [];
      const sorted = [...tasks].sort((x, y) => urgency(x) - urgency(y));
      const st = sorted.map(analyze);
      const nStuck = st.filter((x) => x.stage === "卡住").length;
      const nWait = st.filter((x) => x.stage === "等别人").length;
      const maxAgeAll = st.reduce((m, x) => Math.max(m, x.stage === "完成" ? 0 : x.maxAge), 0);
      const maxOverdue = st.reduce((m, x) => Math.max(m, x.overdueDays), 0);
      // 米拉 19:12：44 步全是「待认领」却没人说出来——顶栏把它摆在最前面
      const totalUnclaimed = st.reduce((n, x) => n + (x.unclaimed || 0), 0);
      const childCount = sorted.filter((t) => t.parentId).length;
      // 米拉 11-05：「卡住 0」有一半是装的——20 张卡源头没写日期，判不出停了多久。
      // 尺子撤了不等于病好了，所以顶栏把这个数摆出来，别让它显得干净。
      const unknownAge = st.filter((x) => x.stage !== "完成" && !x.maxAge).length;
      // Q 类「随手做」单独合成一张卡，别混进大类框（他 19:5x 定的）
      const quickCards = sorted.filter((t) => /^Q-/.test(String(t.id || "")) && !t.parentId);
      // 顶行只在**有可比数据**时才指名道姓，别拿编号顺序冒充结论
      const worst = sorted[0] ? { task: sorted[0], a: analyze(sorted[0]) } : null;

      return h("div", { className: "dbw" },
        h("h1", { className: "dbw-h1" }, "任务面板"),
        h("p", { className: "dbw-lead" },
          "一个任务一张卡。卡头颜色是整条任务的阶段，里面每一行是某个人的这一步。上面能新建任务，改任务去改 03-待办\\_现在.md 再重建。"),

        h("div", { className: "dbw-topbar" },
          h("div", { className: "dbw-chips" },
            // 米拉 19:33 ③：认领率是第一个数——46 步没人接，比"任务几张"重要
            chip("待认领", totalUnclaimed + " 步", totalUnclaimed ? "warn" : ""),
            // 他 19:4x 核过：21 张卡里 2 张是子卡，「任务 23」是看错了。
            // 显示成「总卡数（其中 N 张子卡）」最不容易被误读成"多了两张"。
            chip("任务", sorted.length + (childCount ? "（附 " + childCount + " 张子卡）" : "")),
            chip("卡住", nStuck, nStuck ? "bad" : ""),
            unknownAge ? chip("判不出多久没动", unknownAge + " 张", "warn") : null,
            chip("在等别人", nWait),
            chip("最久没动静", maxAgeAll ? maxAgeAll + " 小时" : "—", maxAgeAll >= 24 ? "warn" : ""),
            chip("超期最多", maxOverdue ? maxOverdue + " 天" : "无", maxOverdue ? "bad" : "")),
          h("div", { className: "dbw-btns" },
            h("button", { className: "dbw-btn", disabled: busy, onClick: load }, "刷新"),
            h("button", { className: "dbw-btn", disabled: busy, onClick: rebuild }, "重建"),
            h("button", { className: "dbw-btn pri", onClick: () => setFormOpen(!formOpen) }, formOpen ? "收起表单" : "新建任务"))),

        (() => {
          // 米拉 19:19 ①：没有可比数据时不许指名道姓。
          // 只有三种情况才说「最该看的是谁」：超期 / 停了 ≥12 小时 / 整卡都在等别人且有等待时长。
          if (!worst) return null;
          const a = worst.a;
          const reason = a.overdueDays > 0 ? "已超期 " + a.overdueDays + " 天"
            : a.maxAge >= 12 ? "停了 " + a.maxAge + " 小时"
            : (a.stage === "等别人" && a.maxAge > 0) ? "在等别人，等了 " + a.maxAge + " 小时"
            : "";
          if (!reason) {
            const openAll = st.filter((x) => x.stage !== "完成");
            return h("div", { className: "dbw-topline calm" },
              "目前没有超期、也没有停太久的卡；",
              openAll.length ? "还有 " + openAll.length + " 张没做完，按编号排着。" : "全部做完了。");
          }
          return h("div", { className: "dbw-topline" },
            "现在最该看的是 ", h("b", null, worst.task.title), "（",
            (a.open[0] || {}).who ? h("span", null, a.open[0].who + " · ") : null,
            reason, "）");
        })(),

        formOpen ? h("div", { className: "dbw-form" },
          h("div", { className: "dbw-form-title" }, "新建一个任务"),
          h("div", { className: "dbw-grid2" },
            h(Field, { label: "任务名（这张卡是什么）", value: form.title, onChange: (v) => setForm((f) => ({ ...f, title: v })), placeholder: "例如：任务面板改成按任务看" }),
            h(Field, { label: "类型（短线 / 长线）", value: form.kind, onChange: (v) => setForm((f) => ({ ...f, kind: v })), placeholder: "长线 = 常驻，不设到期，看上次动静" })),
          h("div", { className: "dbw-grid3" },
            h(Field, { label: "起止", value: form.span, onChange: (v) => setForm((f) => ({ ...f, span: v })), placeholder: "11-02 → 11-03" }),
            h(Field, { label: "简介", value: form.intro, onChange: (v) => setForm((f) => ({ ...f, intro: v })), placeholder: "一句话这是什么" }),
            h(Field, { label: "验收标准（必填）", value: form.accept, onChange: (v) => setForm((f) => ({ ...f, accept: v })), placeholder: "怎么算做完" })),

          h("div", { style: { marginTop: 14, fontSize: 11, color: "var(--dsw-alias-label-tertiary)" } }, "参与人（谁 + 他这一行在做什么）"),
          form.members.map((m, i) => h("div", { className: "dbw-mem", key: i },
            h("select", {
              className: "dbw-input", value: m.who,
              onChange: (e) => setForm((f) => ({ ...f, members: f.members.map((x, k) => (k === i ? { ...x, who: e.target.value } : x)) })),
            }, PEOPLE.map((p) => h("option", { key: p, value: p }, p))),
            h(Field, { label: "", value: m.what, placeholder: "他要做什么（会成卡片里的一行）", onChange: (v) => setForm((f) => ({ ...f, members: f.members.map((x, k) => (k === i ? { ...x, what: v } : x)) })) }),
            h("button", {
              className: "dbw-x", disabled: form.members.length <= 1,
              onClick: () => setForm((f) => ({ ...f, members: f.members.filter((_, k) => k !== i) })),
            }, "\u00d7"))),
          h("div", { style: { marginTop: 8 } },
            h("button", { className: "dbw-btn sm", onClick: () => setForm((f) => ({ ...f, members: [...f.members, { who: "Vigil", what: "" }] })) }, "+ 加一个人")),

          h("div", { className: "dbw-form-foot" },
            h("button", { className: "dbw-btn pri", disabled: busy, onClick: createTask }, busy ? "建卡中…" : "建这张卡"),
            h("button", { className: "dbw-btn", onClick: () => setFormOpen(false) }, "算了")))
          : null,

        (() => {
          if (!sorted.length) return h("div", { className: "dbw-proj" }, h("div", { className: "dbw-empty" }, "还没有任务卡。点右上「新建任务」，或者往 03-待办\\_现在.md 里加一个 ### 标题 再重建。"));
          // 四个大类固定显示（他 15:0x：空也要有壳、名字改成 流程/插件/个人/完结）
          const CATS = [
            { name: "流程", color: "rgba(91,143,214,.95)", desc: "跨人的事" },
            { name: "插件", color: "rgba(157,140,224,.95)", desc: "某个插件自己的活" },
            { name: "个人", color: "rgba(95,174,112,.95)", desc: "个人养护，长线" },
            { name: "完结", color: "rgba(140,148,158,.95)", desc: "做完了，留个念" },
          ];
          const catOf = (t) => {
            const c0 = String(t.category || "").trim();
            if (c0) return c0;
            const m0 = t.meta || {};
            if (analyze(t).stage === "完成") return "完结";
            if (/插件|面板|记忆|灵魂|唤醒|飞书|声音/i.test(String(t.title || ""))) return "插件";
            if (/长线|常驻/.test(String(m0["类型"] || ""))) return "个人";
            return "流程";
          };
          // 先算父子，再分桶（第一版把 topLevel 写在桶后面，运行时 Cannot access before initialization）
          const byId = {};
          for (const t of sorted) byId[t.id] = t;
          for (const t of sorted) {
            if (t.parentId && byId[t.parentId]) {
              byId[t.parentId].children = byId[t.parentId].children || [];
              byId[t.parentId].children.push(t);
            }
          }
// 他 19:5x：Q-01~Q-05 那种小问题别散着占五张卡，合成一张特殊格式的「随手做」
          const quick = quickCards;
          // 他 19:49 问「子卡在哪」——之前把子卡从顶层剔掉了、又没把「补足项」那块渲染出来，
          // 结果它们哪儿都不在。现在**子卡照常显示**，卡头标「子卡 · T-104 的」，一眼能认。
          const topLevel = sorted.filter((t) => !/^Q-/.test(String(t.id || "")));
          const buckets = {};
          for (const t of topLevel) { const k = catOf(t); (buckets[k] = buckets[k] || []).push(t); }
          const out = [];
          for (const cat of CATS) {
            const list = buckets[cat.name] || [];
            const openCnt = list.filter((t) => analyze(t).stage !== "完成").length;
            const collapsed = cat.name === "完结" ? !doneOpen : !!catClosed[cat.name];
            out.push(h("div", { className: "dbw-cat", key: "cat-" + cat.name },
              h("div", { className: "dbw-cat-h", onClick: () => toggleCat(cat.name) },
                h("span", { className: "bar", style: { background: cat.color } }),
                h("span", { className: "arrow" }, collapsed ? "\u25b8" : "\u25be"),
                h("span", { className: "t" }, cat.name),
                h("span", { className: "n" }, list.length + " 个"),
                h("span", { className: "n" }, openCnt ? openCnt + " 个没做完" : (list.length ? "都做完" : "空着")),
                h("span", { className: "desc" }, cat.desc),
                collapsed && list.length ? h("span", { className: "peek" }, list.slice(0, 3).map((t) => t.id || t.title).join(" · ")) : null)));
            if (collapsed) continue;
            if (!list.length) {
              out.push(h("div", { className: "dbw-cat-empty", key: "empty-" + cat.name }, "这一类暂时空着（框是有意留的，做成后再落进来）"));
              continue;
            }
            for (const t of list) out.push(h(TaskCard, { key: t.id || t.title, task: t, srcText, srcOpen: srcOpen === t.title, onToggleSrc: toggleSrc, showHints, onToggleHints: () => setShowHints(!showHints) }));
          }
          return out;
        })(),
        h("div", { className: "dbw-legend" },
          h("span", null, h("i", { style: { background: "rgba(140,148,158,.9)" } }), "还没开工"),
          h("span", null, h("i", { style: { background: "rgba(91,143,214,.9)" } }), "进行中"),
          h("span", null, h("i", { style: { background: "rgba(201,154,60,.9)" } }), "有人停了 12h+"),
          h("span", null, h("i", { style: { background: "rgba(157,140,224,.9)" } }), "在等别人"),
          h("span", null, h("i", { style: { background: "rgba(217,92,92,.9)" } }), "卡住 24h+"),
          h("span", null, h("i", { style: { background: "rgba(95,174,112,.9)" } }), "完成")),

        // 随手做：五条并成一张卡，跟其他卡明显不一样（虚线框、灰底、一行一条）
        quickCards.length
          ? h("div", { className: "dbw-quick" },
              h("div", { className: "dbw-quick-h" },
                h("span", { className: "t" }, "随手做"),
                h("span", { className: "n" }, quickCards.length + " 条"),
                h("span", { className: "hint" }, "凑一批一次处理，不单独占卡")),
              quickCards.map((q, i) => h("div", { className: "dbw-quick-row" + (analyze(q).stage === "完成" ? " done" : ""), key: i },
                h("span", { className: "id" }, q.id),
                h("span", { className: "txt" }, String(q.title || "").replace(/^Q-\d+\s*/, "")),
                h("span", { className: "who" }, (q.rows && q.rows[0] && q.rows[0].who) || "待认领"))))
          : null,
h(HygieneCard, { h: data && data.hygiene }),
        h(AboutFold, { about: data && data.about, open: aboutOpen, onToggle: () => setAboutOpen(!aboutOpen), out }),

        msg ? h("div", { className: "dbw-ok" }, msg) : null,
        err ? h("div", { className: "dbw-err" }, err) : null,
      );
    }

    const inject = ["slots"];
    const NS = "board";
    function apply(ctx) {
      ctx.effect(
        () => ctx.slots.inject("settings.section", () =>
          ctx.slots.register({ name: "settings.section", id: NS, order: 9, label: () => "任务面板" }, BoardSection),
          "board: settings section"),
        "board: settings section",
      );
    }
    exports.apply = apply;
    exports.inject = inject;
    exports.BoardSection = BoardSection;
    return module.exports;
  },
});
