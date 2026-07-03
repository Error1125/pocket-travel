/* ==========================================================================
 * 口袋旅行 · 数据层 (window.PT)
 * --------------------------------------------------------------------------
 * 把「本地」和「云端(Supabase)」两套后端封装成同一套 API。
 *   · 首页(index.html) 用它做：登录、行程列表、新建/导入/删除/分享
 *   · 行程页(trip.html) 用它做：读当前行程、保存改动、后台同步
 *
 * 关键设计：行程页永远先从 localStorage 缓存【同步】读出来（秒开 + 离线可用），
 * 云端拉取/实时同步只在后台悄悄进行，不阻塞界面。
 *
 * 一份「行程文档 (doc)」 = { P, DAYS, RES, S }
 *   P/DAYS/RES = 行程内容（地点、每日安排、情报）
 *   S          = 使用中的规划状态 {plans, done, sw, coach, nav}
 * ========================================================================== */
(function () {
  "use strict";

  var CFG = window.PT_CONFIG || {};
  var HAS_CLOUD = !!(CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY);
  var MODE = HAS_CLOUD ? "cloud" : "local";

  /* ---------- 小工具 ---------- */
  function uid() {
    return (
      "t" +
      Date.now().toString(36) +
      Math.random().toString(36).slice(2, 7)
    );
  }
  function code6() {
    var c = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789",
      s = "";
    for (var i = 0; i < 6; i++) s += c[(Math.random() * c.length) | 0];
    return s;
  }
  function now() {
    return new Date().toISOString();
  }
  function lsGet(k, d) {
    try {
      var v = localStorage.getItem(k);
      return v == null ? d : JSON.parse(v);
    } catch (e) {
      return d;
    }
  }
  function lsSet(k, v) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
      return true;
    } catch (e) {
      return false;
    }
  }
  function clone(o) {
    return JSON.parse(JSON.stringify(o));
  }

  /* 一份空白行程骨架（新建时用） */
  function blankDoc() {
    return {
      P: {},
      DAYS: [],
      RES: { sections: [], anchors: {} },
      S: { plans: {}, done: {}, sw: {}, coach: false, nav: "google" },
    };
  }
  /* 把导入的行程 JSON（{P,DAYS,res,meta}）规整成 doc */
  function docFromImport(j) {
    var d = blankDoc();
    d.P = j.P || {};
    d.DAYS = j.DAYS || [];
    d.RES = j.res || j.RES || d.RES;
    // 用默认 plan 初始化 S.plans
    (d.DAYS || []).forEach(function (day) {
      d.S.plans[day.id] = (day.plan || []).slice();
    });
    return d;
  }
  function titleFromImport(j) {
    return (j.meta && j.meta.title) || "未命名行程";
  }

  /* ================= 本地缓存（两种模式都用作离线缓存） ================= */
  var Cache = {
    docKey: function (id) {
      return "pt_doc_" + id;
    },
    getDoc: function (id) {
      return lsGet(this.docKey(id), null);
    },
    setDoc: function (id, doc) {
      lsSet(this.docKey(id), doc);
    },
    delDoc: function (id) {
      try {
        localStorage.removeItem(this.docKey(id));
      } catch (e) {}
    },
    getIndex: function () {
      return lsGet("pt_index", []);
    },
    setIndex: function (arr) {
      lsSet("pt_index", arr);
    },
    upsertIndex: function (meta) {
      var arr = this.getIndex(),
        i = arr.findIndex(function (t) {
          return t.id === meta.id;
        });
      if (i >= 0) arr[i] = Object.assign(arr[i], meta);
      else arr.unshift(meta);
      this.setIndex(arr);
    },
    removeIndex: function (id) {
      this.setIndex(
        this.getIndex().filter(function (t) {
          return t.id !== id;
        }),
      );
    },
    setLast: function (id) {
      lsSet("pt_last", id);
    },
    getLast: function () {
      return lsGet("pt_last", null);
    },
  };

  /* 一次性迁移：把旧版单行程 (tpk2_trip / tpk2) 变成第一份行程 */
  function migrateLegacy() {
    if (lsGet("pt_migrated_v1", false)) return;
    lsSet("pt_migrated_v1", true);
    var legacyTrip = lsGet("tpk2_trip", null);
    if (!legacyTrip || !legacyTrip.P || !legacyTrip.DAYS) return;
    var id = uid();
    var doc = docFromImport(legacyTrip);
    var legacyState = lsGet("tpk2", null);
    if (legacyState && legacyState.plans) doc.S = legacyState;
    Cache.setDoc(id, doc);
    Cache.upsertIndex({
      id: id,
      title: (legacyTrip.meta && legacyTrip.meta.title) || "東京口袋帖",
      emoji: "🗼",
      role: "owner",
      version: 1,
      updatedAt: now(),
      local: true,
    });
    Cache.setLast(id);
  }

  /* ============================ 本地后端 ============================ */
  var LocalBackend = {
    _user: null,
    init: function () {
      migrateLegacy();
      var p = lsGet("pt_profile", null);
      this._user = { id: "local", name: (p && p.name) || "我", local: true };
      return Promise.resolve();
    },
    getUser: function () {
      return this._user;
    },
    setName: function (name) {
      this._user.name = name || "我";
      lsSet("pt_profile", { name: this._user.name });
      return Promise.resolve(this._user);
    },
    signOut: function () {
      return Promise.resolve();
    },

    listTrips: function () {
      var arr = Cache.getIndex().map(function (t) {
        return Object.assign({}, t);
      });
      return Promise.resolve(arr);
    },
    createTrip: function (opt) {
      opt = opt || {};
      var id = uid();
      var doc = opt.doc || blankDoc();
      Cache.setDoc(id, doc);
      var meta = {
        id: id,
        title: opt.title || "新的旅行",
        emoji: opt.emoji || "🧳",
        role: "owner",
        version: 1,
        updatedAt: now(),
        local: true,
      };
      Cache.upsertIndex(meta);
      return Promise.resolve(meta);
    },
    renameTrip: function (id, patch) {
      Cache.upsertIndex(
        Object.assign({ id: id, updatedAt: now() }, patch || {}),
      );
      return Promise.resolve();
    },
    deleteTrip: function (id) {
      Cache.delDoc(id);
      Cache.removeIndex(id);
      return Promise.resolve();
    },
    loadDoc: function (id) {
      return Promise.resolve(Cache.getDoc(id));
    },
    saveDoc: function (id, doc) {
      Cache.setDoc(id, doc);
      Cache.upsertIndex({ id: id, updatedAt: now() });
      return Promise.resolve();
    },

    // 共享类：本地模式不支持，返回友好提示
    createInvite: function () {
      return Promise.reject(new Error("共享需要云端模式，请先在 config.js 配置 Supabase"));
    },
    redeemInvite: function () {
      return Promise.reject(new Error("共享需要云端模式"));
    },
    listMembers: function () {
      return Promise.resolve([{ userId: "local", name: this._user.name, role: "owner" }]);
    },
    leaveTrip: function (id) {
      return this.deleteTrip(id);
    },
    connect: function () {},
    disconnect: function () {},
  };

  /* ============================ 云端后端 ============================ */
  function CloudBackend() {
    this.sb = null;
    this._user = null;
    this._authCbs = [];
    this._channels = {}; // tripId -> realtime channel
    this._ver = {}; // tripId -> last known version
  }
  CloudBackend.prototype.init = function () {
    var self = this;
    if (!window.supabase || !window.supabase.createClient) {
      // vendor/supabase.js 没加载成功（比如离线）→ 优雅降级到本地
      console.warn("[PT] Supabase 库未加载，暂以本地缓存运行");
      self._degraded = true;
      return LocalBackend.init().then(function () {
        self._user = LocalBackend.getUser();
      });
    }
    this.sb = window.supabase.createClient(
      CFG.SUPABASE_URL,
      CFG.SUPABASE_ANON_KEY,
      { auth: { persistSession: true, autoRefreshToken: true } },
    );
    this.sb.auth.onAuthStateChange(function (_evt, session) {
      self._setUser(session && session.user);
      self._authCbs.forEach(function (cb) {
        try {
          cb(self._user);
        } catch (e) {}
      });
    });
    return this.sb.auth.getSession().then(function (r) {
      self._setUser(r.data.session && r.data.session.user);
      return self._user;
    });
  };
  CloudBackend.prototype._setUser = function (u) {
    if (!u) {
      this._user = null;
      return;
    }
    this._user = {
      id: u.id,
      email: u.email,
      name: (u.user_metadata && u.user_metadata.name) || u.email,
      cloud: true,
    };
    // 异步同步 profile（用于共享时显示名字），失败不影响
    this._upsertProfile();
  };
  CloudBackend.prototype._upsertProfile = function () {
    if (!this.sb || !this._user) return;
    this.sb
      .from("profiles")
      .upsert({
        id: this._user.id,
        name: this._user.name,
        email: this._user.email,
      })
      .then(function () {}, function () {});
  };
  CloudBackend.prototype.onAuth = function (cb) {
    this._authCbs.push(cb);
  };
  CloudBackend.prototype.getUser = function () {
    return this._user;
  };
  CloudBackend.prototype.signUp = function (email, pw, name) {
    return this.sb.auth
      .signUp({ email: email, password: pw, options: { data: { name: name || email } } })
      .then(function (r) {
        if (r.error) throw r.error;
        return r.data;
      });
  };
  CloudBackend.prototype.signIn = function (email, pw) {
    return this.sb.auth
      .signInWithPassword({ email: email, password: pw })
      .then(function (r) {
        if (r.error) throw r.error;
        return r.data;
      });
  };
  CloudBackend.prototype.signInWithGoogle = function () {
    return this.sb.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: location.href.split("#")[0] },
    });
  };
  CloudBackend.prototype.signOut = function () {
    var self = this;
    return this.sb.auth.signOut().then(function () {
      self._user = null;
    });
  };

  CloudBackend.prototype.listTrips = function () {
    // 用 RPC 一次拿到「我拥有的 + 别人分享给我的」，含角色和拥有者名字
    return this.sb.rpc("list_my_trips").then(function (r) {
      if (r.error) throw r.error;
      return (r.data || []).map(function (t) {
        return {
          id: t.id,
          title: t.title,
          emoji: t.emoji,
          role: t.role,
          version: t.version,
          updatedAt: t.updated_at,
          ownerName: t.owner_name,
          cloud: true,
        };
      });
    });
  };
  CloudBackend.prototype.createTrip = function (opt) {
    opt = opt || {};
    var self = this;
    var doc = opt.doc || blankDoc();
    return this.sb
      .from("trips")
      .insert({
        owner: this._user.id,
        title: opt.title || "新的旅行",
        emoji: opt.emoji || "🧳",
        data: doc,
        version: 1,
      })
      .select()
      .single()
      .then(function (r) {
        if (r.error) throw r.error;
        var t = r.data;
        Cache.setDoc(t.id, doc); // 顺手缓存
        self._ver[t.id] = t.version;
        return {
          id: t.id,
          title: t.title,
          emoji: t.emoji,
          role: "owner",
          version: t.version,
          updatedAt: t.updated_at,
          cloud: true,
        };
      });
  };
  CloudBackend.prototype.renameTrip = function (id, patch) {
    return this.sb
      .from("trips")
      .update({ title: patch.title, emoji: patch.emoji })
      .eq("id", id)
      .then(function (r) {
        if (r.error) throw r.error;
      });
  };
  CloudBackend.prototype.deleteTrip = function (id) {
    var self = this;
    return this.sb
      .from("trips")
      .delete()
      .eq("id", id)
      .then(function (r) {
        if (r.error) throw r.error;
        Cache.delDoc(id);
        delete self._ver[id];
      });
  };
  CloudBackend.prototype.loadDoc = function (id) {
    var self = this;
    return this.sb
      .from("trips")
      .select("data,version")
      .eq("id", id)
      .single()
      .then(function (r) {
        if (r.error) throw r.error;
        self._ver[id] = r.data.version;
        Cache.setDoc(id, r.data.data); // 更新缓存
        return r.data.data;
      });
  };
  CloudBackend.prototype.saveDoc = function (id, doc) {
    var self = this;
    var nextVer = (this._ver[id] || 1) + 1;
    Cache.setDoc(id, doc); // 先更新本地缓存（离线也不丢）
    return this.sb
      .from("trips")
      .update({ data: doc, version: nextVer, updated_at: now() })
      .eq("id", id)
      .then(function (r) {
        if (r.error) throw r.error;
        self._ver[id] = nextVer;
      });
  };

  // ---- 共享 ----
  CloudBackend.prototype.createInvite = function (id, role) {
    var self = this;
    var c = code6();
    return this.sb
      .from("trip_invites")
      .insert({
        code: c,
        trip_id: id,
        role: role || "editor",
        created_by: this._user.id,
      })
      .then(function (r) {
        if (r.error) throw r.error;
        var base = location.origin + location.pathname.replace(/[^/]*$/, "");
        return { code: c, url: base + "index.html?join=" + c };
      });
  };
  CloudBackend.prototype.redeemInvite = function (codeStr) {
    return this.sb
      .rpc("redeem_trip_invite", { p_code: String(codeStr).toUpperCase().trim() })
      .then(function (r) {
        if (r.error) throw r.error;
        return r.data; // trip_id
      });
  };
  CloudBackend.prototype.listMembers = function (id) {
    return this.sb.rpc("list_trip_members", { p_trip: id }).then(function (r) {
      if (r.error) throw r.error;
      return (r.data || []).map(function (m) {
        return { userId: m.user_id, name: m.name, role: m.role };
      });
    });
  };
  CloudBackend.prototype.leaveTrip = function (id) {
    var self = this;
    return this.sb
      .from("trip_members")
      .delete()
      .eq("trip_id", id)
      .eq("user_id", this._user.id)
      .then(function (r) {
        if (r.error) throw r.error;
        Cache.delDoc(id);
      });
  };

  // ---- 实时同步 ----
  CloudBackend.prototype.connect = function (id, opt) {
    var self = this;
    opt = opt || {};
    // 先拉一次最新，若比缓存新就回调
    this.loadDoc(id).then(
      function (doc) {
        if (opt.onRemote) opt.onRemote(doc, { initial: true });
      },
      function () {},
    );
    if (this._channels[id]) return;
    var ch = this.sb
      .channel("trip-" + id)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "trips", filter: "id=eq." + id },
        function (payload) {
          var row = payload.new;
          if (!row) return;
          // 忽略自己刚写的版本，只在「别人改的、版本更新」时刷新
          if (row.version > (self._ver[id] || 0)) {
            self._ver[id] = row.version;
            Cache.setDoc(id, row.data);
            if (opt.onRemote) opt.onRemote(row.data, { initial: false });
          }
        },
      )
      .subscribe();
    this._channels[id] = ch;
  };
  CloudBackend.prototype.disconnect = function (id) {
    if (this._channels[id]) {
      try {
        this.sb.removeChannel(this._channels[id]);
      } catch (e) {}
      delete this._channels[id];
    }
  };

  /* ============================ 对外统一门面 ============================ */
  var backend = MODE === "cloud" ? new CloudBackend() : LocalBackend;
  var _readyPromise = null;

  var PT = {
    mode: MODE,
    hasCloud: HAS_CLOUD,
    appName: CFG.APP_NAME || "口袋旅行",
    authMethods: CFG.AUTH_METHODS || ["email"],

    init: function () {
      if (!_readyPromise) _readyPromise = backend.init();
      return _readyPromise;
    },
    ready: function () {
      return this.init();
    },

    /* 身份 */
    getUser: function () {
      return backend.getUser();
    },
    onAuth: function (cb) {
      if (backend.onAuth) backend.onAuth(cb);
    },
    isCloud: function () {
      return MODE === "cloud" && !backend._degraded;
    },
    signUp: function (e, p, n) {
      return backend.signUp(e, p, n);
    },
    signIn: function (e, p) {
      return backend.signIn(e, p);
    },
    signInWithGoogle: function () {
      return backend.signInWithGoogle();
    },
    signOut: function () {
      return backend.signOut();
    },
    setName: function (n) {
      return backend.setName ? backend.setName(n) : Promise.resolve();
    },

    /* 行程列表级 */
    listTrips: function () {
      return backend.listTrips();
    },
    createTrip: function (opt) {
      return backend.createTrip(opt);
    },
    importTrip: function (jsonStrOrObj) {
      var j =
        typeof jsonStrOrObj === "string"
          ? JSON.parse(jsonStrOrObj)
          : jsonStrOrObj;
      if (!j || !j.P || !j.DAYS)
        return Promise.reject(new Error("这个 JSON 里没有行程数据（缺 P / DAYS）"));
      return backend.createTrip({
        title: titleFromImport(j),
        emoji: (j.meta && j.meta.emoji) || "🧳",
        doc: docFromImport(j),
      });
    },
    exportTrip: function (id) {
      return backend.loadDoc(id).then(function (doc) {
        if (!doc) throw new Error("找不到这份行程");
        var out = {
          v: 1,
          meta: { title: undefined, exported: now().slice(0, 10) },
          P: doc.P,
          DAYS: doc.DAYS,
          res: doc.RES,
        };
        return JSON.stringify(out, null, 2);
      });
    },
    renameTrip: function (id, patch) {
      return backend.renameTrip(id, patch);
    },
    deleteTrip: function (id) {
      return backend.deleteTrip(id);
    },
    leaveTrip: function (id) {
      return backend.leaveTrip(id);
    },

    /* 共享 */
    createInvite: function (id, role) {
      return backend.createInvite(id, role);
    },
    redeemInvite: function (code) {
      return backend.redeemInvite(code);
    },
    listMembers: function (id) {
      return backend.listMembers(id);
    },

    /* 行程文档级（行程页用） */
    currentTripId: function () {
      var m = location.search.match(/[?&]trip=([^&]+)/);
      return m ? decodeURIComponent(m[1]) : null;
    },
    loadDocSync: function (id) {
      return Cache.getDoc(id); // 同步、离线可用
    },
    loadDoc: function (id) {
      return backend.loadDoc(id);
    },
    saveDoc: function (id, doc) {
      return backend.saveDoc(id, doc);
    },
    connect: function (id, opt) {
      if (backend.connect) backend.connect(id, opt);
    },
    disconnect: function (id) {
      if (backend.disconnect) backend.disconnect(id);
    },
    _cache: Cache,
  };

  window.PT = PT;
})();
