c', table: TABLE_NAME }, payload => {
      const row = payload.new && Object.keys(payload.new).length ? payload.new : payload.old;
      if (!row || !row.key) return;
 
      if (payload.eventType === 'DELETE') {
        _cache[row.key] = deepClone(DEFAULT_VALUES[row.key] ?? null);
      } else {
        _cache[row.key] = payload.new.value;
      }
 
      // ถ้าเพิ่งเขียนคีย์นี้เองจากเครื่องนี้ไม่เกิน 2 วิ = UI แสดงข้อมูลล่าสุดอยู่แล้ว ไม่ต้อง re-render ซ้ำ
      const lastLocalWrite = _recentLocalWrites.get(row.key) || 0;
      if (Date.now() - lastLocalWrite < 2000) return;
 
      window.dispatchEvent(new CustomEvent('db:change', { detail: { key: row.key } }));
    })
    .subscribe(status => {
      window.dispatchEvent(new CustomEvent('db:realtime-status', { detail: status }));
    });
}
 
function isDbReady() { return _dbReady; }
 
// ล้างข้อมูลทั้งหมดกลับเป็นค่าเริ่มต้น แล้วเขียนทับบนคลาวด์ (ทุกเครื่องจะเห็นค่าใหม่ผ่าน Realtime)
function resetAllData() {
  SYNCED_KEYS.forEach(key => {
    const fresh = key === DB_KEYS.products ? deepClone(DEFAULT_PRODUCTS) : deepClone(DEFAULT_VALUES[key]);
    save(key, fresh);
  });
}
