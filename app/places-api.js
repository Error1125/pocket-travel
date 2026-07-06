/* ==========================================================================
 * 口袋旅行 · 附近推荐服务层  window.PTPlaces
 * --------------------------------------------------------------------------
 * 干什么用：给「系统推荐随缘点」和「地点图片」提供统一的数据源。
 * trip.html 只跟 PTPlaces 说话，完全不关心底下接的是高德还是 Google——
 * 以后想换供应商 / 加供应商（比如 AI 推荐），只改这一个文件。
 *
 * 三个 provider（在 app/config.js 里用 PLACES_PROVIDER 切换）：
 *   "demo"    内置演示数据，零配置、离线可用，用来先看交互效果
 *   "amap"    高德 Web 服务 · 周边搜索 v3（extensions=all 自带 photos，
 *             图片是可长期保存的直链 URL）
 *   "google"  Google Places API (New) · Nearby Search（photos 返回的是
 *             「资源名」，会过期、条款禁止缓存，所以只存引用、展示时现取，
 *             并按要求显示作者署名）
 *   ""        关闭整个推荐功能，界面上不出现任何系统推荐
 *
 * 统一的推荐对象（rec）：
 *   {
 *     ref   : "amap:B0FFG…" | "g:ChIJ…" | "demo:3"   外部唯一标识（去重/回查用）
 *     n     : 名称
 *     c     : 类别（复用 trip.html 的 CAT key：eat/sweet/photo/shop/spot/fun/hotel/fly）
 *     la,ln : 坐标（高德坐标系为 GCJ-02，与国内地图一致；Google 为 WGS-84。
 *             两者相差数十米，phase 1 先不做纠偏，之后可在此层统一转换）
 *     ar    : 区域（商圈/行政区，可能为空）
 *     d     : 一句话描述（地址或类型）
 *     p     : 价位/评分文案，如 "★4.6 · ¥58/人"（可能为空）
 *     ph    : 图片直链 URL（高德/演示；可以存进行程文档）
 *     phref : Google 照片资源名（不可缓存，展示时用 photoUrl() 换真图）
 *     pa    : 图片作者署名（Google 要求展示）
 *     src   : "amap" | "google" | "demo"
 *     dist  : 距离请求中心的米数（供排序展示）
 *   }
 *
 * 安全提示（上线前必读）：
 *   · Google key 可在控制台按「HTTP referrer」限制到你的域名，可直接放前端。
 *   · 高德 Web 服务 key 只能做 IP 白名单，对浏览器场景形同虚设——正式上线
 *     建议配 PLACES_PROXY 指向自己的中转（Supabase Edge Function 就够了，
 *     本项目已经在用 Supabase）。代理约定见下方 BASE() 注释。
 * ========================================================================== */
