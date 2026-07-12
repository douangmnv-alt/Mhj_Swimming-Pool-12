/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Cloud sync engine: mirrors the localStorage data layer (utils/db.ts)
 * into Firestore under shops/{SHOP_ID}/...
 *
 * Architecture
 * ────────────
 *  - localStorage stays the synchronous working copy: the POS always reads
 *    and writes it instantly, online or offline.
 *  - Firestore is the cloud source of truth. Every collection is mirrored:
 *      menu_items, sales (items embedded), stock_logs, pending_orders,
 *      quotations (items embedded), users, and the settings document.
 *  - PULL: onSnapshot listeners keep localStorage up to date in real time
 *    (this also brings all data to a brand-new device).
 *  - PUSH: db.ts calls notifyLocalWrite(lsKey) after each write; a debounced
 *    diff computes which documents changed and writes only those (batched).
 *  - OFFLINE: the Firestore SDK persistent cache queues writes and replays
 *    them automatically when the connection returns. The app itself never
 *    blocks on the network.
 *  - FIRST RUN: Firestore wins. Stale localStorage must never resurrect old
 *    cloud records. Only explicit local app writes are pushed to Firestore.
 *  - DELETE: cache cleanup is local-only. Firestore deletes are sent only when
 *    db.ts marks a real user/staff delete action with notifyLocalDelete(...).
 */

import {
  collection,
  doc,
  onSnapshot,
  setDoc,
  writeBatch,
} from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { auth, firestore, SHOP_ID } from "../firebase";

// ── Collection mapping ────────────────────────────────────────────────

type Row = { [key: string]: any };

interface CollectionSpec {
  /** Firestore sub-collection name under shops/{SHOP_ID}/ */
  coll: string;
  /** primary localStorage key holding the array */
  lsKey: string;
  /** field used as document id (uid is preferred when present) */
  idField: string;
  /** optional child rows embedded into the parent document as `items` */
  embed?: { lsKey: string; foreignKey: string };
}

const SPECS: CollectionSpec[] = [
  { coll: "menu_items", lsKey: "saletracker_menu_items", idField: "id" },
  {
    coll: "sales",
    lsKey: "saletracker_sales",
    idField: "id",
    embed: { lsKey: "saletracker_sale_items", foreignKey: "saleId" },
  },
  { coll: "stock_logs", lsKey: "saletracker_stock_logs", idField: "id" },
  { coll: "pending_orders", lsKey: "saletracker_pending_orders", idField: "id" },
  {
    coll: "quotations",
    lsKey: "saletracker_quotations",
    idField: "id",
    embed: { lsKey: "saletracker_quotation_items", foreignKey: "quotationId" },
  },
  { coll: "users", lsKey: "saletracker_users", idField: "username" },
  { coll: "members", lsKey: "saletracker_members", idField: "id" },
  { coll: "member_point_logs", lsKey: "saletracker_member_point_logs", idField: "id" },
];

const SETTINGS_LS_KEY = "saletracker_settings";

/** lsKey → collection spec (embedded item keys map to their parent). */
const LSKEY_TO_SPEC = new Map<string, CollectionSpec>();
SPECS.forEach((s) => {
  LSKEY_TO_SPEC.set(s.lsKey, s);
  if (s.embed) LSKEY_TO_SPEC.set(s.embed.lsKey, s);
});

// ── Status reporting ──────────────────────────────────────────────────

export interface SyncStatus {
  /** connecting = auth/first snapshot not done yet */
  state: "connecting" | "synced" | "syncing" | "offline" | "error";
  /** true while local changes are still waiting to reach the server */
  hasPendingWrites: boolean;
  lastSyncedAt: number | null;
  error?: string;
}

let status: SyncStatus = { state: "connecting", hasPendingWrites: false, lastSyncedAt: null };
const statusListeners = new Set<(s: SyncStatus) => void>();
const pendingByColl = new Map<string, boolean>();

