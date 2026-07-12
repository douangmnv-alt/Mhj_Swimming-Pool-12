/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Staff PIN hashing. PINs are stored as salted SHA-256 hashes instead of
 * plain text, so nobody browsing the database or device storage can read
 * them. (A 4-digit PIN can still be brute-forced by a determined attacker —
 * this protects against casual reading, not cryptographic attack.)
 */

import { User } from "../types";

const APP_SALT = "mahajuen-pos-v1";

export const hashPin = async (username: string, pin: string): Promise<string> => {
  const data = new TextEncoder().encode(`${APP_SALT}::${username.toLowerCase()}::${pin}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
};

/**
 * Verify a PIN against a user record. Supports legacy plain-text records:
 * when a legacy record matches, `migrated` contains the upgraded (hashed)
 * user object that the caller should persist.
 */
export const verifyPin = async (
  user: User,
  pin: string
): Promise<{ ok: boolean; migrated?: User }> => {
  if (user.passwordHash) {
    return { ok: (await hashPin(user.username, pin)) === user.passwordHash };
  }
  if (user.password !== undefined) {
    if (user.password === pin) {
      const migrated: User = { ...user, passwordHash: await hashPin(user.username, pin) };
      delete migrated.password;
      return { ok: true, migrated };
    }
    return { ok: false };
  }
  return { ok: false };
};
