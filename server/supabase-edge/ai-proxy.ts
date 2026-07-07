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
const MIMO_URL = "https://api.xiaomimimo.com/v1/chat/completions";
const MODEL = "mimo-v2.5-pro";

const SYSTEM_PROMPT = `你是「口袋旅行」App 里的 AI 旅行搭子。
用户在旅途中，讨厌把旅行过成打卡任务。原则：
1. 你只给"预览"，不直接改用户数据——建议地点/路线/整趟行程都由用户点按钮才落库。
2. 输出必须是 JSON，可含这些字段：
   {"reply":"聊天回复",
    "P":{...可选：单个/几个建议地点},
    "route":{...可选：整条路线},
    "trip":{...可选：一整趟新行程}}
   · P 的每个地点：{n:名称, c:类别(eat/sweet/photo/shop/spot/fun/hotel/fly),
                   la:纬度, ln:经度, ar:区域, d:一句话推荐}
   · route: {title:"路线名", ids:[P 里的 key，按顺序]}
   · trip:  {title:"行程名", emoji:"🗼",
             P:{地点同上},
             days:[{date:"Day 1", title:"当天主题", plan:[P里的key,按顺序]}]}
3. 何时给 trip：当请求里 want=="trip"，或用户说「帮我规划/安排 X 几日游」这类
   要一整趟的需求时，就返回完整 trip（合理的天数与每天 3–5 个点，节奏别太赶）。
   只想加一两个点、或只问某地附近时，用 P / route 即可，不要给 trip。
4. 坐标必须真实可导航；拿不准就别编，改为在 reply 里说明或减少地点。
5. 也支持：半日路线、雨天备用、二次元/购物优先、轻松不赶、
   "当前地点附近 90 分钟怎么晃"、"两个锚点之间塞什么最顺"。
6. 回复口语化、简短，像会懂梗的旅行搭子。
7. ★路线硬性要求：当用户说"生成/来一条/规划……路线"（半日、雨天备用、
   附近 90 分钟、二次元/购物优先等），必须返回 route（{title, ids}）和对应的
   P（每个点带真实经纬度），且 route.ids 必须都能在 P 里找到；绝不能只在
   reply 里用文字描述路线而不给 route。若一时给不全坐标，就减少站点数量，
   但仍要给出 route 结构。`;

// 极简限流：每 IP 每小时 N 次（防止被人白嫖你的 Mimo 配额）
const RATE = new Map<string, { n: number; t: number }>();
const RATE_MAX = 10;

Deno.serve(async (req: Request) => {
  const cors = {
    "Access-Control-Allow-Origin": "*", // 上线后建议改成你的 GitHub Pages 域名
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method === "GET")
    return new Response(
      JSON.stringify({ ok: true, has_key: !!Deno.env.get("MIMO_API_KEY"), model: MODEL }),
      { headers: cors },
    );
  if (req.method !== "POST")
    return new Response(JSON.stringify({ error: "POST only" }), {
      status: 405,
      headers: cors,
    });

  // 限流
  const ip = req.headers.get("x-forwarded-for") ?? "anon";
  const now = Date.now();
  const r = RATE.get(ip) ?? { n: 0, t: now };
  if (now - r.t > 3600_000) {
    r.n = 0;
    r.t = now;
  }
  if (++r.n > RATE_MAX)
    return new Response(
      JSON.stringify({ reply: "今天问得有点多啦，歇一会再来～" }),
      { headers: cors },
    );
  RATE.set(ip, r);

  const key = Deno.env.get("MIMO_API_KEY");
  if (!key)
    return new Response(JSON.stringify({ error: "MIMO_API_KEY 未配置" }), {
      status: 500,
      headers: cors,
    });

  try {
    const { messages = [], doc = {}, want = "" } = await req.json();
    const upstream = await fetch(MIMO_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: MODEL,
        max_completion_tokens: 4096,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "system", content: "用户当前行程：" + JSON.stringify(doc) },
          ...(want === "trip"
            ? [
                {
                  role: "system",
                  content:
                    "本次来自首页，用户多半想要一整趟新行程，优先返回 trip 字段。",
                },
              ]
            : []),
          ...(want === "route"
            ? [
                {
                  role: "system",
                  content:
                    "本次用户想要一条具体路线：必须返回 route（title + ids）和对应的 P（每个点带真实经纬度），route.ids 都要能在 P 里找到，不要只用文字描述。",
                },
              ]
            : []),
          ...messages.slice(-12),
        ],
      }),
    });
    if (!upstream.ok) {
      // 把 MiMo 的真实错误透传成一句可读回复，方便前端/你排查
      const errText = (await upstream.text()).slice(0, 500);
      return new Response(
        JSON.stringify({
          reply: "⚠️ MiMo 返回错误 HTTP " + upstream.status + "：" + errText,
          error: errText,
        }),
        { headers: cors },
      );
    }
    const data = await upstream.json();
    const msg = data?.choices?.[0]?.message ?? {};
    const text = msg.content ?? "{}";
    const reasoning = msg.reasoning_content || ""; // MiMo 思考模式的思维链
    let out;
    try {
      out = JSON.parse(text);
    } catch {
      out = { reply: text };
    } // 模型没按 JSON 输出时兜底成纯聊天
    // 把思考过程一并带回前端（可展开查看）；模型没开思考时为空、不影响其他字段
    if (reasoning && out && typeof out === "object") out.reasoning = reasoning;
    return new Response(JSON.stringify(out), { headers: cors });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: cors,
    });
  }
});
