var ri = Object.defineProperty;
var Fn = (e) => {
  throw TypeError(e);
};
var ii = (e, t, n) => t in e ? ri(e, t, { enumerable: !0, configurable: !0, writable: !0, value: n }) : e[t] = n;
var B = (e, t, n) => ii(e, typeof t != "symbol" ? t + "" : t, n), rn = (e, t, n) => t.has(e) || Fn("Cannot " + n);
var u = (e, t, n) => (rn(e, t, "read from private field"), n ? n.call(e) : t.get(e)), m = (e, t, n) => t.has(e) ? Fn("Cannot add the same private member more than once") : t instanceof WeakSet ? t.add(e) : t.set(e, n), p = (e, t, n, r) => (rn(e, t, "write to private field"), r ? r.call(e, n) : t.set(e, n), n), y = (e, t, n) => (rn(e, t, "access private method"), n);
var Xn = Array.isArray, si = Array.prototype.indexOf, ot = Array.prototype.includes, Zt = Array.from, er = Object.defineProperty, yt = Object.getOwnPropertyDescriptor, li = Object.getOwnPropertyDescriptors, oi = Object.prototype, fi = Array.prototype, tr = Object.getPrototypeOf, Ln = Object.isExtensible;
const ye = () => {
};
function nr(e) {
  for (var t = 0; t < e.length; t++)
    e[t]();
}
function rr() {
  var e, t, n = new Promise((r, i) => {
    e = r, t = i;
  });
  return { promise: n, resolve: e, reject: t };
}
const L = 2, ft = 4, Jt = 8, ir = 1 << 24, te = 16, he = 32, Ie = 64, un = 128, Q = 512, R = 1024, F = 2048, ve = 4096, q = 8192, ie = 16384, dt = 32768, $n = 1 << 25, xt = 65536, Bt = 1 << 17, ui = 1 << 18, ht = 1 << 19, ai = 1 << 20, be = 1 << 25, ze = 65536, Vt = 1 << 21, Je = 1 << 22, Ne = 1 << 23, sn = Symbol("$state"), Lt = Symbol("attributes"), an = Symbol("class"), ci = Symbol("style"), gt = Symbol("text"), Qt = new class extends Error {
  constructor() {
    super(...arguments);
    B(this, "name", "StaleReactionError");
    B(this, "message", "The reaction that called `getAbortSignal()` was re-run or destroyed");
  }
}();
function di() {
  throw new Error("https://svelte.dev/e/async_derived_orphan");
}
function hi(e, t, n) {
  throw new Error("https://svelte.dev/e/each_key_duplicate");
}
function vi() {
  throw new Error("https://svelte.dev/e/effect_update_depth_exceeded");
}
function _i() {
  throw new Error("https://svelte.dev/e/state_descriptors_fixed");
}
function pi() {
  throw new Error("https://svelte.dev/e/state_prototype_fixed");
}
function gi() {
  throw new Error("https://svelte.dev/e/state_unsafe_mutation");
}
function wi() {
  throw new Error("https://svelte.dev/e/svelte_boundary_reset_onerror");
}
const mi = 1, bi = 2, yi = 16, Ei = 2, M = Symbol(), sr = "http://www.w3.org/1999/xhtml";
function Si() {
  console.warn("https://svelte.dev/e/derived_inert");
}
function xi() {
  console.warn("https://svelte.dev/e/svelte_boundary_reset_noop");
}
function lr(e) {
  return e === this.v;
}
function or(e, t) {
  return e != e ? t == t : e !== t || e !== null && typeof e == "object" || typeof e == "function";
}
function fr(e) {
  return !or(e, this.v);
}
let le = null;
function ut(e) {
  le = e;
}
function ur(e, t = !1, n) {
  le = {
    p: le,
    i: !1,
    c: null,
    e: null,
    s: e,
    x: null,
    r: (
      /** @type {Effect} */
      S
    ),
    l: null
  };
}
function ar(e) {
  var t = (
    /** @type {ComponentContext} */
    le
  ), n = t.e;
  if (n !== null) {
    t.e = null;
    for (var r of n)
      Qi(r);
  }
  return t.i = !0, le = t.p, /** @type {T} */
  {};
}
function cr() {
  return !0;
}
let We = [];
function ki() {
  var e = We;
  We = [], nr(e);
}
function Qe(e) {
  if (We.length === 0) {
    var t = We;
    queueMicrotask(() => {
      t === We && ki();
    });
  }
  We.push(e);
}
function dr(e) {
  var t = S;
  if (t === null)
    return E.f |= Ne, e;
  if (!(t.f & dt) && !(t.f & ft))
    throw e;
  Ce(e, t);
}
function Ce(e, t) {
  for (; t !== null; ) {
    if (t.f & un) {
      if (!(t.f & dt))
        throw e;
      try {
        t.b.error(e);
        return;
      } catch (n) {
        e = n;
      }
    }
    t = t.parent;
  }
  throw e;
}
const Ai = -7169;
function I(e, t) {
  e.f = e.f & Ai | t;
}
function kn(e) {
  e.f & Q || e.deps === null ? I(e, R) : I(e, ve);
}
function hr(e) {
  if (e !== null)
    for (const t of e)
      !(t.f & L) || !(t.f & ze) || (t.f ^= ze, hr(
        /** @type {Derived} */
        t.deps
      ));
}
function vr(e, t, n) {
  e.f & F ? t.add(e) : e.f & ve && n.add(e), hr(e.deps), I(e, R);
}
function An(e, t, n) {
  if (e == null)
    return t(void 0), n && n(void 0), ye;
  const r = Gr(
    () => e.subscribe(
      t,
      // @ts-expect-error
      n
    )
  );
  return r.unsubscribe ? () => r.unsubscribe() : r;
}
const Ye = [];
function Ti(e, t) {
  return {
    subscribe: Tn(e, t).subscribe
  };
}
function Tn(e, t = ye) {
  let n = null;
  const r = /* @__PURE__ */ new Set();
  function i(l) {
    if (or(e, l) && (e = l, n)) {
      const a = !Ye.length;
      for (const o of r)
        o[1](), Ye.push(o, e);
      if (a) {
        for (let o = 0; o < Ye.length; o += 2)
          Ye[o][0](Ye[o + 1]);
        Ye.length = 0;
      }
    }
  }
  function s(l) {
    i(l(
      /** @type {T} */
      e
    ));
  }
  function f(l, a = ye) {
    const o = [l, a];
    return r.add(o), r.size === 1 && (n = t(i, s) || ye), l(
      /** @type {T} */
      e
    ), () => {
      r.delete(o), r.size === 0 && n && (n(), n = null);
    };
  }
  return { set: i, update: s, subscribe: f };
}
function Di(e, t, n) {
  const r = !Array.isArray(e), i = r ? [e] : e;
  if (!i.every(Boolean))
    throw new Error("derived() expects stores as input, got a falsy value");
  const s = t.length < 2;
  return Ti(n, (f, l) => {
    let a = !1;
    const o = [];
    let v = 0, c = ye;
    const h = () => {
      if (v)
        return;
      c();
      const d = t(r ? o[0] : o, f, l);
      s ? f(d) : c = typeof d == "function" ? d : ye;
    }, _ = i.map(
      (d, b) => An(
        d,
        (A) => {
          o[b] = A, v &= ~(1 << b), a && h();
        },
        () => {
          v |= 1 << b;
        }
      )
    );
    return a = !0, h(), function() {
      nr(_), c(), a = !1;
    };
  });
}
function Ci(e) {
  let t;
  return An(e, (n) => t = n)(), t;
}
let cn = Symbol();
function vt(e, t, n) {
  const r = n[t] ?? (n[t] = {
    store: null,
    source: /* @__PURE__ */ xr(void 0),
    unsubscribe: ye
  });
  if (r.store !== e && !(cn in n))
    if (r.unsubscribe(), r.store = e ?? null, e == null)
      r.source.v = void 0, r.unsubscribe = ye;
    else {
      var i = !0;
      r.unsubscribe = An(e, (s) => {
        i ? r.source.v = s : ke(r.source, s);
      }), i = !1;
    }
  return e && cn in n ? Ci(e) : N(r.source);
}
function Ni() {
  const e = {};
  function t() {
    Or(() => {
      for (var n in e)
        e[n].unsubscribe();
      er(e, cn, {
        enumerable: !1,
        value: !0
      });
    });
  }
  return [e, t];
}
let ln = null, Ge = null, T = null, dn = null, ne = null, hn = null, on = !1, Ze = null, $t = null;
var qn = 0;
let Ii = 1;
var et, Ae, Fe, tt, nt, Le, rt, ge, At, j, Tt, Te, ce, de, it, st, k, vn, wt, _n, _r, pr, qt, Oi, pn, Ke;
const Kt = class Kt {
  constructor() {
    m(this, k);
    B(this, "id", Ii++);
    /** True as soon as `#process` was called */
    m(this, et, !1);
    B(this, "linked", !0);
    /** @type {Batch | null} */
    m(this, Ae, null);
    /** @type {Batch | null} */
    m(this, Fe, null);
    /** @type {Map<Effect, ReturnType<typeof deferred<any>>>} */
    B(this, "async_deriveds", /* @__PURE__ */ new Map());
    /**
     * The current values of any signals that are updated in this batch.
     * Tuple format: [value, is_derived] (note: is_derived is false for deriveds, too, if they were overridden via assignment)
     * They keys of this map are identical to `this.#previous`
     * @type {Map<Value, [any, boolean]>}
     */
    B(this, "current", /* @__PURE__ */ new Map());
    /**
     * The values of any signals (sources and deriveds) that are updated in this batch _before_ those updates took place.
     * They keys of this map are identical to `this.#current`
     * @type {Map<Value, any>}
     */
    B(this, "previous", /* @__PURE__ */ new Map());
    /**
     * Async effects which this batch doesn't take into account anymore when calculating blockers,
     * as it has a value for it already.
     * @type {Set<Effect>}
     */
    B(this, "unblocked", /* @__PURE__ */ new Set());
    /**
     * When the batch is committed (and the DOM is updated), we need to remove old branches
     * and append new ones by calling the functions added inside (if/each/key/etc) blocks
     * @type {Set<(batch: Batch) => void>}
     */
    m(this, tt, /* @__PURE__ */ new Set());
    /**
     * If a fork is discarded, we need to destroy any effects that are no longer needed
     * @type {Set<(batch: Batch) => void>}
     */
    m(this, nt, /* @__PURE__ */ new Set());
    /**
     * Callbacks that should run only when a fork is committed.
     * @type {Set<(batch: Batch) => void>}
     */
    m(this, Le, /* @__PURE__ */ new Set());
    /**
     * The number of async effects that are currently in flight
     */
    m(this, rt, 0);
    /**
     * Async effects that are currently in flight, _not_ inside a pending boundary
     * @type {Map<Effect, number>}
     */
    m(this, ge, /* @__PURE__ */ new Map());
    /**
     * A deferred that resolves when the batch is committed, used with `settled()`
     * TODO replace with Promise.withResolvers once supported widely enough
     * @type {{ promise: Promise<void>, resolve: (value?: any) => void, reject: (reason: unknown) => void } | null}
     */
    m(this, At, null);
    /**
     * The root effects that need to be flushed
     * @type {Effect[]}
     */
    m(this, j, []);
    /**
     * Effects created while this batch was active.
     * @type {Effect[]}
     */
    m(this, Tt, []);
    /**
     * Deferred effects (which run after async work has completed) that are DIRTY
     * @type {Set<Effect>}
     */
    m(this, Te, /* @__PURE__ */ new Set());
    /**
     * Deferred effects that are MAYBE_DIRTY
     * @type {Set<Effect>}
     */
    m(this, ce, /* @__PURE__ */ new Set());
    /**
     * A map of branches that still exist, but will be destroyed when this batch
     * is committed — we skip over these during `process`.
     * The value contains child effects that were dirty/maybe_dirty before being reset,
     * so they can be rescheduled if the branch survives.
     * @type {Map<Effect, { d: Effect[], m: Effect[] }>}
     */
    m(this, de, /* @__PURE__ */ new Map());
    /**
     * Inverse of #skipped_branches which we need to tell prior batches to unskip them when committing
     * @type {Set<Effect>}
     */
    m(this, it, /* @__PURE__ */ new Set());
    B(this, "is_fork", !1);
    m(this, st, !1);
  }
  /**
   * Add an effect to the #skipped_branches map and reset its children
   * @param {Effect} effect
   */
  skip_effect(t) {
    u(this, de).has(t) || u(this, de).set(t, { d: [], m: [] }), u(this, it).delete(t);
  }
  /**
   * Remove an effect from the #skipped_branches map and reschedule
   * any tracked dirty/maybe_dirty child effects
   * @param {Effect} effect
   * @param {(e: Effect) => void} callback
   */
  unskip_effect(t, n = (r) => this.schedule(r)) {
    var r = u(this, de).get(t);
    if (r) {
      u(this, de).delete(t);
      for (var i of r.d)
        I(i, F), n(i);
      for (i of r.m)
        I(i, ve), n(i);
    }
    u(this, it).add(t);
  }
  /**
   * Associate a change to a given source with the current
   * batch, noting its previous and current values
   * @param {Value} source
   * @param {any} value
   * @param {boolean} [is_derived]
   */
  capture(t, n, r = !1) {
    t.v !== M && !this.previous.has(t) && this.previous.set(t, t.v), t.f & Ne || (this.current.set(t, [n, r]), ne?.set(t, n)), this.is_fork || (t.v = n);
  }
  activate() {
    T = this;
  }
  deactivate() {
    T = null, ne = null;
  }
  flush() {
    try {
      on = !0, T = this, y(this, k, wt).call(this);
    } finally {
      qn = 0, hn = null, Ze = null, $t = null, on = !1, T = null, ne = null, Ue.clear();
    }
  }
  discard() {
    for (const t of u(this, nt)) t(this);
    u(this, nt).clear(), u(this, Le).clear(), y(this, k, Ke).call(this);
  }
  /**
   * @param {Effect} effect
   */
  register_created_effect(t) {
    u(this, Tt).push(t);
  }
  /**
   * @param {boolean} blocking
   * @param {Effect} effect
   */
  increment(t, n) {
    if (p(this, rt, u(this, rt) + 1), t) {
      let r = u(this, ge).get(n) ?? 0;
      u(this, ge).set(n, r + 1);
    }
  }
  /**
   * @param {boolean} blocking
   * @param {Effect} effect
   */
  decrement(t, n) {
    if (p(this, rt, u(this, rt) - 1), t) {
      let r = u(this, ge).get(n) ?? 0;
      r === 1 ? u(this, ge).delete(n) : u(this, ge).set(n, r - 1);
    }
    u(this, st) || (p(this, st, !0), Qe(() => {
      p(this, st, !1), this.linked && this.flush();
    }));
  }
  /**
   * @param {Set<Effect>} dirty_effects
   * @param {Set<Effect>} maybe_dirty_effects
   */
  transfer_effects(t, n) {
    for (const r of t)
      u(this, Te).add(r);
    for (const r of n)
      u(this, ce).add(r);
    t.clear(), n.clear();
  }
  /** @param {(batch: Batch) => void} fn */
  oncommit(t) {
    u(this, tt).add(t);
  }
  /** @param {(batch: Batch) => void} fn */
  ondiscard(t) {
    u(this, nt).add(t);
  }
  /** @param {(batch: Batch) => void} fn */
  on_fork_commit(t) {
    u(this, Le).add(t);
  }
  run_fork_commit_callbacks() {
    for (const t of u(this, Le)) t(this);
    u(this, Le).clear();
  }
  settled() {
    return (u(this, At) ?? p(this, At, rr())).promise;
  }
  static ensure() {
    var t;
    if (T === null) {
      const n = T = new Kt();
      y(t = n, k, pn).call(t), on || Qe(() => {
        u(n, et) || n.flush();
      });
    }
    return T;
  }
  apply() {
    {
      ne = null;
      return;
    }
  }
  /**
   *
   * @param {Effect} effect
   */
  schedule(t) {
    if (hn = t, t.b?.is_pending && t.f & (ft | Jt | ir) && !(t.f & dt)) {
      t.b.defer_effect(t);
      return;
    }
    for (var n = t; n.parent !== null; ) {
      n = n.parent;
      var r = n.f;
      if (Ze !== null && n === S && (E === null || !(E.f & L)))
        return;
      if (r & (Ie | he)) {
        if (!(r & R))
          return;
        n.f ^= R;
      }
    }
    u(this, j).push(n);
  }
};
et = new WeakMap(), Ae = new WeakMap(), Fe = new WeakMap(), tt = new WeakMap(), nt = new WeakMap(), Le = new WeakMap(), rt = new WeakMap(), ge = new WeakMap(), At = new WeakMap(), j = new WeakMap(), Tt = new WeakMap(), Te = new WeakMap(), ce = new WeakMap(), de = new WeakMap(), it = new WeakMap(), st = new WeakMap(), k = new WeakSet(), vn = function() {
  if (this.is_fork) return !0;
  for (const r of u(this, ge).keys()) {
    for (var t = r, n = !1; t.parent !== null; ) {
      if (u(this, de).has(t)) {
        n = !0;
        break;
      }
      t = t.parent;
    }
    if (!n)
      return !0;
  }
  return !1;
}, wt = function() {
  var a, o, v;
  if (p(this, et, !0), qn++ > 1e3 && (y(this, k, Ke).call(this), Ri()), !y(this, k, vn).call(this)) {
    for (const c of u(this, Te))
      u(this, ce).delete(c), I(c, F), this.schedule(c);
    for (const c of u(this, ce))
      I(c, ve), this.schedule(c);
  }
  const t = u(this, j);
  p(this, j, []), this.apply();
  var n = Ze = [], r = [], i = $t = [];
  for (const c of t)
    try {
      y(this, k, _n).call(this, c, n, r);
    } catch (h) {
      throw mr(c), h;
    }
  if (T = null, i.length > 0) {
    var s = Kt.ensure();
    for (const c of i)
      s.schedule(c);
  }
  if (Ze = null, $t = null, y(this, k, vn).call(this)) {
    y(this, k, qt).call(this, r), y(this, k, qt).call(this, n);
    for (const [c, h] of u(this, de))
      wr(c, h);
    i.length > 0 && /** @type {unknown} */
    y(a = T, k, wt).call(a);
    return;
  }
  const f = y(this, k, _r).call(this);
  if (f) {
    y(o = f, k, pr).call(o, this);
    return;
  }
  u(this, Te).clear(), u(this, ce).clear();
  for (const c of u(this, tt)) c(this);
  u(this, tt).clear(), dn = this, Un(r), Un(n), dn = null, u(this, At)?.resolve();
  var l = (
    /** @type {Batch | null} */
    /** @type {unknown} */
    T
  );
  if (this.linked && u(this, rt) === 0 && y(this, k, Ke).call(this), u(this, j).length > 0) {
    l === null && (l = this, y(this, k, pn).call(this));
    const c = l;
    u(c, j).push(...u(this, j).filter((h) => !u(c, j).includes(h)));
  }
  l !== null && y(v = l, k, wt).call(v);
}, /**
 * Traverse the effect tree, executing effects or stashing
 * them for later execution as appropriate
 * @param {Effect} root
 * @param {Effect[]} effects
 * @param {Effect[]} render_effects
 */