(function () {
  "use strict";

  var cfg = window.PT_CONFIG || {};

  function provider() {
    return String(cfg.PLACES_PROVIDER || "").toLowerCase();
  }
  function enabled() {
    var p = provider();
    if (!p) return false;
    if (p === "demo") return true;
    if (p === "amap") return !!(cfg.AMAP_WEB_KEY || cfg.PLACES_PROXY);
    if (p === "google") return !!(cfg.GOOGLE_PLACES_KEY || cfg.PLACES_PROXY);
    return false;
  }

  /* 代理约定：设置 PLACES_PROXY = "https://xxx.functions.supabase.co/places"
   * 后，请求会发到  {PROXY}/amap/...   与  {PROXY}/gplaces/...
   * 代理只需原样转发到 restapi.amap.com / places.googleapis.com 并补上 key。 */
  function amapBase() {
    return cfg.PLACES_PROXY
      ? cfg.PLACES_PROXY.replace(/\/$/, "") + "/amap"
      : "https://restapi.amap.com";
  }
  function gBase() {
    return cfg.PLACES_PROXY
      ? cfg.PLACES_PROXY.replace(/\/$/, "") + "/gplaces"
      : "https://places.googleapis.com";
  }

  /* ---------- 小工具 ---------- */
  function distM(a, b) {
    var R = 6371000,
      T = Math.PI / 180;
    var x = Math.sin(((b.la - a.la) * T) / 2),
      y = Math.sin(((b.ln - a.ln) * T) / 2);
    var h = x * x + Math.cos(a.la * T) * Math.cos(b.la * T) * y * y;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  function jsonp(url, ms) {
    return new Promise(function (res, rej) {
      var cb = "_ptp" + Math.random().toString(36).slice(2);
      var s = document.createElement("script");
      var t = setTimeout(function () {
        done();
        rej(new Error("jsonp timeout"));
      }, ms || 8000);
      function done() {
        clearTimeout(t);
        delete window[cb];
        if (s.parentNode) s.parentNode.removeChild(s);
      }
      window[cb] = function (j) {
        done();
        res(j);
      };
      s.onerror = function () {
        done();
        rej(new Error("jsonp error"));
      };
      s.src = url + (url.indexOf("?") < 0 ? "?" : "&") + "callback=" + cb;
      document.head.appendChild(s);
    });
  }
  function getJSON(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error("http " + r.status);
      return r.json();
    });
  }

  /* ---------- 结果缓存（省配额）：内存 + localStorage，12 小时 ---------- */
  var mem = {};
  var TTL = 12 * 3600 * 1000;
  function ckey(la, ln, radius) {
    return (
      "ptrec:" +
      provider() +
      ":" +
      la.toFixed(3) +
      "," +
      ln.toFixed(3) +
      ":" +
      radius
    );
  }
  function cacheGet(k) {
    if (mem[k] && Date.now() - mem[k].t < TTL) return mem[k].recs;
    try {
      var v = JSON.parse(localStorage.getItem(k) || "null");
      if (v && Date.now() - v.t < TTL) {
        mem[k] = v;
        return v.recs;
      }
    } catch (e) {}
    return null;
  }
  function cacheSet(k, recs) {
    var v = { t: Date.now(), recs: recs };
    mem[k] = v;
    try {
      localStorage.setItem(k, JSON.stringify(v));
      /* 简单清理：缓存键超过 40 个时清掉最老的一半 */
      var ks = [];
      for (var i = 0; i < localStorage.length; i++) {
        var key = localStorage.key(i);
        if (key && key.indexOf("ptrec:") === 0) ks.push(key);
      }
      if (ks.length > 40) {
        ks.sort(function (a, b) {
          var ta = 0,
            tb = 0;
          try {
            ta = JSON.parse(localStorage.getItem(a)).t;
            tb = JSON.parse(localStorage.getItem(b)).t;
          } catch (e) {}
          return ta - tb;
        });
        ks.slice(0, 20).forEach(function (key) {
          localStorage.removeItem(key);
        });
      }
    } catch (e) {}
  }

  /* ========================================================================
   * provider · demo —— 零配置演示数据
   * 用请求坐标做随机种子，同一个点每次问都得到同一批「附近推荐」，
   * 方便你反复调交互；不联网也能用。
   * ====================================================================== */
  var DEMO_POOL = [
    ["eat", "转角食堂", "本地人排队的家常味"],
    ["eat", "深夜拉面研究所", "汤头浓、营业到凌晨"],
    ["sweet", "云朵甜品室", "招牌是现烤舒芙蕾"],
    ["sweet", "街口咖啡站", "自家烘豆，座位不多"],
    ["photo", "无名坂道机位", "下午三点逆光最好看"],
    ["shop", "杂货与纸品", "淘手账素材的好地方"],
    ["spot", "小神社", "五分钟就能逛完的清净地"],
    ["spot", "旧仓库画廊", "免费入场，展期常换"],
    ["fun", "街机游戏房", "百元硬币准备多一点"],
    ["fun", "手作体验工坊", "需要一小时，出片"],
  ];
  function demoNearby(o) {
    var seed = Math.floor(Math.abs(o.la * 1e4 + o.ln * 1e4)) % 233280;
    function rnd() {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    }
    var n = Math.min(o.limit || 8, DEMO_POOL.length);
    var recs = [];
    for (var i = 0; i < n; i++) {
      var t = DEMO_POOL[i];
      var ang = rnd() * Math.PI * 2,
        r = 120 + rnd() * (o.radius - 140);
      var la = o.la + (Math.cos(ang) * r) / 111320;
      var ln =
        o.ln + (Math.sin(ang) * r) / (111320 * Math.cos((o.la * Math.PI) / 180));
      recs.push({
        ref: "demo:" + i + ":" + Math.round(o.la * 1e3),
        n: t[1],
        c: t[0],
        la: la,
        ln: ln,
        ar: "",
        d: t[2] + "（演示数据）",
        p: rnd() > 0.5 ? "★" + (3.9 + rnd() * 1).toFixed(1) : "",
        ph: "",
        src: "demo",
        dist: Math.round(r),
      });
    }
    return Promise.resolve(recs);
  }

  /* ========================================================================
   * provider · amap —— 高德周边搜索 v3
   * GET /v3/place/around  extensions=all 时 pois[].photos 直接带图片 URL。
   * 注意高德的 location 是「经度,纬度」顺序；空字段常用 [] 表示。
   * ====================================================================== */
  var AMAP_TYPES = "110000|050000|060000|080000|140100"; /* 风景|餐饮|购物|休闲|博物馆 */
  function amapCat(poi) {
    var s = String(poi.type || "");
    if (/咖啡|甜品|茶|冰淇淋|面包|烘焙|糕/.test(s)) return "sweet";
    var p2 = String(poi.typecode || "").slice(0, 2);
    return (
      {
        "05": "eat",
        "06": "shop",
        "08": "fun",
        "10": "hotel",
        "11": "spot",
        "14": "spot",
        "15": "fly",
      }[p2] || "spot"
    );
  }
  function str(v) {
    return typeof v === "string" ? v : ""; /* 高德空值给 []，统一成 "" */
  }
  function amapNearby(o) {
    var url =
      amapBase() +
      "/v3/place/around?location=" +
      o.ln.toFixed(6) +
      "," +
      o.la.toFixed(6) +
      "&radius=" +
      o.radius +
      "&types=" +
      encodeURIComponent(AMAP_TYPES) +
      "&offset=" +
      Math.min(o.limit * 2, 25) +
      "&page=1&extensions=all&sortrule=weight" +
      (cfg.AMAP_WEB_KEY ? "&key=" + cfg.AMAP_WEB_KEY : "");
    return getJSON(url)
      .catch(function () {
        return jsonp(url); /* 个别环境 fetch 被拦时退回 JSONP */
      })
      .then(function (j) {
        if (!j || j.status !== "1" || !j.pois) throw new Error(str(j && j.info) || "amap error");
        return j.pois.slice(0, o.limit).map(function (poi) {
          var ll = String(poi.location || "").split(",");
          var ph =
            poi.photos && poi.photos[0] && str(poi.photos[0].url)
              ? str(poi.photos[0].url)
              : "";
          var ext = poi.biz_ext || {};
          var bits = [];
          if (str(ext.rating)) bits.push("★" + str(ext.rating));
          if (str(ext.cost)) bits.push("¥" + str(ext.cost) + "/人");
          return {
            ref: "amap:" + poi.id,
            n: str(poi.name),
            c: amapCat(poi),
            la: parseFloat(ll[1]),
            ln: parseFloat(ll[0]),
            ar: str(poi.business_area) || str(poi.adname),
            d: str(poi.address),
            p: bits.join(" · "),
            ph: ph,
            src: "amap",
            dist: parseInt(poi.distance, 10) || 0,
          };
        });
      });
  }

  /* ========================================================================
   * provider · google —— Places API (New) Nearby Search
   * POST /v1/places:searchNearby，必须带 X-Goog-FieldMask。
   * photos[].name 是会过期的资源名：只存引用，展示时 photoUrl() 现拼。
   * ====================================================================== */
  var G_TYPES = [
    "tourist_attraction",
    "restaurant",
    "cafe",
    "bakery",
    "shopping_mall",
    "museum",
    "park",
    "amusement_park",
    "aquarium",
    "zoo",
  ];
  function gCat(place) {
    var ts = [place.primaryType].concat(place.types || []).join(",");
    if (/cafe|bakery|ice_cream|dessert|tea/.test(ts)) return "sweet";
    if (/restaurant|food|meal/.test(ts)) return "eat";
    if (/shopping|store|market/.test(ts)) return "shop";
    if (/amusement|aquarium|zoo|bowling|movie|karaoke/.test(ts)) return "fun";
    if (/lodging|hotel/.test(ts)) return "hotel";
    if (/airport|station|transit/.test(ts)) return "fly";
    return "spot";
  }
  function gNearby(o) {
    var body = {
      languageCode: "zh-CN",
      maxResultCount: Math.min(o.limit, 20),
      rankPreference: "POPULARITY",
      includedTypes: G_TYPES,
      locationRestriction: {
        circle: {
          center: { latitude: o.la, longitude: o.ln },
          radius: o.radius,
        },
      },
    };
    var headers = {
      "Content-Type": "application/json",
      "X-Goog-FieldMask":
        "places.id,places.displayName,places.location,places.types,places.primaryType,places.shortFormattedAddress,places.rating,places.photos",
    };
    if (cfg.GOOGLE_PLACES_KEY) headers["X-Goog-Api-Key"] = cfg.GOOGLE_PLACES_KEY;
    return fetch(gBase() + "/v1/places:searchNearby", {
      method: "POST",
      headers: headers,
      body: JSON.stringify(body),
    })
      .then(function (r) {
        if (!r.ok) throw new Error("gplaces http " + r.status);
        return r.json();
      })
      .then(function (j) {
        return (j.places || []).map(function (pl) {
          var photo = (pl.photos || [])[0] || null;
          var attr =
            photo && photo.authorAttributions && photo.authorAttributions[0];
          var rec = {
            ref: "g:" + pl.id,
            n: (pl.displayName && pl.displayName.text) || "",
            c: gCat(pl),
            la: pl.location ? pl.location.latitude : 0,
            ln: pl.location ? pl.location.longitude : 0,
            ar: "",
            d: pl.shortFormattedAddress || "",
            p: pl.rating ? "★" + pl.rating : "",
            ph: "",
            phref: photo ? photo.name : "",
            pa: attr ? attr.displayName || "" : "",
            src: "google",
            dist: 0,
          };
          rec.dist = Math.round(distM(o, rec));
          return rec;
        });
      });
  }

  /* ---------- 对外接口 ---------- */
  function nearby(o) {
    o = o || {};
    o.radius = o.radius || cfg.PLACES_RADIUS || 900;
    o.limit = o.limit || 8;
    if (!enabled() || o.la == null || o.ln == null)
      return Promise.resolve([]);
    var k = ckey(o.la, o.ln, o.radius);
    var hit = cacheGet(k);
    if (hit) return Promise.resolve(hit);
    var run =
      provider() === "amap"
        ? amapNearby
        : provider() === "google"
          ? gNearby
          : demoNearby;
    return run(o).then(function (recs) {
      recs = (recs || []).filter(function (r) {
        return r.n && isFinite(r.la) && isFinite(r.ln);
      });
      recs.sort(function (a, b) {
        return a.dist - b.dist;
      });
      cacheSet(k, recs);
      return recs;
    });
  }

  /* 把 rec（或已入库、带 ph/pr 字段的地点）变成可用的 <img src>。
   * w 是期望宽度像素。拿不到图时返回 ""，UI 显示 emoji 占位即可。 */
  function photoUrl(x, w) {
    if (!x) return "";
    if (x.ph) return x.ph; /* 高德/演示/用户手填：直链 */
    var ref = x.phref || x.pr; /* Google：资源名 → media 端点现取 */
    if (ref) {
      var u =
        gBase() +
        "/v1/" +
        ref +
        "/media?maxWidthPx=" +
        (w || 640);
      if (cfg.GOOGLE_PLACES_KEY) u += "&key=" + cfg.GOOGLE_PLACES_KEY;
      return u;
    }
    return "";
  }

  function providerName() {
    return { amap: "高德地点", google: "Google 地点", demo: "演示数据" }[
      provider()
    ] || "";
  }

  window.PTPlaces = {
    enabled: enabled,
    nearby: nearby,
    photoUrl: photoUrl,
    providerName: providerName,
  };
})();
