# 口袋旅行 · 启用云端账号与共享（SETUP）

这份应用有**两种运行模式**，你不配置任何东西也能直接用：

| 模式 | 触发条件 | 能做什么 |
| --- | --- | --- |
| **本地模式**（默认） | `app/config.js` 里 URL/key 留空 | 多个行程、导入/导出、离线使用、所有行程功能。数据存在这台手机浏览器里。**无需登录、无需联网后端。** |
| **云端模式** | `app/config.js` 填好 Supabase URL + anon key | 在本地模式基础上，加：邮箱登录、行程存云端（换设备也在）、把行程分享给朋友后**双方实时同步一起编辑**。 |

> 现在直接把仓库部署到 GitHub Pages 就是**本地模式**，你们这次旅行完全够用。
> 想要「登录 + 跨设备 + 好友共享」时，再按下面 15 分钟接上云端。随时可切回本地（清空 config 即可）。

---

## 一、开通云端（约 15 分钟）

### 1. 建一个 Supabase 项目（免费）
1. 打开 https://supabase.com → 用 GitHub 账号登录
2. **New project** → 填个名字（如 `pocket-travel`）、设一个数据库密码（记下来，之后基本用不到）、区域选离你近的（如 Singapore / Tokyo）
3. 等项目初始化（约 2 分钟）

### 2. 建表和权限（复制粘贴一次）
1. 左侧 **SQL Editor** → **New query**
2. 打开本仓库的 `db/schema.sql`，**整段复制**进去
3. 点 **Run**。看到 `Success` 就建好了（表、权限、共享用的函数、实时推送都在这一步搞定）

### 3. 拿到两个值填进 config
1. 左侧 **Project Settings → API**
2. 复制这两项：
   - **Project URL**（形如 `https://xxxx.supabase.co`）
   - **anon public** key（很长的一串）
3. 打开本仓库的 `app/config.js`，填进去：

```js
window.PT_CONFIG = {
  SUPABASE_URL: "https://xxxx.supabase.co",   // ← 粘贴 Project URL
  SUPABASE_ANON_KEY: "eyJhbGci...",            // ← 粘贴 anon public key
  AUTH_METHODS: ["email"],                     // 需要谷歌登录就写 ["email","google"]
  APP_NAME: "口袋旅行",
};
```

4. commit + push。GitHub Pages 更新后，打开就是**云端模式**了——首页会先让你注册/登录。

> **anon key 可以放心提交到公开仓库。** 它本来就是给浏览器用的公开值，真正的数据安全由数据库的行级权限（RLS，schema.sql 里已配好）保证：没登录看不到任何行程，登录了也只能看到「自己的 + 别人分享给你的」。
> 千万别提交的是 Settings→API 里的 **service_role** key（那个能绕过所有权限）——我们整套都用不到它。

### 4.（可选）打开邮箱确认
Supabase 默认注册要邮箱验证。内部测试想图快，可以在 **Authentication → Providers → Email** 里关掉 “Confirm email”，注册完直接就能用。正式上线再打开。

---

## 二、（可选）加谷歌登录
> 注意：谷歌登录在中国大陆需要梯子才能用，所以**默认只开邮箱**。给海外朋友用时再加。

1. Supabase **Authentication → Providers → Google** → 打开，按页面提示到 Google Cloud 建 OAuth 客户端，把 Client ID / Secret 填回来
2. Supabase **Authentication → URL Configuration → Redirect URLs** 里，加上你的线上地址（如 `https://error1125.github.io/pocket-travel/`）
3. `app/config.js` 的 `AUTH_METHODS` 改成 `["email","google"]`

## 三、关于微信登录
Supabase 没有内置微信登录。要做的话得走「自建 OAuth / 微信开放平台 + 一个中转后端」，属于后续工程，这版先不做。代码里已给微信预留了位置，等要做时单独接。

---

## 四、共享是怎么运作的（给你和朋友）

