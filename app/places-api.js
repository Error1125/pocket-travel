/* ==========================================================================
 * 口袋旅行 · 地点服务层  window.PTPlaces
 * --------------------------------------------------------------------------
 * 一个统一的数据源，给这些功能供货：
 *   · 搜索地点（新建地点走这里，像导航软件一样输入名字→出结果）  search()
 *   · 地图选点后反查名称/地址（拖一个点也能自动带出信息）        reverse()
 *   · 系统「附近还可随缘」推荐                                    nearby()
 *   · 目的地图片 + 一句话简介（来自维基百科，免 key）             enrich()
 *
 * trip.html 只跟 PTPlaces 说话，完全不关心底下接的是谁——
 * 以后想换/加供应商，只改这一个文件。
 *
 * provider（在 app/config.js 用 PLACES_PROVIDER 切换）：
 *   "demo"     内置演示数据，零配置、离线可用，先看交互效果（默认）
 *   "geoapify" ★推荐★ 开放地图（OpenStreetMap）· 免费 3000 次/天、免信用卡，
 *              key 可在控制台按域名(HTTP referrer / CORS)锁定 → 可以直接放前端。
 *              覆盖：搜索(autocomplete) + 反查(reverse) + 周边(places)。
 *   "amap"     高德 Web 服务（国内数据最全，图片是可保存直链）
 *   "google"   Google Places API (New)（海外数据全，需绑卡）
 *   ""         关闭系统推荐/图片；搜索新建也停用
 *
 * 图片 & 简介（enrich）与 provider 无关：统一走维基百科（zh→ja→en 就近匹配），
 * 免 key、支持 CORS。地标/寺庙/博物馆/车站类命中率高，餐馆类通常没有→回落 emoji。
 *
 * 统一的地点对象（rec）：
 *   { ref, n, c, la, ln, ar, d, p?, ph?, phref?, pa?, src, dist? }
 *   ref   外部唯一标识（去重/回查）      n 名称      c 类别(见 trip.html CAT)
 *   la,ln 坐标（geoapify=WGS-84 与地图一致；amap=GCJ-02；demo=随机）
 *   ar 区域   d 一句话/地址   p 价位/评分文案   ph 图片直链   phref Google 照片资源名
 *   pa 图片署名   src provider   dist 距请求中心米数
 *
 * 上线安全：
 *   · geoapify / google key 可按域名限制，放前端 OK。
 *   · 高德 Web key 只能 IP 白名单，浏览器场景形同虚设——正式上线请配 PLACES_PROXY
 *     指向自建中转（Supabase Edge Function 即可），key 留服务端。
 * ========================================================================== */
