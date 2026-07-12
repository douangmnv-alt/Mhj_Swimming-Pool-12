/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from "react";
import { 
  Users, Search, Plus, Trash2, Edit, Award, Phone, MapPin, 
  Calendar, FileSpreadsheet, X, Sparkles, PlusCircle, MinusCircle, 
  ChevronRight, TrendingUp, ShoppingBag, History
} from "lucide-react";
import { Member, MemberPointLog, User, ShopSettings } from "../types";
import { db } from "../utils/db";
import { exporters } from "../utils/exporters";

interface MembersViewProps {
  members: Member[];
  settings: ShopSettings;
  currentUser: User | null;
  onSaveMember: (data: { uid?: string; name: string; phone: string; address?: string }) => void;
  onDeleteMember: (uid: string) => void;
  onAdjustPoints: (uid: string, change: number, reason: string) => void;
}

function MembersView({
  members,
  settings,
  currentUser,
  onSaveMember,
  onDeleteMember,
  onAdjustPoints,
}: MembersViewProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedMemberUid, setSelectedMemberUid] = useState<string | null>(
    members.length > 0 ? (members[0].uid || null) : null
  );

  // Modal / Form States
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingMember, setEditingMember] = useState<Member | null>(null);
  const [formData, setFormData] = useState({ name: "", phone: "", address: "" });
  const [formError, setFormError] = useState("");

  // Point Adjustment States
  const [isAdjusting, setIsAdjusting] = useState(false);
  const [adjustAmount, setAdjustAmount] = useState("");
  const [adjustType, setAdjustType] = useState<"ADD" | "DEDUCT">("ADD");
  const [adjustReason, setAdjustReason] = useState("");
  const [adjustError, setAdjustError] = useState("");

  const isManager = currentUser?.role === "Manager";

  // Filtered members list
  const filteredMembers = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return members;
    return members.filter(
      (m) =>
        m.name.toLowerCase().includes(query) ||
        m.phone.includes(query) ||
        (m.address && m.address.toLowerCase().includes(query))
    );
  }, [members, searchQuery]);

  // Handle selected member
  const selectedMember = useMemo(() => {
    if (!selectedMemberUid) return null;
    return members.find((m) => m.uid === selectedMemberUid) || null;
  }, [members, selectedMemberUid]);

  // Points history logs for selected member
  const pointLogs = useMemo(() => {
    if (!selectedMember || !selectedMember.uid) return [];
    return db.getMemberPointLogs(selectedMember.uid);
  }, [selectedMember]);

  // Open Form for Adding
  const handleOpenAdd = () => {
    setEditingMember(null);
    setFormData({ name: "", phone: "", address: "" });
    setFormError("");
    setIsFormOpen(true);
  };

  // Open Form for Editing
  const handleOpenEdit = (member: Member) => {
    setEditingMember(member);
    setFormData({
      name: member.name,
      phone: member.phone,
      address: member.address || "",
    });
    setFormError("");
    setIsFormOpen(true);
  };

  // Save Member
  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    const name = formData.name.trim();
    const phone = formData.phone.trim();
    const address = formData.address.trim();

    if (!name || !phone) {
      setFormError("ກະລຸນາປ້ອນຊື່ ແລະ ເບີໂທລະສັບ!");
      return;
    }

    // Check duplicate phone
    if (db.isPhoneAlreadyUsed(phone, editingMember?.uid)) {
      setFormError("ເບີໂທລະສັບນີ້ຖືກນຳໃຊ້ໃນລະບົບແລ້ວ!");
      return;
    }

    onSaveMember({
      uid: editingMember?.uid,
      name,
      phone,
      address,
    });

    setIsFormOpen(false);
    setEditingMember(null);
  };

  // Delete Member
  const handleDelete = (member: Member) => {
    if (!isManager) {
      alert("ສະເພາະຜູ້ຈັດການ (Manager) ເທົ່ານັ້ນທີ່ສາມາດລຶບສະມາຊິກໄດ້!");
      return;
    }
    if (confirm(`ທ່ານຕ້ອງການລຶບສະມາຊິກ "${member.name}" ແທ້ຫຼືບໍ່?`)) {
      onDeleteMember(member.uid!);
      if (selectedMemberUid === member.uid) {
        setSelectedMemberUid(null);
      }
    }
  };

  // Manual point adjustment submit
  const handleAdjustSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedMember || !selectedMember.uid) return;

    const amount = parseInt(adjustAmount);
    if (isNaN(amount) || amount <= 0) {
      setAdjustError("ກະລຸນາປ້ອນຈຳນວນຄະແນນທີ່ຖືກຕ້ອງ (> 0)!");
      return;
    }

    const finalChange = adjustType === "ADD" ? amount : -amount;
    const reasonText = adjustReason.trim() || (adjustType === "ADD" ? "MANUAL_ADD" : "MANUAL_DEDUCT");

    // Prevent negative points
    if (adjustType === "DEDUCT" && (selectedMember.points || 0) < amount) {
      setAdjustError("ຄະແນນຄົງເຫຼືອຂອງສະມາຊິກບໍ່ພຽງພໍໃຫ້ຫັກອອກ!");
      return;
    }

    onAdjustPoints(selectedMember.uid, finalChange, reasonText);
    
    // Reset states
    setIsAdjusting(false);
    setAdjustAmount("");
    setAdjustReason("");
    setAdjustError("");
  };

  // Export all members and point logs to Excel
  const handleExportExcel = () => {
    const allLogs = db.getAllMemberPointLogs();
    exporters.exportMembersToExcel(members, allLogs);
  };

  return (
    <div className="flex flex-col h-[calc(100vh-100px)] lg:flex-row gap-6 p-1">
      {/* ── Left Column: Member List ── */}
      <div className="flex-1 bg-white border border-slate-100 rounded-3xl p-5 shadow-[0_8px_30px_rgb(0,0,0,0.02)] flex flex-col h-full overflow-hidden">
        
        {/* List Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-5 pb-4 border-b border-slate-100">
          <div>
            <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
              <Users className="w-6 h-6 text-blue-600" />
              ລາຍຊື່ສະມາຊິກ
            </h2>
            <p className="text-[11px] text-slate-400 mt-0.5">
              ທັງໝົດ {members.length} ຄົນ · ຄົ້ນຫາ ແລະ ຈັດການຂໍ້ມູນສະມາຊິກ
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleExportExcel}
              disabled={members.length === 0}
              className="flex items-center gap-1.5 px-3 py-2 border border-slate-200 text-slate-600 hover:text-emerald-600 hover:border-emerald-200 rounded-xl text-xs font-semibold transition-all disabled:opacity-50 cursor-pointer"
              title="ສົ່ງອອກ Excel"
            >
              <FileSpreadsheet className="w-4 h-4" />
              <span>ສົ່ງອອກ Excel</span>
            </button>
            <button
              onClick={handleOpenAdd}
              className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-colors cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>ເພີ່ມສະມາຊິກ</span>
            </button>
          </div>
        </div>

        {/* Search Input */}
        <div className="relative mb-4">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="ຄົ້ນຫາດ້ວຍ ຊື່, ເບີໂທ ຫຼື ທີ່ຢູ່..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-slate-50/50 border border-slate-200 rounded-2xl text-xs font-medium placeholder:text-slate-400 focus:outline-none focus:border-blue-500 focus:bg-white transition-all"
          />
        </div>

        {/* Members List Scrollable Area */}
        <div className="flex-1 overflow-y-auto pr-1 space-y-2">
          {filteredMembers.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-slate-400">
              <Users className="w-12 h-12 text-slate-200 mb-2" />
              <p className="text-xs font-semibold">ບໍ່ພົບຂໍ້ມູນສະມາຊິກ</p>
              {searchQuery && <p className="text-[10px] mt-1">ລອງຄົ້ນຫາດ້ວຍຄຳສັບອື່ນ</p>}
            </div>
          ) : (
            filteredMembers.map((member) => (
              <div
                key={member.uid}
                onClick={() => setSelectedMemberUid(member.uid || null)}
                className={`p-3.5 rounded-2xl border transition-all cursor-pointer flex items-center justify-between ${
                  selectedMemberUid === member.uid
                    ? "bg-blue-50/50 border-blue-200 shadow-sm"
                    : "bg-white hover:bg-slate-50 border-slate-100"
                }`}
              >
                <div className="min-w-0 flex items-center gap-3">
                  <div className={`p-2.5 rounded-xl flex items-center justify-center ${
                    selectedMemberUid === member.uid ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-500"
                  }`}>
                    <Users className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-sm font-bold text-slate-800 truncate">{member.name}</h3>
                    <div className="flex items-center gap-3 mt-1 text-[11px] text-slate-500 font-medium">
                      <span className="flex items-center gap-1">
                        <Phone className="w-3.5 h-3.5 text-slate-400" />
                        {member.phone}
                      </span>
                      {member.address && (
                        <span className="flex items-center gap-1 truncate max-w-[150px] hidden sm:flex">
                          <MapPin className="w-3.5 h-3.5 text-slate-400" />
                          {member.address}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <div className="text-right">
                    <div className="text-xs font-bold text-slate-800">
                      {Math.round(member.points || 0).toLocaleString()} <span className="text-[10px] text-blue-600 font-bold uppercase">Points</span>
                    </div>
                    <div className="text-[9px] text-slate-400 font-medium mt-0.5">
                      ເຂົ້າ {member.visits || 0} ເທື່ອ
                    </div>
                  </div>
                  <ChevronRight className={`w-4 h-4 text-slate-300 transition-transform ${
                    selectedMemberUid === member.uid ? "translate-x-0.5 text-blue-500" : ""
                  }`} />
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* ── Right Column: Member Detail & History ── */}
      <div className="w-full lg:w-[450px] xl:w-[500px] flex flex-col h-full overflow-hidden shrink-0 gap-6">
        {selectedMember ? (
          <div className="flex-1 bg-white border border-slate-100 rounded-3xl p-5 shadow-[0_8px_30px_rgb(0,0,0,0.02)] flex flex-col h-full overflow-hidden">
            
            {/* Profile Info Header */}
            <div className="flex items-start justify-between pb-4 border-b border-slate-100">
              <div className="min-w-0">
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 bg-blue-50 text-blue-700 rounded-md text-[9px] font-bold uppercase tracking-wider">
                  ຂໍ້ມູນສະມາຊິກ
                </span>
                <h2 className="text-xl font-bold text-slate-800 mt-1.5 truncate">{selectedMember.name}</h2>
                <div className="flex items-center gap-1 text-[11px] text-slate-500 font-medium mt-1">
                  <Calendar className="w-3.5 h-3.5 text-slate-400" />
                  <span>ສະໝັກວັນທີ: {selectedMember.createdAt ? new Date(selectedMember.createdAt).toLocaleDateString("lo-LA") : "ບໍ່ມີຂໍ້ມູນ"}</span>
                </div>
              </div>

              {/* Action buttons (Edit/Delete) */}
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => handleOpenEdit(selectedMember)}
                  className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-xl transition-all cursor-pointer"
                  title="ແກ້ໄຂຂໍ້ມູນ"
                >
                  <Edit className="w-4 h-4" />
                </button>
                {isManager && (
                  <button
                    onClick={() => handleDelete(selectedMember)}
                    className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-all cursor-pointer"
                    title="ລຶບສະມາຊິກ"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>

            {/* Profile Content Scrollable Area */}
            <div className="flex-1 overflow-y-auto py-4 space-y-5 pr-1">
              
              {/* Profile Contact Details Card */}
              <div className="p-3.5 bg-slate-50/50 rounded-2xl border border-slate-100 text-xs space-y-2">
                <div className="flex items-center gap-2 text-slate-700">
                  <Phone className="w-4 h-4 text-slate-400" />
                  <span className="font-semibold">ເບີໂທລະສັບ:</span>
                  <span className="font-mono text-slate-900">{selectedMember.phone}</span>
                </div>
                <div className="flex items-start gap-2 text-slate-700">
                  <MapPin className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
                  <div>
                    <span className="font-semibold">ທີ່ຢູ່:</span>{" "}
                    <span className="text-slate-900">{selectedMember.address || "ບໍ່ໄດ້ລະບຸທີ່ຢູ່"}</span>
                  </div>
                </div>
              </div>

              {/* Stats Grid */}
              <div className="grid grid-cols-3 gap-3">
                {/* Points Card */}
                <div className="bg-gradient-to-br from-blue-50 to-blue-50/20 border border-blue-100 p-3 rounded-2xl flex flex-col items-center text-center shadow-[0_4px_12px_rgba(59,130,246,0.02)]">
                  <div className="p-1.5 bg-blue-100 text-blue-700 rounded-lg">
                    <Award className="w-4 h-4" />
                  </div>
                  <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mt-2 block">ຄະແນນສະສົມ</span>
                  <span className="text-base font-extrabold text-blue-700 mt-0.5">
                    {Math.round(selectedMember.points || 0).toLocaleString()}
                  </span>
                </div>

                {/* Visits Card */}
                <div className="bg-slate-50/50 border border-slate-100 p-3 rounded-2xl flex flex-col items-center text-center">
                  <div className="p-1.5 bg-slate-100 text-slate-600 rounded-lg">
                    <ShoppingBag className="w-4 h-4" />
                  </div>
                  <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mt-2 block">ຈຳນວນເຂົ້າໃຊ້</span>
                  <span className="text-base font-extrabold text-slate-700 mt-0.5">
                    {selectedMember.visits || 0}
                  </span>
                </div>

                {/* Total Spend Card */}
                <div className="bg-slate-50/50 border border-slate-100 p-3 rounded-2xl flex flex-col items-center text-center">
                  <div className="p-1.5 bg-slate-100 text-slate-600 rounded-lg">
                    <TrendingUp className="w-4 h-4" />
                  </div>
                  <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mt-2 block">ຍອດຊື້ສະສົມ</span>
                  <span className="text-xs font-extrabold text-slate-700 mt-1 truncate max-w-full">
                    ₭{Math.round(selectedMember.totalSpend || 0).toLocaleString()}
                  </span>
                </div>
              </div>

              {/* Point Adjustment Section */}
              {isManager && (
                <div className="border border-slate-100 rounded-2xl p-4 bg-slate-50/30">
                  {!isAdjusting ? (
                    <button
                      onClick={() => setIsAdjusting(true)}
                      className="w-full flex items-center justify-center gap-2 py-2.5 border border-dashed border-blue-200 hover:border-blue-500 hover:bg-blue-50 text-blue-600 rounded-xl text-xs font-bold transition-all cursor-pointer"
                    >
                      <Sparkles className="w-4 h-4 text-blue-500" />
                      <span>ປັບປຸງຄະແນນດ້ວຍຕົນເອງ (Manual Adjustment)</span>
                    </button>
                  ) : (
                    <form onSubmit={handleAdjustSubmit} className="space-y-3">
                      <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                        <span className="text-[11px] font-bold text-slate-600">ປັບປຸງຄະແນນ (Manual Points)</span>
                        <button
                          type="button"
                          onClick={() => { setIsAdjusting(false); setAdjustError(""); }}
                          className="text-slate-400 hover:text-slate-600 cursor-pointer"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>

                      {adjustError && <p className="text-rose-500 text-[10px] font-semibold">{adjustError}</p>}

                      <div className="grid grid-cols-2 gap-2">
                        {/* Type Toggle Buttons */}
                        <button
                          type="button"
                          onClick={() => setAdjustType("ADD")}
                          className={`py-2 px-3 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                            adjustType === "ADD"
                              ? "bg-emerald-50 border-emerald-200 text-emerald-700 shadow-sm"
                              : "bg-white border-slate-200 text-slate-600"
                          }`}
                        >
                          <PlusCircle className="w-4 h-4" />
                          ເພີ່ມຄະແນນ
                        </button>
                        <button
                          type="button"
                          onClick={() => setAdjustType("DEDUCT")}
                          className={`py-2 px-3 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                            adjustType === "DEDUCT"
                              ? "bg-rose-50 border-rose-200 text-rose-700 shadow-sm"
                              : "bg-white border-slate-200 text-slate-600"
                          }`}
                        >
                          <MinusCircle className="w-4 h-4" />
                          ຫັກຄະແນນ
                        </button>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">ຈຳນວນຄະແນນ</label>
                          <input
                            type="number"
                            min="1"
                            required
                            placeholder="0"
                            value={adjustAmount}
                            onChange={(e) => setAdjustAmount(e.target.value)}
                            className="w-full mt-1 px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold focus:outline-none focus:border-blue-500"
                          />
                        </div>
                        <div>
                          <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">ເຫດຜົນ</label>
                          <input
                            type="text"
                            placeholder="ຕົວຢ່າງ: ແລກຂອງລາງວັນ..."
                            value={adjustReason}
                            onChange={(e) => setAdjustReason(e.target.value)}
                            className="w-full mt-1 px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none focus:border-blue-500"
                          />
                        </div>
                      </div>

                      <button
                        type="submit"
                        className={`w-full py-2 rounded-xl text-white text-xs font-bold transition-colors cursor-pointer ${
                          adjustType === "ADD" ? "bg-emerald-600 hover:bg-emerald-700" : "bg-rose-600 hover:bg-rose-700"
                        }`}
                      >
                        ຢືນຢັນການປັບປຸງ
                      </button>
                    </form>
                  )}
                </div>
              )}

              {/* Points History logs list */}
              <div className="space-y-3">
                <h3 className="text-xs font-bold text-slate-600 flex items-center gap-1.5 uppercase tracking-wider">
                  <History className="w-4 h-4 text-slate-400" />
                  ປະຫວັດການເຄື່ອນໄຫວຄະແນນ
                </h3>

                <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                  {pointLogs.length === 0 ? (
                    <div className="text-center py-6 text-slate-400 text-[11px]">
                      ບໍ່ມີປະຫວັດການເຄື່ອນໄຫວຄະແນນ
                    </div>
                  ) : (
                    pointLogs.map((log) => {
                      const isPositive = log.changePoints >= 0;
                      return (
                        <div key={log.id} className="p-3 bg-white border border-slate-100 rounded-xl flex items-center justify-between text-xs">
                          <div>
                            <div className="font-semibold text-slate-700">
                              {log.reason === "SALE" ? (
                                <span>ສະສົມຄະແນນຈາກບິນ #{log.saleId}</span>
                              ) : (
                                <span>ປັບປຸງຄະແນນ: {log.reason}</span>
                              )}
                            </div>
                            <div className="text-[10px] text-slate-400 mt-1">
                              {new Date(log.timestamp).toLocaleString("lo-LA")}
                            </div>
                          </div>
                          <div className="text-right">
                            <span className={`font-extrabold font-mono text-sm ${
                              isPositive ? "text-emerald-600" : "text-rose-600"
                            }`}>
                              {isPositive ? "+" : ""}{log.changePoints}
                            </span>
                            <div className="text-[9px] text-slate-400 mt-0.5">
                              ຄົງເຫຼືອ {log.pointsAfter}
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

            </div>
          </div>
        ) : (
          <div className="flex-1 bg-white border border-slate-100 rounded-3xl p-5 shadow-[0_8px_30px_rgb(0,0,0,0.02)] flex flex-col items-center justify-center text-center text-slate-400">
            <Users className="w-16 h-16 text-slate-200 mb-2" />
            <p className="text-sm font-bold text-slate-500">ກະລຸນາເລືອກສະມາຊິກ</p>
            <p className="text-xs mt-1">ເພື່ອເບິ່ງຂໍ້ມູນລະອຽດ, ສະຖິຕິ ແລະ ປະຫວັດຄະແນນ</p>
          </div>
        )}
      </div>

      {/* ── Add / Edit Member Modal ── */}
      {isFormOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl shadow-xl w-full max-w-md overflow-hidden animate-fade-in">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
                <Users className="w-5 h-5 text-blue-600" />
                {editingMember ? "ແກ້ໄຂຂໍ້ມູນສະມາຊິກ" : "ເພີ່ມສະມາຊິກໃໝ່"}
              </h3>
              <button
                onClick={() => setIsFormOpen(false)}
                className="text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <form onSubmit={handleSave} className="p-6 space-y-4">
              {formError && (
                <div className="p-3 bg-rose-50 border border-rose-100 rounded-2xl text-rose-600 text-xs font-semibold text-center">
                  {formError}
                </div>
              )}

              {/* Name field */}
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">ຊື່ສະມາຊິກ <span className="text-rose-500">*</span></label>
                <input
                  type="text"
                  required
                  placeholder="ຕົວຢ່າງ: ທ້າວ ສົມພອນ..."
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full mt-1.5 px-3 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none focus:border-blue-500"
                />
              </div>

              {/* Phone field */}
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">ເບີໂທລະສັບ <span className="text-rose-500">*</span></label>
                <input
                  type="tel"
                  required
                  placeholder="ຕົວຢ່າງ: 020 9XXXXXXX..."
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  className="w-full mt-1.5 px-3 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-semibold font-mono focus:outline-none focus:border-blue-500"
                />
              </div>

              {/* Address field */}
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">ທີ່ຢູ່ (ຖ້າມີ)</label>
                <textarea
                  placeholder="ຕົວຢ່າງ: ບ້ານ ໂພນສີນວນ, ເມືອງ ສີສັດຕະນາກ, ນະຄອນຫຼວງວຽງຈັນ..."
                  value={formData.address}
                  rows={3}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  className="w-full mt-1.5 px-3 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none focus:border-blue-500 resize-none"
                />
              </div>

              {/* Modal Actions */}
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsFormOpen(false)}
                  className="flex-1 py-2.5 border border-slate-200 text-slate-600 hover:bg-slate-50 rounded-xl text-xs font-bold transition-all cursor-pointer"
                >
                  ຍົກເລີກ
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-colors cursor-pointer"
                >
                  ບັນທຶກຂໍ້ມູນ
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default MembersView;

