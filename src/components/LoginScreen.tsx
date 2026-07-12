import React, { useState } from 'react';
import { db } from '../utils/db';
import { verifyPin } from '../utils/security';
import { User } from '../types';

interface LoginScreenProps {
  onLogin: (user: User) => void;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({ onLogin }) => {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (checking) return;
    setChecking(true);
    try {
      const users = db.getUsers();
      const user = users.find(u => u.username === username.trim());
      if (!user) {
        setError("ຊື່ຜູ້ໃຊ້ ຫຼື ລະຫັດຜ່ານບໍ່ຖືກຕ້ອງ");
        return;
      }
      const result = await verifyPin(user, password);
      if (!result.ok) {
        setError("ຊື່ຜູ້ໃຊ້ ຫຼື ລະຫັດຜ່ານບໍ່ຖືກຕ້ອງ");
        return;
      }
      // Old plain-text PIN records are upgraded to hashed on first login.
      if (result.migrated) {
        db.saveUser(result.migrated);
        onLogin(result.migrated);
      } else {
        onLogin(user);
      }
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="flex items-center justify-center h-screen bg-slate-100">
      <form onSubmit={handleLogin} className="bg-white p-8 rounded-2xl shadow-xl w-96">
        <h2 className="text-2xl font-bold mb-6 text-center">ເຂົ້າສູ່ລະບົບ</h2>
        {error && <p className="text-red-500 mb-4 text-center text-sm">{error}</p>}
        <input
          type="text"
          placeholder="ຊື່ຜູ້ໃຊ້"
          value={username}
          onChange={e => setUsername(e.target.value)}
          className="w-full p-3 mb-4 border rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
        />
        <input
          type="password"
          placeholder="ລະຫັດຜ່ານ"
          value={password}
          onChange={e => setPassword(e.target.value)}
          className="w-full p-3 mb-6 border rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
        />
        <button type="submit" disabled={checking} className="w-full p-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-xl font-bold transition-colors">
          {checking ? "ກຳລັງກວດສອບ..." : "ເຂົ້າສູ່ລະບົບ"}
        </button>
      </form>
    </div>
  );
};