_n = function(t, n, r) {
  t.f ^= R;
  for (var i = t.first; i !== null; ) {
    var s = i.f, f = (s & (he | Ie)) !== 0, l = f && (s & R) !== 0, a = l || (s & q) !== 0 || u(this, de).has(i);
    if (!a && i.fn !== null) {
      f ? i.f ^= R : s & ft ? n.push(i) : Nt(i) && (s & te && u(this, ce).add(i), ct(i));
      var o = i.first;
      if (o !== null) {
        i = o;
        continue;
      }
    }
    for (; i !== null; ) {
      var v = i.next;
      if (v !== null) {
        i = v;
        break;
      }
      i = i.parent;
    }
  }
}, _r = function() {
  for (var t = u(this, Ae); t !== null; ) {
    if (!t.is_fork) {
      for (const [n, [, r]] of this.current)
        if (t.current.has(n) && !r)
          return t;
    }
    t = u(t, Ae);
  }
  return null;
}, /**
 * @param {Batch} batch
 */
pr = function(t) {
  var r;
  for (const [i, s] of t.current)
    !this.previous.has(i) && t.previous.has(i) && this.previous.set(i, t.previous.get(i)), this.current.set(i, s);
  for (const [i, s] of t.async_deriveds) {
    const f = this.async_deriveds.get(i);
    f && s.promise.then(f.resolve);
  }
  const n = (i) => {
    var s = i.reactions;
    if (s !== null)
      for (const a of s) {
        var f = a.f;
        if (f & L)
          n(
            /** @type {Derived} */
            a
          );
        else {
          var l = (
            /** @type {Effect} */
            a
          );
          f & (Je | te) && !this.async_deriveds.has(l) && (u(this, ce).delete(l), I(l, F), this.schedule(l));
        }
      }
  };
  for (const i of this.current.keys())
    n(i);
  this.oncommit(() => t.discard()), y(r = t, k, Ke).call(r), T = this, y(this, k, wt).call(this);
}, /**
 * @param {Effect[]} effects
 */
