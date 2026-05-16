var ni = Object.defineProperty;
var Fn = (e) => {
  throw TypeError(e);
};
var ri = (e, t, n) => t in e ? ni(e, t, { enumerable: !0, configurable: !0, writable: !0, value: n }) : e[t] = n;
var z = (e, t, n) => ri(e, typeof t != "symbol" ? t + "" : t, n), rn = (e, t, n) => t.has(e) || Fn("Cannot " + n);
var u = (e, t, n) => (rn(e, t, "read from private field"), n ? n.call(e) : t.get(e)), m = (e, t, n) => t.has(e) ? Fn("Cannot add the same private member more than once") : t instanceof WeakSet ? t.add(e) : t.set(e, n), p = (e, t, n, r) => (rn(e, t, "write to private field"), r ? r.call(e, n) : t.set(e, n), n), y = (e, t, n) => (rn(e, t, "access private method"), n);
var Xn = Array.isArray, ii = Array.prototype.indexOf, ft = Array.prototype.includes, Zt = Array.from, er = Object.defineProperty, bt = Object.getOwnPropertyDescriptor, si = Object.getOwnPropertyDescriptors, li = Object.prototype, fi = Array.prototype, tr = Object.getPrototypeOf, Ln = Object.isExtensible;
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
const L = 2, St = 4, Jt = 8, ir = 1 << 24, te = 16, he = 32, Ie = 64, un = 128, Q = 512, M = 1024, F = 2048, ve = 4096, U = 8192, ie = 16384, ct = 32768, $n = 1 << 25, kt = 65536, zt = 1 << 17, oi = 1 << 18, dt = 1 << 19, ui = 1 << 20, be = 1 << 25, Be = 65536, Vt = 1 << 21, Je = 1 << 22, Ce = 1 << 23, sn = Symbol("$state"), Lt = Symbol("attributes"), an = Symbol("class"), ai = Symbol("style"), pt = Symbol("text"), Qt = new class extends Error {
  constructor() {
    super(...arguments);
    z(this, "name", "StaleReactionError");
    z(this, "message", "The reaction that called `getAbortSignal()` was re-run or destroyed");
  }
}();
function ci() {
  throw new Error("https://svelte.dev/e/async_derived_orphan");
}
function di(e, t, n) {
  throw new Error("https://svelte.dev/e/each_key_duplicate");
}
function hi() {
  throw new Error("https://svelte.dev/e/effect_update_depth_exceeded");
}
function vi() {
  throw new Error("https://svelte.dev/e/state_descriptors_fixed");
}
function _i() {
  throw new Error("https://svelte.dev/e/state_prototype_fixed");
}
function pi() {
  throw new Error("https://svelte.dev/e/state_unsafe_mutation");
}
function gi() {
  throw new Error("https://svelte.dev/e/svelte_boundary_reset_onerror");
}
const wi = 1, mi = 2, bi = 16, yi = 2, P = Symbol(), sr = "http://www.w3.org/1999/xhtml";
function Ei() {
  console.warn("https://svelte.dev/e/derived_inert");
}
function Si() {
  console.warn("https://svelte.dev/e/svelte_boundary_reset_noop");
}
function lr(e) {
  return e === this.v;
}
function fr(e, t) {
  return e != e ? t == t : e !== t || e !== null && typeof e == "object" || typeof e == "function";
}
function or(e) {
  return !fr(e, this.v);
}
let le = null;
function ot(e) {
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
    return E.f |= Ce, e;
  if (!(t.f & ct) && !(t.f & St))
    throw e;
  De(e, t);
}
function De(e, t) {
  for (; t !== null; ) {
    if (t.f & un) {
      if (!(t.f & ct))
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
function N(e, t) {
  e.f = e.f & Ai | t;
}
function An(e) {
  e.f & Q || e.deps === null ? N(e, M) : N(e, ve);
}
function hr(e) {
  if (e !== null)
    for (const t of e)
      !(t.f & L) || !(t.f & Be) || (t.f ^= Be, hr(
        /** @type {Derived} */
        t.deps
      ));
}
function vr(e, t, n) {
  e.f & F ? t.add(e) : e.f & ve && n.add(e), hr(e.deps), N(e, M);
}
function xn(e, t, n) {
  if (e == null)
    return t(void 0), n && n(void 0), ye;
  const r = jr(
    () => e.subscribe(
      t,
      // @ts-expect-error
      n
    )
  );
  return r.unsubscribe ? () => r.unsubscribe() : r;
}
const je = [];
function xi(e, t) {
  return {
    subscribe: Tn(e, t).subscribe
  };
}
function Tn(e, t = ye) {
  let n = null;
  const r = /* @__PURE__ */ new Set();
  function i(l) {
    if (fr(e, l) && (e = l, n)) {
      const a = !je.length;
      for (const f of r)
        f[1](), je.push(f, e);
      if (a) {
        for (let f = 0; f < je.length; f += 2)
          je[f][0](je[f + 1]);
        je.length = 0;
      }
    }
  }
  function s(l) {
    i(l(
      /** @type {T} */
      e
    ));
  }
  function o(l, a = ye) {
    const f = [l, a];
    return r.add(f), r.size === 1 && (n = t(i, s) || ye), l(
      /** @type {T} */
      e
    ), () => {
      r.delete(f), r.size === 0 && n && (n(), n = null);
    };
  }
  return { set: i, update: s, subscribe: o };
}
function Ti(e, t, n) {
  const r = !Array.isArray(e), i = r ? [e] : e;
  if (!i.every(Boolean))
    throw new Error("derived() expects stores as input, got a falsy value");
  const s = t.length < 2;
  return xi(n, (o, l) => {
    let a = !1;
    const f = [];
    let v = 0, c = ye;
    const h = () => {
      if (v)
        return;
      c();
      const d = t(r ? f[0] : f, o, l);
      s ? o(d) : c = typeof d == "function" ? d : ye;
    }, _ = i.map(
      (d, b) => xn(
        d,
        (x) => {
          f[b] = x, v &= ~(1 << b), a && h();
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
function Di(e) {
  let t;
  return xn(e, (n) => t = n)(), t;
}
let cn = Symbol();
function ht(e, t, n) {
  const r = n[t] ?? (n[t] = {
    store: null,
    source: /* @__PURE__ */ kr(void 0),
    unsubscribe: ye
  });
  if (r.store !== e && !(cn in n))
    if (r.unsubscribe(), r.store = e ?? null, e == null)
      r.source.v = void 0, r.unsubscribe = ye;
    else {
      var i = !0;
      r.unsubscribe = xn(e, (s) => {
        i ? r.source.v = s : ke(r.source, s);
      }), i = !1;
    }
  return e && cn in n ? Di(e) : I(r.source);
}
function Ci() {
  const e = {};
  function t() {
    Nr(() => {
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
let ln = null, Ge = null, T = null, dn = null, ne = null, hn = null, fn = !1, Ze = null, $t = null;
var Un = 0;
let Ii = 1;
var et, Ae, Fe, tt, nt, Le, rt, ge, xt, Y, Tt, xe, ce, de, it, st, A, vn, gt, _n, _r, pr, Ut, Ni, pn, Ke;
const Kt = class Kt {
  constructor() {
    m(this, A);
    z(this, "id", Ii++);
    /** True as soon as `#process` was called */
    m(this, et, !1);
    z(this, "linked", !0);
    /** @type {Batch | null} */
    m(this, Ae, null);
    /** @type {Batch | null} */
    m(this, Fe, null);
    /** @type {Map<Effect, ReturnType<typeof deferred<any>>>} */
    z(this, "async_deriveds", /* @__PURE__ */ new Map());
    /**
     * The current values of any signals that are updated in this batch.
     * Tuple format: [value, is_derived] (note: is_derived is false for deriveds, too, if they were overridden via assignment)
     * They keys of this map are identical to `this.#previous`
     * @type {Map<Value, [any, boolean]>}
     */
    z(this, "current", /* @__PURE__ */ new Map());
    /**
     * The values of any signals (sources and deriveds) that are updated in this batch _before_ those updates took place.
     * They keys of this map are identical to `this.#current`
     * @type {Map<Value, any>}
     */
    z(this, "previous", /* @__PURE__ */ new Map());
    /**
     * Async effects which this batch doesn't take into account anymore when calculating blockers,
     * as it has a value for it already.
     * @type {Set<Effect>}
     */
    z(this, "unblocked", /* @__PURE__ */ new Set());
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
    m(this, xt, null);
    /**
     * The root effects that need to be flushed
     * @type {Effect[]}
     */
    m(this, Y, []);
    /**
     * Effects created while this batch was active.
     * @type {Effect[]}
     */
    m(this, Tt, []);
    /**
     * Deferred effects (which run after async work has completed) that are DIRTY
     * @type {Set<Effect>}
     */
    m(this, xe, /* @__PURE__ */ new Set());
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
    z(this, "is_fork", !1);
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
        N(i, F), n(i);
      for (i of r.m)
        N(i, ve), n(i);
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
    t.v !== P && !this.previous.has(t) && this.previous.set(t, t.v), t.f & Ce || (this.current.set(t, [n, r]), ne?.set(t, n)), this.is_fork || (t.v = n);
  }
  activate() {
    T = this;
  }
  deactivate() {
    T = null, ne = null;
  }
  flush() {
    try {
      fn = !0, T = this, y(this, A, gt).call(this);
    } finally {
      Un = 0, hn = null, Ze = null, $t = null, fn = !1, T = null, ne = null, qe.clear();
    }
  }
  discard() {
    for (const t of u(this, nt)) t(this);
    u(this, nt).clear(), u(this, Le).clear(), y(this, A, Ke).call(this);
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
      u(this, xe).add(r);
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
    return (u(this, xt) ?? p(this, xt, rr())).promise;
  }
  static ensure() {
    var t;
    if (T === null) {
      const n = T = new Kt();
      y(t = n, A, pn).call(t), fn || Qe(() => {
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
    if (hn = t, t.b?.is_pending && t.f & (St | Jt | ir) && !(t.f & ct)) {
      t.b.defer_effect(t);
      return;
    }
    for (var n = t; n.parent !== null; ) {
      n = n.parent;
      var r = n.f;
      if (Ze !== null && n === S && (E === null || !(E.f & L)))
        return;
      if (r & (Ie | he)) {
        if (!(r & M))
          return;
        n.f ^= M;
      }
    }
    u(this, Y).push(n);
  }
};
et = new WeakMap(), Ae = new WeakMap(), Fe = new WeakMap(), tt = new WeakMap(), nt = new WeakMap(), Le = new WeakMap(), rt = new WeakMap(), ge = new WeakMap(), xt = new WeakMap(), Y = new WeakMap(), Tt = new WeakMap(), xe = new WeakMap(), ce = new WeakMap(), de = new WeakMap(), it = new WeakMap(), st = new WeakMap(), A = new WeakSet(), vn = function() {
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
}, gt = function() {
  var a, f, v;
  if (p(this, et, !0), Un++ > 1e3 && (y(this, A, Ke).call(this), Oi()), !y(this, A, vn).call(this)) {
    for (const c of u(this, xe))
      u(this, ce).delete(c), N(c, F), this.schedule(c);
    for (const c of u(this, ce))
      N(c, ve), this.schedule(c);
  }
  const t = u(this, Y);
  p(this, Y, []), this.apply();
  var n = Ze = [], r = [], i = $t = [];
  for (const c of t)
    try {
      y(this, A, _n).call(this, c, n, r);
    } catch (h) {
      throw mr(c), h;
    }
  if (T = null, i.length > 0) {
    var s = Kt.ensure();
    for (const c of i)
      s.schedule(c);
  }
  if (Ze = null, $t = null, y(this, A, vn).call(this)) {
    y(this, A, Ut).call(this, r), y(this, A, Ut).call(this, n);
    for (const [c, h] of u(this, de))
      wr(c, h);
    i.length > 0 && /** @type {unknown} */
    y(a = T, A, gt).call(a);
    return;
  }
  const o = y(this, A, _r).call(this);
  if (o) {
    y(f = o, A, pr).call(f, this);
    return;
  }
  u(this, xe).clear(), u(this, ce).clear();
  for (const c of u(this, tt)) c(this);
  u(this, tt).clear(), dn = this, qn(r), qn(n), dn = null, u(this, xt)?.resolve();
  var l = (
    /** @type {Batch | null} */
    /** @type {unknown} */
    T
  );
  if (this.linked && u(this, rt) === 0 && y(this, A, Ke).call(this), u(this, Y).length > 0) {
    l === null && (l = this, y(this, A, pn).call(this));
    const c = l;
    u(c, Y).push(...u(this, Y).filter((h) => !u(c, Y).includes(h)));
  }
  l !== null && y(v = l, A, gt).call(v);
}, /**
 * Traverse the effect tree, executing effects or stashing
 * them for later execution as appropriate
 * @param {Effect} root
 * @param {Effect[]} effects
 * @param {Effect[]} render_effects
 */
_n = function(t, n, r) {
  t.f ^= M;
  for (var i = t.first; i !== null; ) {
    var s = i.f, o = (s & (he | Ie)) !== 0, l = o && (s & M) !== 0, a = l || (s & U) !== 0 || u(this, de).has(i);
    if (!a && i.fn !== null) {
      o ? i.f ^= M : s & St ? n.push(i) : It(i) && (s & te && u(this, ce).add(i), at(i));
      var f = i.first;
      if (f !== null) {
        i = f;
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
    const o = this.async_deriveds.get(i);
    o && s.promise.then(o.resolve);
  }
  const n = (i) => {
    var s = i.reactions;
    if (s !== null)
      for (const a of s) {
        var o = a.f;
        if (o & L)
          n(
            /** @type {Derived} */
            a
          );
        else {
          var l = (
            /** @type {Effect} */
            a
          );
          o & (Je | te) && !this.async_deriveds.has(l) && (u(this, ce).delete(l), N(l, F), this.schedule(l));
        }
      }
  };
  for (const i of this.current.keys())
    n(i);
  this.oncommit(() => t.discard()), y(r = t, A, Ke).call(r), T = this, y(this, A, gt).call(this);
}, /**
 * @param {Effect[]} effects
 */
Ut = function(t) {
  for (var n = 0; n < t.length; n += 1)
    vr(t[n], u(this, xe), u(this, ce));
}, Ni = function() {
  var v;
  y(this, A, Ke).call(this);
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
              _.f & (te | Je) ? c.schedule(_) : y(d = c, A, Ut).call(d, [_]);
            });
        c.activate();
        var s = /* @__PURE__ */ new Set(), o = /* @__PURE__ */ new Map();
        for (var l of n)
          gr(l, i, s, o);
        o = /* @__PURE__ */ new Map();
        var a = [...c.current.keys()].filter(
          (h) => this.current.has(h) ? (
            /** @type {[any, boolean]} */
            this.current.get(h)[0] !== h.v
          ) : !0
        );
        if (a.length > 0)
          for (const h of u(this, Tt))
            !(h.f & (ie | U | zt)) && Dn(h, a, o) && (h.f & (Je | te) ? (N(h, F), c.schedule(h)) : u(c, xe).add(h));
        if (u(c, Y).length > 0) {
          c.apply();
          for (var f of u(c, Y))
            y(v = c, A, _n).call(v, f, [], []);
          p(c, Y, []);
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
let ze = Kt;
function Oi() {
  try {
    hi();
  } catch (e) {
    De(e, hn);
  }
}
let pe = null;
function qn(e) {
  var t = e.length;
  if (t !== 0) {
    for (var n = 0; n < t; ) {
      var r = e[n++];
      if (!(r.f & (ie | U)) && It(r) && (pe = /* @__PURE__ */ new Set(), at(r), r.deps === null && r.first === null && r.nodes === null && r.teardown === null && r.ac === null && Pr(r), pe?.size > 0)) {
        qe.clear();
        for (const i of pe) {
          if (i.f & (ie | U)) continue;
          const s = [i];
          let o = i.parent;
          for (; o !== null; )
            pe.has(o) && (pe.delete(o), s.push(o)), o = o.parent;
          for (let l = s.length - 1; l >= 0; l--) {
            const a = s[l];
            a.f & (ie | U) || at(a);
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
      ) : s & (Je | te) && !(s & F) && Dn(i, t, r) && (N(i, F), Cn(
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
      if (ft.call(t, i))
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
  if (!(e.f & he && e.f & M)) {
    e.f & F ? t.d.push(e) : e.f & ve && t.m.push(e), N(e, M);
    for (var n = e.first; n !== null; )
      wr(n, t), n = n.next;
  }
}
function mr(e) {
  N(e, M);
  for (var t = e.first; t !== null; )
    mr(t), t = t.next;
}
function Mi(e) {
  let t = 0, n = Ve(0), r;
  return () => {
    On() && (I(n), ts(() => (t === 0 && (r = jr(() => e(() => yt(n)))), t += 1, () => {
      Qe(() => {
        t -= 1, t === 0 && (r?.(), r = void 0, yt(n));
      });
    })));
  };
}
var Pi = kt | dt;
function Ri(e, t, n, r) {
  new Fi(e, t, n, r);
}
var W, kn, Z, $e, q, J, $, j, we, Ue, Te, lt, Dt, Ct, me, Wt, O, Li, $i, Ui, gn, qt, Ht, wn, mn;
class Fi {
  /**
   * @param {TemplateNode} node
   * @param {BoundaryProps} props
   * @param {((anchor: Node) => void)} children
   * @param {((error: unknown) => unknown) | undefined} [transform_error]
   */
  constructor(t, n, r, i) {
    m(this, O);
    /** @type {Boundary | null} */
    z(this, "parent");
    z(this, "is_pending", !1);
    /**
     * API-level transformError transform function. Transforms errors before they reach the `failed` snippet.
     * Inherited from parent boundary, or defaults to identity.
     * @type {(error: unknown) => unknown}
     */
    z(this, "transform_error");
    /** @type {TemplateNode} */
    m(this, W);
    /** @type {TemplateNode | null} */
    m(this, kn, null);
    /** @type {BoundaryProps} */
    m(this, Z);
    /** @type {((anchor: Node) => void)} */
    m(this, $e);
    /** @type {Effect} */
    m(this, q);
    /** @type {Effect | null} */
    m(this, J, null);
    /** @type {Effect | null} */
    m(this, $, null);
    /** @type {Effect | null} */
    m(this, j, null);
    /** @type {DocumentFragment | null} */
    m(this, we, null);
    m(this, Ue, 0);
    m(this, Te, 0);
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
    m(this, Wt, Mi(() => (p(this, me, Ve(u(this, Ue))), () => {
      p(this, me, null);
    })));
    p(this, W, t), p(this, Z, n), p(this, $e, (s) => {
      var o = (
        /** @type {Effect} */
        S
      );
      o.b = this, o.f |= un, r(s);
    }), this.parent = /** @type {Effect} */
    S.b, this.transform_error = i ?? this.parent?.transform_error ?? ((s) => s), p(this, q, Or(() => {
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
    y(this, O, wn).call(this, t, n), p(this, Ue, u(this, Ue) + t), !(!u(this, me) || u(this, lt)) && (p(this, lt, !0), Qe(() => {
      p(this, lt, !1), u(this, me) && ut(u(this, me), u(this, Ue));
    }));
  }
  get_effect_pending() {
    return u(this, Wt).call(this), I(
      /** @type {Source<number>} */
      u(this, me)
    );
  }
  /** @param {unknown} error */
  error(t) {
    if (!u(this, Z).onerror && !u(this, Z).failed)
      throw t;
    T?.is_fork ? (u(this, J) && T.skip_effect(u(this, J)), u(this, $) && T.skip_effect(u(this, $)), u(this, j) && T.skip_effect(u(this, j)), T.on_fork_commit(() => {
      y(this, O, mn).call(this, t);
    })) : y(this, O, mn).call(this, t);
  }
}
W = new WeakMap(), kn = new WeakMap(), Z = new WeakMap(), $e = new WeakMap(), q = new WeakMap(), J = new WeakMap(), $ = new WeakMap(), j = new WeakMap(), we = new WeakMap(), Ue = new WeakMap(), Te = new WeakMap(), lt = new WeakMap(), Dt = new WeakMap(), Ct = new WeakMap(), me = new WeakMap(), Wt = new WeakMap(), O = new WeakSet(), Li = function() {
  try {
    p(this, J, ae(() => u(this, $e).call(this, u(this, W))));
  } catch (t) {
    this.error(t);
  }
}, /**
 * @param {unknown} error The deserialized error from the server's hydration comment
 */
$i = function(t) {
  const n = u(this, Z).failed;
  n && p(this, j, ae(() => {
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
    var n = p(this, we, document.createDocumentFragment()), r = Et();
    n.append(r), p(this, J, y(this, O, Ht).call(this, () => ae(() => u(this, $e).call(this, r)))), u(this, Te) === 0 && (u(this, W).before(n), p(this, we, null), Xe(
      /** @type {Effect} */
      u(this, $),
      () => {
        p(this, $, null);
      }
    ), y(this, O, qt).call(
      this,
      /** @type {Batch} */
      T
    ));
  }));
}, gn = function() {
  try {
    if (this.is_pending = this.has_pending_snippet(), p(this, Te, 0), p(this, Ue, 0), p(this, J, ae(() => {
      u(this, $e).call(this, u(this, W));
    })), u(this, Te) > 0) {
      var t = p(this, we, document.createDocumentFragment());
      $r(u(this, J), t);
      const n = (
        /** @type {(anchor: Node) => void} */
        u(this, Z).pending
      );
      p(this, $, ae(() => n(u(this, W))));
    } else
      y(this, O, qt).call(
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
qt = function(t) {
  this.is_pending = !1, t.transfer_effects(u(this, Dt), u(this, Ct));
}, /**
 * @template T
 * @param {() => T} fn
 */
Ht = function(t) {
  var n = S, r = E, i = le;
  _e(u(this, q)), ee(u(this, q)), ot(u(this, q).ctx);
  try {
    return ze.ensure(), t();
  } catch (s) {
    return dr(s), null;
  } finally {
    _e(n), ee(r), ot(i);
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
  p(this, Te, u(this, Te) + t), u(this, Te) === 0 && (y(this, O, qt).call(this, n), u(this, $) && Xe(u(this, $), () => {
    p(this, $, null);
  }), u(this, we) && (u(this, W).before(u(this, we)), p(this, we, null)));
}, /**
 * @param {unknown} error
 */
mn = function(t) {
  u(this, J) && (se(u(this, J)), p(this, J, null)), u(this, $) && (se(u(this, $)), p(this, $, null)), u(this, j) && (se(u(this, j)), p(this, j, null));
  var n = u(this, Z).onerror;
  let r = u(this, Z).failed;
  var i = !1, s = !1;
  const o = () => {
    if (i) {
      Si();
      return;
    }
    i = !0, s && gi(), u(this, j) !== null && Xe(u(this, j), () => {
      p(this, j, null);
    }), y(this, O, Ht).call(this, () => {
      y(this, O, gn).call(this);
    });
  }, l = (a) => {
    try {
      s = !0, n?.(a, o), s = !1;
    } catch (f) {
      De(f, u(this, q) && u(this, q).parent);
    }
    r && p(this, j, y(this, O, Ht).call(this, () => {
      try {
        return ae(() => {
          var f = (
            /** @type {Effect} */
            S
          );
          f.b = this, f.f |= un, r(
            u(this, W),
            () => a,
            () => o
          );
        });
      } catch (f) {
        return De(
          f,
          /** @type {Effect} */
          u(this, q).parent
        ), null;
      }
    }));
  };
  Qe(() => {
    var a;
    try {
      a = this.transform_error(t);
    } catch (f) {
      De(f, u(this, q) && u(this, q).parent);
      return;
    }
    a !== null && typeof a == "object" && typeof /** @type {any} */
    a.then == "function" ? a.then(
      l,
      /** @param {unknown} e */
      (f) => De(f, u(this, q) && u(this, q).parent)
    ) : l(a);
  });
};
function qi(e, t, n, r) {
  const i = In;
  var s = e.filter((h) => !h.settled);
  if (n.length === 0 && s.length === 0) {
    r(t.map(i));
    return;
  }
  var o = (
    /** @type {Effect} */
    S
  ), l = Hi(), a = s.length === 1 ? s[0].promise : s.length > 1 ? Promise.all(s.map((h) => h.promise)) : null;
  function f(h) {
    if (!(o.f & ie)) {
      l();
      try {
        r(h);
      } catch (_) {
        De(_, o);
      }
      Yt();
    }
  }
  var v = br();
  if (n.length === 0) {
    a.then(() => f(t.map(i))).finally(v);
    return;
  }
  function c() {
    Promise.all(n.map((h) => /* @__PURE__ */ Bi(h))).then((h) => f([...t.map(i), ...h])).catch((h) => De(h, o)).finally(v);
  }
  a ? a.then(() => {
    l(), c(), Yt();
  }) : c();
}
function Hi() {
  var e = (
    /** @type {Effect} */
    S
  ), t = E, n = le, r = (
    /** @type {Batch} */
    T
  );
  return function(s = !0) {
    _e(e), ee(t), ot(n), s && !(e.f & ie) && (r?.activate(), r?.apply());
  };
}
function Yt(e = !0) {
  _e(null), ee(null), ot(null), e && T?.deactivate();
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
function In(e) {
  var t = L | F;
  return S !== null && (S.f |= dt), {
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
      P
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
  r === null && ci();
  var i = (
    /** @type {Promise<V>} */
    /** @type {unknown} */
    void 0
  ), s = Ve(
    /** @type {V} */
    P
  ), o = !E, l = /* @__PURE__ */ new Set();
  return es(() => {
    var a = (
      /** @type {Effect} */
      S
    ), f = rr();
    i = f.promise;
    try {
      Promise.resolve(e()).then(f.resolve, (_) => {
        _ !== Qt && f.reject(_);
      }).finally(Yt);
    } catch (_) {
      f.reject(_), Yt();
    }
    var v = (
      /** @type {Batch} */
      T
    );
    if (o) {
      if (a.f & ct)
        var c = br();
      if (
        /** @type {Boundary} */
        r.b.is_rendered()
      )
        v.async_deriveds.get(a)?.reject(Ot);
      else
        for (const _ of l.values())
          _.reject(Ot);
      l.add(f), v.async_deriveds.set(a, f);
    }
    const h = (_, d = void 0) => {
      c?.(), l.delete(f), d !== Ot && (v.activate(), d ? (s.f |= Ce, ut(s, d)) : (s.f & Ce && (s.f ^= Ce), ut(s, _)), v.deactivate());
    };
    f.promise.then(h, (_) => h(null, _ || "unknown"));
  }), Nr(() => {
    for (const a of l)
      a.reject(Ot);
  }), new Promise((a) => {
    function f(v) {
      function c() {
        v === i ? a(s) : f(i);
      }
      v.then(c, c);
    }
    f(i);
  });
}
// @__NO_SIDE_EFFECTS__
function Mt(e) {
  const t = /* @__PURE__ */ In(e);
  return Ur(t), t;
}
// @__NO_SIDE_EFFECTS__
function zi(e) {
  const t = /* @__PURE__ */ In(e);
  return t.equals = or, t;
}
function Vi(e) {
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
function Nn(e) {
  var t, n = S, r = e.parent;
  if (!Ye && r !== null && r.f & (ie | U))
    return Ei(), e.v;
  _e(r);
  try {
    e.f &= ~Be, Vi(e), t = zr(e);
  } finally {
    _e(n);
  }
  return t;
}
function yr(e) {
  var t = Nn(e);
  if (!e.equals(t) && (e.wv = Hr(), (!T?.is_fork || e.deps === null) && (T !== null ? (T.capture(e, t, !0), dn?.capture(e, t, !0)) : e.v = t, e.deps === null))) {
    N(e, M);
    return;
  }
  Ye || (ne !== null ? (On() || T?.is_fork) && ne.set(e, t) : An(e));
}
function Yi(e) {
  if (e.effects !== null)
    for (const t of e.effects)
      (t.teardown || t.ac) && (t.teardown?.(), t.ac?.abort(Qt), t.teardown = ye, t.ac = null, At(t, 0), Mn(t));
}
function Er(e) {
  if (e.effects !== null)
    for (const t of e.effects)
      t.teardown && at(t);
}
let jt = /* @__PURE__ */ new Set();
const qe = /* @__PURE__ */ new Map();
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
function Ee(e, t) {
  const n = Ve(e);
  return Ur(n), n;
}
// @__NO_SIDE_EFFECTS__
function kr(e, t = !1, n = !0) {
  const r = Ve(e);
  return t || (r.equals = or), r;
}
function ke(e, t, n = !1) {
  E !== null && // since we are untracking the function inside `$inspect.with` we need to add this check
  // to ensure we error if state is set inside an inspect effect
  (!re || E.f & zt) && cr() && E.f & (L | te | Je | zt) && (X === null || !ft.call(X, e)) && pi();
  let r = n ? wt(t) : t;
  return ut(e, r, $t);
}
function ut(e, t, n = null) {
  if (!e.equals(t)) {
    qe.set(e, Ye ? t : e.v);
    var r = ze.ensure();
    if (r.capture(e, t), e.f & L) {
      const i = (
        /** @type {Derived} */
        e
      );
      e.f & F && Nn(i), ne === null && An(i);
    }
    e.wv = Hr(), Ar(e, F, n), S !== null && S.f & M && !(S.f & (he | Ie)) && (K === null ? is([e]) : K.push(e)), !r.is_fork && jt.size > 0 && !Sr && ji();
  }
  return t;
}
function ji() {
  Sr = !1;
  for (const e of jt) {
    e.f & M && N(e, ve);
    let t;
    try {
      t = It(e);
    } catch {
      t = !0;
    }
    t && at(e);
  }
  jt.clear();
}
function yt(e) {
  ke(e, e.v + 1);
}
function Ar(e, t, n) {
  var r = e.reactions;
  if (r !== null)
    for (var i = r.length, s = 0; s < i; s++) {
      var o = r[s], l = o.f, a = (l & F) === 0;
      if (a && N(o, t), l & zt)
        jt.add(
          /** @type {Effect} */
          o
        );
      else if (l & L) {
        var f = (
          /** @type {Derived} */
          o
        );
        ne?.delete(f), l & Be || (l & Q && (S === null || !(S.f & Vt)) && (o.f |= Be), Ar(f, ve, n));
      } else if (a) {
        var v = (
          /** @type {Effect} */
          o
        );
        l & te && pe !== null && pe.add(v), n !== null ? n.push(v) : Cn(v);
      }
    }
}
function wt(e) {
  if (typeof e != "object" || e === null || sn in e)
    return e;
  const t = tr(e);
  if (t !== li && t !== fi)
    return e;
  var n = /* @__PURE__ */ new Map(), r = Xn(e), i = /* @__PURE__ */ Ee(0), s = He, o = (l) => {
    if (He === s)
      return l();
    var a = E, f = He;
    ee(null), zn(s);
    var v = l();
    return ee(a), zn(f), v;
  };
  return r && n.set("length", /* @__PURE__ */ Ee(
    /** @type {any[]} */
    e.length
  )), new Proxy(
    /** @type {any} */
    e,
    {
      defineProperty(l, a, f) {
        (!("value" in f) || f.configurable === !1 || f.enumerable === !1 || f.writable === !1) && vi();
        var v = n.get(a);
        return v === void 0 ? o(() => {
          var c = /* @__PURE__ */ Ee(f.value);
          return n.set(a, c), c;
        }) : ke(v, f.value, !0), !0;
      },
      deleteProperty(l, a) {
        var f = n.get(a);
        if (f === void 0) {
          if (a in l) {
            const v = o(() => /* @__PURE__ */ Ee(P));
            n.set(a, v), yt(i);
          }
        } else
          ke(f, P), yt(i);
        return !0;
      },
      get(l, a, f) {
        if (a === sn)
          return e;
        var v = n.get(a), c = a in l;
        if (v === void 0 && (!c || bt(l, a)?.writable) && (v = o(() => {
          var _ = wt(c ? l[a] : P), d = /* @__PURE__ */ Ee(_);
          return d;
        }), n.set(a, v)), v !== void 0) {
          var h = I(v);
          return h === P ? void 0 : h;
        }
        return Reflect.get(l, a, f);
      },
      getOwnPropertyDescriptor(l, a) {
        var f = Reflect.getOwnPropertyDescriptor(l, a);
        if (f && "value" in f) {
          var v = n.get(a);
          v && (f.value = I(v));
        } else if (f === void 0) {
          var c = n.get(a), h = c?.v;
          if (c !== void 0 && h !== P)
            return {
              enumerable: !0,
              configurable: !0,
              value: h,
              writable: !0
            };
        }
        return f;
      },
      has(l, a) {
        if (a === sn)
          return !0;
        var f = n.get(a), v = f !== void 0 && f.v !== P || Reflect.has(l, a);
        if (f !== void 0 || S !== null && (!v || bt(l, a)?.writable)) {
          f === void 0 && (f = o(() => {
            var h = v ? wt(l[a]) : P, _ = /* @__PURE__ */ Ee(h);
            return _;
          }), n.set(a, f));
          var c = I(f);
          if (c === P)
            return !1;
        }
        return v;
      },
      set(l, a, f, v) {
        var c = n.get(a), h = a in l;
        if (r && a === "length")
          for (var _ = f; _ < /** @type {Source<number>} */
          c.v; _ += 1) {
            var d = n.get(_ + "");
            d !== void 0 ? ke(d, P) : _ in l && (d = o(() => /* @__PURE__ */ Ee(P)), n.set(_ + "", d));
          }
        if (c === void 0)
          (!h || bt(l, a)?.writable) && (c = o(() => /* @__PURE__ */ Ee(void 0)), ke(c, wt(f)), n.set(a, c));
        else {
          h = c.v !== P;
          var b = o(() => wt(f));
          ke(c, b);
        }
        var x = Reflect.getOwnPropertyDescriptor(l, a);
        if (x?.set && x.set.call(v, f), !h) {
          if (r && typeof a == "string") {
            var D = (
              /** @type {Source<number>} */
              n.get("length")
            ), k = Number(a);
            Number.isInteger(k) && k >= D.v && ke(D, k + 1);
          }
          yt(i);
        }
        return !0;
      },
      ownKeys(l) {
        I(i);
        var a = Reflect.ownKeys(l).filter((c) => {
          var h = n.get(c);
          return h === void 0 || h.v !== P;
        });
        for (var [f, v] of n)
          v.v !== P && !(f in l) && a.push(f);
        return a;
      },
      setPrototypeOf() {
        _i();
      }
    }
  );
}
var Hn, xr, Tr, Dr;
function Gi() {
  if (Hn === void 0) {
    Hn = window, xr = /Firefox/.test(navigator.userAgent);
    var e = Element.prototype, t = Node.prototype, n = Text.prototype;
    Tr = bt(t, "firstChild").get, Dr = bt(t, "nextSibling").get, Ln(e) && (e[an] = void 0, e[Lt] = null, e[ai] = void 0, e.__e = void 0), Ln(n) && (n[pt] = void 0);
  }
}
function Et(e = "") {
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
function vt(e, t = 1, n = !1) {
  let r = e;
  for (; t--; )
    r = /** @type {TemplateNode} */
    /* @__PURE__ */ Xt(r);
  return r;
}
function Ki(e) {
  e.textContent = "";
}
function Wi() {
  return !1;
}
function Zi(e, t, n) {
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
function Ne(e, t) {
  var n = S;
  n !== null && n.f & U && (e |= U);
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
  if (e & St)
    Ze !== null ? Ze.push(r) : ze.ensure().schedule(r);
  else if (t !== null) {
    try {
      at(r);
    } catch (o) {
      throw se(r), o;
    }
    i.deps === null && i.teardown === null && i.nodes === null && i.first === i.last && // either `null`, or a singular child
    !(i.f & dt) && (i = i.first, e & te && e & kt && i !== null && (i.f |= kt));
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
function Nr(e) {
  const t = Ne(Jt, null);
  return N(t, M), t.teardown = e, t;
}
function Qi(e) {
  return Ne(St | ui, e);
}
function Xi(e) {
  ze.ensure();
  const t = Ne(Ie | dt, e);
  return (n = {}) => new Promise((r) => {
    n.outro ? Xe(t, () => {
      se(t), r(void 0);
    }) : (se(t), r(void 0));
  });
}
function es(e) {
  return Ne(Je | dt, e);
}
function ts(e, t = 0) {
  return Ne(Jt | t, e);
}
function Pt(e, t = [], n = [], r = []) {
  qi(r, t, n, (i) => {
    Ne(Jt, () => e(...i.map(I)));
  });
}
function Or(e, t = 0) {
  var n = Ne(te | t, e);
  return n;
}
function ae(e) {
  return Ne(he | dt, e);
}
function Mr(e) {
  var t = e.teardown;
  if (t !== null) {
    const n = Ye, r = E;
    Bn(!0), ee(null);
    try {
      t.call(null);
    } finally {
      Bn(n), ee(r);
    }
  }
}
function Mn(e, t = !1) {
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
function ns(e) {
  for (var t = e.first; t !== null; ) {
    var n = t.next;
    t.f & he || se(t), t = n;
  }
}
function se(e, t = !0) {
  var n = !1;
  (t || e.f & oi) && e.nodes !== null && e.nodes.end !== null && (rs(
    e.nodes.start,
    /** @type {TemplateNode} */
    e.nodes.end
  ), n = !0), N(e, $n), Mn(e, t && !n), At(e, 0);
  var r = e.nodes && e.nodes.t;
  if (r !== null)
    for (const s of r)
      s.stop();
  Mr(e), e.f ^= $n, e.f |= ie;
  var i = e.parent;
  i !== null && i.first !== null && Pr(e), e.next = e.prev = e.teardown = e.ctx = e.deps = e.fn = e.nodes = e.ac = e.b = null;
}
function rs(e, t) {
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
  Rr(e, r, !0);
  var i = () => {
    n && se(e), t && t();
  }, s = r.length;
  if (s > 0) {
    var o = () => --s || i();
    for (var l of r)
      l.out(o);
  } else
    i();
}
function Rr(e, t, n) {
  if (!(e.f & U)) {
    e.f ^= U;
    var r = e.nodes && e.nodes.t;
    if (r !== null)
      for (const l of r)
        (l.is_global || n) && t.push(l);
    for (var i = e.first; i !== null; ) {
      var s = i.next;
      if (!(i.f & Ie)) {
        var o = (i.f & kt) !== 0 || // If this is a branch effect without a block effect parent,
        // it means the parent block effect was pruned. In that case,
        // transparency information was transferred to the branch effect.
        (i.f & he) !== 0 && (e.f & te) !== 0;
        Rr(i, t, o ? n : !1);
      }
      i = s;
    }
  }
}
function Fr(e) {
  Lr(e, !0);
}
function Lr(e, t) {
  if (e.f & U) {
    e.f ^= U, e.f & M || (N(e, F), ze.ensure().schedule(e));
    for (var n = e.first; n !== null; ) {
      var r = n.next, i = (n.f & kt) !== 0 || (n.f & he) !== 0;
      Lr(n, i ? t : !1), n = r;
    }
    var s = e.nodes && e.nodes.t;
    if (s !== null)
      for (const o of s)
        (o.is_global || t) && o.in();
  }
}
function $r(e, t) {
  if (e.nodes)
    for (var n = e.nodes.start, r = e.nodes.end; n !== null; ) {
      var i = n === r ? null : /* @__PURE__ */ Xt(n);
      t.append(n), n = i;
    }
}
let Bt = !1, Ye = !1;
function Bn(e) {
  Ye = e;
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
function is(e) {
  K = e;
}
let qr = 1, Pe = 0, He = Pe;
function zn(e) {
  He = e;
}
function Hr() {
  return ++qr;
}
function It(e) {
  var t = e.f;
  if (t & F)
    return !0;
  if (t & L && (e.f &= ~Be), t & ve) {
    for (var n = (
      /** @type {Value[]} */
      e.deps
    ), r = n.length, i = 0; i < r; i++) {
      var s = n[i];
      if (It(
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
    ne === null && N(e, M);
  }
  return !1;
}
function Br(e, t, n = !0) {
  var r = e.reactions;
  if (r !== null && !(X !== null && ft.call(X, e)))
    for (var i = 0; i < r.length; i++) {
      var s = r[i];
      s.f & L ? Br(
        /** @type {Derived} */
        s,
        t,
        !1
      ) : t === s && (n ? N(s, F) : s.f & M && N(s, ve), Cn(
        /** @type {Effect} */
        s
      ));
    }
}
function zr(e) {
  var b;
  var t = H, n = V, r = K, i = E, s = X, o = le, l = re, a = He, f = e.f;
  H = /** @type {null | Value[]} */
  null, V = 0, K = null, E = f & (he | Ie) ? null : e, X = null, ot(e.ctx), re = !1, He = ++Pe, e.ac !== null && (Ir(() => {
    e.ac.abort(Qt);
  }), e.ac = null);
  try {
    e.f |= Vt;
    var v = (
      /** @type {Function} */
      e.fn
    ), c = v();
    e.f |= ct;
    var h = e.deps, _ = T?.is_fork;
    if (H !== null) {
      var d;
      if (_ || At(e, V), h !== null && V > 0)
        for (h.length = V + H.length, d = 0; d < H.length; d++)
          h[V + d] = H[d];
      else
        e.deps = h = H;
      if (On() && e.f & Q)
        for (d = V; d < h.length; d++)
          ((b = h[d]).reactions ?? (b.reactions = [])).push(e);
    } else !_ && h !== null && V < h.length && (At(e, V), h.length = V);
    if (cr() && K !== null && !re && h !== null && !(e.f & (L | ve | F)))
      for (d = 0; d < /** @type {Source[]} */
      K.length; d++)
        Br(
          K[d],
          /** @type {Effect} */
          e
        );
    if (i !== null && i !== e) {
      if (Pe++, i.deps !== null)
        for (let x = 0; x < n; x += 1)
          i.deps[x].rv = Pe;
      if (t !== null)
        for (const x of t)
          x.rv = Pe;
      K !== null && (r === null ? r = K : r.push(.../** @type {Source[]} */
      K));
    }
    return e.f & Ce && (e.f ^= Ce), c;
  } catch (x) {
    return dr(x);
  } finally {
    e.f ^= Vt, H = t, V = n, K = r, E = i, X = s, ot(o), re = l, He = a;
  }
}
function ss(e, t) {
  let n = t.reactions;
  if (n !== null) {
    var r = ii.call(n, e);
    if (r !== -1) {
      var i = n.length - 1;
      i === 0 ? n = t.reactions = null : (n[r] = n[i], n.pop());
    }
  }
  if (n === null && t.f & L && // Destroying a child effect while updating a parent effect can cause a dependency to appear
  // to be unused, when in fact it is used by the currently-updating parent. Checking `new_deps`
  // allows us to skip the expensive work of disconnecting and immediately reconnecting it
  (H === null || !ft.call(H, t))) {
    var s = (
      /** @type {Derived} */
      t
    );
    s.f & Q && (s.f ^= Q, s.f &= ~Be), s.v !== P && An(s), Yi(s), At(s, 0);
  }
}
function At(e, t) {
  var n = e.deps;
  if (n !== null)
    for (var r = t; r < n.length; r++)
      ss(e, n[r]);
}
function at(e) {
  var t = e.f;
  if (!(t & ie)) {
    N(e, M);
    var n = S, r = Bt;
    S = e, Bt = !0;
    try {
      t & (te | ir) ? ns(e) : Mn(e), Mr(e);
      var i = zr(e);
      e.teardown = typeof i == "function" ? i : null, e.wv = qr;
      var s;
    } finally {
      Bt = r, S = n;
    }
  }
}
function I(e) {
  var t = e.f, n = (t & L) !== 0;
  if (E !== null && !re) {
    var r = S !== null && (S.f & ie) !== 0;
    if (!r && (X === null || !ft.call(X, e))) {
      var i = E.deps;
      if (E.f & Vt)
        e.rv < Pe && (e.rv = Pe, H === null && i !== null && i[V] === e ? V++ : H === null ? H = [e] : H.push(e));
      else {
        (E.deps ?? (E.deps = [])).push(e);
        var s = e.reactions;
        s === null ? e.reactions = [E] : ft.call(s, E) || s.push(E);
      }
    }
  }
  if (Ye && qe.has(e))
    return qe.get(e);
  if (n) {
    var o = (
      /** @type {Derived} */
      e
    );
    if (Ye) {
      var l = o.v;
      return (!(o.f & M) && o.reactions !== null || Yr(o)) && (l = Nn(o)), qe.set(o, l), l;
    }
    var a = (o.f & Q) === 0 && !re && E !== null && (Bt || (E.f & Q) !== 0), f = (o.f & ct) === 0;
    It(o) && (a && (o.f |= Q), yr(o)), a && !f && (Er(o), Vr(o));
  }
  if (ne?.has(e))
    return ne.get(e);
  if (e.f & Ce)
    throw e.v;
  return e.v;
}
function Vr(e) {
  if (e.f |= Q, e.deps !== null)
    for (const t of e.deps)
      (t.reactions ?? (t.reactions = [])).push(e), t.f & L && !(t.f & Q) && (Er(
        /** @type {Derived} */
        t
      ), Vr(
        /** @type {Derived} */
        t
      ));
}
function Yr(e) {
  if (e.v === P) return !0;
  if (e.deps === null) return !1;
  for (const t of e.deps)
    if (qe.has(t) || t.f & L && Yr(
      /** @type {Derived} */
      t
    ))
      return !0;
  return !1;
}
function jr(e) {
  var t = re;
  try {
    return re = !0, e();
  } finally {
    re = t;
  }
}
const ls = ["touchstart", "touchmove"];
function fs(e) {
  return ls.includes(e);
}
const Re = Symbol("events"), Gr = /* @__PURE__ */ new Set(), bn = /* @__PURE__ */ new Set();
function Vn(e, t, n) {
  (t[Re] ?? (t[Re] = {}))[e] = n;
}
function os(e) {
  for (var t = 0; t < e.length; t++)
    Gr.add(e[t]);
  for (var n of bn)
    n(e);
}
let Yn = null;
function jn(e) {
  var t = this, n = (
    /** @type {Node} */
    t.ownerDocument
  ), r = e.type, i = e.composedPath?.() || [], s = (
    /** @type {null | Element} */
    i[0] || e.target
  );
  Yn = e;
  var o = 0, l = Yn === e && e[Re];
  if (l) {
    var a = i.indexOf(l);
    if (a !== -1 && (t === document || t === /** @type {any} */
    window)) {
      e[Re] = t;
      return;
    }
    var f = i.indexOf(t);
    if (f === -1)
      return;
    a <= f && (o = a);
  }
  if (s = /** @type {Element} */
  i[o] || e.target, s !== t) {
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
          var b = s[Re]?.[r];
          b != null && (!/** @type {any} */
          s.disabled || // DOM could've been updated already by the time this is reached, so we check this as well
          // -> the target could not have been disabled because it emits the event in the first place
          e.target === s) && b.call(s, e);
        } catch (x) {
          h ? _.push(x) : h = x;
        }
        if (e.cancelBubble || d === t || d === null)
          break;
        s = d;
      }
      if (h) {
        for (let x of _)
          queueMicrotask(() => {
            throw x;
          });
        throw h;
      }
    } finally {
      e[Re] = t, delete e.currentTarget, ee(v), _e(c);
    }
  }
}
const us = (
  // We gotta write it like this because after downleveling the pure comment may end up in the wrong location
  globalThis?.window?.trustedTypes && /* @__PURE__ */ globalThis.window.trustedTypes.createPolicy("svelte-trusted-html", {
    /** @param {string} html */
    createHTML: (e) => e
  })
);
function as(e) {
  return (
    /** @type {string} */
    us?.createHTML(e) ?? e
  );
}
function cs(e) {
  var t = Zi("template");
  return t.innerHTML = as(e.replaceAll("<!>", "<!---->")), t.content;
}
function ds(e, t) {
  var n = (
    /** @type {Effect} */
    S
  );
  n.nodes === null && (n.nodes = { start: e, end: t, a: null, t: null });
}
// @__NO_SIDE_EFFECTS__
function en(e, t) {
  var n = (t & yi) !== 0, r, i = !e.startsWith("<!>");
  return () => {
    r === void 0 && (r = cs(i ? e : "<!>" + e), r = /** @type {TemplateNode} */
    /* @__PURE__ */ Cr(r));
    var s = (
      /** @type {TemplateNode} */
      n || xr ? document.importNode(r, !0) : r.cloneNode(!0)
    );
    return ds(s, s), s;
  };
}
function Rt(e, t) {
  e !== null && e.before(
    /** @type {Node} */
    t
  );
}
function Me(e, t) {
  var n = t == null ? "" : typeof t == "object" ? `${t}` : t;
  n !== /** @type {any} */
  (e[pt] ?? (e[pt] = e.nodeValue)) && (e[pt] = n, e.nodeValue = `${n}`);
}
function hs(e, t) {
  return vs(e, t);
}
const Ft = /* @__PURE__ */ new Map();
function vs(e, { target: t, anchor: n, props: r = {}, events: i, context: s, intro: o = !0, transformError: l }) {
  Gi();
  var a = void 0, f = Xi(() => {
    var v = n ?? t.appendChild(Et());
    Ri(
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
          var x = fs(b);
          for (const B of [t, document]) {
            var D = Ft.get(B);
            D === void 0 && (D = /* @__PURE__ */ new Map(), Ft.set(B, D));
            var k = D.get(b);
            k === void 0 ? (B.addEventListener(b, jn, { passive: x }), D.set(b, 1)) : D.set(b, k + 1);
          }
        }
      }
    };
    return h(Zt(Gr)), bn.add(h), () => {
      for (var _ of c)
        for (const x of [t, document]) {
          var d = (
            /** @type {Map<string, number>} */
            Ft.get(x)
          ), b = (
            /** @type {number} */
            d.get(_)
          );
          --b == 0 ? (x.removeEventListener(_, jn), d.delete(_), d.size === 0 && Ft.delete(x)) : d.set(_, b);
        }
      bn.delete(h), v !== n && v.parentNode?.removeChild(v);
    };
  });
  return yn.set(a, f), a;
}
let yn = /* @__PURE__ */ new WeakMap();
function _s(e, t) {
  const n = yn.get(e);
  return n ? (yn.delete(e), n(t)) : Promise.resolve();
}
function ps(e, t) {
  return t;
}
function gs(e, t, n) {
  for (var r = [], i = t.length, s, o = t.length, l = 0; l < i; l++) {
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
          o -= 1;
      },
      !1
    );
  }
  if (o === 0) {
    var a = r.length === 0 && n !== null;
    if (a) {
      var f = (
        /** @type {Element} */
        n
      ), v = (
        /** @type {Element} */
        f.parentNode
      );
      Ki(v), v.append(f), e.items.clear();
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
    for (const o of e.pending.values())
      for (const l of o)
        r.add(
          /** @type {EachItem} */
          e.items.get(l).e
        );
  }
  for (var i = 0; i < t.length; i++) {
    var s = t[i];
    if (r?.has(s)) {
      s.f |= be;
      const o = document.createDocumentFragment();
      $r(s, o);
    } else
      se(t[i], n);
  }
}
var Gn;
function Kn(e, t, n, r, i, s = null) {
  var o = e, l = /* @__PURE__ */ new Map();
  {
    var a = (
      /** @type {Element} */
      e
    );
    o = a.appendChild(Et());
  }
  var f = null, v = /* @__PURE__ */ zi(() => {
    var k = n();
    return Xn(k) ? k : k == null ? [] : Zt(k);
  }), c, h = /* @__PURE__ */ new Map(), _ = !0;
  function d(k) {
    D.effect.f & ie || (D.pending.delete(k), D.fallback = f, ws(D, c, o, t, r), f !== null && (c.length === 0 ? f.f & be ? (f.f ^= be, mt(f, null, o)) : Fr(f) : Xe(f, () => {
      f = null;
    })));
  }
  function b(k) {
    D.pending.delete(k);
  }
  var x = Or(() => {
    c = /** @type {V[]} */
    I(v);
    for (var k = c.length, B = /* @__PURE__ */ new Set(), G = (
      /** @type {Batch} */
      T
    ), fe = Wi(), oe = 0; oe < k; oe += 1) {
      var w = c[oe], g = r(w, oe), C = _ ? null : l.get(g);
      C ? (C.v && ut(C.v, w), C.i && ut(C.i, oe), fe && G.unskip_effect(C.e)) : (C = ms(
        l,
        _ ? o : Gn ?? (Gn = Et()),
        w,
        g,
        oe,
        i,
        t,
        n
      ), _ || (C.e.f |= be), l.set(g, C)), B.add(g);
    }
    if (k === 0 && s && !f && (_ ? f = ae(() => s(o)) : (f = ae(() => s(Gn ?? (Gn = Et()))), f.f |= be)), k > B.size && di(), !_)
      if (h.set(G, B), fe) {
        for (const [R, Oe] of l)
          B.has(R) || G.skip_effect(Oe.e);
        G.oncommit(d), G.ondiscard(b);
      } else
        d(G);
    I(v);
  }), D = { effect: x, items: l, pending: h, outrogroups: null, fallback: f };
  _ = !1;
}
function _t(e) {
  for (; e !== null && !(e.f & he); )
    e = e.next;
  return e;
}
function ws(e, t, n, r, i) {
  var s = t.length, o = e.items, l = _t(e.effect.first), a, f = null, v = [], c = [], h, _, d, b;
  for (b = 0; b < s; b += 1) {
    if (h = t[b], _ = i(h, b), d = /** @type {EachItem} */
    o.get(_).e, e.outrogroups !== null)
      for (const g of e.outrogroups)
        g.pending.delete(d), g.done.delete(d);
    if (d.f & U && Fr(d), d.f & be)
      if (d.f ^= be, d === l)
        mt(d, null, n);
      else {
        var x = f ? f.next : l;
        d === e.effect.last && (e.effect.last = d.prev), d.prev && (d.prev.next = d.next), d.next && (d.next.prev = d.prev), Se(e, f, d), Se(e, d, x), mt(d, x, n), f = d, v = [], c = [], l = _t(f.next);
        continue;
      }
    if (d !== l) {
      if (a !== void 0 && a.has(d)) {
        if (v.length < c.length) {
          var D = c[0], k;
          f = D.prev;
          var B = v[0], G = v[v.length - 1];
          for (k = 0; k < v.length; k += 1)
            mt(v[k], D, n);
          for (k = 0; k < c.length; k += 1)
            a.delete(c[k]);
          Se(e, B.prev, G.next), Se(e, f, B), Se(e, G, D), l = D, f = G, b -= 1, v = [], c = [];
        } else
          a.delete(d), mt(d, l, n), Se(e, d.prev, d.next), Se(e, d, f === null ? e.effect.first : f.next), Se(e, f, d), f = d;
        continue;
      }
      for (v = [], c = []; l !== null && l !== d; )
        (a ?? (a = /* @__PURE__ */ new Set())).add(l), c.push(l), l = _t(l.next);
      if (l === null)
        continue;
    }
    d.f & be || v.push(d), f = d, l = _t(d.next);
  }
  if (e.outrogroups !== null) {
    for (const g of e.outrogroups)
      g.pending.size === 0 && (En(e, Zt(g.done)), e.outrogroups?.delete(g));
    e.outrogroups.size === 0 && (e.outrogroups = null);
  }
  if (l !== null || a !== void 0) {
    var fe = [];
    if (a !== void 0)
      for (d of a)
        d.f & U || fe.push(d);
    for (; l !== null; )
      !(l.f & U) && l !== e.fallback && fe.push(l), l = _t(l.next);
    var oe = fe.length;
    if (oe > 0) {
      var w = s === 0 ? n : null;
      gs(e, fe, w);
    }
  }
}
function ms(e, t, n, r, i, s, o, l) {
  var a = o & wi ? o & bi ? Ve(n) : /* @__PURE__ */ kr(n, !1, !1) : null, f = o & mi ? Ve(i) : null;
  return {
    v: a,
    i: f,
    e: ae(() => (s(t, a ?? n, f ?? i, l), () => {
      e.delete(r);
    }))
  };
}
function mt(e, t, n) {
  if (e.nodes)
    for (var r = e.nodes.start, i = e.nodes.end, s = t && !(t.f & be) ? (
      /** @type {EffectNodes} */
      t.nodes.start
    ) : n; r !== null; ) {
      var o = (
        /** @type {TemplateNode} */
        /* @__PURE__ */ Xt(r)
      );
      if (s.before(r), r === i)
        return;
      r = o;
    }
}
function Se(e, t, n) {
  t === null ? e.effect.first = n : t.next = n, n === null ? e.effect.last = t : n.prev = t;
}
const Wn = [...` 	
\r\f \v\uFEFF`];
function bs(e, t, n) {
  var r = "" + e;
  if (n) {
    for (var i of Object.keys(n))
      if (n[i])
        r = r ? r + " " + i : i;
      else if (r.length)
        for (var s = i.length, o = 0; (o = r.indexOf(i, o)) >= 0; ) {
          var l = o + s;
          (o === 0 || Wn.includes(r[o - 1])) && (l === r.length || Wn.includes(r[l])) ? r = (o === 0 ? "" : r.substring(0, o)) + r.substring(l + 1) : o = l;
        }
  }
  return r === "" ? null : r;
}
function ys(e, t, n, r, i, s) {
  var o = (
    /** @type {any} */
    e[an]
  );
  if (o !== n || o === void 0) {
    var l = bs(n, r, s);
    l == null ? e.removeAttribute("class") : e.className = l, e[an] = n;
  } else if (s && i !== s)
    for (var a in s) {
      var f = !!s[a];
      (i == null || f !== !!i[a]) && e.classList.toggle(a, f);
    }
  return s;
}
const Es = Symbol("is custom element"), Ss = Symbol("is html");
function ks(e, t, n, r) {
  var i = As(e);
  i[t] !== (i[t] = n) && (n == null ? e.removeAttribute(t) : typeof n != "string" && xs(e).includes(t) ? e[t] = n : e.setAttribute(t, n));
}
function As(e) {
  return (
    /** @type {Record<string | symbol, unknown>} **/
    /** @type {any} */
    e[Lt] ?? (e[Lt] = {
      [Es]: e.nodeName.includes("-"),
      [Ss]: e.namespaceURI === sr
    })
  );
}
var Zn = /* @__PURE__ */ new Map();
function xs(e) {
  var t = e.getAttribute("is") || e.nodeName, n = Zn.get(t);
  if (n) return n;
  Zn.set(t, n = []);
  for (var r, i = e, s = Element.prototype; s !== i; ) {
    r = si(i);
    for (var o in r)
      r[o].set && // better safe than sorry, we don't want spread attributes to mess with HTML content
      o !== "innerHTML" && o !== "textContent" && o !== "innerText" && n.push(o);
    i = tr(i);
  }
  return n;
}
const Ts = "5";
var Qn;
typeof window < "u" && ((Qn = window.__svelte ?? (window.__svelte = {})).v ?? (Qn.v = /* @__PURE__ */ new Set())).add(Ts);
function Pn(e, t, n) {
  const r = Tn(n ?? t());
  return typeof window < "u" && window.AtelierAPI.events.on(e, () => r.set(t())), { subscribe: r.subscribe };
}
const Ds = Pn(
  window.AtelierAPI.events.COURSES_UPDATED,
  () => window.AtelierAPI.state.getCourses(),
  []
), Cs = Pn(
  window.AtelierAPI.events.LESSONS_UPDATED,
  () => window.AtelierAPI.state.getUpcomingLessons(),
  []
), Kr = Pn(
  window.AtelierAPI.events.LANG_CHANGED,
  () => window.AtelierAPI.i18n.getLang(),
  typeof window < "u" ? window.AtelierAPI.i18n.getLang() : "cs"
), Is = Ti(Kr, () => (e, t) => window.AtelierAPI.i18n.t(e, t));
function Ns() {
  const e = /* @__PURE__ */ new Date(), t = e.getFullYear(), n = String(e.getMonth() + 1).padStart(2, "0"), r = String(e.getDate()).padStart(2, "0");
  return `${t}-${n}-${r}`;
}
const Jn = Tn(Ns());
var Os = /* @__PURE__ */ en('<button type="button"> </button>'), Ms = /* @__PURE__ */ en('<li class="cal-island__item svelte-fu56mo"><div class="cal-island__title svelte-fu56mo"> </div> <div class="cal-island__time svelte-fu56mo"> </div> <div class="cal-island__spots svelte-fu56mo" aria-hidden="true"> </div> <button type="button" class="cal-island__book svelte-fu56mo"> </button></li>'), Ps = /* @__PURE__ */ en('<li class="cal-island__empty svelte-fu56mo"> </li>'), Rs = /* @__PURE__ */ en('<section class="cal-island svelte-fu56mo"><header class="cal-island__head svelte-fu56mo"><strong> </strong></header> <nav class="cal-island__days svelte-fu56mo" aria-label="day picker"></nav> <ul class="cal-island__list svelte-fu56mo"></ul></section>');
function Fs(e, t) {
  ur(t, !0);
  const n = () => ht(Cs, "$upcomingLessons", l), r = () => ht(Jn, "$selectedDay", l), i = () => ht(Ds, "$courses", l), s = () => ht(Kr, "$lang", l), o = () => ht(Is, "$tt", l), [l, a] = Ci();
  function f(w) {
    const g = w.getFullYear(), C = String(w.getMonth() + 1).padStart(2, "0"), R = String(w.getDate()).padStart(2, "0");
    return `${g}-${C}-${R}`;
  }
  const v = /* @__PURE__ */ Mt(() => {
    const w = [], g = /* @__PURE__ */ new Date();
    g.setHours(0, 0, 0, 0);
    for (let C = 0; C < 14; C++) {
      const R = new Date(g);
      R.setDate(R.getDate() + C), w.push(R);
    }
    return w;
  }), c = /* @__PURE__ */ Mt(() => n().filter((w) => f(new Date(w.start_time)) === r()));
  function h(w) {
    return i().find((g) => g.id === w);
  }
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
  function x(w) {
    const g = h(w.course_id);
    g && window.AtelierAPI.actions.openBookingPopup(g.id, null, w.lesson_id);
  }
  var D = Rs(), k = ue(D), B = ue(k), G = ue(B), fe = vt(k, 2);
  Kn(fe, 21, () => I(v), ps, (w, g) => {
    const C = /* @__PURE__ */ Mt(() => f(I(g)));
    var R = Os();
    let Oe;
    var tn = ue(R);
    Pt(
      (Nt) => {
        Oe = ys(R, 1, "cal-island__day svelte-fu56mo", null, Oe, { active: I(C) === r() }), Me(tn, Nt);
      },
      [() => b(I(g))]
    ), Vn("click", R, () => Jn.set(I(C))), Rt(w, R);
  });
  var oe = vt(fe, 2);
  Kn(
    oe,
    21,
    () => I(c),
    (w) => w.lesson_id,
    (w, g) => {
      const C = /* @__PURE__ */ Mt(() => h(I(g).course_id));
      var R = Ms(), Oe = ue(R), tn = ue(Oe), Nt = vt(Oe, 2), Wr = ue(Nt), Rn = vt(Nt, 2), Zr = ue(Rn), nn = vt(Rn, 2), Jr = ue(nn);
      Pt(
        (Qr, Xr, ei, ti) => {
          Me(tn, Qr), Me(Wr, `${Xr ?? ""}–${ei ?? ""}`), Me(Zr, I(g).available_spots), nn.disabled = I(g).available_spots <= 0, Me(Jr, ti);
        },
        [
          () => _(I(C)?.title),
          () => d(I(g).start_time),
          () => d(I(g).end_time),
          () => I(g).available_spots > 0 ? o()("booking.btn.book") : o()("common.full")
        ]
      ), Vn("click", nn, () => x(I(g))), Rt(w, R);
    },
    (w) => {
      var g = Ps(), C = ue(g);
      Pt((R) => Me(C, R), [() => o()("booking.empty.noScheduledSessions")]), Rt(w, g);
    }
  ), Pt(
    (w, g) => {
      ks(D, "aria-label", w), Me(G, g);
    },
    [() => o()("nav.calendar"), () => o()("nav.calendar")]
  ), Rt(e, D), ar(), a();
}
os(["click"]);
const Ls = {
  calendar: Fs
}, Gt = /* @__PURE__ */ new Map();
function on(e, t, n = {}) {
  if (!t) return null;
  const r = Gt.get(t);
  if (r && r.name === e) return r.component;
  r && Sn(t);
  const i = Ls[e];
  if (!i)
    return console.warn("[svelte-islands] Unknown island:", e), null;
  const s = hs(i, { target: t, props: n });
  return Gt.set(t, { component: s, name: e }), s;
}
function Sn(e) {
  const t = Gt.get(e);
  t && (_s(t.component), Gt.delete(e));
}
if (typeof window < "u" && (window.AtelierSvelte = { mount: on, unmount: Sn }, window.__appNavHooks = window.__appNavHooks ?? [], window.__appNavHooks.push((t) => {
  const n = document.getElementById("calendar-root");
  if (!n) return;
  const r = window.__features?.svelteCalendar === !0;
  t === "kalendar" && r ? on("calendar", n) : Sn(n);
}), document.querySelector("#screen-kalendar.active") && window.__features?.svelteCalendar)) {
  const t = document.getElementById("calendar-root");
  t && on("calendar", t);
}
//# sourceMappingURL=atelier-svelte.js.map
