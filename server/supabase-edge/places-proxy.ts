/* ==========================================================================
 * 口袋旅行 · 地点代理 Edge Function（Supabase）
 * --------------------------------------------------------------------------
 * 职责：把前端对「地点搜索 / 附近推荐 / 反查地址」的请求转发到上游，
 *       上游 key 只存在这里的环境变量，前端永远看不到（和 AI 代理一个思路）。
 *
 * 前端约定（app/places-api.js 已经这么发）：
 *   PLACES_PROXY = "https://<ref>.functions.supabase.co/places-proxy"
 *   实际请求会带上子路径，标明发给哪个上游：
 *     {PROXY}/geoapify/v1/geocode/autocomplete?text=...   → api.geoapify.com
 *     {PROXY}/geoapify/v2/places?...                      → api.geoapify.com
 *     {PROXY}/geoapify/v1/geocode/reverse?...             → api.geoapify.com
 *     {PROXY}/amap/...                                    → restapi.amap.com
 *     {PROXY}/gplaces/...                                 → places.googleapis.com
 *   本函数按子路径把请求原样转发到对应上游，并在服务端补上 key。
 *
 * 部署（约 3 分钟，和 ai-proxy 完全一样的套路）：
 *   supabase functions new places-proxy
 *   cp server/supabase-edge/places-proxy.ts supabase/functions/places-proxy/index.ts
 *   supabase secrets set GEOAPIFY_KEY=你的Geoapifykey
 *   supabase functions deploy places-proxy --no-verify-jwt
 *   然后把返回的地址填进 app/config.js 的 PLACES_PROXY，GEOAPIFY_KEY 留空。
 *
 * 说明：
 *   · GEOAPIFY_KEY 是唯一必填的。amap / gplaces 只有你真用到时才需要设
 *     AMAP_WEB_KEY / GOOGLE_PLACES_KEY，没设就当没这个上游。
 *   · key 藏在服务端后，这个函数地址本身还是公开的，所以加了个「每 IP 限流」
 *     防止有人狂刷、把你的 Geoapify 免费额度（3000 次/天）刷光。搜索是随打字
 *     触发的，限额给得比较宽。
 * ========================================================================== */

// 上游映射：子路径标记 → 真实上游根地址
const UPSTREAM: Record<string, string> = {
  geoapify: "https://api.geoapify.com/",
  amap: "https://restapi.amap.com/",
  gplaces: "https://places.googleapis.com/",
};

// 极简限流：每 IP 每小时 N 次（够正常边打字边搜，挡住脚本刷额度）
const RATE = new Map<string, { n: number; t: number }>();
const RATE_MAX = 600;

function pickProvider(pathname: string): { name: string; rest: string } | null {
  for (const name of Object.keys(UPSTREAM)) {
    const marker = "/" + name + "/";
    const i = pathname.indexOf(marker);
    if (i >= 0) return { name, rest: pathname.slice(i + marker.length) };
  }
  return null;
}

Deno.serve(async (req: Request) => {
  const cors: Record<string, string> = {
    "Access-Control-Allow-Origin": "*", // 上线后可收紧成你的 GitHub Pages 域名
    "Access-Control-Allow-Headers":
      "authorization, apikey, content-type, x-client-info, x-goog-fieldmask",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  };
  const json = (o: unknown, status = 200) =>
    new Response(JSON.stringify(o), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    });

  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const url = new URL(req.url);
  const hit = pickProvider(url.pathname);

  // 没带 provider 子路径 → 当作健康检查，顺便报告哪些 key 配好了
  if (!hit) {
    return json({
      ok: true,
      service: "places-proxy",
      has_geoapify: !!Deno.env.get("GEOAPIFY_KEY"),
      has_amap: !!Deno.env.get("AMAP_WEB_KEY"),
      has_gplaces: !!Deno.env.get("GOOGLE_PLACES_KEY"),
      usage: "调用 {PROXY}/geoapify/v1/geocode/autocomplete?text=…",
    });
  }

  // 限流
  const ip = req.headers.get("x-forwarded-for") ?? "anon";
  const now = Date.now();
  const r = RATE.get(ip) ?? { n: 0, t: now };
  if (now - r.t > 3600_000) {
    r.n = 0;
    r.t = now;
  }
  if (++r.n > RATE_MAX)
    return json({ error: "rate_limited", message: "搜得有点猛，歇一会再来～" }, 429);
  RATE.set(ip, r);

  const provider = hit.name;
  const keyEnv =
    provider === "geoapify"
      ? "GEOAPIFY_KEY"
      : provider === "amap"
        ? "AMAP_WEB_KEY"
        : "GOOGLE_PLACES_KEY";
  const KEY = Deno.env.get(keyEnv) || "";
  if (!KEY) return json({ error: keyEnv + " 未配置" }, 500);

  // 拼上游地址：保留原始 query，再按上游补 key
  const target = new URL(UPSTREAM[provider] + hit.rest);
  url.searchParams.forEach((v, k) => target.searchParams.set(k, v));
  if (provider === "geoapify") target.searchParams.set("apiKey", KEY);
  if (provider === "amap") target.searchParams.set("key", KEY);

  // 转发用的 headers / body
  const upHeaders: Record<string, string> = {};
  let body: BodyInit | undefined = undefined;
  if (req.method === "POST") {
    body = await req.text();
    upHeaders["Content-Type"] =
      req.headers.get("content-type") || "application/json";
  }
  if (provider === "gplaces") {
    const fm = req.headers.get("x-goog-fieldmask");
    if (fm) upHeaders["X-Goog-FieldMask"] = fm;
    upHeaders["X-Goog-Api-Key"] = KEY;
  }

  try {
    const upstream = await fetch(target.toString(), {
      method: req.method,
      headers: upHeaders,
      body,
    });
    const text = await upstream.text();
    // 原样透传上游响应体与状态码，补上 CORS。上游一般返回 JSON。
    return new Response(text, {
      status: upstream.status,
      headers: {
        ...cors,
        "Content-Type":
          upstream.headers.get("content-type") || "application/json",
      },
    });
  } catch (e) {
    return json({ error: String(e) }, 502);
  }
});
