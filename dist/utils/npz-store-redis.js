// ROME-TAG: 0xC27F4F
// Redis implementation removed - use in-memory fallback to avoid external dependency.
import { v4 as uuidv4 } from 'uuid';
import { getNpzNamespace } from './npz-config.js';
// NOTE: this module intentionally does NOT depend on ioredis anymore.
// It exposes the same async API but stores data in memory with TTL semantics.
const NS = getNpzNamespace();
const store = new Map();
function nowMs() { return Date.now(); }
export async function createRecord(meta) {
    const id = uuidv4();
    const rec = { id, ts: nowMs(), meta };
    // default TTL 24h
    const expiresAt = nowMs() + 24 * 3600 * 1000;
    store.set(id, Object.assign({}, rec, { expiresAt }));
    return rec;
}
export async function updateRecord(id, patch) {
    const entry = store.get(id);
    if (!entry)
        return null;
    const updated = Object.assign({}, entry, patch);
    store.set(id, updated);
    // return shallow copy
    const copy = Object.assign({}, updated);
    delete copy.expiresAt;
    return copy;
}
export async function getRecord(id) {
    const entry = store.get(id);
    if (!entry)
        return null;
    if (entry.expiresAt && entry.expiresAt < nowMs()) {
        store.delete(id);
        return null;
    }
    const copy = Object.assign({}, entry);
    delete copy.expiresAt;
    return copy;
}
export async function deleteRecord(id) {
    return store.delete(id);
}
export async function listRecords() {
    const now = nowMs();
    const res = [];
    for (const [k, v] of store.entries()) {
        if (v.expiresAt && v.expiresAt < now) {
            store.delete(k);
            continue;
        }
        const copy = Object.assign({}, v);
        delete copy.expiresAt;
        res.push(copy);
    }
    return res;
}
export async function clearAll() {
    const n = store.size;
    store.clear();
    return n;
}
// helper: not part of original API but useful for tests
export function __internal_size() { return store.size; }