qt = function(t) {
  for (var n = 0; n < t.length; n += 1)
    vr(t[n], u(this, Te), u(this, ce));
}, Oi = function() {
  var v;
  y(this, k, Ke).call(this);
  for (let c = ln; c !== null; c = u(c, Fe)) {
    var t = c.id < this.id, n = [];
    for (const [h, [_, d]] of this.current) {
      if (c.current.has(h)) {
        var r = (
          /** @type {[any, boolean]} */
          c.current.get(h)[0]
        );
        if (t && _ !== r)
          c.current.set(h, [_, d]);
        else
          continue;
      }
      n.push(h);
    }
    if (t)
      for (const [h, _] of this.async_deriveds) {
        const d = c.async_deriveds.get(h);
        d && _.promise.then(d.resolve);
      }
    if (u(c, et)) {
      var i = [...c.current.keys()].filter((h) => !this.current.has(h));
      if (i.length === 0)
        t && c.discard();
      else if (n.length > 0) {
        if (t)
          for (const h of u(this, it))
            c.unskip_effect(h, (_) => {
              var d;
              _.f & (te | Je) ? c.schedule(_) : y(d = c, k, qt).call(d, [_]);
            });
        c.activate();
        var s = /* @__PURE__ */ new Set(), f = /* @__PURE__ */ new Map();
        for (var l of n)
          gr(l, i, s, f);
        f = /* @__PURE__ */ new Map();
        var a = [...c.current.keys()].filter(
          (h) => this.current.has(h) ? (
            /** @type {[any, boolean]} */
            this.current.get(h)[0] !== h.v
          ) : !0
        );
        if (a.length > 0)
          for (const h of u(this, Tt))
            !(h.f & (ie | q | Bt)) && Dn(h, a, f) && (h.f & (Je | te) ? (I(h, F), c.schedule(h)) : u(c, Te).add(h));
        if (u(c, j).length > 0) {
          c.apply();
          for (var o of u(c, j))
            y(v = c, k, _n).call(v, o, [], []);
          p(c, j, []);
        }
        c.deactivate();
      }
    }
  }
}, pn = function() {
  Ge === null ? ln = Ge = this : (p(Ge, Fe, this), p(this, Ae, Ge)), Ge = this;
}, Ke = function() {
  var t = u(this, Ae), n = u(this, Fe);
  t === null ? ln = n : p(t, Fe, n), n === null ? Ge = t : p(n, Ae, t), this.linked = !1;
};
let Be = Kt;
function Ri() {
  try {
    vi();
  } catch (e) {
    Ce(e, hn);
  }
}
let pe = null;
function Un(e) {
  var t = e.length;
  if (t !== 0) {
    for (var n = 0; n < t; ) {
      var r = e[n++];
      if (!(r.f & (ie | q)) && Nt(r) && (pe = /* @__PURE__ */ new Set(), ct(r), r.deps === null && r.first === null && r.nodes === null && r.teardown === null && r.ac === null && Pr(r), pe?.size > 0)) {
        Ue.clear();
        for (const i of pe) {
          if (i.f & (ie | q)) continue;
          const s = [i];
          let f = i.parent;
          for (; f !== null; )
            pe.has(f) && (pe.delete(f), s.push(f)), f = f.parent;
          for (let l = s.length - 1; l >= 0; l--) {
            const a = s[l];
            a.f & (ie | q) || ct(a);
          }
        }
        pe.clear();
      }
    }
    pe = null;
  }
}
function gr(e, t, n, r) {
  if (!n.has(e) && (n.add(e), e.reactions !== null))
    for (const i of e.reactions) {
      const s = i.f;
      s & L ? gr(
        /** @type {Derived} */
        i,
        t,
        n,
        r
      ) : s & (Je | te) && !(s & F) && Dn(i, t, r) && (I(i, F), Cn(
        /** @type {Effect} */
        i
      ));
    }
}
function Dn(e, t, n) {
  const r = n.get(e);
  if (r !== void 0) return r;
  if (e.deps !== null)
    for (const i of e.deps) {
      if (ot.call(t, i))
        return !0;
      if (i.f & L && Dn(
        /** @type {Derived} */
        i,
        t,
        n
      ))
        return n.set(
          /** @type {Derived} */
          i,
          !0
        ), !0;
    }
  return n.set(e, !1), !1;
}
function Cn(e) {
  T.schedule(e);
}
function wr(e, t) {
  if (!(e.f & he && e.f & R)) {
    e.f & F ? t.d.push(e) : e.f & ve && t.m.push(e), I(e, R);
    for (var n = e.first; n !== null; )
      wr(n, t), n = n.next;
  }
}
function mr(e) {
  I(e, R);
  for (var t = e.first; t !== null; )
    mr(t), t = t.next;
}
function Mi(e) {
  let t = 0, n = Ve(0), r;
  return () => {
    On() && (N(n), ns(() => (t === 0 && (r = Gr(() => e(() => Et(n)))), t += 1, () => {
      Qe(() => {
        t -= 1, t === 0 && (r?.(), r = void 0, Et(n));
      });
    })));
  };
}
var Pi = xt | ht;
function Fi(e, t, n, r) {
  new Li(e, t, n, r);
}
var W, xn, Z, $e, U, J, $, Y, we, qe, De, lt, Dt, Ct, me, Wt, O, $i, qi, Ui, gn, Ut, Ht, wn, mn;
class Li {
  /**
   * @param {TemplateNode} node
   * @param {BoundaryProps} props
   * @param {((anchor: Node) => void)} children
   * @param {((error: unknown) => unknown) | undefined} [transform_error]
   */
  constructor(t, n, r, i) {
    m(this, O);
    /** @type {Boundary | null} */
    B(this, "parent");
    B(this, "is_pending", !1);
    /**
     * API-level transformError transform function. Transforms errors before they reach the `failed` snippet.
     * Inherited from parent boundary, or defaults to identity.
     * @type {(error: unknown) => unknown}
     */
    B(this, "transform_error");
    /** @type {TemplateNode} */
    m(this, W);
    /** @type {TemplateNode | null} */
    m(this, xn, null);
    /** @type {BoundaryProps} */
    m(this, Z);
    /** @type {((anchor: Node) => void)} */
    m(this, $e);
    /** @type {Effect} */
    m(this, U);
    /** @type {Effect | null} */
    m(this, J, null);
    /** @type {Effect | null} */
    m(this, $, null);
    /** @type {Effect | null} */
    m(this, Y, null);
    /** @type {DocumentFragment | null} */
    m(this, we, null);
    m(this, qe, 0);
    m(this, De, 0);
    m(this, lt, !1);
    /** @type {Set<Effect>} */
    m(this, Dt, /* @__PURE__ */ new Set());
    /** @type {Set<Effect>} */
    m(this, Ct, /* @__PURE__ */ new Set());
    /**
     * A source containing the number of pending async deriveds/expressions.
     * Only created if `$effect.pending()` is used inside the boundary,
     * otherwise updating the source results in needless `Batch.ensure()`
     * calls followed by no-op flushes
     * @type {Source<number> | null}
     */
    m(this, me, null);
    m(this, Wt, Mi(() => (p(this, me, Ve(u(this, qe))), () => {
      p(this, me, null);
    })));
    p(this, W, t), p(this, Z, n), p(this, $e, (s) => {
      var f = (
        /** @type {Effect} */
        S
      );
      f.b = this, f.f |= un, r(s);
    }), this.parent = /** @type {Effect} */
    S.b, this.transform_error = i ?? this.parent?.transform_error ?? ((s) => s), p(this, U, Rr(() => {
      y(this, O, gn).call(this);
    }, Pi));
  }
  /**
   * Defer an effect inside a pending boundary until the boundary resolves
   * @param {Effect} effect
   */
  defer_effect(t) {
    vr(t, u(this, Dt), u(this, Ct));
  }
  /**
   * Returns `false` if the effect exists inside a boundary whose pending snippet is shown
   * @returns {boolean}
   */
  is_rendered() {
    return !this.is_pending && (!this.parent || this.parent.is_rendered());
  }
  has_pending_snippet() {
    return !!u(this, Z).pending;
  }
  /**
   * Update the source that powers `$effect.pending()` inside this boundary,
   * and controls when the current `pending` snippet (if any) is removed.
   * Do not call from inside the class
   * @param {1 | -1} d
   * @param {Batch} batch
   */
  update_pending_count(t, n) {
    y(this, O, wn).call(this, t, n), p(this, qe, u(this, qe) + t), !(!u(this, me) || u(this, lt)) && (p(this, lt, !0), Qe(() => {
      p(this, lt, !1), u(this, me) && at(u(this, me), u(this, qe));
    }));
  }
  get_effect_pending() {
    return u(this, Wt).call(this), N(
      /** @type {Source<number>} */
      u(this, me)
    );
  }
  /** @param {unknown} error */
  error(t) {
    if (!u(this, Z).onerror && !u(this, Z).failed)
      throw t;
    T?.is_fork ? (u(this, J) && T.skip_effect(u(this, J)), u(this, $) && T.skip_effect(u(this, $)), u(this, Y) && T.skip_effect(u(this, Y)), T.on_fork_commit(() => {
      y(this, O, mn).call(this, t);
    })) : y(this, O, mn).call(this, t);
  }
}
W = new WeakMap(), xn = new WeakMap(), Z = new WeakMap(), $e = new WeakMap(), U = new WeakMap(), J = new WeakMap(), $ = new WeakMap(), Y = new WeakMap(), we = new WeakMap(), qe = new WeakMap(), De = new WeakMap(), lt = new WeakMap(), Dt = new WeakMap(), Ct = new WeakMap(), me = new WeakMap(), Wt = new WeakMap(), O = new WeakSet(), $i = function() {
  try {
    p(this, J, ae(() => u(this, $e).call(this, u(this, W))));
  } catch (t) {
    this.error(t);
  }
}, /**
 * @param {unknown} error The deserialized error from the server's hydration comment
 */
qi = function(t) {
  const n = u(this, Z).failed;
  n && p(this, Y, ae(() => {
    n(
      u(this, W),
      () => t,
      () => () => {
      }
    );
  }));
}, Ui = function() {
  const t = u(this, Z).pending;
  t && (this.is_pending = !0, p(this, $, ae(() => t(u(this, W)))), Qe(() => {
    var n = p(this, we, document.createDocumentFragment()), r = St();
    n.append(r), p(this, J, y(this, O, Ht).call(this, () => ae(() => u(this, $e).call(this, r)))), u(this, De) === 0 && (u(this, W).before(n), p(this, we, null), Xe(
      /** @type {Effect} */
      u(this, $),
      () => {
        p(this, $, null);
      }
    ), y(this, O, Ut).call(
      this,
      /** @type {Batch} */
      T
    ));
  }));
}, gn = function() {
  try {
    if (this.is_pending = this.has_pending_snippet(), p(this, De, 0), p(this, qe, 0), p(this, J, ae(() => {
      u(this, $e).call(this, u(this, W));
    })), u(this, De) > 0) {
      var t = p(this, we, document.createDocumentFragment());
      qr(u(this, J), t);
      const n = (
        /** @type {(anchor: Node) => void} */
        u(this, Z).pending
      );
      p(this, $, ae(() => n(u(this, W))));
    } else
      y(this, O, Ut).call(
        this,
        /** @type {Batch} */
        T
      );
  } catch (n) {
    this.error(n);
  }
}, /**
 * @param {Batch} batch
 */
