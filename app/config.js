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

  /* ── 地点数据（搜索新建 / 附近推荐 / 目的地图片，可选，断网出错都静默降级）──
   * PLACES_PROVIDER:
   *   "demo"     零配置演示数据，先看交互效果（默认，离线可用）
   *   "geoapify" ★推荐★ 开放地图。免费 3000 次/天、免信用卡。搜索/反查/周边全支持。
   *   "amap"     高德（国内数据最全，图片是可保存直链）
   *   "google"   Google Places（海外数据全，需绑卡；图片引用会过期）
   *   ""         彻底关闭：不出现系统推荐，新建地点也停用搜索
   *
   * key 放哪？两种接法（本项目默认走 A，最安全）：
   *   A. 后端代理（推荐）：key 藏在 Supabase 服务端，前端零暴露。
   *      1. 部署 server/supabase-edge/places-proxy.ts（步骤见该文件顶部注释 / SETUP.md）
   *      2. supabase secrets set GEOAPIFY_KEY=你的key
   *      3. 把返回的函数地址填进下面 PLACES_PROXY，GEOAPIFY_KEY 留空
   *      4. PLACES_PROVIDER 改成 "geoapify"
   *   B. 直接放前端（更省事，仅 geoapify 适用）：Geoapify key 能在后台按
   *      「Allowed origins」锁到你的域名，锁了之后放前端也安全。
   *      把 key 填进 GEOAPIFY_KEY、provider 改 "geoapify" 即可，不用部署代理。
   *
   * 目的地图片 + 简介：统一走维基百科（免 key），与上面选哪个 provider 无关。
   *
   * ⚠️ 高德 Web key 无法按域名限制，只能走 A（后端代理），别直接放前端。
   * 备注：设了 PLACES_PROXY 就一定走后端；只填了 key 没改 provider 会先用演示数据。 */
  PLACES_PROVIDER: "demo",
  GEOAPIFY_KEY: "" /* 走后端代理时留空；直接放前端时才填 */,
  AMAP_WEB_KEY: "",
  GOOGLE_PLACES_KEY: "",
  PLACES_PROXY:
    "" /* 后端代理地址，如 https://<ref>.functions.supabase.co/places-proxy */,
  PLACES_RADIUS: 900 /* 推荐搜索半径（米）*/,

  /* ── AI 行程规划（预留，见 app/ai-planner.js 的接口约定）──
   * 填你自己的转发地址后 PTAI.plan() 即可用；留空 = 未接入。 */
  AI_ENDPOINT:
    "https://yhgdxutmcouxonrurgkc.supabase.co/functions/v1/ai-proxy",
};
