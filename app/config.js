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
  SUPABASE_URL: "https://yhgdxutmcouxonrurgkc.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_xrbumelnf24T1UVMclZwrg_TzlPt9cD",

  /* 云端登录方式（仅云端模式生效）
   *   email  : 邮箱 + 密码（最通用，无需额外配置，默认开启）
   *   google : 需在 Supabase → Authentication → Providers 里开启 Google
   * 注：微信登录 Supabase 暂不原生支持，需自建 OAuth，作为后续扩展。 */
  AUTH_METHODS: ["email", "google"],

  /* 品牌名，显示在首页顶部 */
  APP_NAME: "口袋旅行",

  /* ── 附近推荐 & 地点图片（可选功能，断网/出错都会静默降级）──────────
   * PLACES_PROVIDER:
   *   "demo"   零配置演示数据，先看交互效果（默认）
   *   "amap"   高德周边搜索（国内数据全，图片是可保存的直链）→ 填 AMAP_WEB_KEY
   *   "google" Google Places（海外数据全，图片引用会过期、展示时现取，
   *            key 记得在控制台按 HTTP referrer 限制到你的域名）→ 填 GOOGLE_PLACES_KEY
   *   ""       彻底关闭，界面上不出现任何系统推荐
   *
   * ⚠️ 高德 Web 服务 key 无法按域名限制，直接放公开仓库会被人盗刷配额。
   *    本地自用没问题；正式上线请把 PLACES_PROXY 指向自己的中转
   *    （Supabase Edge Function 即可），key 留在服务端。 */
  PLACES_PROVIDER: "demo",
  AMAP_WEB_KEY: "",
  GOOGLE_PLACES_KEY: "",
  PLACES_PROXY: "",
  PLACES_RADIUS: 900, /* 推荐搜索半径（米）*/

  /* ── AI 行程规划（预留，见 app/ai-planner.js 的接口约定）──
   * 填你自己的转发地址后 PTAI.plan() 即可用；留空 = 未接入。 */
  AI_ENDPOINT: "",
};