const emitStatus = (partial: Partial<SyncStatus>) => {
  const hasPendingWrites = Array.from(pendingByColl.values()).some(Boolean);
  status = { ...status, ...partial, hasPendingWrites };
  if (partial.lastSyncedAt) status.error = undefined; // successful sync clears errors
  if (!navigator.onLine) {
    status.state = "offline";
  } else if (status.error) {
    status.state = "error";
  } else if (status.lastSyncedAt === null) {
    status.state = "connecting";
  } else {
    status.state = hasPendingWrites ? "syncing" : "synced";
  }
  statusListeners.forEach((cb) => cb(status));
};

export const getSyncStatus = (): SyncStatus => status;

export const subscribeSyncStatus = (cb: (s: SyncStatus) => void): (() => void) => {
  statusListeners.add(cb);
  cb(status);
  return () => statusListeners.delete(cb);
};

// ── Helpers ───────────────────────────────────────────────────────────

const readArray = (lsKey: string): Row[] => {
  try {
    return JSON.parse(localStorage.getItem(lsKey) || "[]");
  } catch {
    return [];
  }
};

const docKey = (spec: CollectionSpec, row: Row): string =>
  String(row.uid ?? row[spec.idField]);

const isToday = (timestamp: unknown): boolean => {
  if (typeof timestamp !== "number") return false;
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = start.getTime() + 24 * 60 * 60 * 1000;
  return timestamp >= start.getTime() && timestamp < end;
};

/** Browser-only cache protection: keep only today's active held orders. */
const docsForLocalCache = (spec: CollectionSpec, docs: Map<string, Row>): Map<string, Row> => {
  if (spec.coll !== "pending_orders") return docs;
  const filtered = new Map<string, Row>();
  docs.forEach((row, id) => {
    if (isToday(row.createdAt)) filtered.set(id, row);
  });
  return filtered;
};

/** Join parent rows with their embedded child rows into cloud documents. */
const buildDocs = (spec: CollectionSpec): Map<string, Row> => {
  const parents = readArray(spec.lsKey);
  const out = new Map<string, Row>();
  if (spec.embed) {
    const children = readArray(spec.embed.lsKey);
    const byParent = new Map<any, Row[]>();
    children.forEach((c) => {
      const k = c[spec.embed!.foreignKey];
      if (!byParent.has(k)) byParent.set(k, []);
      byParent.get(k)!.push(c);
    });
    parents.forEach((p) => {
      out.set(docKey(spec, p), { ...p, items: byParent.get(p[spec.idField]) || [] });
    });
  } else {
    parents.forEach((p) => out.set(docKey(spec, p), { ...p }));
  }
  return out;
};

/** Split cloud documents back into localStorage arrays (parent + children). */
const applyDocsToLocal = (spec: CollectionSpec, docs: Map<string, Row>) => {
  const parents: Row[] = [];
  const children: Row[] = [];
  docs.forEach((d) => {
    if (spec.embed) {
      const { items, ...parent } = d;
      parents.push(parent);
      if (Array.isArray(items)) children.push(...items);
    } else {
      parents.push({ ...d });
    }
  });
  localStorage.setItem(spec.lsKey, JSON.stringify(parents));
  if (spec.embed) localStorage.setItem(spec.embed.lsKey, JSON.stringify(children));
};

/** Firestore rejects `undefined` field values — strip them via JSON. */
const sanitize = (row: Row): Row => JSON.parse(JSON.stringify(row));

const collRef = (name: string) => collection(firestore, "shops", SHOP_ID, name);
const settingsDocRef = () => doc(firestore, "shops", SHOP_ID, "meta", "settings");

// ── Engine state ──────────────────────────────────────────────────────

let started = false;
let onRemoteChange: (() => void) | null = null;

