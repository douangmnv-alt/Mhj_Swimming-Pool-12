/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Firebase initialization for Mahajuen POS.
 * - Firestore is the cloud source of truth (named database "mahajuen-swimming-pool").
 * - persistentLocalCache gives full offline support: reads come from the local
 *   cache and writes are queued and re-sent automatically when back online.
 * - The device is activated once with the shop's email/password account; rules
 *   only accept that account. App Check (reCAPTCHA v3) blocks non-app clients.
 */

import { initializeApp } from "firebase/app";
import { initializeAppCheck, ReCaptchaV3Provider } from "firebase/app-check";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  User as FirebaseUser,
} from "firebase/auth";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from "firebase/firestore";

// Public web-app config (safe to ship in client code; access is controlled
// by Firestore security rules, not by this config).
const firebaseConfig = {
  apiKey: "AIzaSyCUqox56fuaw3b4kWnE_T7VEvfb1YuDSFU",
  authDomain: "gen-lang-client-0887400142.firebaseapp.com",
  projectId: "gen-lang-client-0887400142",
  storageBucket: "gen-lang-client-0887400142.firebasestorage.app",
  messagingSenderId: "979114595732",
  appId: "1:979114595732:web:d5ae17dd895e03a6662b81",
  measurementId: "G-YHPV1P3QVR",
};

/** Every document of this shop lives under shops/{SHOP_ID}/... */
export const SHOP_ID = "mahajuen-pos";

/** Named Firestore database dedicated to this app (Standard edition, asia-southeast3). */
export const DATABASE_ID = "mahajuen-swimming-pool";

export const firebaseApp = initializeApp(firebaseConfig);

// App Check (reCAPTCHA v3): proves each request comes from the genuine
// Mahajuen app, blocking scripts/bots/stolen configs before Firestore rules
// even run. The site key is public. Only works on domains registered with
// the reCAPTCHA key (the published *.run.app URL and localhost).
initializeAppCheck(firebaseApp, {
  provider: new ReCaptchaV3Provider("6Lc830EtAAAAABgQBXdUJIgWcxEPUIe9X5GLqtJE"),
  isTokenAutoRefreshEnabled: true,
});

export const firestore = initializeFirestore(
  firebaseApp,
  {
    localCache: persistentLocalCache({
      tabManager: persistentMultipleTabManager(),
    }),
  },
  DATABASE_ID
);

export const auth = getAuth(firebaseApp);

/**
 * Device activation: the shop owner signs this device in ONCE with the
 * shop's Firebase email + password. The session persists across restarts
 * (works offline afterwards), and Firestore security rules only accept
 * requests from this account — so having a copy of the app is useless
 * without the shop password.
 */
export const activateDevice = (email: string, password: string) =>
  signInWithEmailAndPassword(auth, email.trim(), password);

export const deactivateDevice = () => signOut(auth);

/**
 * Notifies about the device activation state. Old anonymous sessions
 * (from the previous version of the app) are signed out automatically so
 * the activation screen appears.
 */
export const onShopAuthChanged = (cb: (user: FirebaseUser | null) => void) =>
  onAuthStateChanged(auth, (user) => {
    if (user && user.isAnonymous) {
      signOut(auth).catch(() => {});
      cb(null);
      return;
    }
    cb(user);
  });
