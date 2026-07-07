# 给「口袋旅行」接上 Mimo（AI 旅行搭子）——部署你的 key

你的站点是 GitHub Pages（纯静态）。**Mimo 的 key 一旦写进前端就等于公开**，
所以我们让前端只知道一个转发地址 `AI_ENDPOINT`，真正的 key 放在服务端。

```
GitHub Pages 前端  ──POST {messages, doc}──▶  你的转发函数  ──带上 Mimo key──▶  Mimo API
（app/config.js 只填 AI_ENDPOINT）            （key 存这里的环境变量）
```

绝对不要把 key 放这些地方：`app/config.js`、`trip.html`、GitHub 仓库、
`localStorage`、任何浏览器端 JS、前端能 `select` 到的数据库表。

本项目已经在用 Supabase，所以最省事的转发就是一个 **Supabase Edge Function**
（下面的 A 方案，约 10 分钟）。不想用 Supabase 的话，Cloudflare Worker /
Vercel Function 也一样（B 方案）。

---

## 准备：先拿到 Mimo 的三样东西

1. **API Key**（形如 `sk-...`）
2. **接口地址（base URL）**，通常是 `https://<厂商域名>/v1/chat/completions`
3. **模型名**，例如 `mimo-...`

打开 `supabase-edge/ai-proxy.ts`，把顶部这两行改成你的真实值：

```ts
const MIMO_URL = "https://api.你的Mimo厂商.com/v1/chat/completions";
const MODEL = "你的模型名";
```

> 这个转发按「OpenAI 兼容」格式写（`messages[]` + `response_format:json_object`）。
> 如果你的 Mimo 接口字段不一样，只需改 `ai-proxy.ts` 里 `fetch(MIMO_URL, …)`
> 的 body，以及从返回里取文本的那一行（`data?.choices?.[0]?.message?.content`）。
> 前端完全不用动。

---

## A 方案：Supabase Edge Function（推荐）

```bash
# 1) 安装 CLI（一次就好）
npm i -g supabase
supabase login

# 2) 在项目根目录，关联你的 Supabase 工程
#    <project-ref> 在 Supabase 控制台 Project Settings → General 里
supabase link --project-ref <project-ref>

# 3) 新建函数，把我们写好的转发代码放进去
supabase functions new ai-proxy
cp server/supabase-edge/ai-proxy.ts supabase/functions/ai-proxy/index.ts

# 4) 把 Mimo key 存成服务端密钥（不会进仓库、不会进前端）
supabase secrets set MIMO_API_KEY=apikey

# 5) 部署（--no-verify-jwt 让未登录也能调；限流已在代码里）
supabase functions deploy ai-proxy --no-verify-jwt
```

部署完终端会给出地址，形如：
`https://<project-ref>.functions.supabase.co/ai-proxy`

把它填进 `app/config.js`：

```js
AI_ENDPOINT: "https://<project-ref>.functions.supabase.co/ai-proxy",
```

提交、推送到 GitHub Pages。打开 App → 点 AI 搭子 → 发一句话，
若能收到不是「本地演示」的回复，就接通了。

### 自测一条命令

```bash
curl -X POST "https://<project-ref>.functions.supabase.co/ai-proxy" \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"银座附近雨天备用路线"}],"doc":{}}'
```

返回里应有 `reply`（可能还有 `P` / `route`）。报 401/500 就看下面排查。

---

## B 方案：Cloudflare Worker（不想用 Supabase）

逻辑一模一样，把 `ai-proxy.ts` 的 `Deno.serve` 换成 Worker 的 `fetch` 即可
（`Deno.env.get("MIMO_API_KEY")` → `env.MIMO_API_KEY`）。
key 用 `wrangler secret put MIMO_API_KEY` 存。部署后拿到的 `*.workers.dev`
地址填进 `AI_ENDPOINT`。Vercel 同理（`process.env.MIMO_API_KEY`）。

---

## 收紧（上线前建议）

- **限定来源**：把 `ai-proxy.ts` 里的 `Access-Control-Allow-Origin: "*"`
  改成你的 GitHub Pages 域名，别人就不能借你的函数刷 Mimo 配额。
- **限流**：代码里已有「每 IP 每小时 30 次」的简单限流，可按需调 `RATE_MAX`。
- **要登录才可用**：去掉 `--no-verify-jwt`，前端调用时带上 Supabase 的
  用户 JWT（本项目云端模式已有登录会话）。

---

## 排查

| 现象                  | 多半是                                                                                                 |
| --------------------- | ------------------------------------------------------------------------------------------------------ |
| 一直显示「本地演示」  | `AI_ENDPOINT` 没填，或填了但函数没部署成功                                                             |
| 401 / 403             | `MIMO_API_KEY` 没设或不对；或 Mimo 那边要求不同鉴权头                                                  |
| 500 + 提到字段        | Mimo 返回结构和 OpenAI 不同 → 改 `ai-proxy.ts` 取文本那一行                                            |
| 浏览器报 CORS         | `Access-Control-Allow-Origin` 没放行你的域名                                                           |
| 有 reply 但地图不出点 | 模型没按 JSON 给 `P`/坐标；`ai-proxy.ts` 已强制 `json_object`，可在 `SYSTEM_PROMPT` 里再强调坐标要真实 |

契约（前端↔函数）写在 `app/ai-planner.js` 顶部：请求 `{messages, doc}`，
期望 `{reply, P?, route?}`。函数负责把它翻译给 Mimo、再把 Mimo 输出整理回这个形状。