/** last known cloud JSON per collection: coll → (docId → json string) */
const lastCloud = new Map<string, Map<string, string>>();
/** collections whose first snapshot has arrived (safe to push diffs) */
const ready = new Set<string>();
/** collections with local changes waiting to be pushed */
const dirty = new Set<string>();
/** explicit app deletes: coll -> document ids intentionally removed by staff */
const explicitDeletes = new Map<string, Set<string>>();
let settingsDirty = false;
let settingsReady = false;
let lastCloudSettings = "";

let pushTimer: number | null = null;

// ── PUSH: local → cloud ───────────────────────────────────────────────

/**
 * Called by utils/db.ts after every localStorage write.
 * Safe to call before startCloudSync — changes are queued as dirty.
 */
export const notifyLocalWrite = (lsKey: string) => {
  if (lsKey === SETTINGS_LS_KEY) {
    settingsDirty = true;
  } else {
    const spec = LSKEY_TO_SPEC.get(lsKey);
    if (!spec) return;
    dirty.add(spec.coll);
  }
  schedulePush();
};

/**
 * Called only by real app delete/remove actions. Missing rows caused by local
 * cache cleanup or Firestore snapshots must not become cloud deletes.
 */
export const notifyLocalDelete = (lsKey: string, rowOrId: Row | string | number) => {
  const spec = LSKEY_TO_SPEC.get(lsKey);
  if (!spec) return;
  const id = typeof rowOrId === "object" ? docKey(spec, rowOrId) : String(rowOrId);
  if (!id || id === "undefined") return;
  if (!explicitDeletes.has(spec.coll)) explicitDeletes.set(spec.coll, new Set<string>());
  explicitDeletes.get(spec.coll)!.add(id);
  dirty.add(spec.coll);
  schedulePush();
};

const schedulePush = () => {
  if (!started) return;
  if (pushTimer !== null) window.clearTimeout(pushTimer);
  pushTimer = window.setTimeout(() => {
    pushTimer = null;
    flushDirty().catch((err) => {
      console.error("Cloud push failed:", err);
      emitStatus({ state: "error", error: String(err?.message || err) });
    });
  }, 400);
};

const flushDirty = async () => {
  // Only push once the device is activated with the shop account.
  if (!auth.currentUser || auth.currentUser.isAnonymous) return;

  for (const spec of SPECS) {
    if (!dirty.has(spec.coll) || !ready.has(spec.coll)) continue;
    dirty.delete(spec.coll);

    const local = buildDocs(spec);
    const cloud = lastCloud.get(spec.coll) || new Map<string, string>();
    const deletesForColl = explicitDeletes.get(spec.coll) || new Set<string>();

    const writes: { id: string; data: Row }[] = [];
    const deletes: string[] = [];

    local.forEach((row, id) => {
      const json = JSON.stringify(row);
      if (cloud.get(id) !== json) writes.push({ id, data: sanitize(row) });
    });
    deletesForColl.forEach((id) => {
      if (!local.has(id)) deletes.push(id);
    });

    if (writes.length === 0 && deletes.length === 0) continue;

    // Batched writes, chunked below Firestore's 500-op limit.
    let batch = writeBatch(firestore);
    let count = 0;
    const commitIfFull = async () => {
      if (count >= 450) {
        await batch.commit().catch(() => {}); // offline: queued by SDK cache
        batch = writeBatch(firestore);
        count = 0;
      }
    };
    for (const w of writes) {
      batch.set(doc(collRef(spec.coll), w.id), { ...w.data, _updatedAt: Date.now() });
      count++;
      await commitIfFull();
    }
    for (const id of deletes) {
      batch.delete(doc(collRef(spec.coll), id));
      count++;
      await commitIfFull();
    }
    if (count > 0) {
      // With the persistent cache, commit() resolves only when the server
      // acknowledges — don't await it, the snapshot listener tracks status.
      batch.commit().catch((err) => {
        console.warn(`Cloud commit for ${spec.coll} pending/failed:`, err?.code || err);
      });
      deletes.forEach((id) => deletesForColl.delete(id));
      if (deletesForColl.size === 0) explicitDeletes.delete(spec.coll);
    }
  }

  if (settingsDirty && settingsReady) {
    settingsDirty = false;
    const raw = localStorage.getItem(SETTINGS_LS_KEY);
    if (raw && raw !== lastCloudSettings) {
      setDoc(settingsDocRef(), { ...sanitize(JSON.parse(raw)), _updatedAt: Date.now() }).catch(
        (err) => console.warn("Settings commit pending/failed:", err?.code || err)
      );
    }
  }
};

