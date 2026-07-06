/* ==========================================================================
 * 口袋旅行 · AI 行程规划接口（预留桩）  window.PTAI
 * --------------------------------------------------------------------------
 * 现在还没接任何模型——这个文件的意义是把「合同」先定下来：
 * UI 侧只管调 PTAI.plan()，拿到标准 delta 就能入库；
 * 以后无论接 Claude / GPT / 通义，都只改服务端，前端零改动。
 *
 * 为什么必须走自己的 endpoint 而不是前端直连模型 API：
 * 模型 key 一放前端就等于公开。用 Supabase Edge Function 写 20 行转发即可
 * （本项目已在用 Supabase）。前端只知道 AI_ENDPOINT 这一个地址。
 *
 * ── 请求（POST AI_ENDPOINT，JSON）──────────────────────────────
 *   {
 *     wish: "用户的一句话需求，如：东京 5 天，两个人，爱吃拉面，慢节奏",
 *     doc:  当前行程文档的精简版（见 buildContext），供模型增补而非重造
 *   }
 * ── 期望响应（JSON）────────────────────────────────────────────
 *   {
 *     P:    { newId: {n,c,la,ln,ar,d,p?,t?}, ... }   新增地点，结构同 trip 文档
 *     DAYS: [ {date,title,plan:[ids],pool:[ids]} ]   可选：整天的编排建议
 *     note: "模型想对用户说的一句话"                  可选
 *   }
 * 坐标要求真实可导航（服务端应让模型配合地点检索工具取坐标，
 * 或返回名称后由服务端用 PTPlaces 同款周边/文本搜索落地坐标）。
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

  function plan(opt) {
    opt = opt || {};
    if (!cfg.AI_ENDPOINT)
      return Promise.reject(
        new Error(
          "AI 规划尚未接入：在 app/config.js 填 AI_ENDPOINT（建议用 Supabase Edge Function 转发到模型 API）。",
        ),
      );
    return fetch(cfg.AI_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        wish: String(opt.wish || ""),
        doc: buildContext(opt.doc),
      }),
    })
      .then(function (r) {
        if (!r.ok) throw new Error("AI endpoint http " + r.status);
        return r.json();
      })
      .then(function (j) {
        /* 最小校验：结构不对宁可失败，也不要污染用户行程 */
        if (!j || typeof j !== "object" || (!j.P && !j.DAYS))
          throw new Error("AI 响应缺少 P / DAYS 字段");
        var P = j.P || {};
        for (var id in P) {
          var p = P[id];
          if (!p || !p.n || !isFinite(p.la) || !isFinite(p.ln))
            throw new Error("AI 返回的地点「" + id + "」缺名称或坐标");
        }
        return j;
      });
  }

  window.PTAI = {
    enabled: function () {
      return !!cfg.AI_ENDPOINT;
    },
    plan: plan,
    buildContext: buildContext,
  };
})();