1. **你**（行程拥有者）：打开某个行程 → 情报页/首页卡片菜单 → **共享** → 生成一个 6 位邀请码和一条链接
2. 把链接（或码）发给**朋友**
3. **朋友**：打开链接 → 注册/登录自己的账号 → 自动加入这个行程
4. 之后你俩看到的是**同一份行程**：谁改了顺序、加了点、打了卡，另一方几秒内自动刷新（页面顶部会提示「行程已被同行更新」）
5. 邀请码**默认 7 天有效**；拥有者可删行程，协作者只能「退出」不能删

> 同步是「整份行程」级别、最后保存者为准（last-write-wins）。你们俩不太会在同一秒改同一个点，日常使用完全够；真撞上了也只是以后写入的那次为准，不会报错。

---

## 五、地点搜索 / 附近推荐 / 目的地图片（约 3 分钟，可选）

这三样是一套：
- **新建地点**——像导航软件一样搜名字，点一下就加进行程（名称 / 坐标 / 区域自动带好，不用手填）
- **附近还可随缘**——详情卡里 ✨ 系统推荐的真实周边店铺 / 景点
- **目的地图片 + 一句话简介**——地标 / 寺庙 / 博物馆 / 车站等会自动配图和介绍（走维基百科，**不需要任何 key**）

**不配置也能用**：默认 `PLACES_PROVIDER: "demo"` 是一套离线演示数据，先看交互效果完全没问题。想换成**真实数据**，需要一把 Geoapify key（免费 **3000 次/天、不用信用卡**）。

### 拿一把 Geoapify key
1. 打开 https://myprojects.geoapify.com → 注册登录 → **New project**
2. 进 **API Keys**，复制那把自动生成的 key（同一把 key 所有 Geoapify 接口通用）

### 接法 A：后端代理（推荐，key 零暴露，和 AI 一个思路）
key 藏在 Supabase 服务端，前端仓库里看不到。约 3 分钟：

```bash
supabase functions new places-proxy
cp server/supabase-edge/places-proxy.ts supabase/functions/places-proxy/index.ts
supabase secrets set GEOAPIFY_KEY=你复制的key
supabase functions deploy places-proxy --no-verify-jwt
```

部署完拿到形如 `https://<ref>.functions.supabase.co/places-proxy` 的地址，填进 `app/config.js`：

```js
  PLACES_PROVIDER: "geoapify",   // 从 "demo" 改成这个
  GEOAPIFY_KEY: "",               // 留空！key 在服务端
  PLACES_PROXY: "https://<ref>.functions.supabase.co/places-proxy",  // ← 粘进来
```

> 验证：浏览器直接打开那个地址（不带子路径），应返回 `{"ok":true,"has_geoapify":true,...}` 就说明 key 配好了。

### 接法 B：key 直接放前端（更省事，仅 geoapify 适用）
Geoapify key 能在后台按 **Allowed origins** 锁到你的域名（如 `https://error1125.github.io`），锁了之后放前端也安全。不用部署代理：

```js
  PLACES_PROVIDER: "geoapify",
  GEOAPIFY_KEY: "你复制的key",     // 直接填
```

> - **图片和简介走维基百科**，不需要 key，也和上面选 A/B 无关——地标类命中率高，餐馆类通常没图就回落 emoji，属正常。
> - 想彻底关掉系统推荐 / 搜索：`PLACES_PROVIDER` 设成 `""`。
> - 高德（`amap`）/ Google（`google`）也支持：高德 Web key 无法按域名限制、Google 要绑卡，所以**都建议走接法 A**（`places-proxy.ts` 已支持转发这两家，设 `AMAP_WEB_KEY` / `GOOGLE_PLACES_KEY` 即可）。
> - 代理是公开地址，函数里已加「每 IP 每小时 600 次」的限流，防止有人刷光你的免费额度。

---

## 六、常见问题
- **只想自己用、不想搞后端？** 什么都不用做，就是本地模式。
- **换了新手机行程没了？** 本地模式的数据在旧手机浏览器里；想跨设备就接云端（第一章）。接上后登录同一账号即可看到。
- **想临时切回本地？** 把 `config.js` 的 URL/key 清空再部署即可，互不影响。
- **报错 “Supabase 未加载”？** 检查 `vendor/supabase.js` 是否随仓库一起部署了（它是本地打包的，不走 CDN）。
