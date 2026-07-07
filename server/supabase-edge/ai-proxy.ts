/* ==========================================================================
 * 口袋旅行 · AI 转发 Edge Function（Supabase）
 * --------------------------------------------------------------------------
 * 职责：把前端的 {messages, doc} 转成 Mimo 的对话请求，
 *       token 只存在这里的环境变量，前端永远看不到。
 *
 * 完整部署步骤见 server/README.md（约 10 分钟）。速记：
 *   supabase functions new ai-proxy
 *   cp server/supabase-edge/ai-proxy.ts supabase/functions/ai-proxy/index.ts
 *   supabase secrets set MIMO_API_KEY=你的key
 *   supabase functions deploy ai-proxy --no-verify-jwt
 *   然后把返回的地址填进 app/config.js 的 AI_ENDPOINT
 * ========================================================================== */

// ⚠️ 改成你的真实 Mimo 接口地址与模型名（见 server/README.md「准备」一节）
// 这里按「OpenAI 兼容」格式写；若字段不同，改下面 fetch 的 body 与取文本那一行即可。
const MIMO_URL = "https://api.mimo.example.com/v1/chat/completions";
const MODEL = "mimo-latest";

const SYSTEM_PROMPT = `你是「口袋旅行」App 里的 AI 旅行搭子。
用户在旅途中，讨厌把旅行过成打卡任务。原则：
1. 你只给"预览"，不改用户行程——建议地点/路线由用户点按钮落库。
2. 输出必须是 JSON：{"reply":"聊天回复","P":{...可选地点},"route":{...可选整条路线}}。
   P 的每个地点：{n:名称, c:类别(eat/sweet/photo/shop/spot/fun/hotel/fly),
                 la:纬度, ln:经度, ar:区域, d:一句话推荐}
   route: {title:"路线名", ids:[P 里的 key，按顺序]}
3. 坐标必须真实可导航；不确定坐标就不要编造，改为在 reply 里说明。
4. 支持的任务：半日路线、雨天备用、二次元/购物优先、轻松不赶、
   "当前地点附近 90 分钟怎么晃"、"两个锚点之间塞什么最顺"。
5. 回复口语化、简短，像会懂梗的旅行搭子。`;

// 极简限流：每 IP 每小时 N 次（防止被人白嫖你的 Mimo 配额）
const RATE = new Map<string, { n: number; t: number }>();
const RATE_MAX = 30;

Deno.serve(async (req: Request) => {
  const cors = {
    "Access-Control-Allow-Origin": "*", // 上线后建议改成你的 GitHub Pages 域名
    "Access-Control-Allow-Headers": "content-type",
    "Content-Type": "application/json",
  };
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST")
    return new Response(JSON.stringify({ error: "POST only" }), { status: 405, headers: cors });

  // 限流
  const ip = req.headers.get("x-forwarded-for") ?? "anon";
  const now = Date.now();
  const r = RATE.get(ip) ?? { n: 0, t: now };
  if (now - r.t > 3600_000) { r.n = 0; r.t = now; }
  if (++r.n > RATE_MAX)
    return new Response(JSON.stringify({ reply: "今天问得有点多啦，歇一会再来～" }), { headers: cors });
  RATE.set(ip, r);

  const key = Deno.env.get("MIMO_API_KEY");
  if (!key)
    return new Response(JSON.stringify({ error: "MIMO_API_KEY 未配置" }), { status: 500, headers: cors });

  try {
    const { messages = [], doc = {} } = await req.json();
    const upstream = await fetch(MIMO_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: MODEL,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "system", content: "用户当前行程：" + JSON.stringify(doc) },
          ...messages.slice(-12),
        ],
      }),
    });
    const data = await upstream.json();
    const text = data?.choices?.[0]?.message?.content ?? "{}";
    let out;
    try { out = JSON.parse(text); }
    catch { out = { reply: text }; } // 模型没按 JSON 输出时兜底成纯聊天
    return new Response(JSON.stringify(out), { headers: cors });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: cors });
  }
});
