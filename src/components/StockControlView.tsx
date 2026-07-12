/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from "react";
import { 
  Plus, Minus, RefreshCw, ClipboardList, Play, X, ShieldAlert, 
  Edit, Trash2, Camera, Check, Search, Tag, DollarSign, AlertTriangle, Barcode
} from "lucide-react";
import { MenuItem, StockLog, isOnPromo } from "../types";
import CameraScanner from "./CameraScanner";

interface StockControlViewProps {
  menuItems: MenuItem[];
  stockLogs: StockLog[];
  onRestockItem: (itemId: number, changeQty: number) => void;
  onAdjustStockItem: (itemId: number, changeQty: number, reason: string) => void;
  onAddMenuItem?: (name: string, price: number, category: string, stock: number, threshold: number, barcode: string | null, imageUrl?: string | null, costPrice?: number, promoPrice?: number) => void;
  onUpdateMenuItem?: (id: number, name: string, price: number, category: string, stock: number, threshold: number, barcode: string | null, imageUrl?: string | null, costPrice?: number, promoPrice?: number) => void;
  onDeleteMenuItem?: (id: number) => void;
}

export default function StockControlView({
  menuItems,
  stockLogs,
  onRestockItem,
  onAdjustStockItem,
  onAddMenuItem,
  onUpdateMenuItem,
  onDeleteMenuItem
}: StockControlViewProps) {
  // Alert lists
  const outOfStockItems = menuItems.filter(item => item.stockQty === 0);
  const lowStockItems = menuItems.filter(item => item.stockQty > 0 && item.stockQty <= item.lowStockThreshold);

  // Filter & Search
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");

  // Audit Logs Visibility state
  const [showHistory, setShowHistory] = useState(false);

  // Category management states
  const [customCategories, setCustomCategories] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem("saletracker_custom_categories");
      return stored ? JSON.parse(stored) : ["ເຄື່ອງດື່ມ", "ອາຫານ", "ຂະໜົມ"];
    } catch (e) {
      return ["ເຄື່ອງດື່ມ", "ອາຫານ", "ຂະໜົມ"];
    }
  });
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [newCategoryInput, setNewCategoryInput] = useState("");
  const [showInlineAddCategory, setShowInlineAddCategory] = useState(false);

  const handleAddCustomCategory = (newCat: string) => {
    const trimmed = newCat.trim();
    if (!trimmed) return;
    if (customCategories.includes(trimmed)) {
      showNotification("ໝວດໝູ່ນີ້ມີຢູ່ແລ້ວ!", true);
      return;
    }
    const updated = [...customCategories, trimmed];
    setCustomCategories(updated);
    localStorage.setItem("saletracker_custom_categories", JSON.stringify(updated));
    showNotification(`ເພີ່ມໝວດໝູ່ "${trimmed}" ສຳເລັດແລ້ວ!`);
  };

  const requestDeleteCustomCategory = (catToDelete: string) => {
    setDeletingCategory(catToDelete);
    setManagerConfirmText("");
  };

  const handleConfirmDeleteCustomCategory = () => {
    if (!deletingCategory) return;
    if (managerConfirmText !== managerConfirmPhrase) {
      showNotification("ການຢືນຢັນ Manager ບໍ່ຖືກຕ້ອງ. ກະລຸນາພິມ MANAGER.", true);
      return;
    }
    const catToDelete = deletingCategory;
    const updated = customCategories.filter(c => c !== catToDelete);
    setCustomCategories(updated);
    localStorage.setItem("saletracker_custom_categories", JSON.stringify(updated));
    showNotification(`ລຶບໝວດໝູ່ "${catToDelete}" ສຳເລັດແລ້ວ!`);
    if (selectedCategory === catToDelete) {
      setSelectedCategory("all");
    }
    setDeletingCategory(null);
    setManagerConfirmText("");
  };

  const uniqueCategoriesFromItems = Array.from(new Set(menuItems.map(item => item.category)));
  const allCategories = Array.from(new Set([...uniqueCategoriesFromItems, ...customCategories]));

  // Search input change handler to clear exact scanning filters
  const handleSearchChange = (val: string) => {
    setSearchQuery(val);
  };

  // Adjust dialog states (Manual custom adjustment)
  const [selectedAdjustItem, setSelectedAdjustItem] = useState<MenuItem | null>(null);
  const [adjustQtyInput, setAdjustQtyInput] = useState("");
  const [adjustReason, setAdjustReason] = useState("ADJUSTMENT"); // ADJUSTMENT, DAMAGE, RESTOCK

  // Individual row custom restock quantity input states
  // Key: item ID, Value: text quantity (defaulting to "10")
  const [restockQtys, setRestockQtys] = useState<{ [itemId: number]: string }>({});
  const [labelQtys, setLabelQtys] = useState<{ [itemId: number]: string }>({});

  // Product Add / Edit modal states
  const [showProductModal, setShowProductModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState<MenuItem | null>(null);
  const [prodName, setProdName] = useState("");
  const [prodPrice, setProdPrice] = useState("");
  const [prodCost, setProdCost] = useState("");
  const [prodPromo, setProdPromo] = useState("");
  const [prodCategory, setProdCategory] = useState("");
  const [prodStock, setProdStock] = useState("");
  const [prodThreshold, setProdThreshold] = useState("");
  const [prodBarcode, setProdBarcode] = useState("");
  const [prodImageUrl, setProdImageUrl] = useState("");

  // Product Delete safe confirmation dialog state
  const [deletingProductItem, setDeletingProductItem] = useState<MenuItem | null>(null);
  const [deletingCategory, setDeletingCategory] = useState<string | null>(null);
  const [managerConfirmText, setManagerConfirmText] = useState("");
  const managerConfirmPhrase = "MANAGER";

  // Camera scanner states
  const [showCameraScanner, setShowCameraScanner] = useState(false);
  const [scannerTarget, setScannerTarget] = useState<"lookup" | "form">("lookup");

  // Notifications
  const [notification, setNotification] = useState<{ message: string; isError?: boolean } | null>(null);
  const showNotification = (message: string, isError = false) => {
    setNotification({ message, isError });
    setTimeout(() => setNotification(null), 3500);
  };
  const roundMoney = (value: number) => Number((Math.round((Number(value) || 0) * 100) / 100).toFixed(2));
  const formatMoneyInput = (value: number) => roundMoney(value).toFixed(2);

  // Filter items matching query & selected category
  const filteredItems = menuItems.filter(item => {
    const matchesSearch = item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (item.barcode && item.barcode.includes(searchQuery)) ||
      item.category.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesCategory = selectedCategory === "all" || item.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  // Action helpers for custom numeric count in rows
  const handleRestockQtyChange = (itemId: number, val: string) => {
    setRestockQtys(prev => ({ ...prev, [itemId]: val }));
  };

  const handleLabelQtyChange = (itemId: number, val: string) => {
    setLabelQtys(prev => ({ ...prev, [itemId]: val }));
  };

  const handlePrintBarcodeLabels = (item: MenuItem) => {
    const qtyStr = labelQtys[item.id] !== undefined ? labelQtys[item.id] : "1";
    const qty = Math.max(1, Math.min(999, parseInt(qtyStr) || 1));
    const barcode = item.barcode?.trim();

    if (!barcode) {
      showNotification(`"${item.name}" ຍັງບໍ່ມີບາໂຄດ. ກະລຸນາແກ້ໄຂສິນຄ້າແລ້ວເພີ່ມບາໂຄດກ່ອນ.`, true);
      return;
    }

    import("../utils/exporters")
      .then(({ exporters }) => {
        exporters.printBarcodeLabels([{ item, quantity: qty }]);
        showNotification(`ເປີດໜ້າພິມປ້າຍບາໂຄດ 20mm ຈຳນວນ ${qty} ດວງແລ້ວ!`);
      })
      .catch((error) => {
        console.error("Barcode label print failed", error);
        showNotification(error instanceof Error ? error.message : "ພິມປ້າຍບາໂຄດບໍ່ສຳເລັດ", true);
      });
  };

  const handleDownloadAllBarcodeLabels = () => {
    import("../utils/exporters")
      .then(({ exporters }) => {
        const result = exporters.downloadBarcodeLabelsFile(menuItems);
        const skippedText = result.skippedCount > 0 ? ` (${result.skippedCount} ລາຍການບໍ່ມີບາໂຄດ)` : "";
        showNotification(`ດາວໂຫຼດປ້າຍບາໂຄດ 20mm ${result.exportedCount} ລາຍການແລ້ວ${skippedText}`);
      })
      .catch((error) => {
        console.error("Bulk barcode label download failed", error);
        showNotification(error instanceof Error ? error.message : "ດາວໂຫຼດປ້າຍບາໂຄດບໍ່ສຳເລັດ", true);
      });
  };

  const incrementRestockQty = (itemId: number) => {
    const currentValStr = restockQtys[itemId] !== undefined ? restockQtys[itemId] : "10";
    const current = parseInt(currentValStr) || 0;
    setRestockQtys(prev => ({ ...prev, [itemId]: (current + 1).toString() }));
  };

  const decrementRestockQty = (itemId: number) => {
    const currentValStr = restockQtys[itemId] !== undefined ? restockQtys[itemId] : "10";
    const current = parseInt(currentValStr) || 0;
    const nextVal = Math.max(1, current - 1);
    setRestockQtys(prev => ({ ...prev, [itemId]: nextVal.toString() }));
  };

  // Restock action using typed value or incremented value
  const handleRowRestockSubmit = (item: MenuItem) => {
    const customValStr = restockQtys[item.id] !== undefined ? restockQtys[item.id] : "10";
    const val = parseInt(customValStr) || 0;
    if (val <= 0) {
      showNotification("ກະລຸນາປ້ອນຈຳນວນຫຼາຍກວ່າ 0 ເພື່ອເພີ່ມສະຕັອກ.", true);
      return;
    }
    onRestockItem(item.id, val);
    showNotification(`ເພີ່ມສະຕັອກ "${item.name}" +${val} ສຳເລັດແລ້ວ!`);
  };

  // Manual Adjust Modal Handler
  const handleApplyAdjustment = () => {
    if (!selectedAdjustItem) return;
    const changeQty = parseInt(adjustQtyInput) || 0;
    if (changeQty === 0) {
      showNotification("ກະລຸນາປ້ອນຈຳນວນທີ່ຕ້ອງການປັບປຸງສະຕັອກໃຫ້ຖືກຕ້ອງ.", true);
      return;
    }

    onAdjustStockItem(selectedAdjustItem.id, changeQty, adjustReason);
    showNotification(`ປັບປຸງສະຕັອກ "${selectedAdjustItem.name}" ສຳເລັດແລ້ວ!`);
    setSelectedAdjustItem(null);
    setAdjustQtyInput("");
    setAdjustReason("ADJUSTMENT");
  };

  // Product Add / Edit Submit Handler
  const handleProductSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const name = prodName.trim();
    const price = roundMoney(parseFloat(prodPrice) || 0);
    const costPrice = roundMoney(parseFloat(prodCost) || 0);
    const promoPrice = roundMoney(parseFloat(prodPromo) || 0);
    const category = prodCategory.trim() || "ອື່ນໆ";
    const stock = parseInt(prodStock) || 0;
    const threshold = parseInt(prodThreshold) || 0;
    const barcode = prodBarcode.trim() || null;
    const imageUrl = prodImageUrl.trim() || null;

    if (!name) {
      showNotification("ກະລຸນາປ້ອນຊື່ສິນຄ້າ.", true);
      return;
    }
    if (price <= 0) {
      showNotification("ກະລຸນາປ້ອນລາຄາສິນຄ້າໃຫ້ຖືກຕ້ອງ.", true);
      return;
    }
    if (costPrice < 0) {
      showNotification("ລາຄາຕົ້ນທຶນຕ້ອງບໍ່ເປັນຄ່າຕິດລົບ.", true);
      return;
    }
    if (promoPrice < 0) {
      showNotification("ລາຄາສ່ວນຫຼຸດຕ້ອງບໍ່ເປັນຄ່າຕິດລົບ.", true);
      return;
    }
    if (promoPrice > 0 && promoPrice >= price) {
      showNotification("ລາຄາສ່ວນຫຼຸດຕ້ອງຕ່ຳກວ່າລາຄາຂາຍປົກກະຕິ.", true);
      return;
    }

    if (editingProduct) {
      if (onUpdateMenuItem) {
        onUpdateMenuItem(editingProduct.id, name, price, category, stock, threshold, barcode, imageUrl, costPrice, promoPrice);
        showNotification(`ອັບເດດຂໍ້ມູນສິນຄ້າ "${name}" ແລ້ວ!`);
      }
    } else {
      if (onAddMenuItem) {
        onAddMenuItem(name, price, category, stock, threshold, barcode, imageUrl, costPrice, promoPrice);
        showNotification(`ເພີ່ມສິນຄ້າໃໝ່ "${name}" ສຳເລັດ!`);
      }
    }

    setShowProductModal(false);
    setEditingProduct(null);
    clearProductForm();
  };

  // Deletion submit
  const handleConfirmDeleteProduct = () => {
    if (!deletingProductItem) return;
    if (managerConfirmText !== managerConfirmPhrase) {
      showNotification("ການຢືນຢັນ Manager ບໍ່ຖືກຕ້ອງ. ກະລຸນາພິມ MANAGER.", true);
      return;
    }
    if (onDeleteMenuItem) {
      onDeleteMenuItem(deletingProductItem.id);
      showNotification(`ລຶບສິນຄ້າ "${deletingProductItem.name}" ອອກຈາກລະບົບແລ້ວ!`);
    }
    setDeletingProductItem(null);
    setManagerConfirmText("");
  };

  const clearProductForm = () => {
    setProdName("");
    setProdPrice("");
    setProdCost("");
    setProdPromo("");
    setProdCategory("");
    setProdStock("");
    setProdThreshold("5");
    setProdBarcode("");
    setProdImageUrl("");
  };

  const openAddProductModal = () => {
    clearProductForm();
    setEditingProduct(null);
    setShowProductModal(true);
  };

  const openEditProductModal = (item: MenuItem) => {
    setEditingProduct(item);
    setProdName(item.name);
    setProdPrice(formatMoneyInput(item.price));
    setProdCost(formatMoneyInput(item.costPrice !== undefined ? item.costPrice : 0));
    setProdPromo(item.promoPrice && item.promoPrice > 0 ? formatMoneyInput(item.promoPrice) : "");
    setProdCategory(item.category);
    setProdStock(item.stockQty.toString());
    setProdThreshold(item.lowStockThreshold.toString());
    setProdBarcode(item.barcode || "");
    setProdImageUrl(item.imageUrl || "");
    setShowProductModal(true);
  };

  // Camera scanner scanned event
  const handleCameraScan = (barcode: string) => {
    if (scannerTarget === "form") {
      setProdBarcode(barcode);
      setShowCameraScanner(false);
      showNotification(`ສະແກນບາໂຄດສຳເລັດ: ${barcode}`);
    } else {
      // Lookup scanner
      const matched = menuItems.find(item => item.barcode === barcode);
      if (matched) {
        setSearchQuery(barcode);
        setSelectedAdjustItem(matched);
        setShowCameraScanner(false);
        showNotification(`ພົບສິນຄ້າ "${matched.name}". ກະລຸນາປັບສະຕັອກ.`);
      } else {
        // Not found - let user create it!
        clearProductForm();
        setProdBarcode(barcode);
        setProdCategory("ເຄື່ອງດື່ມ");
        setProdStock("10");
        setProdThreshold("5");
        setEditingProduct(null);
        setScannerTarget("form");
        setShowProductModal(true);
        setShowCameraScanner(false);
        showNotification(`ບໍ່ພົບສິນຄ້າ! ພ້ອມເພີ່ມສິນຄ້າໃໝ່ດ້ວຍບາໂຄດ: ${barcode}`, true);
      }
    }
  };

  // Unique categories list to help form suggestions
  const uniqueCategories = Array.from(new Set(menuItems.map(item => item.category)));

  return (
    <div id="stock-view-container" className="grid grid-cols-1 lg:grid-cols-12 gap-6 h-full p-1 lg:p-4 select-none relative">
      
      {/* Floating notifications */}
      {notification && (
        <div 
          id="stock-notification-banner"
          className={`fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-3 rounded-xl border shadow-2xl text-sm font-semibold transition-all animate-bounce ${
            notification.isError 
              ? "bg-rose-50 border-rose-200 text-rose-700" 
              : "bg-blue-50 border-blue-200 text-blue-700"
          }`}
        >
          <div className={`w-2 h-2 rounded-full ${notification.isError ? "bg-rose-500" : "bg-blue-500"}`} />
          <span>{notification.message}</span>
        </div>
      )}

      {/* LEFT COLUMN: Main stock level controls */}
      <div id="stock-levels-section" className={`${showHistory ? "lg:col-span-8" : "lg:col-span-12"} flex flex-col gap-6 transition-all duration-300`}>
        
        {/* Urgent Alerts Bento Box */}
        {(outOfStockItems.length > 0 || lowStockItems.length > 0) && (
          <div id="stock-alerts-card" className="bg-rose-50 border border-rose-100 p-4 rounded-3xl flex flex-col gap-3">
            <div className="flex items-center gap-2 text-rose-800 font-bold text-sm">
              <ShieldAlert className="w-5 h-5 text-rose-600 animate-pulse" />
              <span>ຄຳເຕືອນສະຕັອກສິນຄ້າ</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Out of stock list */}
              {outOfStockItems.length > 0 && (
                <div className="bg-white border border-rose-100 p-3 rounded-2xl">
                  <span className="text-[10px] font-bold text-rose-500 uppercase tracking-wide">ໝົດສະຕັອກ ({outOfStockItems.length})</span>
                  <div className="mt-1.5 space-y-1 text-xs font-semibold text-slate-700 max-h-[80px] overflow-y-auto">
                    {outOfStockItems.map(it => (
                      <div key={it.id} className="flex justify-between">• {it.name} <span className="text-rose-500 font-bold">0 ໃນສະຕັອກ</span></div>
                    ))}
                  </div>
                </div>
              )}

              {/* Low stock list */}
              {lowStockItems.length > 0 && (
                <div className="bg-white border border-amber-100 p-3 rounded-2xl">
                  <span className="text-[10px] font-bold text-amber-600 uppercase tracking-wide">ສິນຄ້າໃກ້ໝົດສະຕັອກ ({lowStockItems.length})</span>
                  <div className="mt-1.5 space-y-1 text-xs font-semibold text-slate-700 max-h-[80px] overflow-y-auto">
                    {lowStockItems.map(it => (
                      <div key={it.id} className="flex justify-between">• {it.name} <span className="text-amber-500 font-bold">ຍັງເຫຼືອ {it.stockQty}</span></div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Catalog Table */}
        <div id="stock-levels-table-card" className="bg-white border border-slate-100 rounded-3xl overflow-hidden shadow-[0_4px_24px_rgba(0,0,0,0.02)] flex flex-col flex-1">
          {/* Header Controls */}
          <div className="p-5 border-b border-slate-100 bg-slate-50/20 flex flex-wrap gap-4 items-center justify-between">
            <div>
              <h3 className="text-base font-extrabold text-slate-800 font-sans tracking-tight">ລະດັບສະຕັອກສິນຄ້າທັງໝົດ</h3>
              <p className="text-[11px] text-slate-400 font-semibold font-sans mt-0.5">ສະແດງທັງໝົດ {filteredItems.length} ລາຍການ</p>
            </div>
            
            <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
              {/* Toggle History Button */}
              <button
                id="stock-btn-toggle-history"
                onClick={() => setShowHistory(prev => !prev)}
                className={`flex items-center justify-center gap-1.5 px-3 py-2 border rounded-xl text-xs font-bold transition-all cursor-pointer shadow-sm font-sans ${
                  showHistory 
                    ? "bg-blue-600 border-blue-600 text-white hover:bg-blue-700"
                    : "bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100"
                }`}
              >
                <ClipboardList className="w-4 h-4" />
                <span>{showHistory ? "ປິດປະຫວັດ" : "ເບິ່ງປະຫວັດການເຄື່ອນໄຫວ"}</span>
              </button>

              {/* Search */}
              <div id="stock-search-wrapper" className="relative flex-1 sm:max-w-xs sm:w-56">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
                <input
                  id="stock-search"
                  type="text"
                  placeholder="ຄົ້ນຫາດ້ວຍຊື່, ບາໂຄດ..."
                  value={searchQuery}
                  onChange={(e) => handleSearchChange(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-150 rounded-xl text-xs font-semibold focus:outline-none focus:border-blue-500 focus:bg-white transition-colors"
                />
                {searchQuery && (
                  <button type="button" onClick={() => setSearchQuery("")} aria-label="ລ້າງການຄົ້ນຫາ" title="ລ້າງການຄົ້ນຫາ" className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600">
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* Scan Barcode button */}
              <button
                id="stock-btn-scan-header"
                onClick={() => {
                  setScannerTarget("lookup");
                  setShowCameraScanner(true);
                }}
                className="flex items-center justify-center gap-1.5 px-3 py-2 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-xl text-xs text-blue-700 font-bold transition-all cursor-pointer shadow-sm"
              >
                <Camera className="w-4 h-4" />
                <span>ສະແກນ</span>
              </button>

              {/* Add product button */}
              {onAddMenuItem && (
                <button
                  id="stock-btn-add-product"
                  onClick={openAddProductModal}
                  className="flex items-center justify-center gap-1 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-all cursor-pointer shadow-sm shadow-blue-100"
                >
                  <Plus className="w-4 h-4" />
                  <span>ເພີ່ມສິນຄ້າ</span>
                </button>
              )}
            </div>
          </div>

          {/* Sub-header Categories & Exporters Bar */}
          <div id="stock-categories-exporters-bar" className="px-5 py-3 border-b border-slate-100 bg-slate-50/10 flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
            {/* Category tabs */}
            <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none py-1 w-full sm:w-auto">
              <button
                id="stock-cat-tab-all"
                onClick={() => setSelectedCategory("all")}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-all cursor-pointer font-sans whitespace-nowrap ${
                  selectedCategory === "all"
                    ? "bg-blue-600 border-blue-600 text-white shadow-sm"
                    : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                }`}
              >
                ທັງໝົດ
              </button>
              {allCategories.map(cat => (
                <button
                  id={`stock-cat-tab-${cat}`}
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-all cursor-pointer font-sans whitespace-nowrap ${
                    selectedCategory === cat
                      ? "bg-blue-600 border-blue-600 text-white shadow-sm"
                      : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>

            {/* Manage Categories & Export buttons */}
            <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
              <button
                id="stock-btn-manage-categories"
                onClick={() => setShowCategoryModal(true)}
                className="flex items-center justify-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 border border-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-all cursor-pointer shadow-sm font-sans whitespace-nowrap"
              >
                <Tag className="w-3.5 h-3.5 text-slate-500" />
                <span>ຈັດການໝວດໝູ່</span>
              </button>

              <div className="h-5 w-px bg-slate-200 mx-1"></div>

              {/* Export to Excel */}
              <button
                id="stock-btn-export-excel"
                aria-label="ສົ່ງອອກ Stock Excel"
                title="ສົ່ງອອກ Stock Excel"
                onClick={() => {
                  import("../utils/exporters")
                    .then(({ exporters }) => {
                      exporters.exportStockToExcel(menuItems);
                      showNotification("ສົ່ງອອກ Stock Excel ສຳເລັດແລ້ວ!");
                    })
                    .catch(() => showNotification("ສົ່ງອອກ Excel ບໍ່ສຳເລັດ", true));
                }}
                className="flex items-center justify-center gap-1.5 px-3 py-1.5 bg-emerald-55 hover:bg-emerald-100 border border-emerald-200 text-emerald-700 rounded-xl text-xs font-bold transition-all cursor-pointer shadow-sm font-sans whitespace-nowrap"
              >
                <span>Excel</span>
              </button>

              {/* Export to PDF */}
              <button
                id="stock-btn-export-pdf"
                aria-label="ສົ່ງອອກ Stock PDF"
                title="ສົ່ງອອກ Stock PDF"
                onClick={() => {
                  import("../utils/exporters")
                    .then(({ exporters }) => {
                      exporters.exportStockToPDF(menuItems);
                      showNotification("ເປີດໜ້າພິມ Stock PDF ສຳເລັດແລ້ວ!");
                    })
                    .catch(() => showNotification("ສົ່ງອອກ PDF ບໍ່ສຳເລັດ", true));
                }}
                className="flex items-center justify-center gap-1.5 px-3 py-1.5 bg-rose-55 hover:bg-rose-100 border border-rose-200 text-rose-700 rounded-xl text-xs font-bold transition-all cursor-pointer shadow-sm font-sans whitespace-nowrap"
              >
                <span>PDF</span>
              </button>

              {/* Download all 20mm barcode labels */}
              <button
                id="stock-btn-download-barcode-labels"
                aria-label="ດາວໂຫຼດປ້າຍບາໂຄດ 20mm ທັງໝົດ"
                title="ດາວໂຫຼດປ້າຍບາໂຄດ 20mm ທັງໝົດ"
                onClick={handleDownloadAllBarcodeLabels}
                className="flex items-center justify-center gap-1.5 px-3 py-1.5 bg-emerald-55 hover:bg-emerald-100 border border-emerald-200 text-emerald-700 rounded-xl text-xs font-bold transition-all cursor-pointer shadow-sm font-sans whitespace-nowrap"
              >
                <Barcode className="w-3.5 h-3.5" />
                <span>Labels</span>
              </button>
            </div>
          </div>

          {/* Big scrollable list */}
          <div className="overflow-x-auto flex-1 max-h-[680px] overflow-y-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/70 border-b border-slate-100 text-[10px] font-extrabold text-slate-500 uppercase tracking-wider sticky top-0 z-10 backdrop-blur-sm">
                  <th className="px-3 py-3 sm:px-6 sm:py-4 whitespace-nowrap">ຊື່ສິນຄ້າ</th>
                  <th className="px-3 py-3 sm:px-6 sm:py-4 text-right whitespace-nowrap">ລາຄາຕົ້ນທຶນ</th>
                  <th className="px-3 py-3 sm:px-6 sm:py-4 text-right whitespace-nowrap">ລາຄາຂາຍ</th>
                  <th className="px-3 py-3 sm:px-6 sm:py-4 text-right whitespace-nowrap">ຈຳນວນໃນສະຕັອກ</th>
                  <th className="px-3 py-3 sm:px-6 sm:py-4 text-right whitespace-nowrap">ເກນແຈ້ງເຕືອນ</th>
                  <th className="px-3 py-3 sm:px-6 sm:py-4 text-center whitespace-nowrap">ເພີ່ມ/ຫຼຸດ ສະຕັອກ (ພິມໄດ້)</th>
                  <th className="px-3 py-3 sm:px-6 sm:py-4 text-center whitespace-nowrap">ຈັດການ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700 text-xs">
                {filteredItems.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-20 text-center text-slate-400 font-semibold font-sans">
                      ບໍ່ມີສິນຄ້າທີ່ກົງກັບການຄົ້ນຫາຂອງທ່ານ.
                    </td>
                  </tr>
                ) : (
                  filteredItems.map(item => {
                    const isOutOfStock = item.stockQty === 0;
                    const isLowStock = item.stockQty > 0 && item.stockQty <= item.lowStockThreshold;
                    const customQtyStr = restockQtys[item.id] !== undefined ? restockQtys[item.id] : "10";
                    const labelQtyStr = labelQtys[item.id] !== undefined ? labelQtys[item.id] : "1";

                    return (
                      <tr id={`stock-row-${item.id}`} key={item.id} className="hover:bg-slate-50/40 transition-colors group">
                        {/* Name and Barcode */}
                        <td className="px-3 py-3 sm:px-6 sm:py-4 whitespace-nowrap">
                          <div className="flex items-center gap-3">
                            {/* Product Thumbnail */}
                            <div className="w-10 h-10 rounded-xl bg-slate-50 border border-slate-150 overflow-hidden flex items-center justify-center shrink-0 shadow-sm">
                              {item.imageUrl ? (
                                <img 
                                  src={item.imageUrl} 
                                  alt={item.name} 
                                  referrerPolicy="no-referrer"
                                  className="w-full h-full object-cover" 
                                />
                              ) : (
                                <Tag className="w-4.5 h-4.5 text-slate-300" />
                              )}
                            </div>
                            <div>
                              <div className="font-extrabold text-slate-800 text-sm">{item.name}</div>
                              <div className="flex items-center gap-2 mt-1">
                                <span className="px-1.5 py-0.5 bg-slate-100 text-slate-500 rounded text-[9px] font-bold tracking-wider">
                                  {item.category}
                                </span>
                                {item.barcode && (
                                  <span className="text-[10px] font-mono text-slate-400 tracking-tight">
                                    {item.barcode}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        </td>

                        {/* Cost Price */}
                        <td className="px-3 py-3 sm:px-6 sm:py-4 text-right font-mono font-bold text-slate-500 whitespace-nowrap">
                          ₭{(item.costPrice || 0).toLocaleString()}
                        </td>

                        {/* Price (with promo when active) */}
                        <td className="px-3 py-3 sm:px-6 sm:py-4 text-right font-mono font-bold text-slate-600 whitespace-nowrap">
                          {isOnPromo(item) ? (
                            <span className="inline-flex flex-col items-end leading-tight">
                              <span className="text-blue-600">₭{(item.promoPrice || 0).toLocaleString()}</span>
                              <span className="text-[10px] text-slate-400 line-through">₭{item.price.toLocaleString()}</span>
                            </span>
                          ) : (
                            <>₭{item.price.toLocaleString()}</>
                          )}
                        </td>

                        {/* Stock status badge */}
                        <td className="px-3 py-3 sm:px-6 sm:py-4 text-right font-mono whitespace-nowrap">
                          {isOutOfStock ? (
                            <span className="text-rose-700 bg-rose-50 border border-rose-100 px-2.5 py-1 rounded-xl text-[10px] font-extrabold inline-block">
                              ໝົດສະຕັອກ
                            </span>
                          ) : isLowStock ? (
                            <span className="text-amber-700 bg-amber-50 border border-amber-100 px-2.5 py-1 rounded-xl text-[10px] font-extrabold inline-block">
                              {item.stockQty} (ໃກ້ໝົດ)
                            </span>
                          ) : (
                            <span className="text-slate-850 font-bold bg-slate-50 px-2.5 py-1 rounded-xl border border-slate-100 text-[11px] inline-block">
                              {item.stockQty}
                            </span>
                          )}
                        </td>

                        {/* Threshold */}
                        <td className="px-3 py-3 sm:px-6 sm:py-4 text-right font-mono text-slate-400 font-semibold whitespace-nowrap">
                          {item.lowStockThreshold} ລາຍການ
                        </td>

                        {/* Inline custom typing quantity box with decrement/increment */}
                        <td className="px-3 py-3 sm:px-6 sm:py-4 whitespace-nowrap">
                          <div className="flex items-center justify-center gap-1.5">
                            <div className="flex items-center bg-slate-50 border border-slate-200 rounded-xl overflow-hidden shadow-sm h-8">
                              {/* Minus */}
                              <button
                                type="button"
                                aria-label={`ຫຼຸດຈຳນວນເພີ່ມສະຕັອກ ${item.name}`}
                                title="ຫຼຸດຈຳນວນ"
                                onClick={() => decrementRestockQty(item.id)}
                                className="px-2 h-full text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition-colors border-r border-slate-150 cursor-pointer flex items-center justify-center"
                              >
                                <Minus className="w-3 h-3" />
                              </button>
                              
                              {/* Value Input (Typing is supported) */}
                              <input
                                type="number"
                                value={customQtyStr}
                                onChange={(e) => handleRestockQtyChange(item.id, e.target.value)}
                                className="w-12 text-center bg-transparent border-0 font-extrabold font-mono text-xs focus:outline-none focus:ring-0 p-0 text-slate-800"
                                min="1"
                              />

                              {/* Plus */}
                              <button
                                type="button"
                                aria-label={`ເພີ່ມຈຳນວນເພີ່ມສະຕັອກ ${item.name}`}
                                title="ເພີ່ມຈຳນວນ"
                                onClick={() => incrementRestockQty(item.id)}
                                className="px-2 h-full text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition-colors border-l border-slate-150 cursor-pointer flex items-center justify-center"
                              >
                                <Plus className="w-3 h-3" />
                              </button>
                            </div>

                            {/* Action apply button */}
                            <button
                              id={`stock-restock-btn-${item.id}`}
                              onClick={() => handleRowRestockSubmit(item)}
                              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-[10px] font-bold transition-all shadow-sm shadow-blue-100 cursor-pointer whitespace-nowrap"
                            >
                              ເພີ່ມສະຕັອກ
                            </button>
                          </div>
                        </td>

                        {/* Barcode label, edit, and delete actions */}
                        <td className="px-3 py-3 sm:px-6 sm:py-4 whitespace-nowrap">
                          <div className="flex items-center justify-center gap-2">
                            <div className="flex items-center bg-emerald-50 border border-emerald-100 rounded-lg overflow-hidden shadow-sm h-8">
                              <input
                                id={`stock-label-qty-${item.id}`}
                                type="number"
                                min="1"
                                max="999"
                                value={labelQtyStr}
                                onChange={(e) => handleLabelQtyChange(item.id, e.target.value)}
                                aria-label={`ຈຳນວນປ້າຍບາໂຄດ ${item.name}`}
                                title="ຈຳນວນປ້າຍ"
                                className="w-10 h-full text-center bg-white/60 border-0 border-r border-emerald-100 font-extrabold font-mono text-[10px] focus:outline-none focus:ring-0 p-0 text-emerald-900"
                              />
                              <button
                                id={`stock-print-barcode-label-btn-${item.id}`}
                                type="button"
                                onClick={() => handlePrintBarcodeLabels(item)}
                                title="ພິມປ້າຍບາໂຄດ 20mm"
                                aria-label={`ພິມປ້າຍບາໂຄດ 20mm ${item.name}`}
                                className="h-full px-2 flex items-center gap-1 text-emerald-700 hover:bg-emerald-100 transition-colors cursor-pointer text-[10px] font-bold"
                              >
                                <Barcode className="w-3.5 h-3.5" />
                                <span>20mm</span>
                              </button>
                            </div>

                            {/* Manual adjust stock details */}
                            <button
                              id={`stock-adjust-btn-${item.id}`}
                              onClick={() => setSelectedAdjustItem(item)}
                              title="ປັບປຸງເອງລະອຽດ"
                              className="px-2 py-1.5 bg-slate-50 text-slate-600 hover:bg-slate-100 border border-slate-200 rounded-lg text-[10px] font-bold transition-colors cursor-pointer whitespace-nowrap"
                            >
                              ປັບປຸງເອງ
                            </button>

                            {/* Edit product details */}
                            {onUpdateMenuItem && (
                              <button
                                onClick={() => openEditProductModal(item)}
                                title="ແກ້ໄຂສິນຄ້າ"
                                aria-label={`ແກ້ໄຂສິນຄ້າ ${item.name}`}
                                className="p-1.5 hover:bg-blue-50 text-blue-600 rounded-lg border border-transparent hover:border-blue-100 transition-colors cursor-pointer"
                              >
                                <Edit className="w-3.5 h-3.5" />
                              </button>
                            )}

                            {/* Delete product */}
                            {onDeleteMenuItem && (
                              <button
                                onClick={() => {
                                  setDeletingProductItem(item);
                                  setManagerConfirmText("");
                                }}
                                title="ລຶບສິນຄ້າ"
                                aria-label={`ລຶບສິນຄ້າ ${item.name}`}
                                className="p-1.5 hover:bg-rose-50 text-rose-600 rounded-lg border border-transparent hover:border-rose-100 transition-colors cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* RIGHT COLUMN: Recent Stock Logs Audit Feed */}
      {showHistory && (
        <div id="stock-audit-logs-section" className="lg:col-span-4 bg-white rounded-3xl border border-slate-100 shadow-[0_8px_30px_rgb(0,0,0,0.01)] flex flex-col overflow-hidden max-h-[calc(100vh-140px)] animate-fade-in">
          <div id="stock-logs-header" className="p-5 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ClipboardList className="w-5 h-5 text-blue-600" />
              <h3 className="font-extrabold text-slate-800 text-sm font-sans">ປະຫວັດການເຄື່ອນໄຫວ</h3>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold text-slate-400 bg-slate-100 px-2 py-0.5 rounded">
                ຫຼ້າສຸດ 200
              </span>
              <button 
                onClick={() => setShowHistory(false)}
                aria-label="ປິດປະຫວັດສະຕັອກ"
                title="ປິດປະຫວັດ"
                className="text-slate-400 hover:text-slate-600 transition-colors p-1.5 hover:bg-slate-100 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Logs Feed List */}
          <div id="stock-logs-feed" className="flex-1 overflow-y-auto p-4 space-y-3 font-mono text-[11px] leading-relaxed">
            {stockLogs.length === 0 ? (
              <div className="py-24 text-center text-slate-400 text-xs font-sans">
                ບໍ່ມີປະຫວັດສະຕັອກ. ປະຫວັດການຂາຍ, ການເພີ່ມ, ຫຼື ການປັບປຸງສະຕັອກຈະສະແດງຢູ່ນີ້.
              </div>
            ) : (
              stockLogs.map(log => {
                const isAddition = log.changeQty > 0;
                const dateStr = new Date(log.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

                return (
                  <div
                    id={`stock-log-card-${log.id}`}
                    key={log.id}
                    className="p-3 border border-slate-100 rounded-2xl bg-slate-50/30 hover:bg-slate-50 transition-colors space-y-1.5"
                  >
                    <div className="flex justify-between items-start gap-2">
                      <strong className="text-slate-800 truncate block flex-1 font-bold font-sans text-xs">
                        {log.menuItemName}
                      </strong>
                      <span className="text-slate-400 font-semibold">{dateStr}</span>
                    </div>

                    <div className="flex justify-between items-center text-[10px] font-semibold text-slate-500">
                      <div>
                        <span>ເຫດຜົນ: </span>
                        <strong className={`font-bold font-sans ${
                          log.reason === "DAMAGE" ? "text-rose-600" :
                          log.reason === "RESTOCK" ? "text-blue-600" :
                          log.reason === "SALE" ? "text-slate-605" : "text-slate-500"
                        }`}>
                          {log.reason === "DAMAGE" ? "ເສຍຫາຍ" :
                           log.reason === "RESTOCK" ? "ເພີ່ມສະຕັອກ" :
                           log.reason === "SALE" ? "ຂາຍ" : "ປັບປຸງ"}
                        </strong>
                      </div>

                      <div className="text-right">
                        <span className={`font-bold ${isAddition ? "text-blue-600" : "text-rose-500"}`}>
                          {isAddition ? `+${log.changeQty}` : log.changeQty}
                        </span>
                        <span className="text-slate-400 font-normal font-sans"> → ຍັງເຫຼືອ {log.stockAfter}</span>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* MANUAL STOCK ADJUSTMENT DIALOG */}
      {selectedAdjustItem !== null && (
        <div id="adjust-dialog-overlay" className="fixed inset-0 z-50 bg-slate-950/40 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in">
          <div id="adjust-dialog" className="bg-white border border-slate-100 rounded-3xl p-6 w-full max-w-sm shadow-2xl space-y-4">
            <div className="flex justify-between items-center border-b border-slate-100 pb-2">
              <div>
                <h3 className="text-sm font-bold text-slate-800 font-sans">ປັບປຸງສະຕັອກສິນຄ້າ</h3>
                <p className="text-[10px] text-slate-400 font-semibold">{selectedAdjustItem.name}</p>
              </div>
              <button onClick={() => setSelectedAdjustItem(null)} aria-label="ປິດການປັບປຸງສະຕັອກ" title="ປິດ" className="p-1 rounded hover:bg-slate-50 text-slate-400">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2 space-y-1">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block font-sans">ຈຳນວນທີ່ປັບປຸງ (ໃສ່ເຄື່ອງໝາຍລົບ (-) ເພື່ອຫຼຸດ)</span>
                <input
                  id="adjust-qty-input"
                  type="number"
                  placeholder="ຕົວຢ່າງ: +20, -5"
                  value={adjustQtyInput}
                  onChange={(e) => setAdjustQtyInput(e.target.value)}
                  className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-xs font-bold font-mono focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div className="col-span-2 space-y-1">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block font-sans">ປະເພດເຫດຜົນ</span>
                <select
                  id="adjust-reason-select"
                  value={adjustReason}
                  onChange={(e) => setAdjustReason(e.target.value)}
                  className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-xs font-bold text-slate-600 focus:outline-none bg-white font-sans"
                >
                  <option value="ADJUSTMENT">ປັບປຸງສະຕັອກ (ກວດສອບຄືນ)</option>
                  <option value="DAMAGE">ເສຍຫາຍ (ເສຍ/ໝົດອາຍຸ)</option>
                  <option value="RESTOCK">ເພີ່ມສະຕັອກ (ຊື້ເຂົ້າໃໝ່)</option>
                </select>
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
              <button
                onClick={() => setSelectedAdjustItem(null)}
                className="px-4 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-600 font-semibold hover:bg-slate-100 transition-all cursor-pointer"
              >
                ຍົກເລີກ
              </button>
              <button
                onClick={handleApplyAdjustment}
                className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-all cursor-pointer font-sans"
              >
                ຢືນຢັນການປັບປຸງ
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ADD / EDIT PRODUCT DIALOG */}
      {showProductModal && (
        <div id="product-dialog-overlay" className="fixed inset-0 z-50 bg-slate-950/40 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in">
          <form onSubmit={handleProductSubmit} id="product-dialog" className="bg-white border border-slate-100 rounded-3xl p-6 w-full max-w-lg shadow-2xl space-y-4">
            <div className="flex justify-between items-center border-b border-slate-100 pb-2">
              <div>
                <h3 className="text-sm font-bold text-slate-850 font-sans">
                  {editingProduct ? "ແກ້ໄຂຂໍ້ມູນສິນຄ້າ" : "ເພີ່ມສິນຄ້າໃໝ່"}
                </h3>
                <p className="text-[10px] text-slate-400 font-semibold font-sans">
                  {editingProduct ? "ປັບປຸງລາຍລະອຽດ ຫຼື ຮູບພາບສິນຄ້າ" : "ກະລຸນາປ້ອນຂໍ້ມູນສິນຄ້າ ແລະ ຮູບພາບທີ່ຕ້ອງການເພີ່ມ"}
                </p>
              </div>
              <button type="button" onClick={() => setShowProductModal(false)} aria-label="ປິດຟອມສິນຄ້າ" title="ປິດ" className="p-1 rounded hover:bg-slate-50 text-slate-400">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3.5">
              {/* Product Image Section (Split row) */}
              <div className="grid grid-cols-12 gap-4 items-start bg-slate-50/50 p-3 rounded-2xl border border-slate-100">
                {/* Image Selection Area */}
                <div className="col-span-4 flex flex-col items-center gap-1.5">
                  <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider font-sans self-start">ຮູບພາບສິນຄ້າ</span>
                  <div className="w-24 h-24 rounded-2xl bg-white border border-slate-200 overflow-hidden relative flex items-center justify-center group shadow-sm shrink-0">
                    {prodImageUrl ? (
                      <>
                        <img 
                          src={prodImageUrl} 
                          alt="Product preview" 
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover animate-fade-in" 
                        />
                        <button
                          type="button"
                          onClick={() => setProdImageUrl("")}
                          className="absolute top-1 right-1 p-1 bg-rose-600 hover:bg-rose-700 text-white rounded-full transition-all cursor-pointer shadow-md"
                          title="ລຶບຮູບ"
                          aria-label="ລຶບຮູບສິນຄ້າ"
                        >
                          <X className="w-2.5 h-2.5" />
                        </button>
                      </>
                    ) : (
                      <label className="flex flex-col items-center justify-center cursor-pointer w-full h-full p-2 hover:bg-slate-50 transition-colors select-none text-center">
                        <Plus className="w-5 h-5 text-slate-400" />
                        <span className="text-[9px] text-slate-400 font-extrabold mt-1 leading-tight font-sans">ອັບໂຫຼດຮູບ</span>
                        <input 
                          type="file" 
                          accept="image/*" 
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) {
                              const reader = new FileReader();
                              reader.onloadend = () => {
                                setProdImageUrl(reader.result as string);
                              };
                              reader.readAsDataURL(file);
                            }
                          }}
                          className="hidden" 
                        />
                      </label>
                    )}
                  </div>
                </div>

                {/* Preset quick image choices */}
                <div className="col-span-8 space-y-1.5">
                  <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider font-sans block">ຫຼື ເລືອກຈາກຮູບຕົວຢ່າງ</span>
                  <div className="grid grid-cols-5 gap-2">
                    <button
                      type="button"
                      onClick={() => setProdImageUrl("https://images.unsplash.com/photo-1567696911980-2eed69a46042?w=200&auto=format&fit=crop&q=80")}
                      className="aspect-square rounded-xl bg-white border border-slate-200 overflow-hidden hover:border-blue-400 transition-all cursor-pointer relative shadow-sm"
                      title="Beer"
                    >
                      <img src="https://images.unsplash.com/photo-1567696911980-2eed69a46042?w=80&auto=format&fit=crop&q=60" alt="Beer preset" className="w-full h-full object-cover" />
                      <span className="absolute bottom-0 inset-x-0 bg-slate-900/60 text-white text-[8px] font-bold text-center py-0.5 font-sans">ເບຍ</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setProdImageUrl("https://images.unsplash.com/photo-1622483767028-3f66f32aef97?w=200&auto=format&fit=crop&q=80")}
                      className="aspect-square rounded-xl bg-white border border-slate-200 overflow-hidden hover:border-blue-400 transition-all cursor-pointer relative shadow-sm"
                      title="Cola"
                    >
                      <img src="https://images.unsplash.com/photo-1622483767028-3f66f32aef97?w=80&auto=format&fit=crop&q=60" alt="Cola preset" className="w-full h-full object-cover" />
                      <span className="absolute bottom-0 inset-x-0 bg-slate-900/60 text-white text-[8px] font-bold text-center py-0.5 font-sans">ນ້ຳອັດລົມ</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setProdImageUrl("https://images.unsplash.com/photo-1509042239860-f550ce710b93?w=200&auto=format&fit=crop&q=80")}
                      className="aspect-square rounded-xl bg-white border border-slate-200 overflow-hidden hover:border-blue-400 transition-all cursor-pointer relative shadow-sm"
                      title="Coffee"
                    >
                      <img src="https://images.unsplash.com/photo-1509042239860-f550ce710b93?w=80&auto=format&fit=crop&q=60" alt="Coffee preset" className="w-full h-full object-cover" />
                      <span className="absolute bottom-0 inset-x-0 bg-slate-900/60 text-white text-[8px] font-bold text-center py-0.5 font-sans">ກາເຟ</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setProdImageUrl("https://images.unsplash.com/photo-1599490659213-e2b9527bb087?w=200&auto=format&fit=crop&q=80")}
                      className="aspect-square rounded-xl bg-white border border-slate-200 overflow-hidden hover:border-blue-400 transition-all cursor-pointer relative shadow-sm"
                      title="Snack"
                    >
                      <img src="https://images.unsplash.com/photo-1599490659213-e2b9527bb087?w=80&auto=format&fit=crop&q=60" alt="Snack preset" className="w-full h-full object-cover" />
                      <span className="absolute bottom-0 inset-x-0 bg-slate-900/60 text-white text-[8px] font-bold text-center py-0.5 font-sans">ຂະໜົມ</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setProdImageUrl("https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?w=200&auto=format&fit=crop&q=80")}
                      className="aspect-square rounded-xl bg-white border border-slate-200 overflow-hidden hover:border-blue-400 transition-all cursor-pointer relative shadow-sm"
                      title="General"
                    >
                      <img src="https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?w=80&auto=format&fit=crop&q=60" alt="General preset" className="w-full h-full object-cover" />
                      <span className="absolute bottom-0 inset-x-0 bg-slate-900/60 text-white text-[8px] font-bold text-center py-0.5 font-sans">ທົ່ວໄປ</span>
                    </button>
                  </div>
                  <input
                    type="text"
                    placeholder="ຫຼື ວາງ URL ຮູບພາບທີ່ນີ້..."
                    value={prodImageUrl.startsWith("data:") ? "" : prodImageUrl}
                    onChange={(e) => setProdImageUrl(e.target.value)}
                    className="w-full px-3 py-1 bg-white border border-slate-200 rounded-lg text-[10px] font-semibold focus:outline-none focus:border-blue-500 font-mono"
                  />
                </div>
              </div>

              {/* Product Name */}
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider font-sans">ຊື່ສິນຄ້າ *</label>
                <input
                  type="text"
                  required
                  placeholder="ຕົວຢ່າງ: Beerlao 330ml"
                  value={prodName}
                  onChange={(e) => setProdName(e.target.value)}
                  className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                {/* Cost Price */}
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider font-sans">ລາຄາຕົ້ນທຶນ (LAK) *</label>
                  <input
                    type="number"
                    required
                    min="0"
                    step="0.01"
                    placeholder="ຕົວຢ່າງ: 10000"
                    value={prodCost}
                    onChange={(e) => setProdCost(e.target.value)}
                    onBlur={() => setProdCost(prev => prev.trim() ? formatMoneyInput(parseFloat(prev) || 0) : "")}
                    className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 font-mono"
                  />
                </div>

                {/* Price */}
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider font-sans">ລາຄາຂາຍ (LAK) *</label>
                  <input
                    type="number"
                    required
                    min="0"
                    step="0.01"
                    placeholder="ຕົວຢ່າງ: 15000"
                    value={prodPrice}
                    onChange={(e) => setProdPrice(e.target.value)}
                    onBlur={() => setProdPrice(prev => prev.trim() ? formatMoneyInput(parseFloat(prev) || 0) : "")}
                    className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 font-mono"
                  />
                </div>
              </div>

              {/* Promo / discount price */}
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider font-sans">ລາຄາສ່ວນຫຼຸດ / Promo (LAK)</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="ປ່ອຍວ່າງ = ບໍ່ມີສ່ວນຫຼຸດ"
                  value={prodPromo}
                  onChange={(e) => setProdPromo(e.target.value)}
                  onBlur={() => setProdPromo(prev => prev.trim() && (parseFloat(prev) || 0) > 0 ? formatMoneyInput(parseFloat(prev) || 0) : "")}
                  className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 font-mono"
                />
                <p className="text-[9px] text-slate-400 font-sans">ຖ້າໃສ່ລາຄານີ້ (ຕ່ຳກວ່າລາຄາຂາຍ) ໜ້າຂາຍຈະໃຊ້ລາຄານີ້ອັດຕະໂນມັດ</p>
              </div>

              {/* Category */}
              <div className="space-y-1">
                <div className="flex justify-between items-center">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider font-sans">ໝວດໝູ່ *</label>
                  <button
                    type="button"
                    onClick={() => setShowInlineAddCategory(!showInlineAddCategory)}
                    className="text-[10px] font-bold text-blue-600 hover:text-blue-800 transition-colors cursor-pointer flex items-center gap-0.5"
                  >
                    {showInlineAddCategory ? "ເລືອກຈາກລາຍການ" : "+ ເພີ່ມໝວດໝູ່ໃໝ່"}
                  </button>
                </div>

                {showInlineAddCategory ? (
                  <div className="flex gap-1.5 items-center animate-fade-in">
                    <input
                      type="text"
                      placeholder="ປ້ອນໝວດໝູ່ໃໝ່..."
                      id="new-category-inline-input"
                      className="flex-1 px-3.5 py-2 border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          const val = e.currentTarget.value.trim();
                          if (val) {
                            handleAddCustomCategory(val);
                            setProdCategory(val);
                            setShowInlineAddCategory(false);
                          }
                        }
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const el = document.getElementById("new-category-inline-input") as HTMLInputElement;
                        const val = el?.value.trim();
                        if (val) {
                          handleAddCustomCategory(val);
                          setProdCategory(val);
                          setShowInlineAddCategory(false);
                        }
                      }}
                      className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-all cursor-pointer font-sans"
                    >
                      ເພີ່ມ
                    </button>
                  </div>
                ) : (
                  <select
                    required
                    value={prodCategory}
                    onChange={(e) => setProdCategory(e.target.value)}
                    className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 bg-white"
                  >
                    <option value="">-- ເລືອກໝວດໝູ່ --</option>
                    {allCategories.map(cat => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                {/* Stock Qty */}
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider font-sans">ຈຳນວນໃນສະຕັອກ</label>
                  <input
                    type="number"
                    placeholder="ຕົວຢ່າງ: 50"
                    value={prodStock}
                    onChange={(e) => setProdStock(e.target.value)}
                    className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 font-mono"
                  />
                </div>

                {/* Alert threshold */}
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider font-sans">ເກນເຕືອນສະຕັອກໜ້ອຍ</label>
                  <input
                    type="number"
                    placeholder="ຕົວຢ່າງ: 5"
                    value={prodThreshold}
                    onChange={(e) => setProdThreshold(e.target.value)}
                    className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 font-mono"
                  />
                </div>
              </div>

              {/* Barcode scan / text */}
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider font-sans">ເລກບາໂຄດ (ບໍ່ໃສ່ກໍໄດ້)</label>
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    placeholder="ຕົວຢ່າງ: 8850000000123"
                    value={prodBarcode}
                    onChange={(e) => setProdBarcode(e.target.value)}
                    className="flex-1 px-3.5 py-2 border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 font-mono text-slate-650"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setScannerTarget("form");
                      setShowCameraScanner(true);
                    }}
                    title="ສະແກນບາໂຄດສຳລັບສິນຄ້ານີ້"
                    aria-label="ສະແກນບາໂຄດສຳລັບສິນຄ້ານີ້"
                    className="px-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition-colors flex items-center justify-center cursor-pointer"
                  >
                    <Camera className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
              <button
                type="button"
                onClick={() => setShowProductModal(false)}
                className="px-4 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-600 font-semibold hover:bg-slate-100 transition-all cursor-pointer font-sans"
              >
                ຍົກເລີກ
              </button>
              <button
                type="submit"
                className="px-5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-all cursor-pointer font-sans"
              >
                ບັນທຶກ
              </button>
            </div>
          </form>
        </div>
      )}

      {/* SAFE DELETE CONFIRMATION DIALOG (Avoids iframe block) */}
      {deletingProductItem && (
        <div id="delete-dialog-overlay" className="fixed inset-0 z-50 bg-slate-950/40 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in">
          <div id="delete-dialog" className="bg-white border border-slate-100 rounded-3xl p-6 w-full max-w-sm shadow-2xl space-y-4">
            <div className="flex flex-col items-center text-center gap-2">
              <div className="p-3 bg-rose-50 text-rose-600 rounded-full border border-rose-100">
                <AlertTriangle className="w-6 h-6 animate-pulse" />
              </div>
              <h3 className="font-extrabold text-slate-800 text-base mt-2 font-sans">ຢືນຢັນການລຶບສິນຄ້າ?</h3>
              <p className="text-xs text-slate-500 font-medium leading-relaxed font-sans">
                ທ່ານແນ່ໃຈບໍ່ວ່າຕ້ອງການລຶບສິນຄ້າ <strong className="text-slate-800">"{deletingProductItem.name}"</strong> ອອກຈາກລະບົບ?
                <br />
                <span className="text-[10px] text-rose-500 font-bold italic">** ຂັ້ນຕອນນີ້ບໍ່ສາມາດຍົກເລີກໄດ້.</span>
              </p>
            </div>

            <div className="rounded-2xl border border-rose-100 bg-rose-50/70 p-3 space-y-2">
              <label className="text-[10px] font-bold text-rose-700 uppercase tracking-wider block font-sans">
                Manager confirmation: type MANAGER
              </label>
              <input
                value={managerConfirmText}
                onChange={(e) => setManagerConfirmText(e.target.value)}
                placeholder="MANAGER"
                className="w-full px-3 py-2 bg-white border border-rose-200 rounded-xl text-xs font-bold font-mono text-rose-700 focus:outline-none focus:border-rose-500"
              />
            </div>

            <div className="flex justify-stretch gap-2.5 pt-2">
              <button
                onClick={() => { setDeletingProductItem(null); setManagerConfirmText(""); }}
                className="flex-1 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-all cursor-pointer font-sans"
              >
                ຍົກເລີກ
              </button>
              <button
                onClick={handleConfirmDeleteProduct}
                disabled={managerConfirmText !== managerConfirmPhrase}
                className="flex-1 py-2 bg-rose-600 hover:bg-rose-700 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed text-white rounded-xl text-xs font-bold transition-all cursor-pointer font-sans shadow-sm shadow-rose-100"
              >
                ຢືນຢັນລຶບສິນຄ້າ
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MANAGE CATEGORIES MODAL */}
      {showCategoryModal && (
        <div id="category-modal-overlay" className="fixed inset-0 z-50 bg-slate-950/40 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in">
          <div id="category-modal" className="bg-white border border-slate-100 rounded-3xl p-6 w-full max-w-md shadow-2xl space-y-4">
            <div className="flex justify-between items-center border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-sm font-extrabold text-slate-800 font-sans">ຈັດການໝວດໝູ່ສິນຄ້າ / Categories</h3>
                <p className="text-[10px] text-slate-400 font-semibold mt-0.5">ເພີ່ມ ຫຼື ລຶບໝວດໝູ່ສິນຄ້າຂອງທ່ານ</p>
              </div>
              <button 
                onClick={() => setShowCategoryModal(false)}
                aria-label="ປິດຈັດການໝວດໝູ່"
                title="ປິດ"
                className="text-slate-400 hover:text-slate-600 p-1.5 bg-slate-50 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Add New Category form section */}
            <div className="space-y-1.5 bg-slate-50 p-3 rounded-2xl border border-slate-100">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider font-sans">ເພີ່ມໝວດໝູ່ໃໝ່</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="ຕົວຢ່າງ: ເຄື່ອງຂຽນ"
                  value={newCategoryInput}
                  onChange={(e) => setNewCategoryInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      if (newCategoryInput.trim()) {
                        handleAddCustomCategory(newCategoryInput);
                        setNewCategoryInput("");
                      }
                    }
                  }}
                  className="flex-1 px-3.5 py-1.5 bg-white border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                />
                <button
                  onClick={() => {
                    if (newCategoryInput.trim()) {
                      handleAddCustomCategory(newCategoryInput);
                      setNewCategoryInput("");
                    }
                  }}
                  className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-all cursor-pointer font-sans"
                >
                  ເພີ່ມ
                </button>
              </div>
            </div>

            {/* List of current custom categories */}
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider font-sans block">ໝວດໝູ່ທີ່ມີທັງໝົດ ({allCategories.length})</label>
              <div className="max-h-[220px] overflow-y-auto space-y-1.5 pr-1">
                {allCategories.map(cat => {
                  const isSystem = ["ເຄື່ອງດື່ມ", "ອາຫານ", "ຂະໜົມ"].includes(cat);
                  return (
                    <div 
                      key={cat} 
                      className="flex justify-between items-center px-3 py-2 bg-slate-50/50 border border-slate-100 rounded-xl text-xs font-semibold"
                    >
                      <div className="flex items-center gap-2">
                        <Tag className="w-3.5 h-3.5 text-slate-400" />
                        <span className="text-slate-755">{cat}</span>
                        {isSystem && (
                          <span className="text-[9px] bg-slate-200/60 text-slate-500 px-1.5 py-0.5 rounded font-sans scale-90">
                            ຄ່າເລີ່ມຕົ້ນ
                          </span>
                        )}
                      </div>
                      {!isSystem && (
                        <button
                          onClick={() => requestDeleteCustomCategory(cat)}
                          className="p-1 hover:bg-rose-50 text-rose-500 hover:text-rose-700 rounded-lg transition-colors cursor-pointer"
                          title="ລຶບໝວດໝູ່"
                          aria-label={`ລຶບໝວດໝູ່ ${cat}`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {deletingCategory && (
              <div className="rounded-2xl border border-rose-100 bg-rose-50/70 p-3 space-y-2">
                <p className="text-xs font-bold text-rose-700 font-sans">
                  ຢືນຢັນລຶບໝວດໝູ່ "{deletingCategory}". Type MANAGER to continue.
                </p>
                <input
                  value={managerConfirmText}
                  onChange={(e) => setManagerConfirmText(e.target.value)}
                  placeholder="MANAGER"
                  className="w-full px-3 py-2 bg-white border border-rose-200 rounded-xl text-xs font-bold font-mono text-rose-700 focus:outline-none focus:border-rose-500"
                />
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => { setDeletingCategory(null); setManagerConfirmText(""); }} className="px-3 py-1.5 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-600">
                    ຍົກເລີກ
                  </button>
                  <button type="button" onClick={handleConfirmDeleteCustomCategory} disabled={managerConfirmText !== managerConfirmPhrase} className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed text-white rounded-xl text-xs font-bold">
                    ຢືນຢັນລຶບ
                  </button>
                </div>
              </div>
            )}

            <div className="flex justify-end pt-2 border-t border-slate-100">
              <button
                onClick={() => setShowCategoryModal(false)}
                className="px-5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-all cursor-pointer font-sans"
              >
                ປິດ
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CAMERA SCANNER DIALOG OVERLAY */}
      {showCameraScanner && (
        <CameraScanner
          onScan={handleCameraScan}
          onClose={() => setShowCameraScanner(false)}
          title={scannerTarget === "form" ? "ສະແກນບາໂຄດໃສ່ຟອມສິນຄ້າ" : "ສະແກນຄົ້ນຫາ/ເພີ່ມສະຕັອກສິນຄ້າ"}
        />
      )}
    </div>
  );
}
