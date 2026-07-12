/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from "react";
import { 
  Building2, Phone, MapPin, Upload, Percent, Check, RefreshCw, Trash2, Eye, User as UserIcon, Plus, ReceiptText
} from "lucide-react";
import { ShopSettings, User } from "../types";
import { db } from "../utils/db";
import { hashPin } from "../utils/security";

interface SettingsViewProps {
  onSettingsSaved?: () => void;
  currentUser: User;
}

export default function SettingsView({ onSettingsSaved, currentUser }: SettingsViewProps) {
  const [notification, setNotification] = useState<{ message: string; isError: boolean } | null>(null);
  const [users, setUsers] = useState<User[]>(db.getUsers());
  const [newUser, setNewUser] = useState<Partial<User>>({ 
    username: '', 
    password: '', 
    name: '', 
    role: 'Cashier', 
    permissions: ['pos'],
    tabPermissions: { pos: true, stock: false, reports: false, members: false, settings: false }
  });

  const showNotification = (message: string, isError = false) => {
    setNotification({ message, isError });
    window.setTimeout(() => setNotification(null), 3000);
  };

  const managerConfirmPhrase = "MANAGER";
  const defaultTabPermissionsForRole = (role: "Manager" | "Cashier") => role === "Manager"
    ? { pos: true, stock: true, reports: true, members: true, settings: true }
    : { pos: true, stock: false, reports: false, members: false, settings: false };
  const buildPermissionsFromTabs = (tabs: User["tabPermissions"] = defaultTabPermissionsForRole("Cashier")) => {
    const permissions: string[] = [];
    if (tabs?.pos) permissions.push("pos");
    if (tabs?.stock) permissions.push("stock");
    if (tabs?.reports) permissions.push("reports");
    if (tabs?.members) permissions.push("members");
    if (tabs?.settings) permissions.push("settings");
    return permissions;
  };
  const resetNewUserForm = () => setNewUser({
    username: '',
    password: '',
    name: '',
    role: 'Cashier',
    permissions: ['pos'],
    tabPermissions: defaultTabPermissionsForRole("Cashier")
  });
  const requestManagerConfirmation = (actionLabel: string) => {
    if (currentUser.role !== "Manager") {
      showNotification("ສະເພາະ Manager ເທົ່ານັ້ນທີ່ຢືນຢັນການກະທຳນີ້ໄດ້.", true);
      return false;
    }
    const typed = window.prompt(actionLabel + "\n\nພິມ MANAGER ເພື່ອຢືນຢັນ:");
    if (typed !== managerConfirmPhrase) {
      showNotification("ຍົກເລີກ: ການຢືນຢັນ Manager ບໍ່ຖືກຕ້ອງ.", true);
      return false;
    }
    return true;
  };

  const handleAddUser = async () => {
    if (!newUser.username || !newUser.password || !newUser.name) {
      showNotification("ກະລຸນາປ້ອນຂໍ້ມູນຜູ້ໃຊ້ໃຫ້ຄົບຖ້ວນ!", true);
      return;
    }
    if (users.some(u => u.username.toLowerCase() === newUser.username?.trim().toLowerCase())) {
      showNotification("ຊື່ຜູ້ໃຊ້ນີ້ມີຢູ່ແລ້ວ!", true);
      return;
    }
    const selectedPermissions = buildPermissionsFromTabs(newUser.tabPermissions);
    if (selectedPermissions.length === 0) {
      showNotification("ກະລຸນາເລືອກຢ່າງນ້ອຍ 1 ໜ້າທີ່ຜູ້ໃຊ້ສາມາດເຂົ້າໄດ້.", true);
      return;
    }
    const trimmedUsername = newUser.username.trim();
    const userToSave: User = {
      ...(newUser as User),
      username: trimmedUsername,
      name: newUser.name.trim(),
      permissions: selectedPermissions,
      tabPermissions: newUser.tabPermissions || defaultTabPermissionsForRole(newUser.role as "Manager" | "Cashier"),
      // PINs are stored hashed, never as plain text.
      passwordHash: await hashPin(trimmedUsername, newUser.password)
    };
    delete userToSave.password;
    const updatedUsers = db.saveUser(userToSave);
    setUsers(updatedUsers);
    resetNewUserForm();
    showNotification("ເພີ່ມຜູ້ໃຊ້ໃໝ່ສຳເລັດແລ້ວ!");
  };

  const handleDeleteUser = (username: string) => {
    if (username === currentUser.username) {
      showNotification("ທ່ານບໍ່ສາມາດລຶບຜູ້ໃຊ້ຂອງທ່ານເອງໄດ້!", true);
      return;
    }
    if (!requestManagerConfirmation("ກຳລັງຈະລຶບຜູ້ໃຊ້ " + username)) return;
    const updatedUsers = db.deleteUser(username);
    setUsers(updatedUsers);
    showNotification("ລຶບຜູ້ໃຊ້ສຳເລັດແລ້ວ!");
  };

  const [settings, setSettings] = useState<ShopSettings>({
    shopName: "",
    phone: "",
    contact: "",
    qrCodeUrl: null,
    logoUrl: null,
    receiptPaperSize: "80mm",
    vatEnabled: false,
    vatRate: 10,
    xxxRateEnabled: false,
    xxxRateName: "ຄ່າບໍລິການ (Service)",
    xxxRate: 5,
    membershipEnabled: false,
    pointRate: 1
  });

  const [dragActiveField, setDragActiveField] = useState<'logo' | 'qr' | null>(null);

  // Load settings on mount
  useEffect(() => {
    const loaded = db.getSettings();
    setSettings(loaded);
  }, []);

  const handleSave = () => {
    if (!settings.shopName.trim()) {
      showNotification("ກະລຸນາປ້ອນຊື່ຮ້ານ!", true);
      return;
    }
    try {
      db.saveSettings(settings);
      showNotification("ບັນທຶກການຕັ້ງຄ່າຮ້ານສຳເລັດແລ້ວ!");
      if (onSettingsSaved) {
        onSettingsSaved();
      }
    } catch (error) {
      console.error("Settings save failed", error);
      showNotification("ບັນທຶກການຕັ້ງຄ່າບໍ່ສຳເລັດ.", true);
    }
  };

  const handleResetDefaults = () => {
    if (!requestManagerConfirmation("ກຳລັງຈະຕັ້ງຄ່າລະບົບຄືນເປັນຄ່າເລີ່ມຕົ້ນ")) return;
    const defaultSettings: ShopSettings = {
      shopName: "ມະຫາຈື່ນ ສະລອຍນ້ຳ",
      phone: "020 28228077",
      contact: "ບ້ານ ດົງໂດກ, ເມືອງ ໄຊທານີ, ນະຄອນຫຼວງວຽງຈັນ",
      qrCodeUrl: null,
      logoUrl: null,
      receiptPaperSize: "80mm",
      vatEnabled: false,
      vatRate: 10,
      xxxRateEnabled: false,
      xxxRateName: "ຄ່າບໍລິການ (Service)",
      xxxRate: 5,
      membershipEnabled: false,
      pointRate: 1
    };
    setSettings(defaultSettings);
    db.saveSettings(defaultSettings);
    showNotification("ຕັ້ງຄ່າຄືນເປັນຄ່າເລີ່ມຕົ້ນສຳເລັດ!");
    if (onSettingsSaved) {
      onSettingsSaved();
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>, field: 'logoUrl' | 'qrCodeUrl') => {
    const file = e.target.files?.[0];
    if (!file) return;
    processFile(file, field);
  };

  // Resize + re-encode an image so the base64 stays small. This is essential:
  // the logo and QR are stored inside the single `meta/settings` Firestore
  // document, which has a hard 1MB limit. A raw phone photo (~2MB → ~2.7MB
  // base64) silently fails to upload AND blocks the rest of the config from
  // syncing. Compressing to a few tens of KB guarantees the whole settings
  // document reaches the cloud. QR keeps higher fidelity so it stays scannable.
  const compressImage = (dataUrl: string, maxDim: number, quality: number): Promise<string> =>
    new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          const scale = Math.min(maxDim / width, maxDim / height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) { resolve(dataUrl); return; }
        // White backing so transparent PNGs print cleanly on paper receipts.
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        try {
          resolve(canvas.toDataURL("image/jpeg", quality));
        } catch {
          resolve(dataUrl);
        }
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    });

  const processFile = (file: File, field: 'logoUrl' | 'qrCodeUrl') => {
    if (!file.type.startsWith("image/")) {
      showNotification("ກະລຸນາເລືອກສະເພາະໄຟລ໌ຮູບພາບ!", true);
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      showNotification("ຮູບພາບຕ້ອງມີຂະໜາດບໍ່ເກີນ 2MB!", true);
      return;
    }

    const reader = new FileReader();
    reader.onload = async () => {
      const original = reader.result as string;
      // QR needs to stay crisp/scannable → larger + higher quality; the logo
      // can be smaller. Both end up well under Firestore's 1MB doc limit.
      const isQr = field === "qrCodeUrl";
      const compressed = await compressImage(original, isQr ? 512 : 320, isQr ? 0.92 : 0.8);
      setSettings(prev => ({
        ...prev,
        [field]: compressed
      }));
    };
    reader.readAsDataURL(file);
  };

  const handleDrag = (e: React.DragEvent, field: 'logo' | 'qr', active: boolean) => {
    e.preventDefault();
    e.stopPropagation();
    if (active) {
      setDragActiveField(field);
    } else {
      setDragActiveField(null);
    }
  };

  const handleDrop = (e: React.DragEvent, field: 'logoUrl' | 'qrCodeUrl') => {
    e.preventDefault();
    e.stopPropagation();
    setDragActiveField(null);
    
    const file = e.dataTransfer.files?.[0];
    if (file) {
      processFile(file, field);
    }
  };

  const removeImage = (field: 'logoUrl' | 'qrCodeUrl') => {
    setSettings(prev => ({
      ...prev,
      [field]: null
    }));
  };

  const receiptPaperSize = settings.receiptPaperSize || "80mm";

  return (
    <div id="settings-view-root" className="grid grid-cols-1 lg:grid-cols-12 gap-6 h-full pb-8">
      
      {/* Left panel: Store identity & visual assets */}
      <div className="lg:col-span-7 space-y-6">
        
        {/* Card: Shop identity */}
        <div className="bg-white border border-slate-100 rounded-3xl p-5 md:p-6 shadow-sm shadow-slate-100/40">
          <div className="flex items-center gap-3 border-b border-slate-50 pb-4 mb-5">
            <div className="p-2.5 bg-blue-50 text-blue-600 rounded-2xl">
              <Building2 className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-800">ຂໍ້ມູນເອກະລັກຂອງຮ້ານ</h2>
              <p className="text-[10px] text-slate-400 font-medium">ຕັ້ງຄ່າຊື່ຮ້ານ, ເບີໂທ ແລະ ທີ່ຢູ່ເພື່ອສະແດງໃນໃບບິນ</p>
            </div>
          </div>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">ຊື່ຮ້ານ (Shop Name)</label>
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400">
                  <Building2 className="w-4 h-4" />
                </span>
                <input
                  id="settings-shop-name"
                  type="text"
                  placeholder="ປ້ອນຊື່ຮ້ານ..."
                  value={settings.shopName}
                  onChange={(e) => setSettings(prev => ({ ...prev, shopName: e.target.value }))}
                  className="w-full pl-10 pr-4 py-2.5 bg-slate-50/50 border border-slate-200/80 rounded-2xl text-xs font-bold focus:outline-none focus:border-blue-500 focus:bg-white transition-all"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">ເບີໂທລະສັບ (Phone Number)</label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400">
                    <Phone className="w-4 h-4" />
                  </span>
                  <input
                    id="settings-shop-phone"
                    type="text"
                    placeholder="ປ້ອນເບີໂທລະສັບ..."
                    value={settings.phone}
                    onChange={(e) => setSettings(prev => ({ ...prev, phone: e.target.value }))}
                    className="w-full pl-10 pr-4 py-2.5 bg-slate-50/50 border border-slate-200/80 rounded-2xl text-xs font-bold focus:outline-none focus:border-blue-500 focus:bg-white transition-all"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">ຊ່ອງທາງຕິດຕໍ່ / ທີ່ຢູ່ (Contact/Address)</label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400">
                    <MapPin className="w-4 h-4" />
                  </span>
                  <input
                    id="settings-shop-contact"
                    type="text"
                    placeholder="ປ້ອນທີ່ຢູ່ ຫຼື ຊ່ອງທາງຕິດຕໍ່..."
                    value={settings.contact}
                    onChange={(e) => setSettings(prev => ({ ...prev, contact: e.target.value }))}
                    className="w-full pl-10 pr-4 py-2.5 bg-slate-50/50 border border-slate-200/80 rounded-2xl text-xs font-bold focus:outline-none focus:border-blue-500 focus:bg-white transition-all"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white border border-slate-100 rounded-3xl p-5 md:p-6 shadow-sm shadow-slate-100/40">
          <div className="flex items-center gap-3 border-b border-slate-50 pb-4 mb-5">
            <div className="p-2.5 bg-blue-50 text-blue-600 rounded-2xl">
              <Upload className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-800">ຮູບໂລໂກ້ຮ້ານ ແລະ QR ຮັບເງິນ</h2>
              <p className="text-[10px] text-slate-400 font-medium">ອັບໂຫຼດຮູບພາບໂດຍການລາກວາງ ຫຼື ຄລິກເພື່ອເລືອກໄຟລ໌ (ສູງສຸດ 2MB)</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="space-y-2">
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">ໂລໂກ້ຮ້ານ (Shop Logo)</span>
              {settings.logoUrl ? (
                <div className="relative group border border-slate-200 rounded-2xl p-3 bg-slate-50/50 flex flex-col items-center justify-center min-h-[140px] animate-fade-in">
                  <img 
                    src={settings.logoUrl} 
                    alt="Logo preview" 
                    className="max-h-20 object-contain rounded-lg shadow-sm"
                  />
                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      onClick={() => removeImage('logoUrl')}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-600 hover:text-rose-700 text-[10px] font-bold rounded-xl border border-rose-100 transition-colors cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      ລຶບຮູບພາບ
                    </button>
                  </div>
                </div>
              ) : (
                <div
                  onDragOver={(e) => handleDrag(e, 'logo', true)}
                  onDragLeave={(e) => handleDrag(e, 'logo', false)}
                  onDrop={(e) => handleDrop(e, 'logoUrl')}
                  className={`border-2 border-dashed rounded-2xl p-4 flex flex-col items-center justify-center text-center min-h-[140px] transition-all cursor-pointer ${
                    dragActiveField === 'logo'
                      ? "border-blue-500 bg-blue-50/50 scale-[0.98]"
                      : "border-slate-200 hover:border-slate-350 hover:bg-slate-50/30"
                  }`}
                  onClick={() => document.getElementById('logo-file-input')?.click()}
                >
                  <Upload className={`w-7 h-7 mb-2 transition-transform ${dragActiveField === 'logo' ? 'scale-110 text-blue-600' : 'text-slate-400'}`} />
                  <span className="text-xs font-bold text-slate-700">ລາກໄຟລ໌ມາວາງ ຫຼື ຄລິກອັບໂຫຼດ</span>
                  <span className="text-[9px] text-slate-400 mt-0.5">ຮອງຮັບ PNG, JPG, JPEG</span>
                  <input
                    id="logo-file-input"
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => handleFileChange(e, 'logoUrl')}
                  />
                </div>
              )}
            </div>

            <div className="space-y-2">
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">ຄິວອາໂຄດຮັບເງິນ (Payment QR)</span>
              {settings.qrCodeUrl ? (
                <div className="relative group border border-slate-200 rounded-2xl p-3 bg-slate-50/50 flex flex-col items-center justify-center min-h-[140px] animate-fade-in">
                  <img 
                    src={settings.qrCodeUrl} 
                    alt="QR preview" 
                    className="max-h-24 aspect-square object-contain rounded-lg shadow-sm border border-slate-100"
                  />
                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      onClick={() => removeImage('qrCodeUrl')}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-600 hover:text-rose-700 text-[10px] font-bold rounded-xl border border-rose-100 transition-colors cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      ລຶບຮູບພາບ
                    </button>
                  </div>
                </div>
              ) : (
                <div
                  onDragOver={(e) => handleDrag(e, 'qr', true)}
                  onDragLeave={(e) => handleDrag(e, 'qr', false)}
                  onDrop={(e) => handleDrop(e, 'qrCodeUrl')}
                  className={`border-2 border-dashed rounded-2xl p-4 flex flex-col items-center justify-center text-center min-h-[140px] transition-all cursor-pointer ${
                    dragActiveField === 'qr'
                      ? "border-blue-500 bg-blue-50/50 scale-[0.98]"
                      : "border-slate-200 hover:border-slate-350 hover:bg-slate-50/30"
                  }`}
                  onClick={() => document.getElementById('qr-file-input')?.click()}
                >
                  <Upload className={`w-7 h-7 mb-2 transition-transform ${dragActiveField === 'qr' ? 'scale-110 text-blue-600' : 'text-slate-400'}`} />
                  <span className="text-xs font-bold text-slate-700">ລາກໄຟລ໌ມາວາງ ຫຼື ຄລິກອັບໂຫຼດ</span>
                  <span className="text-[9px] text-slate-400 mt-0.5">ຮອງຮັບ PNG, JPG, JPEG</span>
                  <input
                    id="qr-file-input"
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => handleFileChange(e, 'qrCodeUrl')}
                  />
                </div>
              )}
            </div>
          </div>
        </div>

        {currentUser.role === 'Manager' && (
          <div className="bg-white border border-slate-100 rounded-3xl p-5 md:p-6 shadow-sm shadow-slate-100/40">
            <div className="flex items-center gap-3 border-b border-slate-50 pb-4 mb-5">
              <div className="p-2.5 bg-blue-50 text-blue-600 rounded-2xl">
                <UserIcon className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-slate-800">ຈັດການຜູ້ໃຊ້</h2>
                <p className="text-[10px] text-slate-400 font-medium">ຈັດການບັນຊີຜູ້ໃຊ້ ແລະ ສິດການເຂົ້າເຖິງລະບົບ</p>
              </div>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                {users.map(u => (
                  <div key={u.username} className="flex items-center justify-between p-3 bg-slate-50 rounded-xl">
                    <div className="space-y-1">
                      <p className="text-xs font-bold">{u.name} ({u.username})</p>
                      <p className="text-[10px] text-slate-500">{u.role} · Password hidden</p>
                      <div className="flex flex-wrap gap-1">
                        {buildPermissionsFromTabs(u.tabPermissions || defaultTabPermissionsForRole(u.role)).map(permission => (
                          <span key={permission} className="px-1.5 py-0.5 rounded-md bg-blue-50 text-blue-700 border border-blue-100 text-[9px] font-bold uppercase">
                            {permission}
                          </span>
                        ))}
                      </div>
                    </div>
                    {u.username !== currentUser.username && (
                      <button type="button" onClick={() => handleDeleteUser(u.username)} aria-label={`ລຶບຜູ້ໃຊ້ ${u.username}`} title={`ລຶບຜູ້ໃຊ້ ${u.username}`} className="p-2 text-rose-500 hover:bg-rose-50 rounded-lg">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-4 border-t border-slate-100">
                <input type="text" placeholder="ຊື່ຜູ້ໃຊ້" value={newUser.username} onChange={e => setNewUser({...newUser, username: e.target.value})} className="p-2 border rounded-xl text-xs" />
                <input type="text" placeholder="ຊື່ແທ້" value={newUser.name} onChange={e => setNewUser({...newUser, name: e.target.value})} className="p-2 border rounded-xl text-xs" />
                <input type="password" aria-label="ລະຫັດຜ່ານ" placeholder="ລະຫັດຜ່ານ" value={newUser.password} autoComplete="new-password" minLength={4} onChange={e => setNewUser({...newUser, password: e.target.value})} className="p-2 border rounded-xl text-xs" />
                <select value={newUser.role} onChange={e => {
                  const role = e.target.value as 'Manager' | 'Cashier';
                  const tabPermissions = defaultTabPermissionsForRole(role);
                  setNewUser({ ...newUser, role, tabPermissions, permissions: buildPermissionsFromTabs(tabPermissions) });
                }} className="p-2 border rounded-xl text-xs">
                  <option value="Cashier">Cashier</option>
                  <option value="Manager">Manager</option>
                </select>
                <div className="col-span-full grid grid-cols-2 gap-2 text-[10px] p-2 border rounded-xl">
                    <label className="flex items-center gap-1"><input type="checkbox" checked={newUser.tabPermissions?.pos} onChange={e => setNewUser({...newUser, tabPermissions: {...newUser.tabPermissions!, pos: e.target.checked}})} /> POS</label>
                    <label className="flex items-center gap-1"><input type="checkbox" checked={newUser.tabPermissions?.stock} onChange={e => setNewUser({...newUser, tabPermissions: {...newUser.tabPermissions!, stock: e.target.checked}})} /> Stock control</label>
                    <label className="flex items-center gap-1"><input type="checkbox" checked={newUser.tabPermissions?.reports} onChange={e => setNewUser({...newUser, tabPermissions: {...newUser.tabPermissions!, reports: e.target.checked}})} /> Reports</label>
                    <label className="flex items-center gap-1"><input type="checkbox" checked={newUser.tabPermissions?.members} onChange={e => setNewUser({...newUser, tabPermissions: {...newUser.tabPermissions!, members: e.target.checked}})} /> Members</label>
                    <label className="flex items-center gap-1"><input type="checkbox" checked={newUser.tabPermissions?.settings} onChange={e => setNewUser({...newUser, tabPermissions: {...newUser.tabPermissions!, settings: e.target.checked}})} /> Settings</label>
                </div>
                <button onClick={handleAddUser} className="col-span-full flex items-center justify-center gap-2 p-2 bg-blue-600 text-white rounded-xl text-xs font-bold">
                  <Plus className="w-4 h-4" /> ເພີ່ມຜູ້ໃຊ້ໃໝ່
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="lg:col-span-5 space-y-6">
        <div className="bg-white border border-slate-100 rounded-3xl p-5 md:p-6 shadow-sm shadow-slate-100/40">
          <div className="flex items-center gap-3 border-b border-slate-50 pb-4 mb-5">
            <div className="p-2.5 bg-blue-50 text-blue-600 rounded-2xl">
              <Percent className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-800">ພາສີມູນຄ່າເພີ່ມ & ຄ່າບໍລິການ</h2>
              <p className="text-[10px] text-slate-400 font-medium">ເປີດ/ປິດ ລະບົບພາສີ VAT ແລະ ຄ່າບໍລິການອື່ນໆ (%)</p>
            </div>
          </div>

          <div className="space-y-5">
            <div className="border border-slate-100 rounded-2xl p-4 space-y-3.5 bg-slate-50/30">
              <div className="flex items-center justify-between">
                <div className="flex flex-col">
                  <span className="text-xs font-bold text-slate-700">ພາສີມູນຄ່າເພີ່ມ (VAT)</span>
                  <span className="text-[9px] text-slate-400 font-medium">ຄິດໄລ່ພາສີ (%) ເຂົ້າໃນໃບບິນຊຳລະເງິນ</span>
                </div>
                
                <button
                  type="button"
                  onClick={() => setSettings(prev => ({ ...prev, vatEnabled: !prev.vatEnabled }))}
                  aria-label={settings.vatEnabled ? "ປິດ VAT" : "ເປີດ VAT"}
                  title={settings.vatEnabled ? "ປິດ VAT" : "ເປີດ VAT"}
                  className={`w-11 h-6 flex items-center rounded-full p-0.5 cursor-pointer transition-colors ${
                    settings.vatEnabled ? "bg-blue-600" : "bg-slate-200"
                  }`}
                >
                  <div
                    className={`bg-white w-5 h-5 rounded-full shadow-md transform transition-transform ${
                      settings.vatEnabled ? "translate-x-5" : "translate-x-0"
                    }`}
                  />
                </button>
              </div>

              {settings.vatEnabled && (
                <div className="grid grid-cols-1 gap-1.5 pt-1 animate-fade-in">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">ອັດຕາພາສີ VAT (%)</label>
                  <div className="relative">
                    <input
                      id="settings-vat-rate"
                      type="number"
                      placeholder="ຕົວຢ່າງ: 10"
                      value={settings.vatRate}
                      onChange={(e) => setSettings(prev => ({ ...prev, vatRate: Math.max(0, parseFloat(e.target.value) || 0) }))}
                      className="w-full pr-8 pl-4 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold focus:outline-none focus:border-blue-500"
                    />
                    <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400 font-mono">%</span>
                  </div>
                </div>
              )}
            </div>

            <div className="border border-slate-100 rounded-2xl p-4 space-y-3.5 bg-slate-50/30">
              <div className="flex items-center justify-between">
                <div className="flex flex-col">
                  <span className="text-xs font-bold text-slate-700">ຄ່າບໍລິການ ຫຼື ຄ່າໃຊ້ຈ່າຍອື່ນໆ (%)</span>
                  <span className="text-[9px] text-slate-400 font-medium">ຄິດໄລ່ເປີເຊັນເພີ່ມເຕີມ (%) ເຊັ່ນ ຄ່າບໍລິການ, SC</span>
                </div>
                
                <button
                  type="button"
                  onClick={() => { setSettings(prev => ({ ...prev, xxxRateEnabled: !prev.xxxRateEnabled })); }}
                  className={`w-11 h-6 flex items-center rounded-full p-0.5 cursor-pointer transition-colors ${
                    settings.xxxRateEnabled ? "bg-blue-600" : "bg-slate-200"
                  }`}
                >
                  <div
                    className={`bg-white w-5 h-5 rounded-full shadow-md transform transition-transform ${
                      settings.xxxRateEnabled ? "translate-x-5" : "translate-x-0"
                    }`}
                  />
                </button>
              </div>

              {settings.xxxRateEnabled && (
                <div className="grid grid-cols-2 gap-3 pt-1 animate-fade-in">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">ຊື່ລາຍການຄ່າບໍລິການ</label>
                    <input
                      id="settings-xxx-name"
                      type="text"
                      placeholder="ເຊັ່ນ: ຄ່າບໍລິການ (Service)"
                      value={settings.xxxRateName}
                      onChange={(e) => setSettings(prev => ({ ...prev, xxxRateName: e.target.value }))}
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold focus:outline-none focus:border-blue-500"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">ອັດຕາ (%)</label>
                    <div className="relative">
                      <input
                        id="settings-xxx-rate"
                        type="number"
                        placeholder="ຕົວຢ່າງ: 5"
                        value={settings.xxxRate}
                        onChange={(e) => setSettings(prev => ({ ...prev, xxxRate: Math.max(0, parseFloat(e.target.value) || 0) }))}
                        className="w-full pr-8 pl-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold focus:outline-none focus:border-blue-500"
                      />
                      <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400 font-mono">%</span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* ── Membership / Loyalty Points ── */}
            <div className="border-t border-slate-100 pt-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex flex-col">
                  <span className="text-xs font-bold text-slate-700">ສະມາຊິກ & ຄະແນນສະສົມ (Membership Points)</span>
                  <span className="text-[9px] text-slate-400 font-medium">ເປີດ/ປິດ ການໃຫ້ point ໃນບິນ ແລະ ຕັ້ງອັດຕາ</span>
                </div>
                <button
                  type="button"
                  onClick={() => { setSettings(prev => ({ ...prev, membershipEnabled: !prev.membershipEnabled })); }}
                  className={`w-11 h-6 flex items-center rounded-full p-0.5 cursor-pointer transition-colors ${
                    settings.membershipEnabled ? "bg-blue-600" : "bg-slate-200"
                  }`}
                >
                  <div className={`bg-white w-5 h-5 rounded-full shadow-md transform transition-transform ${
                    settings.membershipEnabled ? "translate-x-5" : "translate-x-0"
                  }`} />
                </button>
              </div>

              {settings.membershipEnabled && (
                <div className="pt-1 animate-fade-in">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">ອັດຕາ point (%)</label>
                  <div className="relative mt-1.5 max-w-[200px]">
                    <input
                      type="number"
                      placeholder="ຕົວຢ່າງ: 1"
                      value={settings.pointRate}
                      onChange={(e) => setSettings(prev => ({ ...prev, pointRate: Math.max(0, parseFloat(e.target.value) || 0) }))}
                      className="w-full pr-8 pl-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold focus:outline-none focus:border-blue-500"
                    />
                    <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400 font-mono">%</span>
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1.5">
                    ຕົວຢ່າງ: {settings.pointRate}% → ບິນ 10,000 LAK ໄດ້ {Math.round(10000 * (settings.pointRate / 100)).toLocaleString()} point
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="bg-white border border-slate-100 rounded-3xl p-5 md:p-6 shadow-sm shadow-slate-100/40">
          <div className="flex items-center gap-3 border-b border-slate-50 pb-4 mb-5">
            <div className="p-2.5 bg-blue-50 text-blue-600 rounded-2xl">
              <ReceiptText className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-800">ຂະໜາດເຈ້ຍໃບບິນ</h2>
              <p className="text-[10px] text-slate-400 font-medium">ເລືອກຂະໜາດໃບບິນສຳລັບເຄື່ອງພິມ thermal</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {(["58mm", "80mm"] as const).map(size => (
              <button
                key={size}
                type="button"
                onClick={() => setSettings(prev => ({ ...prev, receiptPaperSize: size }))}
                className={`rounded-2xl border px-3 py-3 text-left transition-all ${
                  receiptPaperSize === size
                    ? "border-blue-500 bg-blue-50 text-blue-700 shadow-sm"
                    : "border-slate-200 bg-slate-50/60 text-slate-600 hover:bg-slate-100"
                }`}
              >
                <span className="block text-sm font-extrabold">{size}</span>
                <span className="block text-[10px] font-semibold mt-0.5">
                  {size === "58mm" ? "Compact receipt" : "Standard receipt"}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="bg-slate-900 text-white rounded-3xl p-5 shadow-xl border border-slate-800 relative overflow-hidden font-mono select-none">
          <div className="absolute right-3 top-3 px-2 py-0.5 bg-blue-500/20 text-blue-400 border border-blue-500/30 rounded text-[9px] font-bold uppercase flex items-center gap-1">
            <Eye className="w-3 h-3" />
            <span>{receiptPaperSize} Preview</span>
          </div>
          
          <div className={`space-y-4 pt-4 text-center mx-auto ${receiptPaperSize === "58mm" ? "max-w-[220px]" : "max-w-[280px]"}`}>
            <div className="flex flex-col items-center">
              {settings.logoUrl ? (
                <img src={settings.logoUrl} alt="logo mockup" className={`${receiptPaperSize === "58mm" ? "max-h-7" : "max-h-8"} object-contain mb-1.5 rounded`} />
              ) : (
                <div className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center text-slate-500 text-xs font-sans mb-1.5">Logo</div>
              )}
              <h3 className={`${receiptPaperSize === "58mm" ? "text-[11px]" : "text-xs"} font-bold tracking-tight text-white`}>{settings.shopName || "ຊື່ຮ້ານຂອງທ່ານ"}</h3>
              <p className="text-[9px] text-slate-400">Tel: {settings.phone || "020 28XXXXXX"}</p>
              {settings.contact && <p className="text-[8px] text-slate-500 max-w-[200px] truncate">{settings.contact}</p>}
            </div>

            <div className="border-t border-dashed border-slate-800 my-2"></div>

            <div className={`text-left ${receiptPaperSize === "58mm" ? "text-[11px]" : "text-[10px]"} space-y-1.5`}>
              {receiptPaperSize === "58mm" ? (
                <div className="text-slate-300">
                  <div className="text-[13px] font-extrabold leading-tight">ລາຍການອາຫານ</div>
                  <div className="grid grid-cols-[auto_1fr_auto] items-end gap-1 font-mono text-[11px] text-slate-400 leading-tight">
                    <span>1 x ₭100,000</span>
                    <span className="border-b border-dotted border-slate-700 translate-y-[-3px]"></span>
                    <span className="font-bold text-slate-200">₭100,000</span>
                  </div>
                </div>
              ) : (
                <div className="space-y-1">
                  <div className="grid grid-cols-[minmax(0,1fr)_32px_52px_72px] items-start gap-1 border-y border-slate-600 py-1 text-[7px] font-extrabold leading-tight text-slate-300">
                    <span>ເມນູ (MENU)</span>
                    <span className="text-center">ຈນ. (QTY)</span>
                    <span className="text-right">ລາຄາ (PR)</span>
                    <span className="text-right">ລວມ (TOTAL)</span>
                  </div>
                  <div className="grid grid-cols-[minmax(0,1fr)_32px_52px_72px] items-start gap-1 text-[13px] font-extrabold leading-tight text-slate-100">
                    <span className="break-words">M8-ເສັ້ນກະເພົາໄກ່ ໃຫຍ່</span>
                    <span className="text-center tabular-nums">1</span>
                    <span className="text-right tabular-nums">85,000</span>
                    <span className="text-right tabular-nums">85,000</span>
                  </div>
                  <div className="grid grid-cols-[minmax(0,1fr)_32px_52px_72px] items-start gap-1 text-[13px] font-extrabold leading-tight text-slate-100">
                    <span className="break-words">M3-ເສັ້ນຜັດໄກ່ ນ້ອຍ</span>
                    <span className="text-center tabular-nums">1</span>
                    <span className="text-right tabular-nums">45,000</span>
                    <span className="text-right tabular-nums">45,000</span>
                  </div>
                  <div className="border-t border-slate-600 pt-1"></div>
                </div>
              )}
              
              <div className="border-t border-dashed border-slate-800 my-2"></div>

              <div className="flex justify-between">
                <span className="text-slate-400">Subtotal / ລວມ:</span>
                <span>₭100,000.00</span>
              </div>

              {settings.vatEnabled && (
                <div className="flex justify-between text-slate-300">
                  <span className="text-slate-400">VAT ({settings.vatRate}%):</span>
                  <span>₭{(100000 * (settings.vatRate / 100)).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                </div>
              )}

              {settings.xxxRateEnabled && (
                <div className="flex justify-between text-slate-300">
                  <span className="text-slate-400">{settings.xxxRateName || "Service Charge"} ({settings.xxxRate}%):</span>
                  <span>₭{(100000 * (settings.xxxRate / 100)).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                </div>
              )}

              <div className="flex justify-between text-xs font-bold text-white border-t border-slate-800 pt-2 mt-1">
                <span>TOTAL / ທັງໝົດ:</span>
                <span className="text-blue-400">
                  ₭{(100000 + 
                    (settings.vatEnabled ? 100000 * (settings.vatRate / 100) : 0) + 
                    (settings.xxxRateEnabled ? 100000 * (settings.xxxRate / 100) : 0)
                  ).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </span>
              </div>
            </div>

            {settings.qrCodeUrl && (
              <div className="flex flex-col items-center pt-2">
                <div className="text-[8px] text-slate-500 mb-1">Scan to Pay / ສະແກນຊຳລະເງິນ</div>
                <img src={settings.qrCodeUrl} alt="QR mockup" className={`${receiptPaperSize === "58mm" ? "w-20 h-20" : "w-24 h-24"} border border-slate-800 p-1 rounded bg-white`} />
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-3.5 border-t border-slate-100 pt-5">
          <button
            id="settings-reset-btn"
            type="button"
            onClick={handleResetDefaults}
            className="flex items-center gap-1.5 px-4 py-2.5 bg-slate-50 border border-slate-200/80 hover:bg-slate-100 text-slate-600 rounded-2xl text-xs font-bold transition-all cursor-pointer shadow-sm"
          >
            <RefreshCw className="w-4 h-4 text-slate-500" />
            <span>ຕັ້ງຄ່າເລີ່ມຕົ້ນ</span>
          </button>

          <button
            id="settings-save-btn"
            type="button"
            onClick={handleSave}
            className="flex items-center gap-1.5 px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl text-xs font-extrabold transition-all cursor-pointer shadow-md shadow-blue-500/20"
          >
            <Check className="w-4 h-4" />
            <span>ບັນທຶກການຕັ້ງຄ່າ</span>
          </button>
        </div>
      </div>

      {notification && (
        <div className={`fixed bottom-4 right-4 z-50 flex items-center gap-2 px-4 py-2.5 rounded-xl shadow-lg border text-xs font-bold transition-all duration-300 transform translate-y-0 ${
          notification.isError
            ? "bg-rose-50 border-rose-200 text-rose-800"
            : "bg-emerald-50 border-emerald-200 text-emerald-800"
        }`}>
          <div className={`w-2 h-2 rounded-full ${notification.isError ? 'bg-rose-500' : 'bg-emerald-500'}`} />
          <span>{notification.message}</span>
        </div>
      )}

    </div>
  );
}