(function () {
  "use strict";

  var cfg = window.PT_CONFIG || {};

  function provider() {
    return String(cfg.PLACES_PROVIDER || "").toLowerCase();
  }
  function hasKey(p) {
    if (p === "demo") return true;
    if (p === "geoapify") return !!(cfg.GEOAPIFY_KEY || cfg.PLACES_PROXY);
    if (p === "amap") return !!(cfg.AMAP_WEB_KEY || cfg.PLACES_PROXY);
    if (p === "google") return !!(cfg.GOOGLE_PLACES_KEY || cfg.PLACES_PROXY);
    return false;
  }
  function enabled() {
    var p = provider();
    if (!p) return false;
    return hasKey(p);
  }
  /* 选了真实 provider 却还没填 key 时：静默回落到 demo 数据，
     这样界面（搜索/推荐）不至于「空掉」，填上 key 立刻变真实。只提示一次。 */
  var _warned = false;
  function effectiveProvider() {
    var p = provider();
    if (p && p !== "demo" && !hasKey(p)) {
      if (!_warned) {
        _warned = true;
        try {
          console.info(
            "[PTPlaces] PLACES_PROVIDER=" +
              p +
              " 还没配 key，先用演示数据。到 app/config.js 填 " +
              (p === "geoapify"
                ? "GEOAPIFY_KEY"
                : p === "amap"
                  ? "AMAP_WEB_KEY"
                  : "GOOGLE_PLACES_KEY") +
              " 即变真实数据。",
          );
        } catch (e) {}
      }
      return "demo";
    }
    return p;
  }

  /* 代理约定：PLACES_PROXY = "https://xxx.functions.supabase.co/places"
   * 请求会发到 {PROXY}/geoapify/... {PROXY}/amap/... {PROXY}/gplaces/...
   * 代理原样转发到对应上游并补 key 即可。 */
  function geoBase() {
    return cfg.PLACES_PROXY
      ? cfg.PLACES_PROXY.replace(/\/$/, "") + "/geoapify"
      : "https://api.geoapify.com";
  }
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
  function geoKeyQS() {
    return cfg.GEOAPIFY_KEY ? "&apiKey=" + encodeURIComponent(cfg.GEOAPIFY_KEY) : "";
  }
  /* 走后端代理时（PLACES_PROXY 指向 Supabase 函数）带上 anon key，
     让函数网关放行（函数本身用 --no-verify-jwt，不校验它）。anon key 本就是公开值。
     只在请求确实发往代理时才加，避免把 key 发给维基百科等第三方。 */
  function merge(a, b) {
    var o = {},
      k;
    for (k in a) o[k] = a[k];
    for (k in b) o[k] = b[k];
    return o;
  }
  function isProxyUrl(url) {
    return !!(
      cfg.PLACES_PROXY &&
      url &&
      url.indexOf(cfg.PLACES_PROXY.replace(/\/$/, "")) === 0
    );
  }
  function proxyHeaders(url) {
    var h = {};
    if (isProxyUrl(url) && cfg.SUPABASE_ANON_KEY) {
      h["apikey"] = cfg.SUPABASE_ANON_KEY;
      h["Authorization"] = "Bearer " + cfg.SUPABASE_ANON_KEY;
    }
    return h;
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
  function getJSON(url, opt) {
    opt = opt || {};
    var ph = proxyHeaders(url);
    if (ph.apikey) opt.headers = merge(ph, opt.headers || {});
    return fetch(url, opt).then(function (r) {
      if (!r.ok) throw new Error("http " + r.status);
      return r.json();
    });
  }
  function str(v) {
    return typeof v === "string" ? v : ""; /* 高德空值给 []，统一成 "" */
  }
  function clip(s, n) {
    s = String(s || "").trim();
    return s.length > n ? s.slice(0, n - 1) + "…" : s;
  }

  /* ---------- 结果缓存（省配额）：内存 + localStorage，12 小时 ---------- */
  var mem = {};
  var TTL = 12 * 3600 * 1000;
  function ckey(tag, a, b, r) {
    return (
      "ptrec:" + effectiveProvider() + ":" + tag + ":" + a.toFixed(3) + "," + b.toFixed(3) + ":" + r
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
    ["eat", "海鲜盖饭店", "早市旁，用料新鲜"],
    ["shop", "唱片二手店", "老板会跟你聊上半天"],
  ];
  function demoSeed(la, ln) {
    var seed = Math.floor(Math.abs(la * 1e4 + ln * 1e4)) % 233280;
    return function () {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
  }
  function demoRec(t, i, o, rnd) {
    var ang = rnd() * Math.PI * 2,
      r = 120 + rnd() * ((o.radius || 900) - 140);
    var la = o.la + (Math.cos(ang) * r) / 111320;
    var ln =
      o.ln + (Math.sin(ang) * r) / (111320 * Math.cos((o.la * Math.PI) / 180));
    return {
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
    };
  }
  function demoNearby(o) {
    var rnd = demoSeed(o.la, o.ln);
    var n = Math.min(o.limit || 8, DEMO_POOL.length);
    var recs = [];
    for (var i = 0; i < n; i++) recs.push(demoRec(DEMO_POOL[i], i, o, rnd));
    return Promise.resolve(recs);
  }
  function demoSearch(o) {
    var near = o.near || { la: 35.68, ln: 139.76, radius: 1500 };
    near.radius = near.radius || 1500;
    var rnd = demoSeed(near.la + o.q.length, near.ln);
    var q = o.q;
    var hits = DEMO_POOL.filter(function (t) {
      return t[1].indexOf(q) >= 0 || q.length <= 1;
    });
    if (!hits.length) hits = DEMO_POOL.slice(0, 4);
    /* 头一条用「搜索词本身」当结果，模拟搜到了这个地方 */
    var recs = [
      demoRec(["spot", q, "按名字搜到的地方"], 99, near, rnd),
    ].concat(
      hits.slice(0, (o.limit || 8) - 1).map(function (t, i) {
        return demoRec(t, i, near, rnd);
      }),
    );
    return Promise.resolve(recs);
  }
  function demoReverse(la, ln) {
    return Promise.resolve({
      ref: "demo:rev:" + la.toFixed(4) + "," + ln.toFixed(4),
      n: "地图上的点",
      c: "spot",
      la: la,
      ln: ln,
      ar: "",
      d: "手动选点（演示：换成真实 provider 会自动带出地址）",
      p: "",
      ph: "",
      src: "demo",
      dist: 0,
    });
  }

  /* ========================================================================
   * provider · geoapify —— 开放地图（OpenStreetMap 数据）· 推荐
   * 搜索: /v1/geocode/autocomplete    反查: /v1/geocode/reverse
   * 周边: /v2/places                  统统返回 GeoJSON FeatureCollection
   * 坐标为 WGS-84，与 Leaflet/CartoDB 地图一致，不用纠偏。
   * ====================================================================== */
  function geoCat(cats) {
    var s = (cats || []).join(",");
    if (/catering\.(cafe|ice_cream)|bakery|coffee|dessert|pastry|tea/.test(s))
      return "sweet";
    if (/catering|restaurant|\bfood\b|fast_food|food_court|\bpub\b|\bbar\b/.test(s))
      return "eat";
    if (/accommodation|hotel|hostel|guest_house|motel|apartment/.test(s))
      return "hotel";
    if (/airport|aeroway|railway|public_transport|bus_station|subway/.test(s))
      return "fly";
    if (/commercial|\bshop\b|marketplace|mall|department_store|supermarket/.test(s))
      return "shop";
    if (/viewpoint/.test(s)) return "photo";
    if (
      /theme_park|amusement|\bzoo\b|aquarium|arcade|bowling|cinema|karaoke|water_park/.test(
        s,
      )
    )
      return "fun";
    /* museum / sights / religion / heritage / tourism / leisure.park → 景点 */
    return "spot";
  }
  function geoFeatureToRec(f, center) {
    var pr = (f && f.properties) || {};
    var la = pr.lat,
      ln = pr.lon;
    if (!isFinite(la) || !isFinite(ln)) return null;
    var name = str(pr.name) || str(pr.address_line1) || str(pr.street);
    if (!name) return null;
    var cats = pr.categories || (pr.category ? [pr.category] : []);
    var ar =
      str(pr.suburb) ||
      str(pr.district) ||
      str(pr.neighbourhood) ||
      str(pr.city) ||
      str(pr.county) ||
      "";
    var d = str(pr.address_line2) || str(pr.formatted) || str(pr.address_line1);
    if (d === name) d = str(pr.formatted) || str(pr.city) || "";
    var dist = isFinite(pr.distance)
      ? pr.distance
      : center
        ? Math.round(distM(center, { la: la, ln: ln }))
        : 0;
    return {
      ref: "geo:" + (str(pr.place_id) || la.toFixed(5) + "," + ln.toFixed(5)),
      n: name,
      c: geoCat(cats),
      la: la,
      ln: ln,
      ar: ar,
      d: d,
      p: "",
      ph: "",
      src: "geoapify",
      dist: dist,
    };
  }
  var GEO_CATS = [
    "catering.restaurant",
    "catering.cafe",
    "catering.fast_food",
    "catering.food_court",
    "catering.ice_cream",
    "commercial.shopping_mall",
    "commercial.marketplace",
    "commercial.gift_and_souvenir",
    "commercial.books",
    "tourism.sights",
    "tourism.attraction",
    "entertainment",
    "leisure.park",
    "heritage",
  ].join(",");
  function geoNearby(o) {
    var lon = o.ln.toFixed(6),
      lat = o.la.toFixed(6);
    var url =
      geoBase() +
      "/v2/places?categories=" +
      encodeURIComponent(GEO_CATS) +
      "&filter=circle:" +
      lon +
      "," +
      lat +
      "," +
      o.radius +
      "&bias=proximity:" +
      lon +
      "," +
      lat +
      "&limit=" +
      Math.min((o.limit || 8) * 2, 40) +
      "&lang=zh" +
      geoKeyQS();
    return getJSON(url).then(function (j) {
      return (j.features || [])
        .map(function (f) {
          return geoFeatureToRec(f, o);
        })
        .filter(Boolean);
    });
  }
  function geoSearch(o) {
    var url =
      geoBase() +
      "/v1/geocode/autocomplete?text=" +
      encodeURIComponent(o.q) +
      "&format=geojson&limit=" +
      (o.limit || 8) +
      "&lang=zh";
    if (o.near && isFinite(o.near.la))
      url +=
        "&bias=proximity:" +
        o.near.ln.toFixed(5) +
        "," +
        o.near.la.toFixed(5);
    url += geoKeyQS();
    return getJSON(url).then(function (j) {
      return (j.features || [])
        .map(function (f) {
          return geoFeatureToRec(f, o.near);
        })
        .filter(Boolean);
    });
  }
  function geoReverse(la, ln) {
    var url =
      geoBase() +
      "/v1/geocode/reverse?lat=" +
      la +
      "&lon=" +
      ln +
      "&format=geojson&lang=zh&limit=1" +
      geoKeyQS();
    return getJSON(url).then(function (j) {
      var f = (j.features || [])[0];
      var rec = f ? geoFeatureToRec(f, { la: la, ln: ln }) : null;
      if (rec) {
        rec.la = la;
        rec.ln = ln;
      } /* 保留用户点的精确坐标 */
      return rec;
    });
  }

  /* ========================================================================
   * provider · amap —— 高德
   * 周边 /v3/place/around   文本 /v3/place/text   反查 /v3/geocode/regeo
   * 注意 location 为「经度,纬度」；空字段常用 []。
   * ====================================================================== */
  var AMAP_TYPES = "110000|050000|060000|080000|140100";
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
  function amapPoiToRec(poi, center) {
    var ll = String(poi.location || "").split(",");
    var la = parseFloat(ll[1]),
      ln = parseFloat(ll[0]);
    var ph =
      poi.photos && poi.photos[0] && str(poi.photos[0].url)
        ? str(poi.photos[0].url)
        : "";
    var ext = poi.biz_ext || {};
    var bits = [];
    if (str(ext.rating)) bits.push("★" + str(ext.rating));
    if (str(ext.cost)) bits.push("¥" + str(ext.cost) + "/人");
    var dist =
      parseInt(poi.distance, 10) ||
      (center && isFinite(la) ? Math.round(distM(center, { la: la, ln: ln })) : 0);
    return {
      ref: "amap:" + poi.id,
      n: str(poi.name),
      c: amapCat(poi),
      la: la,
      ln: ln,
      ar: str(poi.business_area) || str(poi.adname),
      d: str(poi.address),
      p: bits.join(" · "),
      ph: ph,
      src: "amap",
      dist: dist,
    };
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
        return jsonp(url);
      })
      .then(function (j) {
        if (!j || j.status !== "1" || !j.pois)
          throw new Error(str(j && j.info) || "amap error");
        return j.pois.slice(0, o.limit).map(function (poi) {
          return amapPoiToRec(poi, o);
        });
      });
  }
  function amapSearch(o) {
    var url =
      amapBase() +
      "/v3/place/text?keywords=" +
      encodeURIComponent(o.q) +
      "&offset=" +
      (o.limit || 10) +
      "&page=1&extensions=all&citylimit=false" +
      (o.near
        ? "&location=" + o.near.ln.toFixed(6) + "," + o.near.la.toFixed(6)
        : "") +
      (cfg.AMAP_WEB_KEY ? "&key=" + cfg.AMAP_WEB_KEY : "");
    return getJSON(url)
      .catch(function () {
        return jsonp(url);
      })
      .then(function (j) {
        if (!j || j.status !== "1" || !j.pois)
          throw new Error(str(j && j.info) || "amap error");
        return j.pois
          .map(function (poi) {
            return amapPoiToRec(poi, o.near);
          })
          .filter(function (r) {
            return isFinite(r.la);
          });
      });
  }
  function amapReverse(la, ln) {
    var url =
      amapBase() +
      "/v3/geocode/regeo?location=" +
      ln.toFixed(6) +
      "," +
      la.toFixed(6) +
      "&extensions=all&radius=200" +
      (cfg.AMAP_WEB_KEY ? "&key=" + cfg.AMAP_WEB_KEY : "");
    return getJSON(url)
      .catch(function () {
        return jsonp(url);
      })
      .then(function (j) {
        var rc = j && j.regeocode;
        if (!rc) return null;
        var poi = (rc.pois || [])[0];
        var name =
          (poi && str(poi.name)) ||
          str(rc.formatted_address) ||
          "地图上的点";
        var ar = "";
        var ac = rc.addressComponent || {};
        ar =
          (ac.businessAreas &&
            ac.businessAreas[0] &&
            str(ac.businessAreas[0].name)) ||
          str(ac.township) ||
          str(ac.district) ||
          "";
        return {
          ref: "amap:rev:" + la.toFixed(5) + "," + ln.toFixed(5),
          n: name,
          c: poi ? amapCat(poi) : "spot",
          la: la,
          ln: ln,
          ar: ar,
          d: str(rc.formatted_address),
          p: "",
          ph: poi && poi.photos && poi.photos[0] ? str(poi.photos[0].url) : "",
          src: "amap",
          dist: 0,
        };
      });
  }

  /* ========================================================================
   * provider · google —— Places API (New)
   * 周边 /v1/places:searchNearby   文本 /v1/places:searchText
   * photos[].name 会过期：只存引用，展示时 photoUrl() 现拼。
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
  function gPlaceToRec(pl, center) {
    var photo = (pl.photos || [])[0] || null;
    var attr =
      photo && photo.authorAttributions && photo.authorAttributions[0];
    var la = pl.location ? pl.location.latitude : 0,
      ln = pl.location ? pl.location.longitude : 0;
    var rec = {
      ref: "g:" + pl.id,
      n: (pl.displayName && pl.displayName.text) || "",
      c: gCat(pl),
      la: la,
      ln: ln,
      ar: "",
      d: pl.shortFormattedAddress || pl.formattedAddress || "",
      p: pl.rating ? "★" + pl.rating : "",
      ph: "",
      phref: photo ? photo.name : "",
      pa: attr ? attr.displayName || "" : "",
      src: "google",
      dist: center ? Math.round(distM(center, { la: la, ln: ln })) : 0,
    };
    return rec;
  }
  function gHeaders(mask) {
    var h = { "Content-Type": "application/json", "X-Goog-FieldMask": mask };
    if (cfg.GOOGLE_PLACES_KEY) h["X-Goog-Api-Key"] = cfg.GOOGLE_PLACES_KEY;
    if (cfg.PLACES_PROXY && cfg.SUPABASE_ANON_KEY) {
      h["apikey"] = cfg.SUPABASE_ANON_KEY;
      h["Authorization"] = "Bearer " + cfg.SUPABASE_ANON_KEY;
    }
    return h;
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
    return fetch(gBase() + "/v1/places:searchNearby", {
      method: "POST",
      headers: gHeaders(
        "places.id,places.displayName,places.location,places.types,places.primaryType,places.shortFormattedAddress,places.rating,places.photos",
      ),
      body: JSON.stringify(body),
    })
      .then(function (r) {
        if (!r.ok) throw new Error("gplaces http " + r.status);
        return r.json();
      })
      .then(function (j) {
        return (j.places || []).map(function (pl) {
          return gPlaceToRec(pl, o);
        });
      });
  }
  function gSearch(o) {
    var body = {
      textQuery: o.q,
      languageCode: "zh-CN",
      maxResultCount: Math.min(o.limit || 10, 15),
    };
    if (o.near && isFinite(o.near.la))
      body.locationBias = {
        circle: {
          center: { latitude: o.near.la, longitude: o.near.ln },
          radius: 30000,
        },
      };
    return fetch(gBase() + "/v1/places:searchText", {
      method: "POST",
      headers: gHeaders(
        "places.id,places.displayName,places.location,places.types,places.primaryType,places.formattedAddress,places.shortFormattedAddress,places.rating,places.photos",
      ),
      body: JSON.stringify(body),
    })
      .then(function (r) {
        if (!r.ok) throw new Error("gplaces http " + r.status);
        return r.json();
      })
      .then(function (j) {
        return (j.places || []).map(function (pl) {
          return gPlaceToRec(pl, o.near);
        });
      });
  }

  /* ========================================================================
   * enrich —— 目的地图片 + 一句话简介（维基百科，免 key，就近匹配）
   * 只给地标类（景点/体验/机位/酒店）自动配图，餐馆等回落 emoji（命中率低+易错配）。
   * 结果长期缓存（含「查过但没有」的负缓存），避免反复请求。
   * ====================================================================== */
  var ENR_TTL = 30 * 24 * 3600 * 1000;
  var ENR_OK = { spot: 1, fun: 1, photo: 1, hotel: 1 };
  function enrKey(p) {
    return (
      "ptenr:" +
      (p.ref ||
        p.n + "@" + (isFinite(p.la) ? p.la.toFixed(3) : ""))
    );
  }
  function enrGet(k) {
    try {
      var v = JSON.parse(localStorage.getItem(k) || "null");
      if (v && Date.now() - v.t < ENR_TTL) return v;
    } catch (e) {}
    return null;
  }
  function enrSet(k, val) {
    try {
      localStorage.setItem(k, JSON.stringify({ t: Date.now(), v: val }));
    } catch (e) {}
  }
  function wikiGeo(lang, la, ln) {
    var u =
      "https://" +
      lang +
      ".wikipedia.org/w/api.php?action=query&format=json&origin=*" +
      "&prop=pageimages%7Ccoordinates%7Cextracts&piprop=thumbnail&pithumbsize=800" +
      "&exintro=1&explaintext=1&exsentences=2" +
      "&generator=geosearch&ggscoord=" +
      la +
      "%7C" +
      ln +
      "&ggsradius=700&ggslimit=6";
    return getJSON(u);
  }
  function normName(s) {
    return String(s || "")
      .toLowerCase()
      .replace(/[\s·・,，.。()（）]/g, "");
  }
  function pickWiki(j, name, lang) {
    var pages = j && j.query && j.query.pages;
    if (!pages) return null;
    var arr = Object.keys(pages)
      .map(function (k) {
        return pages[k];
      })
      .filter(function (p) {
        return p && p.thumbnail && p.thumbnail.source;
      });
    if (!arr.length) return null;
    var nn = normName(name);
    arr.sort(function (a, b) {
      var at = normName(a.title),
        bt = normName(b.title);
      var am = nn && (at.indexOf(nn) >= 0 || nn.indexOf(at) >= 0) ? 0 : 1;
      var bm = nn && (bt.indexOf(nn) >= 0 || nn.indexOf(bt) >= 0) ? 0 : 1;
      if (am !== bm) return am - bm;
      return (a.index || 99) - (b.index || 99);
    });
    var pg = arr[0];
    return {
      ph: pg.thumbnail.source,
      info: clip(pg.extract, 150),
      wiki: "https://" + lang + ".wikipedia.org/?curid=" + pg.pageid,
      attr: "维基百科",
    };
  }
  function wikiChain(langs, i, place, name) {
    if (i >= langs.length) return Promise.resolve(null);
    return wikiGeo(langs[i], place.la, place.ln)
      .then(function (j) {
        var r = pickWiki(j, name, langs[i]);
        return r || wikiChain(langs, i + 1, place, name);
      })
      .catch(function () {
        return wikiChain(langs, i + 1, place, name);
      });
  }
  function enrich(place, opt) {
    opt = opt || {};
    if (!place || !isFinite(place.la) || !isFinite(place.ln))
      return Promise.resolve(null);
    /* 已经带图（高德/手填/收编过）：直接给回，附带已存简介 */
    if (place.ph)
      return Promise.resolve({
        ph: place.ph,
        info: place.info || "",
        wiki: place.wiki || "",
        attr: place.pa || "",
      });
    if (!opt.force && !ENR_OK[place.c]) return Promise.resolve(null);
    var k = enrKey(place);
    var cached = enrGet(k);
    if (cached) return Promise.resolve(cached.v);
    var langs = place.j ? ["ja", "zh", "en"] : ["zh", "ja", "en"];
    return wikiChain(langs, 0, place, place.n || "")
      .then(function (r) {
        enrSet(k, r || null);
        return r;
      })
      .catch(function () {
        return null;
      });
  }

  /* ---------- 对外接口 ---------- */
  function nearby(o) {
    o = o || {};
    o.radius = o.radius || cfg.PLACES_RADIUS || 900;
    o.limit = o.limit || 8;
    if (!enabled() && effectiveProvider() !== "demo") return Promise.resolve([]);
    if (o.la == null || o.ln == null) return Promise.resolve([]);
    var k = ckey("near", o.la, o.ln, o.radius);
    var hit = cacheGet(k);
    if (hit) return Promise.resolve(hit);
    var ep = effectiveProvider();
    var run =
      ep === "geoapify"
        ? geoNearby
        : ep === "amap"
          ? amapNearby
          : ep === "google"
            ? gNearby
            : demoNearby;
    return run(o)
      .then(function (recs) {
        recs = (recs || []).filter(function (r) {
          return r.n && isFinite(r.la) && isFinite(r.ln);
        });
        recs.sort(function (a, b) {
          return a.dist - b.dist;
        });
        recs = recs.slice(0, o.limit);
        cacheSet(k, recs);
        return recs;
      })
      .catch(function () {
        return [];
      });
  }

  /* 搜索地点（新建地点用）：q 关键词，near 可选中心（优先就近）。返回 rec[]。 */
  function search(o) {
    o = o || {};
    o.q = String(o.q || "").trim();
    o.limit = o.limit || 8;
    if (!o.q) return Promise.resolve([]);
    if (!enabled() && effectiveProvider() !== "demo") return Promise.resolve([]);
    var ep = effectiveProvider();
    var run =
      ep === "geoapify"
        ? geoSearch
        : ep === "amap"
          ? amapSearch
          : ep === "google"
            ? gSearch
            : demoSearch;
    return run(o)
      .then(function (recs) {
        return (recs || []).filter(function (r) {
          return r.n && isFinite(r.la) && isFinite(r.ln);
        });
      })
      .catch(function () {
        return [];
      });
  }

  /* 反查：地图选点后拿名称/地址（拖点也能自动带信息）。拿不到就 resolve(null)。 */
  function reverse(la, ln) {
    if (!isFinite(la) || !isFinite(ln)) return Promise.resolve(null);
    if (!enabled() && effectiveProvider() !== "demo") return Promise.resolve(null);
    var ep = effectiveProvider();
    var run =
      ep === "geoapify"
        ? geoReverse
        : ep === "amap"
          ? amapReverse
          : ep === "google"
            ? function () {
                return Promise.resolve(null);
              }
            : demoReverse;
    return run(la, ln).catch(function () {
      return null;
    });
  }

  /* rec/地点 → <img src>（同步；只处理直链 ph 和 Google 资源名）。
   * 维基图片走 enrich()（异步）。拿不到返回 ""，UI 用 emoji 占位。 */
  function photoUrl(x, w) {
    if (!x) return "";
    if (x.ph) return x.ph;
    var ref = x.phref || x.pr;
    if (ref) {
      var u = gBase() + "/v1/" + ref + "/media?maxWidthPx=" + (w || 640);
      if (cfg.GOOGLE_PLACES_KEY) u += "&key=" + cfg.GOOGLE_PLACES_KEY;
      return u;
    }
    return "";
  }

  function providerName() {
    return (
      {
        geoapify: "开放地图",
        amap: "高德地点",
        google: "Google 地点",
        demo: "演示数据",
      }[effectiveProvider()] || ""
    );
  }

  window.PTPlaces = {
    enabled: enabled,
    nearby: nearby,
    search: search,
    reverse: reverse,
    enrich: enrich,
    photoUrl: photoUrl,
    providerName: providerName,
  };
})();