Ut = function(t) {
  this.is_pending = !1, t.transfer_effects(u(this, Dt), u(this, Ct));
}, /**
 * @template T
 * @param {() => T} fn
 */
Ht = function(t) {
  var n = S, r = E, i = le;
  _e(u(this, U)), ee(u(this, U)), ut(u(this, U).ctx);
  try {
    return Be.ensure(), t();
  } catch (s) {
    return dr(s), null;
  } finally {
    _e(n), ee(r), ut(i);
  }
}, /**
 * Updates the pending count associated with the currently visible pending snippet,
 * if any, such that we can replace the snippet with content once work is done
 * @param {1 | -1} d
 * @param {Batch} batch
 */
wn = function(t, n) {
  var r;
  if (!this.has_pending_snippet()) {
    this.parent && y(r = this.parent, O, wn).call(r, t, n);
    return;
  }
  p(this, De, u(this, De) + t), u(this, De) === 0 && (y(this, O, Ut).call(this, n), u(this, $) && Xe(u(this, $), () => {
    p(this, $, null);
  }), u(this, we) && (u(this, W).before(u(this, we)), p(this, we, null)));
}, /**
 * @param {unknown} error
 */
mn = function(t) {
  u(this, J) && (se(u(this, J)), p(this, J, null)), u(this, $) && (se(u(this, $)), p(this, $, null)), u(this, Y) && (se(u(this, Y)), p(this, Y, null));
  var n = u(this, Z).onerror;
  let r = u(this, Z).failed;
  var i = !1, s = !1;
  const f = () => {
    if (i) {
      xi();
      return;
    }
    i = !0, s && wi(), u(this, Y) !== null && Xe(u(this, Y), () => {
      p(this, Y, null);
    }), y(this, O, Ht).call(this, () => {
      y(this, O, gn).call(this);
    });
  }, l = (a) => {
    try {
      s = !0, n?.(a, f), s = !1;
    } catch (o) {
      Ce(o, u(this, U) && u(this, U).parent);
    }
    r && p(this, Y, y(this, O, Ht).call(this, () => {
      try {
        return ae(() => {
          var o = (
            /** @type {Effect} */
            S
          );
          o.b = this, o.f |= un, r(
            u(this, W),
            () => a,
            () => f
          );
        });
      } catch (o) {
        return Ce(
          o,
          /** @type {Effect} */
          u(this, U).parent
        ), null;
      }
    }));
  };
  Qe(() => {
    var a;
    try {
      a = this.transform_error(t);
    } catch (o) {
      Ce(o, u(this, U) && u(this, U).parent);
      return;
    }
    a !== null && typeof a == "object" && typeof /** @type {any} */
    a.then == "function" ? a.then(
      l,
      /** @param {unknown} e */
      (o) => Ce(o, u(this, U) && u(this, U).parent)
    ) : l(a);
  });
};
function Hi(e, t, n, r) {
  const i = Nn;
  var s = e.filter((h) => !h.settled);
  if (n.length === 0 && s.length === 0) {
    r(t.map(i));
    return;
  }
  var f = (
    /** @type {Effect} */
    S
  ), l = zi(), a = s.length === 1 ? s[0].promise : s.length > 1 ? Promise.all(s.map((h) => h.promise)) : null;
  function o(h) {
    if (!(f.f & ie)) {
      l();
      try {
        r(h);
      } catch (_) {
        Ce(_, f);
      }
      jt();
    }
  }
  var v = br();
  if (n.length === 0) {
    a.then(() => o(t.map(i))).finally(v);
    return;
  }
  function c() {
    Promise.all(n.map((h) => /* @__PURE__ */ Bi(h))).then((h) => o([...t.map(i), ...h])).catch((h) => Ce(h, f)).finally(v);
  }
  a ? a.then(() => {
    l(), c(), jt();
  }) : c();
}
function zi() {
  var e = (
    /** @type {Effect} */
    S
  ), t = E, n = le, r = (
    /** @type {Batch} */
    T
  );
  return function(s = !0) {
    _e(e), ee(t), ut(n), s && !(e.f & ie) && (r?.activate(), r?.apply());
  };
}
function jt(e = !0) {
  _e(null), ee(null), ut(null), e && T?.deactivate();
}
function br() {
  var e = (
    /** @type {Effect} */
    S
  ), t = (
    /** @type {Boundary} */
    e.b
  ), n = (
    /** @type {Batch} */
    T
  ), r = t.is_rendered();
  return t.update_pending_count(1, n), n.increment(r, e), () => {
    t.update_pending_count(-1, n), n.decrement(r, e);
  };
}
// @__NO_SIDE_EFFECTS__
function Nn(e) {
  var t = L | F;
  return S !== null && (S.f |= ht), {
    ctx: le,
    deps: null,
    effects: null,
    equals: lr,
    f: t,
    fn: e,
    reactions: null,
    rv: 0,
    v: (
      /** @type {V} */
      M
    ),
    wv: 0,
    parent: S,
    ac: null
  };
}
const Ot = Symbol("obsolete");
// @__NO_SIDE_EFFECTS__
function Bi(e, t, n) {
  let r = (
    /** @type {Effect | null} */
    S
  );
  r === null && di();
  var i = (
    /** @type {Promise<V>} */
    /** @type {unknown} */
    void 0
  ), s = Ve(
    /** @type {V} */
    M
  ), f = !E, l = /* @__PURE__ */ new Set();
  return ts(() => {
    var a = (
      /** @type {Effect} */
      S
    ), o = rr();
    i = o.promise;
    try {
      Promise.resolve(e()).then(o.resolve, (_) => {
        _ !== Qt && o.reject(_);
      }).finally(jt);
    } catch (_) {
      o.reject(_), jt();
    }
    var v = (
      /** @type {Batch} */
      T
    );
    if (f) {
      if (a.f & dt)
        var c = br();
      if (
        /** @type {Boundary} */
        r.b.is_rendered()
      )
        v.async_deriveds.get(a)?.reject(Ot);
      else
        for (const _ of l.values())
          _.reject(Ot);
      l.add(o), v.async_deriveds.set(a, o);
    }
    const h = (_, d = void 0) => {
      c?.(), l.delete(o), d !== Ot && (v.activate(), d ? (s.f |= Ne, at(s, d)) : (s.f & Ne && (s.f ^= Ne), at(s, _)), v.deactivate());
    };
    o.promise.then(h, (_) => h(null, _ || "unknown"));
  }), Or(() => {
    for (const a of l)
      a.reject(Ot);
  }), new Promise((a) => {
    function o(v) {
      function c() {
        v === i ? a(s) : o(i);
      }
      v.then(c, c);
    }
    o(i);
  });
}
// @__NO_SIDE_EFFECTS__
function Rt(e) {
  const t = /* @__PURE__ */ Nn(e);
  return Ur(t), t;
}
// @__NO_SIDE_EFFECTS__
function Vi(e) {
  const t = /* @__PURE__ */ Nn(e);
  return t.equals = fr, t;
}
function ji(e) {
  var t = e.effects;
  if (t !== null) {
    e.effects = null;
    for (var n = 0; n < t.length; n += 1)
      se(
        /** @type {Effect} */
        t[n]
      );
  }
}
function In(e) {
  var t, n = S, r = e.parent;
  if (!je && r !== null && r.f & (ie | q))
    return Si(), e.v;
  _e(r);
  try {
    e.f &= ~ze, ji(e), t = Vr(e);
  } finally {
    _e(n);
  }
  return t;
}
function yr(e) {
  var t = In(e);
  if (!e.equals(t) && (e.wv = zr(), (!T?.is_fork || e.deps === null) && (T !== null ? (T.capture(e, t, !0), dn?.capture(e, t, !0)) : e.v = t, e.deps === null))) {
    I(e, R);
    return;
  }
  je || (ne !== null ? (On() || T?.is_fork) && ne.set(e, t) : kn(e));
}
function Yi(e) {
  if (e.effects !== null)
    for (const t of e.effects)
      (t.teardown || t.ac) && (t.teardown?.(), t.ac?.abort(Qt), t.teardown = ye, t.ac = null, kt(t, 0), Rn(t));
}
function Er(e) {
  if (e.effects !== null)
    for (const t of e.effects)
      t.teardown && ct(t);
}
let Yt = /* @__PURE__ */ new Set();
const Ue = /* @__PURE__ */ new Map();
let Sr = !1;
function Ve(e, t) {
  var n = {
    f: 0,
    // TODO ideally we could skip this altogether, but it causes type errors
    v: e,
    reactions: null,
    equals: lr,
    rv: 0,
    wv: 0
  };
  return n;
}
// @__NO_SIDE_EFFECTS__
function Se(e, t) {
  const n = Ve(e);
  return Ur(n), n;
}
// @__NO_SIDE_EFFECTS__
function xr(e, t = !1, n = !0) {
  const r = Ve(e);
  return t || (r.equals = fr), r;
}
function ke(e, t, n = !1) {
  E !== null && // since we are untracking the function inside `$inspect.with` we need to add this check
  // to ensure we error if state is set inside an inspect effect
  (!re || E.f & Bt) && cr() && E.f & (L | te | Je | Bt) && (X === null || !ot.call(X, e)) && gi();
  let r = n ? mt(t) : t;
  return at(e, r, $t);
}
function at(e, t, n = null) {
  if (!e.equals(t)) {
    Ue.set(e, je ? t : e.v);
    var r = Be.ensure();
    if (r.capture(e, t), e.f & L) {
      const i = (
        /** @type {Derived} */
        e
      );
      e.f & F && In(i), ne === null && kn(i);
    }
    e.wv = zr(), kr(e, F, n), S !== null && S.f & R && !(S.f & (he | Ie)) && (K === null ? ss([e]) : K.push(e)), !r.is_fork && Yt.size > 0 && !Sr && Gi();
  }
  return t;
}
function Gi() {
  Sr = !1;
  for (const e of Yt) {
    e.f & R && I(e, ve);
    let t;
    try {
      t = Nt(e);
    } catch {
      t = !0;
    }
    t && ct(e);
  }
  Yt.clear();
}
function Et(e) {
  ke(e, e.v + 1);
}
function kr(e, t, n) {
  var r = e.reactions;
  if (r !== null)
    for (var i = r.length, s = 0; s < i; s++) {
      var f = r[s], l = f.f, a = (l & F) === 0;
      if (a && I(f, t), l & Bt)
        Yt.add(
          /** @type {Effect} */
          f
        );
      else if (l & L) {
        var o = (
          /** @type {Derived} */
          f
        );
        ne?.delete(o), l & ze || (l & Q && (S === null || !(S.f & Vt)) && (f.f |= ze), kr(o, ve, n));
      } else if (a) {
        var v = (
          /** @type {Effect} */
          f
        );
        l & te && pe !== null && pe.add(v), n !== null ? n.push(v) : Cn(v);
      }
    }
}
function mt(e) {
  if (typeof e != "object" || e === null || sn in e)
    return e;
  const t = tr(e);
  if (t !== oi && t !== fi)
    return e;
  var n = /* @__PURE__ */ new Map(), r = Xn(e), i = /* @__PURE__ */ Se(0), s = He, f = (l) => {
    if (He === s)
      return l();
    var a = E, o = He;
    ee(null), Bn(s);
    var v = l();
    return ee(a), Bn(o), v;
  };
  return r && n.set("length", /* @__PURE__ */ Se(
    /** @type {any[]} */
    e.length
  )), new Proxy(
    /** @type {any} */
    e,
    {
      defineProperty(l, a, o) {
        (!("value" in o) || o.configurable === !1 || o.enumerable === !1 || o.writable === !1) && _i();
        var v = n.get(a);
        return v === void 0 ? f(() => {
          var c = /* @__PURE__ */ Se(o.value);
          return n.set(a, c), c;
        }) : ke(v, o.value, !0), !0;
      },
      deleteProperty(l, a) {
        var o = n.get(a);
        if (o === void 0) {
          if (a in l) {
            const v = f(() => /* @__PURE__ */ Se(M));
            n.set(a, v), Et(i);
          }
        } else
          ke(o, M), Et(i);
        return !0;
      },
      get(l, a, o) {
        if (a === sn)
          return e;
        var v = n.get(a), c = a in l;
        if (v === void 0 && (!c || yt(l, a)?.writable) && (v = f(() => {
          var _ = mt(c ? l[a] : M), d = /* @__PURE__ */ Se(_);
          return d;
        }), n.set(a, v)), v !== void 0) {
          var h = N(v);
          return h === M ? void 0 : h;
        }
        return Reflect.get(l, a, o);
      },
      getOwnPropertyDescriptor(l, a) {
        var o = Reflect.getOwnPropertyDescriptor(l, a);
        if (o && "value" in o) {
          var v = n.get(a);
          v && (o.value = N(v));
        } else if (o === void 0) {
          var c = n.get(a), h = c?.v;
          if (c !== void 0 && h !== M)
            return {
              enumerable: !0,
              configurable: !0,
              value: h,
              writable: !0
            };
        }
        return o;
      },
      has(l, a) {
        if (a === sn)
          return !0;
        var o = n.get(a), v = o !== void 0 && o.v !== M || Reflect.has(l, a);
        if (o !== void 0 || S !== null && (!v || yt(l, a)?.writable)) {
          o === void 0 && (o = f(() => {
            var h = v ? mt(l[a]) : M, _ = /* @__PURE__ */ Se(h);
            return _;
          }), n.set(a, o));
          var c = N(o);
          if (c === M)
            return !1;
        }
        return v;
      },
      set(l, a, o, v) {
        var c = n.get(a), h = a in l;
        if (r && a === "length")
          for (var _ = o; _ < /** @type {Source<number>} */
          c.v; _ += 1) {
            var d = n.get(_ + "");
            d !== void 0 ? ke(d, M) : _ in l && (d = f(() => /* @__PURE__ */ Se(M)), n.set(_ + "", d));
          }
        if (c === void 0)
          (!h || yt(l, a)?.writable) && (c = f(() => /* @__PURE__ */ Se(void 0)), ke(c, mt(o)), n.set(a, c));
        else {
          h = c.v !== M;
          var b = f(() => mt(o));
          ke(c, b);
        }
        var A = Reflect.getOwnPropertyDescriptor(l, a);
        if (A?.set && A.set.call(v, o), !h) {
          if (r && typeof a == "string") {
            var D = (
              /** @type {Source<number>} */
              n.get("length")
            ), x = Number(a);
            Number.isInteger(x) && x >= D.v && ke(D, x + 1);
          }
          Et(i);
        }
        return !0;
      },
      ownKeys(l) {
        N(i);
        var a = Reflect.ownKeys(l).filter((c) => {
          var h = n.get(c);
          return h === void 0 || h.v !== M;
        });
        for (var [o, v] of n)
          v.v !== M && !(o in l) && a.push(o);
        return a;
      },
      setPrototypeOf() {
        pi();
      }
    }
  );
}
var Hn, Ar, Tr, Dr;
function Ki() {
  if (Hn === void 0) {
    Hn = window, Ar = /Firefox/.test(navigator.userAgent);
    var e = Element.prototype, t = Node.prototype, n = Text.prototype;
    Tr = yt(t, "firstChild").get, Dr = yt(t, "nextSibling").get, Ln(e) && (e[an] = void 0, e[Lt] = null, e[ci] = void 0, e.__e = void 0), Ln(n) && (n[gt] = void 0);
  }
}
function St(e = "") {
  return document.createTextNode(e);
}
// @__NO_SIDE_EFFECTS__
function Cr(e) {
  return (
    /** @type {TemplateNode | null} */
    Tr.call(e)
  );
}
// @__NO_SIDE_EFFECTS__
function Xt(e) {
  return (
    /** @type {TemplateNode | null} */
    Dr.call(e)
  );
}
function ue(e, t) {
  return /* @__PURE__ */ Cr(e);
}
function _t(e, t = 1, n = !1) {
  let r = e;
  for (; t--; )
    r = /** @type {TemplateNode} */
    /* @__PURE__ */ Xt(r);
  return r;
}
function Wi(e) {
  e.textContent = "";
}
function Zi() {
  return !1;
}
function Nr(e, t, n) {
  return (
    /** @type {T extends keyof HTMLElementTagNameMap ? HTMLElementTagNameMap[T] : Element} */
    document.createElementNS(sr, e, void 0)
  );
}
function Ir(e) {
  var t = E, n = S;
  ee(null), _e(null);
  try {
    return e();
  } finally {
    ee(t), _e(n);
  }
}
function Ji(e, t) {
  var n = t.last;
  n === null ? t.last = t.first = e : (n.next = e, e.prev = n, t.last = e);
}
function Ee(e, t) {
  var n = S;
  n !== null && n.f & q && (e |= q);
  var r = {
    ctx: le,
    deps: null,
    nodes: null,
    f: e | F | Q,
    first: null,
    fn: t,
    last: null,
    next: null,
    parent: n,
    b: n && n.b,
    prev: null,
    teardown: null,
    wv: 0,
    ac: null
  };
  T?.register_created_effect(r);
  var i = r;
  if (e & ft)
    Ze !== null ? Ze.push(r) : Be.ensure().schedule(r);
  else if (t !== null) {
    try {
      ct(r);
    } catch (f) {
      throw se(r), f;
    }
    i.deps === null && i.teardown === null && i.nodes === null && i.first === i.last && // either `null`, or a singular child
    !(i.f & ht) && (i = i.first, e & te && e & xt && i !== null && (i.f |= xt));
  }
  if (i !== null && (i.parent = n, n !== null && Ji(i, n), E !== null && E.f & L && !(e & Ie))) {
    var s = (
      /** @type {Derived} */
      E
    );
    (s.effects ?? (s.effects = [])).push(i);
  }
  return r;
}
function On() {
  return E !== null && !re;
}
function Or(e) {
  const t = Ee(Jt, null);
  return I(t, R), t.teardown = e, t;
}
function Qi(e) {
  return Ee(ft | ai, e);
}
function Xi(e) {
  Be.ensure();
  const t = Ee(Ie | ht, e);
  return (n = {}) => new Promise((r) => {
    n.outro ? Xe(t, () => {
      se(t), r(void 0);
    }) : (se(t), r(void 0));
  });
}
function es(e) {
  return Ee(ft, e);
}
function ts(e) {
  return Ee(Je | ht, e);
}
function ns(e, t = 0) {
  return Ee(Jt | t, e);
}
function Mt(e, t = [], n = [], r = []) {
  Hi(r, t, n, (i) => {
    Ee(Jt, () => e(...i.map(N)));
  });
}
function Rr(e, t = 0) {
  var n = Ee(te | t, e);
  return n;
}
function ae(e) {
  return Ee(he | ht, e);
}
function Mr(e) {
  var t = e.teardown;
  if (t !== null) {
    const n = je, r = E;
    zn(!0), ee(null);
    try {
      t.call(null);
    } finally {
      zn(n), ee(r);
    }
  }
}
function Rn(e, t = !1) {
  var n = e.first;
  for (e.first = e.last = null; n !== null; ) {
    const i = n.ac;
    i !== null && Ir(() => {
      i.abort(Qt);
    });
    var r = n.next;
    n.f & Ie ? n.parent = null : se(n, t), n = r;
  }
}
function rs(e) {
  for (var t = e.first; t !== null; ) {
    var n = t.next;
    t.f & he || se(t), t = n;
  }
}
function se(e, t = !0) {
  var n = !1;
  (t || e.f & ui) && e.nodes !== null && e.nodes.end !== null && (is(
    e.nodes.start,
    /** @type {TemplateNode} */
    e.nodes.end
  ), n = !0), I(e, $n), Rn(e, t && !n), kt(e, 0);
  var r = e.nodes && e.nodes.t;
  if (r !== null)
    for (const s of r)
      s.stop();
  Mr(e), e.f ^= $n, e.f |= ie;
  var i = e.parent;
  i !== null && i.first !== null && Pr(e), e.next = e.prev = e.teardown = e.ctx = e.deps = e.fn = e.nodes = e.ac = e.b = null;
}
function is(e, t) {
  for (; e !== null; ) {
    var n = e === t ? null : /* @__PURE__ */ Xt(e);
    e.remove(), e = n;
  }
}
function Pr(e) {
  var t = e.parent, n = e.prev, r = e.next;
  n !== null && (n.next = r), r !== null && (r.prev = n), t !== null && (t.first === e && (t.first = r), t.last === e && (t.last = n));
}
function Xe(e, t, n = !0) {
  var r = [];
  Fr(e, r, !0);
  var i = () => {
    n && se(e), t && t();
  }, s = r.length;
  if (s > 0) {
    var f = () => --s || i();
    for (var l of r)
      l.out(f);
  } else
    i();
}
function Fr(e, t, n) {
  if (!(e.f & q)) {
    e.f ^= q;
    var r = e.nodes && e.nodes.t;
    if (r !== null)
      for (const l of r)
        (l.is_global || n) && t.push(l);
    for (var i = e.first; i !== null; ) {
      var s = i.next;
      if (!(i.f & Ie)) {
        var f = (i.f & xt) !== 0 || // If this is a branch effect without a block effect parent,
        // it means the parent block effect was pruned. In that case,
        // transparency information was transferred to the branch effect.
        (i.f & he) !== 0 && (e.f & te) !== 0;
        Fr(i, t, f ? n : !1);
      }
      i = s;
    }
  }
}
function Lr(e) {
  $r(e, !0);
}
function $r(e, t) {
  if (e.f & q) {
    e.f ^= q, e.f & R || (I(e, F), Be.ensure().schedule(e));
    for (var n = e.first; n !== null; ) {
      var r = n.next, i = (n.f & xt) !== 0 || (n.f & he) !== 0;
      $r(n, i ? t : !1), n = r;
    }
    var s = e.nodes && e.nodes.t;
    if (s !== null)
      for (const f of s)
        (f.is_global || t) && f.in();
  }
}
function qr(e, t) {
  if (e.nodes)
    for (var n = e.nodes.start, r = e.nodes.end; n !== null; ) {
      var i = n === r ? null : /* @__PURE__ */ Xt(n);
      t.append(n), n = i;
    }
}
let zt = !1, je = !1;
function zn(e) {
  je = e;
}
let E = null, re = !1;
function ee(e) {
  E = e;
}
let S = null;
function _e(e) {
  S = e;
}
let X = null;
function Ur(e) {
  E !== null && (X === null ? X = [e] : X.push(e));
}
let H = null, V = 0, K = null;
function ss(e) {
  K = e;
}
let Hr = 1, Me = 0, He = Me;
function Bn(e) {
  He = e;
}
function zr() {
  return ++Hr;
}
function Nt(e) {
  var t = e.f;
  if (t & F)
    return !0;
  if (t & L && (e.f &= ~ze), t & ve) {
    for (var n = (
      /** @type {Value[]} */
      e.deps
    ), r = n.length, i = 0; i < r; i++) {
      var s = n[i];
      if (Nt(
        /** @type {Derived} */
        s
      ) && yr(
        /** @type {Derived} */
        s
      ), s.wv > e.wv)
        return !0;
    }
    t & Q && // During time traveling we don't want to reset the status so that
    // traversal of the graph in the other batches still happens
    ne === null && I(e, R);
  }
  return !1;
}
function Br(e, t, n = !0) {
  var r = e.reactions;
  if (r !== null && !(X !== null && ot.call(X, e)))
    for (var i = 0; i < r.length; i++) {
      var s = r[i];
      s.f & L ? Br(
        /** @type {Derived} */
        s,
        t,
        !1
      ) : t === s && (n ? I(s, F) : s.f & R && I(s, ve), Cn(
        /** @type {Effect} */
        s
      ));
    }
}
function Vr(e) {
  var b;
  var t = H, n = V, r = K, i = E, s = X, f = le, l = re, a = He, o = e.f;
  H = /** @type {null | Value[]} */
  null, V = 0, K = null, E = o & (he | Ie) ? null : e, X = null, ut(e.ctx), re = !1, He = ++Me, e.ac !== null && (Ir(() => {
    e.ac.abort(Qt);
  }), e.ac = null);
  try {
    e.f |= Vt;
    var v = (
      /** @type {Function} */
      e.fn
    ), c = v();
    e.f |= dt;
    var h = e.deps, _ = T?.is_fork;
    if (H !== null) {
      var d;
      if (_ || kt(e, V), h !== null && V > 0)
        for (h.length = V + H.length, d = 0; d < H.length; d++)
          h[V + d] = H[d];
      else
        e.deps = h = H;
      if (On() && e.f & Q)
        for (d = V; d < h.length; d++)
          ((b = h[d]).reactions ?? (b.reactions = [])).push(e);
    } else !_ && h !== null && V < h.length && (kt(e, V), h.length = V);
    if (cr() && K !== null && !re && h !== null && !(e.f & (L | ve | F)))
      for (d = 0; d < /** @type {Source[]} */
      K.length; d++)
        Br(
          K[d],
          /** @type {Effect} */
          e
        );
    if (i !== null && i !== e) {
      if (Me++, i.deps !== null)
        for (let A = 0; A < n; A += 1)
          i.deps[A].rv = Me;
      if (t !== null)
        for (const A of t)
          A.rv = Me;
      K !== null && (r === null ? r = K : r.push(.../** @type {Source[]} */
      K));
    }
    return e.f & Ne && (e.f ^= Ne), c;
  } catch (A) {
    return dr(A);
  } finally {
    e.f ^= Vt, H = t, V = n, K = r, E = i, X = s, ut(f), re = l, He = a;
  }
}
function ls(e, t) {
  let n = t.reactions;
  if (n !== null) {
    var r = si.call(n, e);
    if (r !== -1) {
      var i = n.length - 1;
      i === 0 ? n = t.reactions = null : (n[r] = n[i], n.pop());
    }
  }
  if (n === null && t.f & L && // Destroying a child effect while updating a parent effect can cause a dependency to appear
  // to be unused, when in fact it is used by the currently-updating parent. Checking `new_deps`
  // allows us to skip the expensive work of disconnecting and immediately reconnecting it
  (H === null || !ot.call(H, t))) {
    var s = (
      /** @type {Derived} */
      t
    );
    s.f & Q && (s.f ^= Q, s.f &= ~ze), s.v !== M && kn(s), Yi(s), kt(s, 0);
  }
}
function kt(e, t) {
  var n = e.deps;
  if (n !== null)
    for (var r = t; r < n.length; r++)
      ls(e, n[r]);
}
function ct(e) {
  var t = e.f;
  if (!(t & ie)) {
    I(e, R);
    var n = S, r = zt;
    S = e, zt = !0;
    try {
      t & (te | ir) ? rs(e) : Rn(e), Mr(e);
      var i = Vr(e);
      e.teardown = typeof i == "function" ? i : null, e.wv = Hr;
      var s;
    } finally {
      zt = r, S = n;
    }
  }
}
function N(e) {
  var t = e.f, n = (t & L) !== 0;
  if (E !== null && !re) {
    var r = S !== null && (S.f & ie) !== 0;
    if (!r && (X === null || !ot.call(X, e))) {
      var i = E.deps;
      if (E.f & Vt)
        e.rv < Me && (e.rv = Me, H === null && i !== null && i[V] === e ? V++ : H === null ? H = [e] : H.push(e));
      else {
        (E.deps ?? (E.deps = [])).push(e);
        var s = e.reactions;
        s === null ? e.reactions = [E] : ot.call(s, E) || s.push(E);
      }
    }
  }
  if (je && Ue.has(e))
    return Ue.get(e);
  if (n) {
    var f = (
      /** @type {Derived} */
      e
    );
    if (je) {
      var l = f.v;
      return (!(f.f & R) && f.reactions !== null || Yr(f)) && (l = In(f)), Ue.set(f, l), l;
    }
    var a = (f.f & Q) === 0 && !re && E !== null && (zt || (E.f & Q) !== 0), o = (f.f & dt) === 0;
    Nt(f) && (a && (f.f |= Q), yr(f)), a && !o && (Er(f), jr(f));
  }
  if (ne?.has(e))
    return ne.get(e);
  if (e.f & Ne)
    throw e.v;
  return e.v;
}
function jr(e) {
  if (e.f |= Q, e.deps !== null)
    for (const t of e.deps)
      (t.reactions ?? (t.reactions = [])).push(e), t.f & L && !(t.f & Q) && (Er(
        /** @type {Derived} */
        t
      ), jr(
        /** @type {Derived} */
        t
      ));
}
function Yr(e) {
  if (e.v === M) return !0;
  if (e.deps === null) return !1;
  for (const t of e.deps)
    if (Ue.has(t) || t.f & L && Yr(
      /** @type {Derived} */
      t
    ))
      return !0;
  return !1;
}
function Gr(e) {
  var t = re;
  try {
    return re = !0, e();
  } finally {
    re = t;
  }
}
const os = ["touchstart", "touchmove"];
function fs(e) {
  return os.includes(e);
}
const Pe = Symbol("events"), Kr = /* @__PURE__ */ new Set(), bn = /* @__PURE__ */ new Set();
function Vn(e, t, n) {
  (t[Pe] ?? (t[Pe] = {}))[e] = n;
}
function us(e) {
  for (var t = 0; t < e.length; t++)
    Kr.add(e[t]);
  for (var n of bn)
    n(e);
}
let jn = null;
function Yn(e) {
  var t = this, n = (
    /** @type {Node} */
    t.ownerDocument
  ), r = e.type, i = e.composedPath?.() || [], s = (
    /** @type {null | Element} */
    i[0] || e.target
  );
  jn = e;
  var f = 0, l = jn === e && e[Pe];
  if (l) {
    var a = i.indexOf(l);
    if (a !== -1 && (t === document || t === /** @type {any} */
    window)) {
      e[Pe] = t;
      return;
    }
    var o = i.indexOf(t);
    if (o === -1)
      return;
    a <= o && (f = a);
  }
  if (s = /** @type {Element} */
  i[f] || e.target, s !== t) {
    er(e, "currentTarget", {
      configurable: !0,
      get() {
        return s || n;
      }
    });
    var v = E, c = S;
    ee(null), _e(null);
    try {
      for (var h, _ = []; s !== null; ) {
        var d = s.assignedSlot || s.parentNode || /** @type {any} */
        s.host || null;
        try {
          var b = s[Pe]?.[r];
          b != null && (!/** @type {any} */
          s.disabled || // DOM could've been updated already by the time this is reached, so we check this as well
          // -> the target could not have been disabled because it emits the event in the first place
          e.target === s) && b.call(s, e);
        } catch (A) {
          h ? _.push(A) : h = A;
        }
        if (e.cancelBubble || d === t || d === null)
          break;
        s = d;
      }
      if (h) {
        for (let A of _)
          queueMicrotask(() => {
            throw A;
          });
        throw h;
      }
    } finally {
      e[Pe] = t, delete e.currentTarget, ee(v), _e(c);
    }
  }
}
const as = (
  // We gotta write it like this because after downleveling the pure comment may end up in the wrong location
  globalThis?.window?.trustedTypes && /* @__PURE__ */ globalThis.window.trustedTypes.createPolicy("svelte-trusted-html", {
    /** @param {string} html */
    createHTML: (e) => e
  })
);
function cs(e) {
  return (
    /** @type {string} */
    as?.createHTML(e) ?? e
  );
}
function ds(e) {
  var t = Nr("template");
  return t.innerHTML = cs(e.replaceAll("<!>", "<!---->")), t.content;
}
function hs(e, t) {
  var n = (
    /** @type {Effect} */
    S
  );
  n.nodes === null && (n.nodes = { start: e, end: t, a: null, t: null });
}
// @__NO_SIDE_EFFECTS__
function en(e, t) {
  var n = (t & Ei) !== 0, r, i = !e.startsWith("<!>");
  return () => {
    r === void 0 && (r = ds(i ? e : "<!>" + e), r = /** @type {TemplateNode} */
    /* @__PURE__ */ Cr(r));
    var s = (
      /** @type {TemplateNode} */
      n || Ar ? document.importNode(r, !0) : r.cloneNode(!0)
    );
    return hs(s, s), s;
  };
}
function Pt(e, t) {
  e !== null && e.before(
    /** @type {Node} */
    t
  );
}
function Re(e, t) {
  var n = t == null ? "" : typeof t == "object" ? `${t}` : t;
  n !== /** @type {any} */
  (e[gt] ?? (e[gt] = e.nodeValue)) && (e[gt] = n, e.nodeValue = `${n}`);
}
function vs(e, t) {
  return _s(e, t);
}
const Ft = /* @__PURE__ */ new Map();
function _s(e, { target: t, anchor: n, props: r = {}, events: i, context: s, intro: f = !0, transformError: l }) {
  Ki();
  var a = void 0, o = Xi(() => {
    var v = n ?? t.appendChild(St());
    Fi(
      /** @type {TemplateNode} */
      v,
      {
        pending: () => {
        }
      },
      (_) => {
        ur({});
        var d = (
          /** @type {ComponentContext} */
          le
        );
        s && (d.c = s), i && (r.$$events = i), a = e(_, r) || {}, ar();
      },
      l
    );
    var c = /* @__PURE__ */ new Set(), h = (_) => {
      for (var d = 0; d < _.length; d++) {
        var b = _[d];
        if (!c.has(b)) {
          c.add(b);
          var A = fs(b);
          for (const z of [t, document]) {
            var D = Ft.get(z);
            D === void 0 && (D = /* @__PURE__ */ new Map(), Ft.set(z, D));
            var x = D.get(b);
            x === void 0 ? (z.addEventListener(b, Yn, { passive: A }), D.set(b, 1)) : D.set(b, x + 1);
          }
        }
      }
    };
    return h(Zt(Kr)), bn.add(h), () => {
      for (var _ of c)
        for (const A of [t, document]) {
          var d = (
            /** @type {Map<string, number>} */
            Ft.get(A)
          ), b = (
            /** @type {number} */
            d.get(_)
          );
          --b == 0 ? (A.removeEventListener(_, Yn), d.delete(_), d.size === 0 && Ft.delete(A)) : d.set(_, b);
        }
      bn.delete(h), v !== n && v.parentNode?.removeChild(v);
    };
  });
  return yn.set(a, o), a;
}
let yn = /* @__PURE__ */ new WeakMap();
function ps(e, t) {
  const n = yn.get(e);
  return n ? (yn.delete(e), n(t)) : Promise.resolve();
}
function gs(e, t) {
  return t;
}
function ws(e, t, n) {
  for (var r = [], i = t.length, s, f = t.length, l = 0; l < i; l++) {
    let c = t[l];
    Xe(
      c,
      () => {
        if (s) {
          if (s.pending.delete(c), s.done.add(c), s.pending.size === 0) {
            var h = (
              /** @type {Set<EachOutroGroup>} */
              e.outrogroups
            );
            En(e, Zt(s.done)), h.delete(s), h.size === 0 && (e.outrogroups = null);
          }
        } else
          f -= 1;
      },
      !1
    );
  }
  if (f === 0) {
    var a = r.length === 0 && n !== null;
    if (a) {
      var o = (
        /** @type {Element} */
        n
      ), v = (
        /** @type {Element} */
        o.parentNode
      );
      Wi(v), v.append(o), e.items.clear();
    }
    En(e, t, !a);
  } else
    s = {
      pending: new Set(t),
      done: /* @__PURE__ */ new Set()
    }, (e.outrogroups ?? (e.outrogroups = /* @__PURE__ */ new Set())).add(s);
}
function En(e, t, n = !0) {
  var r;
  if (e.pending.size > 0) {
    r = /* @__PURE__ */ new Set();
    for (const f of e.pending.values())
      for (const l of f)
        r.add(
          /** @type {EachItem} */
          e.items.get(l).e
        );
  }
  for (var i = 0; i < t.length; i++) {
    var s = t[i];
    if (r?.has(s)) {
      s.f |= be;
      const f = document.createDocumentFragment();
      qr(s, f);
    } else
      se(t[i], n);
  }
}
var Gn;
function Kn(e, t, n, r, i, s = null) {
  var f = e, l = /* @__PURE__ */ new Map();
  {
    var a = (
      /** @type {Element} */
      e
    );
    f = a.appendChild(St());
  }
  var o = null, v = /* @__PURE__ */ Vi(() => {
    var x = n();
    return Xn(x) ? x : x == null ? [] : Zt(x);
  }), c, h = /* @__PURE__ */ new Map(), _ = !0;
  function d(x) {
    D.effect.f & ie || (D.pending.delete(x), D.fallback = o, ms(D, c, f, t, r), o !== null && (c.length === 0 ? o.f & be ? (o.f ^= be, bt(o, null, f)) : Lr(o) : Xe(o, () => {
      o = null;
    })));
  }
  function b(x) {
    D.pending.delete(x);
  }
  var A = Rr(() => {
    c = /** @type {V[]} */
    N(v);
    for (var x = c.length, z = /* @__PURE__ */ new Set(), G = (
      /** @type {Batch} */
      T
    ), oe = Zi(), fe = 0; fe < x; fe += 1) {
      var w = c[fe], g = r(w, fe), C = _ ? null : l.get(g);
      C ? (C.v && at(C.v, w), C.i && at(C.i, fe), oe && G.unskip_effect(C.e)) : (C = bs(
        l,
        _ ? f : Gn ?? (Gn = St()),
        w,
        g,
        fe,
        i,
        t,
        n
      ), _ || (C.e.f |= be), l.set(g, C)), z.add(g);
    }
    if (x === 0 && s && !o && (_ ? o = ae(() => s(f)) : (o = ae(() => s(Gn ?? (Gn = St()))), o.f |= be)), x > z.size && hi(), !_)
      if (h.set(G, z), oe) {
        for (const [P, Oe] of l)
          z.has(P) || G.skip_effect(Oe.e);
        G.oncommit(d), G.ondiscard(b);
      } else
        d(G);
    N(v);
  }), D = { effect: A, items: l, pending: h, outrogroups: null, fallback: o };
  _ = !1;
}
function pt(e) {
  for (; e !== null && !(e.f & he); )
    e = e.next;
  return e;
}
function ms(e, t, n, r, i) {
  var s = t.length, f = e.items, l = pt(e.effect.first), a, o = null, v = [], c = [], h, _, d, b;
  for (b = 0; b < s; b += 1) {
    if (h = t[b], _ = i(h, b), d = /** @type {EachItem} */
    f.get(_).e, e.outrogroups !== null)
      for (const g of e.outrogroups)
        g.pending.delete(d), g.done.delete(d);
    if (d.f & q && Lr(d), d.f & be)
      if (d.f ^= be, d === l)
        bt(d, null, n);
      else {
        var A = o ? o.next : l;
        d === e.effect.last && (e.effect.last = d.prev), d.prev && (d.prev.next = d.next), d.next && (d.next.prev = d.prev), xe(e, o, d), xe(e, d, A), bt(d, A, n), o = d, v = [], c = [], l = pt(o.next);
        continue;
      }
    if (d !== l) {
      if (a !== void 0 && a.has(d)) {
        if (v.length < c.length) {
          var D = c[0], x;
          o = D.prev;
          var z = v[0], G = v[v.length - 1];
          for (x = 0; x < v.length; x += 1)
            bt(v[x], D, n);
          for (x = 0; x < c.length; x += 1)
            a.delete(c[x]);
          xe(e, z.prev, G.next), xe(e, o, z), xe(e, G, D), l = D, o = G, b -= 1, v = [], c = [];
        } else
          a.delete(d), bt(d, l, n), xe(e, d.prev, d.next), xe(e, d, o === null ? e.effect.first : o.next), xe(e, o, d), o = d;
        continue;
      }
      for (v = [], c = []; l !== null && l !== d; )
        (a ?? (a = /* @__PURE__ */ new Set())).add(l), c.push(l), l = pt(l.next);
      if (l === null)
        continue;
    }
    d.f & be || v.push(d), o = d, l = pt(d.next);
  }
  if (e.outrogroups !== null) {
    for (const g of e.outrogroups)
      g.pending.size === 0 && (En(e, Zt(g.done)), e.outrogroups?.delete(g));
    e.outrogroups.size === 0 && (e.outrogroups = null);
  }
  if (l !== null || a !== void 0) {
    var oe = [];
    if (a !== void 0)
      for (d of a)
        d.f & q || oe.push(d);
    for (; l !== null; )
      !(l.f & q) && l !== e.fallback && oe.push(l), l = pt(l.next);
    var fe = oe.length;
    if (fe > 0) {
      var w = s === 0 ? n : null;
      ws(e, oe, w);
    }
  }
}
function bs(e, t, n, r, i, s, f, l) {
  var a = f & mi ? f & yi ? Ve(n) : /* @__PURE__ */ xr(n, !1, !1) : null, o = f & bi ? Ve(i) : null;
  return {
    v: a,
    i: o,
    e: ae(() => (s(t, a ?? n, o ?? i, l), () => {
      e.delete(r);
    }))
  };
}
function bt(e, t, n) {
  if (e.nodes)
    for (var r = e.nodes.start, i = e.nodes.end, s = t && !(t.f & be) ? (
      /** @type {EffectNodes} */
      t.nodes.start
    ) : n; r !== null; ) {
      var f = (
        /** @type {TemplateNode} */
        /* @__PURE__ */ Xt(r)
      );
      if (s.before(r), r === i)
        return;
      r = f;
    }
}
function xe(e, t, n) {
  t === null ? e.effect.first = n : t.next = n, n === null ? e.effect.last = t : n.prev = t;
}
function ys(e, t) {
  es(() => {
    var n = e.getRootNode(), r = (
      /** @type {ShadowRoot} */
      n.host ? (
        /** @type {ShadowRoot} */
        n
      ) : (
        /** @type {Document} */
        n.head ?? /** @type {Document} */
        n.ownerDocument.head
      )
    );
    if (!r.querySelector("#" + t.hash)) {
      const i = Nr("style");
      i.id = t.hash, i.textContent = t.code, r.appendChild(i);
    }
  });
}
const Wn = [...` 	
\r\f \v\uFEFF`];
function Es(e, t, n) {
  var r = "" + e;
  if (n) {
    for (var i of Object.keys(n))
      if (n[i])
        r = r ? r + " " + i : i;
      else if (r.length)
        for (var s = i.length, f = 0; (f = r.indexOf(i, f)) >= 0; ) {
          var l = f + s;
          (f === 0 || Wn.includes(r[f - 1])) && (l === r.length || Wn.includes(r[l])) ? r = (f === 0 ? "" : r.substring(0, f)) + r.substring(l + 1) : f = l;
        }
  }
  return r === "" ? null : r;
}
function Ss(e, t, n, r, i, s) {
  var f = (
    /** @type {any} */
    e[an]
  );
  if (f !== n || f === void 0) {
    var l = Es(n, r, s);
    l == null ? e.removeAttribute("class") : e.className = l, e[an] = n;
  } else if (s && i !== s)
    for (var a in s) {
      var o = !!s[a];
      (i == null || o !== !!i[a]) && e.classList.toggle(a, o);
    }
  return s;
}
const xs = Symbol("is custom element"), ks = Symbol("is html");
function As(e, t, n, r) {
  var i = Ts(e);
  i[t] !== (i[t] = n) && (n == null ? e.removeAttribute(t) : typeof n != "string" && Ds(e).includes(t) ? e[t] = n : e.setAttribute(t, n));
}
function Ts(e) {
  return (
    /** @type {Record<string | symbol, unknown>} **/
    /** @type {any} */
    e[Lt] ?? (e[Lt] = {
      [xs]: e.nodeName.includes("-"),
      [ks]: e.namespaceURI === sr
    })
  );
}
var Zn = /* @__PURE__ */ new Map();
function Ds(e) {
  var t = e.getAttribute("is") || e.nodeName, n = Zn.get(t);
  if (n) return n;
  Zn.set(t, n = []);
  for (var r, i = e, s = Element.prototype; s !== i; ) {
    r = li(i);
    for (var f in r)
      r[f].set && // better safe than sorry, we don't want spread attributes to mess with HTML content
      f !== "innerHTML" && f !== "textContent" && f !== "innerText" && n.push(f);
    i = tr(i);
  }
  return n;
}
const Cs = "5";
var Qn;
typeof window < "u" && ((Qn = window.__svelte ?? (window.__svelte = {})).v ?? (Qn.v = /* @__PURE__ */ new Set())).add(Cs);
function Mn(e, t, n) {
  const r = Tn(n ?? t());
  return typeof window < "u" && window.AtelierAPI.events.on(e, () => r.set(t())), { subscribe: r.subscribe };
}
const Ns = Mn(
  window.AtelierAPI.events.COURSES_UPDATED,
  () => window.AtelierAPI.state.getCourses(),
  []
), Is = Mn(
  window.AtelierAPI.events.LESSONS_UPDATED,
  () => window.AtelierAPI.state.getUpcomingLessons(),
  []
), Wr = Mn(
  window.AtelierAPI.events.LANG_CHANGED,
  () => window.AtelierAPI.i18n.getLang(),
  typeof window < "u" ? window.AtelierAPI.i18n.getLang() : "cs"
), Os = Di(Wr, () => (e, t) => window.AtelierAPI.i18n.t(e, t));
function Rs() {
  const e = /* @__PURE__ */ new Date(), t = e.getFullYear(), n = String(e.getMonth() + 1).padStart(2, "0"), r = String(e.getDate()).padStart(2, "0");
  return `${t}-${n}-${r}`;
}
const Jn = Tn(Rs());
var Ms = /* @__PURE__ */ en('<button type="button"> </button>'), Ps = /* @__PURE__ */ en('<li class="cal-island__item svelte-fu56mo"><div class="cal-island__title svelte-fu56mo"> </div> <div class="cal-island__time svelte-fu56mo"> </div> <div class="cal-island__spots svelte-fu56mo" aria-hidden="true"> </div> <button type="button" class="cal-island__book svelte-fu56mo"> </button></li>'), Fs = /* @__PURE__ */ en('<li class="cal-island__empty svelte-fu56mo"> </li>'), Ls = /* @__PURE__ */ en('<section class="cal-island svelte-fu56mo"><header class="cal-island__head svelte-fu56mo"><strong> </strong></header> <nav class="cal-island__days svelte-fu56mo" aria-label="day picker"></nav> <ul class="cal-island__list svelte-fu56mo"></ul></section>');
const $s = {
  hash: "svelte-fu56mo",
  code: ".cal-island.svelte-fu56mo {display:flex;flex-direction:column;gap:14px;padding:4px 0;}.cal-island__head.svelte-fu56mo {display:flex;align-items:center;justify-content:space-between;font-family:'Vend Sans', sans-serif;font-size:19px;font-weight:500;}.cal-island__days.svelte-fu56mo {display:flex;gap:6px;overflow-x:auto;padding-bottom:4px;scrollbar-width:thin;}.cal-island__day.svelte-fu56mo {flex:0 0 auto;padding:8px 14px;border-radius:999px;border:1px solid var(--border, rgba(17, 24, 39, 0.1));background:transparent;color:inherit;cursor:pointer;font:inherit;white-space:nowrap;}.cal-island__day.active.svelte-fu56mo {background:var(--primary, #2854b9);color:#fff;border-color:transparent;}.cal-island__list.svelte-fu56mo {list-style:none;padding:0;margin:0;display:grid;gap:8px;}.cal-island__item.svelte-fu56mo {display:grid;grid-template-columns:1fr auto auto auto;gap:12px;align-items:center;padding:10px 14px;border:1px solid var(--border, rgba(17, 24, 39, 0.1));border-radius:14px;background:var(--surface, #fff);}.cal-island__title.svelte-fu56mo {font-weight:600;}.cal-island__time.svelte-fu56mo {color:var(--muted, #6b7280);font-variant-numeric:tabular-nums;}.cal-island__spots.svelte-fu56mo {color:var(--muted, #6b7280);font-variant-numeric:tabular-nums;min-width:1.5ch;text-align:right;}.cal-island__book.svelte-fu56mo {padding:8px 16px;border-radius:999px;border:none;background:var(--primary, #2854b9);color:#fff;cursor:pointer;font:inherit;font-weight:500;}.cal-island__book.svelte-fu56mo:disabled {background:var(--muted-surface, #f6f7f9);color:var(--muted, #6b7280);cursor:not-allowed;}.cal-island__empty.svelte-fu56mo {padding:24px;text-align:center;color:var(--muted, #6b7280);border:1px dashed var(--border, rgba(17, 24, 39, 0.1));border-radius:14px;}"
};
function qs(e, t) {
  ur(t, !0), ys(e, $s);
  const n = () => vt(Ns, "$courses", l), r = () => vt(Is, "$upcomingLessons", l), i = () => vt(Jn, "$selectedDay", l), s = () => vt(Wr, "$lang", l), f = () => vt(Os, "$tt", l), [l, a] = Ni();
  function o(w) {
    const g = w.getFullYear(), C = String(w.getMonth() + 1).padStart(2, "0"), P = String(w.getDate()).padStart(2, "0");
    return `${g}-${C}-${P}`;
  }
  const v = /* @__PURE__ */ Rt(() => {
    const w = [], g = /* @__PURE__ */ new Date();
    g.setHours(0, 0, 0, 0);
    for (let C = 0; C < 14; C++) {
      const P = new Date(g);
      P.setDate(P.getDate() + C), w.push(P);
    }
    return w;
  });
  function c(w) {
    return n().find((g) => g.id === w);
  }
  const h = /* @__PURE__ */ Rt(() => r().filter((w) => c(w.course_id) ? o(new Date(w.start_time)) === i() : !1));
  function _(w) {
    return w ? w[s()] ?? w.cs ?? "" : "";
  }
  function d(w) {
    const g = new Date(w), C = s() === "en" ? "en-GB" : "cs-CZ";
    return g.toLocaleTimeString(C, { hour: "2-digit", minute: "2-digit" });
  }
  function b(w) {
    const g = s() === "en" ? "en-GB" : "cs-CZ";
    return w.toLocaleDateString(g, { weekday: "short", day: "numeric", month: "short" });
  }
  function A(w) {
    const g = c(w.course_id);
    g && window.AtelierAPI.actions.openBookingPopup(g.id, null, w.lesson_id);
  }
  var D = Ls(), x = ue(D), z = ue(x), G = ue(z), oe = _t(x, 2);
  Kn(oe, 21, () => N(v), gs, (w, g) => {
    const C = /* @__PURE__ */ Rt(() => o(N(g)));
    var P = Ms();
    let Oe;
    var tn = ue(P);
    Mt(
      (It) => {
        Oe = Ss(P, 1, "cal-island__day svelte-fu56mo", null, Oe, { active: N(C) === i() }), Re(tn, It);
      },
      [() => b(N(g))]
    ), Vn("click", P, () => Jn.set(N(C))), Pt(w, P);
  });
  var fe = _t(oe, 2);
  Kn(
    fe,
    21,
    () => N(h),
    (w) => w.lesson_id,
    (w, g) => {
      const C = /* @__PURE__ */ Rt(() => c(N(g).course_id));
      var P = Ps(), Oe = ue(P), tn = ue(Oe), It = _t(Oe, 2), Zr = ue(It), Pn = _t(It, 2), Jr = ue(Pn), nn = _t(Pn, 2), Qr = ue(nn);
      Mt(
        (Xr, ei, ti, ni) => {
          Re(tn, Xr), Re(Zr, `${ei ?? ""}–${ti ?? ""}`), Re(Jr, N(g).available_spots), nn.disabled = N(g).available_spots <= 0, Re(Qr, ni);
        },
        [
          () => _(N(C)?.title),
          () => d(N(g).start_time),
          () => d(N(g).end_time),
          () => N(g).available_spots > 0 ? f()("booking.btn.book") : f()("common.full")
        ]
      ), Vn("click", nn, () => A(N(g))), Pt(w, P);
    },
    (w) => {
      var g = Fs(), C = ue(g);
      Mt((P) => Re(C, P), [() => f()("booking.empty.noScheduledSessions")]), Pt(w, g);
    }
  ), Mt(
    (w, g) => {
      As(D, "aria-label", w), Re(G, g);
    },
    [() => f()("nav.calendar"), () => f()("nav.calendar")]
  ), Pt(e, D), ar(), a();
}
us(["click"]);
const Us = {
  calendar: qs
}, Gt = /* @__PURE__ */ new Map();
function fn(e, t, n = {}) {
  if (!t) return null;
  const r = Gt.get(t);
  if (r && r.name === e) return r.component;
  r && Sn(t);
  const i = Us[e];
  if (!i)
    return console.warn("[svelte-islands] Unknown island:", e), null;
  const s = vs(i, { target: t, props: n });
  return Gt.set(t, { component: s, name: e }), s;
}
function Sn(e) {
  const t = Gt.get(e);
  t && (ps(t.component), Gt.delete(e));
}
if (typeof window < "u" && (window.AtelierSvelte = { mount: fn, unmount: Sn }, window.__appNavHooks = window.__appNavHooks ?? [], window.__appNavHooks.push((t) => {
  const n = document.getElementById("calendar-root");
  if (!n) return;
  const r = window.__features?.svelteCalendar === !0;
  t === "kalendar" && r ? fn("calendar", n) : Sn(n);
}), document.querySelector("#screen-kalendar.active") && window.__features?.svelteCalendar)) {
  const t = document.getElementById("calendar-root");
  t && fn("calendar", t);
}
//# sourceMappingURL=atelier-svelte.js.map
