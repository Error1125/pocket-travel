/* ==========================================================================
 * 口袋旅行 · 配置
 * --------------------------------------------------------------------------
 * 这是「本地模式 / 云端模式」的总开关。
 *
 *   ┌ 两个都留空  → 本地模式：数据只存这台手机，免登录、完全离线可用。
 *   └ 两个都填上  → 云端模式：需要登录，行程存云端，可多设备同步、和朋友共享。
 *
 * 如何拿到这两个值（详见 SETUP.md）：
 *   1. 到 https://supabase.com 免费注册、新建一个 project
 *   2. 打开 Project Settings → API
 *   3. 把 "Project URL" 填到 SUPABASE_URL
 *      把 "anon / public" key 填到 SUPABASE_ANON_KEY
 *   4. 到 SQL Editor 里把 db/schema.sql 整段跑一遍
 *
 * anon key 是「公开可暴露」的前端 key，放进这里、推到 GitHub 都没问题——
 * 真正的数据安全由 Supabase 的 Row Level Security（schema.sql 里已写好）保证。
 * ========================================================================== */
window.PT_CONFIG = {
  SUPABASE_URL: "",
  SUPABASE_ANON_KEY: "",

  /* 云端登录方式（仅云端模式生效）
   *   email  : 邮箱 + 密码（最通用，无需额外配置，默认开启）
   *   google : 需在 Supabase → Authentication → Providers 里开启 Google
   * 注：微信登录 Supabase 暂不原生支持，需自建 OAuth，作为后续扩展。 */
  AUTH_METHODS: ["email"],

  /* 品牌名，显示在首页顶部 */
  APP_NAME: "口袋旅行",
};
