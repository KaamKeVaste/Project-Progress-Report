import crypto from "node:crypto";
import { getStore } from "@netlify/blobs";

let factory = (name) => getStore({ name, consistency: "strong" });
export function setStoreFactory(f) { factory = f; } // used by the automated tests only
export const snaps = () => factory("snapshots");
export const locks = () => factory("locks");
export const auditStore = () => factory("audit");
export const registryStore = () => factory("projects"); // projects added on the /admin page

export async function audit(type, data = {}) {
  try {
    await auditStore().setJSON(`${new Date().toISOString()}-${crypto.randomUUID().slice(0, 8)}`, { type, ...data });
  } catch { /* auditing must never break a request */ }
}
