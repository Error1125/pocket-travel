# AI 服务端转发（Mimo token 安全接入）

GitHub Pages 是纯静态站，**Mimo token 一旦放进前端就等于公开**。
下面这些地方全都不能放 token：

- `app/config.js` / `trip.html` / 任何前端 JS
- GitHub 仓库（包括私有分支，迟早手滑）
- `localStorage`
- 前端能直接 `select` 到的数据库表

## 推荐架构（第一版最简方案）

```
GitHub Pages 前端
      │  只知道一个地址：AI_ENDPOINT
      ▼
Supabase Edge Function（本项目已在用 Supabase，零新增依赖）
      │  MIMO_API_KEY 放在 Edge Function 的环境变量（Secrets）里
      ▼
Mimo API
```

前端只保存 `AI_ENDPOINT`，token 永远不出服务端。

## 部署步骤（约 10 分钟）

1. 安装 Supabase CLI 并登录：`supabase login`
2. 在项目目录：
   ```bash
   supabase functions new ai-proxy
   # 把 supabase-edge/ai-proxy.ts 的内容复制进去
   supabase secrets set MIMO_API_KEY=你的token
   supabase functions deploy ai-proxy --no-verify-jwt
   ```
3. 把部署后的 URL 填进 `app/config.js`：
   ```js
   AI_ENDPOINT: "https://<你的项目>.functions.supabase.co/ai-proxy",
   ```

## 如果一定要把 token 存进数据库表

不推荐作为第一方案。如果要存，必须同时满足：

1. 前端**不能**直接 `select` 到该表（RLS 全拒绝 anon）；
2. 只允许 Edge Function 用 service role 或受控权限读取；
3. 最好加密存储（pgsodium）；
4. 有调用次数限制和用户权限校验（见 ai-proxy.ts 里的限流注释）。

## 请求/响应契约

见 `app/ai-planner.js` 顶部注释——Edge Function 负责把
`{messages, doc}` 翻译成 Mimo 的对话请求，并把模型输出整理成
`{reply, P?, route?}` 返回。前端零改动即可换模型供应商。
