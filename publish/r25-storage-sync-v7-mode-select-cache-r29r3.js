window.GameModules = window.GameModules || {};
window.GameModules.storageSync = (() => {
  const warned = {}, pendingCloud = new Set(), cloudReadFailures = new Map();
  let readQueue = Promise.resolve();
  let localFallbackAllowed = false;
  const bootAt = Date.now(), BOOT_GRACE_MS = 9000;
  const wait = ms => new Promise(r => setTimeout(r, ms));
  function now() { return Date.now(); }
  function stamp(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
    return { ...value, updatedAt: now() };
  }
  function timeOf(value) {
    const t = Number(value?.updatedAt || value?.savedAt || value?.at || 0);
    return Number.isFinite(t) ? t : 0;
  }
  function newer(a, b) {
    if (a == null) return b ?? null;
    if (b == null) return a;
    return timeOf(b) > timeOf(a) ? b : a;
  }
  function localGet(key) { try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null; } catch (_) { return null; } }
  function localPut(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) {} }
  function localRemove(key) { try { localStorage.removeItem(key); } catch (_) {} }
  function inBootGrace() { return now() - bootAt < BOOT_GRACE_MS; }
  function readTimeout(local) { return inBootGrace() ? (local ? 6200 : 7600) : (local ? 3600 : 4800); }
  function writeTimeout() { return inBootGrace() ? 6800 : 4600; }
  function warn(scope, text, e) {
    if (!warned[scope]) {
      warned[scope] = true;
      window.dzmm?.toast?.warning?.(text);
    }
    if (e) console.warn(text + ':', e.code, e.message);
  }
  function quietWarn(text, e) { if (e) console.warn(text + ':', e.code, e.message); }
  function err(code, message) { const e = new Error(message); e.code = code; return e; }
  function withTimeout(task, ms = 2800) {
    if (!task || typeof task.then !== 'function') return Promise.reject(err('CLOUD_UNAVAILABLE', '云端存档接口尚未就绪'));
    return Promise.race([
      task,
      new Promise((_, reject) => setTimeout(() => reject(err('CLOUD_TIMEOUT', '云端请求超时')), ms))
    ]);
  }
  async function cloudApi(ms = 3200) {
    const end = now() + ms;
    while (now() < end) {
      const kv = window.dzmm?.kv;
      if (kv?.get && kv?.put) return kv;
      await wait(120);
    }
    throw err('CLOUD_UNAVAILABLE', '云端存档接口尚未就绪');
  }
  async function cloudGet(key, timeout) {
    const kv = await cloudApi(timeout);
    try {
      return (await withTimeout(kv.get(key), timeout))?.value ?? null;
    } catch (e) {
      if (isMissingKey(e)) return null;
      throw e;
    }
  }
  function markPending(key, e) { pendingCloud.add(key); cloudReadFailures.set(key, { code: e?.code || 'CLOUD_ERROR', message: e?.message || '云端读取失败', at: now() }); }
  function clearPending(key) { pendingCloud.delete(key); cloudReadFailures.delete(key); }
  function isMissingKey(e) {
    const c = String(e?.code || e?.rawCode || e?.name || '').toUpperCase();
    const status = Number(e?.status || e?.statusCode || e?.response?.status || 0);
    const msg = String(e?.message || '').toLowerCase();
    return status === 404 || c === 'KEY_NOT_FOUND' || c === 'NOT_FOUND' || c === 'KEY_NOT_EXIST' || c === 'NOT_EXISTS' || msg.includes('key not found') || msg.includes('not found') || msg.includes('不存在') || msg.includes('未找到');
  }
  function cloudFailure(key) { return cloudReadFailures.get(key) || null; }
  async function ready(ms = 18000) {
    const deadline = now() + Math.max(ms, 18000);
    let last = null;
    while (now() < deadline) {
      try {
        await cloudGet('__arcane_kv_probe__', Math.min(6800, Math.max(1200, deadline - now())));
        return true;
      } catch (e) {
        last = e;
        await wait(420);
      }
    }
    throw err('CLOUD_COLD_START_TIMEOUT', last?.message || '云端存档连接超时，请刷新重试');
  }
  async function getLocalFallback(key) { return localGet(key); }
  async function readCloudWithRetry(key, local) {
    let cloud = null, last = null;
    const tries = local ? 2 : 3;
    for (let i = 0; i < tries; i++) {
      try {
        cloud = await cloudGet(key, readTimeout(local));
        clearPending(key);
        if (cloud != null) localPut(key, cloud);
        return cloud;
      } catch (e) {
        if (isMissingKey(e)) {
          clearPending(key);
          return null;
        }
        last = e;
        if (i < tries - 1) await wait(360 * (i + 1));
      }
    }
    markPending(key, last);
    quietWarn('云端读取失败，已阻止关键数据写入，请重试或显式使用本机备份', last);
    if (!localFallbackAllowed) throw err('CLOUD_READ_BLOCKED', '云端存档读取失败，请重试；不要在空进度下继续写入覆盖云端');
    return local;
  }
  async function get(key) {
    const local = localGet(key);
    if (localFallbackAllowed && local != null) return local;
    const run = () => readCloudWithRetry(key, local);
    const next = readQueue.then(run, run);
    readQueue = next.catch(() => {});
    return await next;
  }
  async function put(key, value, label = '数据') {
    const data = stamp(value);
    if (pendingCloud.has(key)) {
      try {
        const existing = await cloudGet(key, writeTimeout());
        clearPending(key);
        const best = newer(existing, data);
        if (best && best !== data) {
          localPut(key, best);
          return best;
        }
      } catch (e) {
        localPut(key, data);
        warn(key + ':pending', `${label}云端尚未确认，已先暂存本机`, e);
        return data;
      }
    }
    try {
      const ms = writeTimeout();
      const kv = await cloudApi(ms);
      await withTimeout(kv.put(key, data), ms);
      clearPending(key);
      localPut(key, data);
    } catch (e) {
      localPut(key, data);
      warn(key, `${label}云端保存失败，已暂存本机`, e);
    }
    return data;
  }
  async function remove(key, label = '数据') {
    localRemove(key);
    try {
      const ms = writeTimeout();
      const kv = await cloudApi(ms);
      await withTimeout(kv.delete?.(key), ms);
    } catch (e) { warn(key + ':delete', `${label}云端删除失败`, e); }
  }
  function allowLocalFallback(v = true) { localFallbackAllowed = !!v; }
  return { get, put, remove, localGet, localPut, getLocalFallback, allowLocalFallback, newer, stamp, ready, cloudFailure, hasPending: key => pendingCloud.has(key) };
})();
window.StorageSync = window.GameModules.storageSync;
