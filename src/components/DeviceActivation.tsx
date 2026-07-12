/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * One-time device activation screen. The shop owner signs the device in
 * with the shop's Firebase email + password. After that the session
 * persists (works offline too) and staff only ever see the normal PIN
 * login screen.
 */

import React, { useState } from "react";
import { ShieldCheck, Loader2 } from "lucide-react";
import { activateDevice } from "../firebase";

export const DeviceActivation: React.FC = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleActivate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      setError("ກະລຸນາປ້ອນອີເມວ ແລະ ລະຫັດຜ່ານຮ້ານ");
      return;
    }
    setError("");
    setLoading(true);
    try {
      await activateDevice(email, password);
      // onShopAuthChanged in App.tsx takes over from here.
    } catch (err: any) {
      const code = err?.code || "";
      if (code === "auth/invalid-credential" || code === "auth/wrong-password" || code === "auth/user-not-found") {
        setError("ອີເມວ ຫຼື ລະຫັດຜ່ານບໍ່ຖືກຕ້ອງ");
      } else if (code === "auth/too-many-requests") {
        setError("ພະຍາຍາມຫຼາຍເກີນໄປ — ກະລຸນາລໍຖ້າຈັກໜ້ອຍແລ້ວລອງໃໝ່");
      } else if (code === "auth/network-request-failed") {
        setError("ບໍ່ມີອິນເຕີເນັດ — ການເປີດໃຊ້ເຄື່ອງຄັ້ງທຳອິດຕ້ອງການອິນເຕີເນັດ");
      } else {
        setError("ເປີດໃຊ້ບໍ່ສຳເລັດ (" + (code || "unknown") + ")");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center h-screen bg-slate-900 p-4">
      <form onSubmit={handleActivate} className="bg-white p-8 rounded-2xl shadow-xl w-full max-w-md">
        <div className="flex flex-col items-center mb-6 text-center">
          <div className="p-3 bg-blue-100 text-blue-700 rounded-2xl mb-3">
            <ShieldCheck className="w-8 h-8" />
          </div>
          <h2 className="text-2xl font-bold">ເປີດໃຊ້ເຄື່ອງນີ້ (Activate Device)</h2>
          <p className="text-sm text-slate-500 mt-2">
            ປ້ອນບັນຊີຮ້ານ (Firebase) ເທື່ອດຽວຕໍ່ເຄື່ອງ ເພື່ອເຊື່ອມຕໍ່ຖານຂໍ້ມູນຮ້ານ.
            ພະນັກງານຈະໃຊ້ໜ້າ PIN ຕາມປົກກະຕິ.
          </p>
        </div>

        {error && <p className="text-red-500 mb-4 text-center text-sm">{error}</p>}

        <input
          type="email"
          placeholder="ອີເມວບັນຊີຮ້ານ (Shop email)"
          value={email}
          autoComplete="username"
          onChange={(e) => setEmail(e.target.value)}
          className="w-full p-3 mb-4 border rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
        />
        <input
          type="password"
          placeholder="ລະຫັດຜ່ານຮ້ານ (Shop password)"
          value={password}
          autoComplete="current-password"
          onChange={(e) => setPassword(e.target.value)}
          className="w-full p-3 mb-6 border rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
        />
        <button
          type="submit"
          disabled={loading}
          className="w-full p-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-xl font-bold transition-colors flex items-center justify-center gap-2"
        >
          {loading && <Loader2 className="w-4 h-4 animate-spin" />}
          {loading ? "ກຳລັງເປີດໃຊ້..." : "ເປີດໃຊ້ເຄື່ອງ"}
        </button>

        <p className="text-[11px] text-slate-400 mt-4 text-center">
          ຕ້ອງການອິນເຕີເນັດສະເພາະຄັ້ງທຳອິດ — ຫຼັງຈາກນັ້ນເຄື່ອງນີ້ໃຊ້ໄດ້ທັງ online ແລະ offline.
        </p>
      </form>
    </div>
  );
};