// ── PULL: cloud → local ───────────────────────────────────────────────

const startCollectionListener = (spec: CollectionSpec) => {
  onSnapshot(
    collRef(spec.coll),
    { includeMetadataChanges: true },
    (snap) => {
      const cloudDocs = new Map<string, Row>();
      snap.docs.forEach((d) => {
        const { _updatedAt, ...data } = d.data();
        cloudDocs.set(d.id, data as Row);
      });

      pendingByColl.set(spec.coll, snap.metadata.hasPendingWrites);

      // lastCloud must reflect ONLY what the server/cache really has, so the
      // push diff can detect local-only docs that still need uploading.
      const jsonMap = new Map<string, string>();
      cloudDocs.forEach((row, id) => jsonMap.set(id, JSON.stringify(row)));
      lastCloud.set(spec.coll, jsonMap);

      if (!ready.has(spec.coll)) {
        // FIRST SNAPSHOT: Firestore wins. Do not upload local-only rows from
        // stale browser storage; only explicit app writes can push changes.
        ready.add(spec.coll);
        applyDocsToLocal(spec, docsForLocalCache(spec, cloudDocs));
      } else {
        applyDocsToLocal(spec, docsForLocalCache(spec, cloudDocs));
      }

      emitStatus({ lastSyncedAt: Date.now() });
      onRemoteChange?.();
    },
    (err) => {
      console.error(`Snapshot listener for ${spec.coll} failed:`, err);
      emitStatus({ state: "error", error: err.code || String(err) });
    }
  );
};

const startSettingsListener = () => {
  onSnapshot(
    settingsDocRef(),
    { includeMetadataChanges: true },
    (snap) => {
      pendingByColl.set("meta/settings", snap.metadata.hasPendingWrites);
      if (snap.exists()) {
        const { _updatedAt, ...data } = snap.data();
        const json = JSON.stringify(data);
        lastCloudSettings = json;
        if (!settingsReady) {
          settingsReady = true;
        }
        localStorage.setItem(SETTINGS_LS_KEY, json);
      } else {
        // No cloud settings yet. Do not resurrect stale local settings; a real
        // Settings save action will call notifyLocalWrite and create the doc.
        settingsReady = true;
        lastCloudSettings = "";
        localStorage.removeItem(SETTINGS_LS_KEY);
      }
      emitStatus({ lastSyncedAt: Date.now() });
      onRemoteChange?.();
    },
    (err) => {
      console.error("Settings listener failed:", err);
      emitStatus({ state: "error", error: err.code || String(err) });
    }
  );
};

// ── Entry point ───────────────────────────────────────────────────────

/**
 * Start the sync engine. Call once at app start. Listeners only begin once
 * the device has been activated with the shop's Firebase account — until
 * then the app simply runs on local data.
 */
export const startCloudSync = (onChange?: () => void) => {
  if (started) {
    if (onChange) onRemoteChange = onChange;
    return;
  }
  started = true;
  if (onChange) onRemoteChange = onChange;

  window.addEventListener("online", () => {
    emitStatus({});
    schedulePush();
  });
  window.addEventListener("offline", () => emitStatus({}));

  let listenersStarted = false;
  onAuthStateChanged(auth, (user) => {
    if (user && !user.isAnonymous && !listenersStarted) {
      listenersStarted = true;
      SPECS.forEach(startCollectionListener);
      startSettingsListener();
      schedulePush(); // flush anything queued before activation completed
    }
  });
};
