/* ==========================================================================
 * 口袋旅行 · AI 行程规划接口  window.PTAI
 * --------------------------------------------------------------------------
 * UI 侧只管调 PTAI.chat() / PTAI.plan()，拿到标准结构就能渲染/落库；
 * 以后无论接 Mimo / Claude / GPT / 通义，都只改服务端，前端零改动。
 *
 * ★ 安全铁律：模型 token（Mimo token）绝对不能出现在——
 *   app/config.js、trip.html、GitHub 仓库、localStorage、任何浏览器端 JS、
 *   前端能 select 到的数据库表。
 *   正确姿势：GitHub Pages 前端 → AI_ENDPOINT →
 *   Supabase Edge Function / Vercel Function / Cloudflare Worker → Mimo API，
 *   token 放服务端环境变量。参考实现见 server/ 目录。
 *
 * ── chat 请求（POST AI_ENDPOINT，JSON）─────────────────────────
 *   {
 *     messages: [{role:"user"|"assistant", content:"..."}],  近几轮对话
 *     doc:      当前行程文档精简版（见 buildContext），供模型增补而非重造
 *   }
 * ── chat 期望响应（JSON）──────────────────────────────────────
 *   {
 *     reply: "AI 说的话（会显示成聊天气泡）",
 *     P:     { id: {n,c,la,ln,ar,d,p?,t?}, ... }        可选：建议地点
 *     route: { title:"雨天备用路线", ids:["id1","id2"] } 可选：把 P 里的点
 *             按顺序编成一条整路线（半日/雨天备用/90分钟顺路…），
 *             前端会渲染成「整条预览卡」
 *   }
 * 原则：AI 只给预览，永远不直接改行程——落库由用户点按钮触发。
 * 坐标要求真实可导航（服务端应让模型配合地点检索工具取坐标）。
 * ========================================================================== */
(function () {
  "use strict";
  var cfg = window.PT_CONFIG || {};

  /* 把当前行程压缩成给模型看的上下文：只留决策需要的字段，控制 token */
  function buildContext(doc) {
    var P = (doc && doc.P) || {};
    var days = ((doc && doc.DAYS) || []).map(function (d) {
      return {
        date: d.date,
        title: d.title,
        plan: (d.plan || []).map(function (id) {
          var p = P[id] || {};
          return { n: p.n, c: p.c, ar: p.ar, a: p.a ? 1 : 0 };
        }),
      };
    });
    return { days: days };
  }

  function post(body) {
    if (!cfg.AI_ENDPOINT)
      return Promise.reject(
        new Error(
          "AI 尚未接入：在 app/config.js 填 AI_ENDPOINT（服务端转发，token 留在服务端，见 server/）。",
        ),
      );
    return fetch(cfg.AI_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(function (r) {
      if (!r.ok) throw new Error("AI endpoint http " + r.status);
      return r.json();
    });
  }

  function validateP(P) {
    for (var id in P) {
      var p = P[id];
      if (!p || !p.n || !isFinite(p.la) || !isFinite(p.ln))
        throw new Error("AI 返回的地点「" + id + "」缺名称或坐标");
    }
  }

  /* 聊天式：多轮对话 + 可选地点/路线预览 */
  function chat(opt) {
    opt = opt || {};
    return post({
      messages: opt.messages || [],
      doc: buildContext(opt.doc),
    }).then(function (j) {
      if (!j || typeof j !== "object")
        throw new Error("AI 响应不是 JSON 对象");
      if (j.P) validateP(j.P);
      return j;
    });
  }

  /* 旧版一次性规划接口（保留兼容） */
  function plan(opt) {
    opt = opt || {};
    return post({
      wish: String(opt.wish || ""),
      doc: buildContext(opt.doc),
    }).then(function (j) {
      if (!j || typeof j !== "object" || (!j.P && !j.DAYS))
        throw new Error("AI 响应缺少 P / DAYS 字段");
      if (j.P) validateP(j.P);
      return j;
    });
  }

  window.PTAI = {
    enabled: function () {
      return !!cfg.AI_ENDPOINT;
    },
    chat: chat,
    plan: plan,
    buildContext: buildContext,
  };
})();
