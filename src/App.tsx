/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef } from "react";
import { motion } from "motion/react";
import { 
  ShoppingCart, Layers, TrendingUp, Store, Waves, Settings, LogOut, Users as UsersIcon
} from "lucide-react";

// Database and types
import { db } from "./utils/db";
import { startCloudSync, subscribeSyncStatus, getSyncStatus, SyncStatus } from "./utils/cloudSync";
import { onShopAuthChanged } from "./firebase";
import { DeviceActivation } from "./components/DeviceActivation";
import { MenuItem, SaleWithItems, StockLog, PendingOrder, ShopSettings, User, AppTab, Quotation, QuotationItem, QuotationWithItems, Member } from "./types";

// Components
import { LoginScreen } from "./components/LoginScreen";

// Views
import POSView from "./components/POSView";
import StockControlView from "./components/StockControlView";
import ReportsView from "./components/ReportsView";
import SettingsView from "./components/SettingsView";
import MembersView from "./components/MembersView";

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  
  // Navigation State
  const [activeTab, setActiveTab] = useState<AppTab>(AppTab.POS);

  // Synchronized States from db / LocalStorage
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [salesList, setSalesList] = useState<SaleWithItems[]>([]);
  const [quotationsList, setQuotationsList] = useState<QuotationWithItems[]>([]);
  const [stockLogs, setStockLogs] = useState<StockLog[]>([]);
  const [pendingOrders, setPendingOrders] = useState<PendingOrder[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [settings, setSettings] = useState<ShopSettings>(db.getSettings());

  // Active Cart State (itemId -> quantity)
  const [cart, setCart] = useState<{ [itemId: number]: number }>({});
  const [cartItemDiscounts, setCartItemDiscounts] = useState<{ [itemId: number]: { type: "PERCENT" | "FIXED"; value: number } }>({});
  const [billDiscount, setBillDiscount] = useState<{ type: "PERCENT" | "FIXED"; value: number } | null>(null);
  const [selectedMemberUid, setSelectedMemberUid] = useState<string | null>(null);
  const [activeQuotationToConvert, setActiveQuotationToConvert] = useState<Quotation | null>(null);

  // Cloud sync connectivity status (real state from the sync engine)
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(getSyncStatus());

  // Device activation state: 'loading' until Firebase restores the session,
  // then 'inactive' (show activation screen) or 'activated'.
  const [shopAuth, setShopAuth] = useState<"loading" | "inactive" | "activated">("loading");

  useEffect(() => {
    const unsubscribe = onShopAuthChanged((fbUser) => {
      setShopAuth(fbUser ? "activated" : "inactive");
    });
    return () => unsubscribe();
  }, []);

  const refreshAllData = () => {
    setMenuItems(db.getAllMenuItems());
    setSalesList(db.getAllSalesWithItems());
    setQuotationsList(db.getAllQuotationsWithItems());
    setStockLogs(db.getAllStockLogs());
    setPendingOrders(db.getPendingOrders());
    setMembers(db.getAllMembers());
    setSettings(db.getSettings());
  };
  const refreshRef = useRef(refreshAllData);
  refreshRef.current = refreshAllData;

  useEffect(() => {
    const storedUser = localStorage.getItem('user');
    if (storedUser) {
      setUser(JSON.parse(storedUser));
    }
  }, []);

  // Start the cloud sync engine once at app start. It runs before login so
  // a brand-new device pulls users/menu/settings from the cloud immediately.
  useEffect(() => {
    db.init();
    startCloudSync(() => refreshRef.current());
    const unsubscribe = subscribeSyncStatus(setSyncStatus);
    return () => { unsubscribe(); };
  }, []);

  // Load records into state after login
  useEffect(() => {
    if (!user) return;
    refreshAllData();
  }, [user]);

  // Synchronize activeTab if it's no longer allowed
  useEffect(() => {
    if (!user) return;
    const allowedTabs = [
      { id: AppTab.POS, allowed: user.tabPermissions?.pos ?? true },
      { id: AppTab.STOCK, allowed: user.tabPermissions?.stock ?? true },
      { id: AppTab.REPORTS, allowed: user.tabPermissions?.reports ?? true },
      { id: AppTab.MEMBERS, allowed: user.tabPermissions?.members ?? (user.role === "Manager") },
      { id: AppTab.SETTINGS, allowed: user.tabPermissions?.settings ?? true },
    ].filter(t => t.allowed);

    if (!allowedTabs.find(t => t.id === activeTab)) {
      setActiveTab(allowedTabs[0]?.id || AppTab.POS);
    }
  }, [user, activeTab]);

  const handleLogin = (loggedInUser: User) => {
    // Never keep PIN material in the login session.
    const { password, passwordHash, ...safeUser } = loggedInUser;
    const u = safeUser as User;
    setUser(u);
    localStorage.setItem('user', JSON.stringify(u));
    
    // Set default tab if current user doesn't have access
    const allowed = (id: AppTab) => {
      const key = id as 'pos' | 'stock' | 'reports' | 'members' | 'settings';
      const membersDefault = u.role === "Manager";
      if (!u.tabPermissions) return key === 'members' ? membersDefault : true;
      return u.tabPermissions[key] ?? (key === 'members' ? membersDefault : true);
    };

    if (!allowed(activeTab)) {
      const firstAllowed = [AppTab.POS, AppTab.STOCK, AppTab.REPORTS, AppTab.MEMBERS, AppTab.SETTINGS].find(allowed);
      setActiveTab(firstAllowed || AppTab.POS);
    }
  };

  const handleLogout = () => {
    setUser(null);
    localStorage.removeItem('user');
  };

  if (shopAuth === "loading") {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-900 text-slate-300 text-sm">
        ກຳລັງກວດສອບການເປີດໃຊ້ເຄື່ອງ...
      </div>
    );
  }

  if (shopAuth === "inactive") {
    return <DeviceActivation />;
  }

  if (!user) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  const tabs = [
    { id: AppTab.POS, label: "ໜ້າຮ້ານ POS", icon: ShoppingCart, allowed: user.tabPermissions?.pos ?? true },
    { id: AppTab.STOCK, label: "ຄວບຄຸມສະຕັອກ", icon: Layers, allowed: user.tabPermissions?.stock ?? true },
    { id: AppTab.REPORTS, label: "ລາຍງານການຂາຍ", icon: TrendingUp, allowed: user.tabPermissions?.reports ?? true },
    { id: AppTab.MEMBERS, label: "ສະມາຊິກ", icon: UsersIcon, allowed: user.tabPermissions?.members ?? (user.role === "Manager") },
    { id: AppTab.SETTINGS, label: "ຕັ້ງຄ່າລະບົບ", icon: Settings, allowed: user.tabPermissions?.settings ?? true },
  ].filter(t => t.allowed);
  const activeTabConfig = tabs.find(tab => tab.id === activeTab) || tabs[0];
  const syncTone =
    syncStatus.state === "synced" ? "bg-emerald-500/20 text-emerald-300"
    : syncStatus.state === "syncing" ? "bg-sky-500/20 text-sky-300"
    : syncStatus.state === "connecting" ? "bg-slate-500/20 text-slate-300"
    : syncStatus.state === "offline" ? "bg-amber-500/20 text-amber-300"
    : "bg-red-500/20 text-red-300";
  const syncDot =
    syncStatus.state === "synced" ? "bg-emerald-400"
    : syncStatus.state === "syncing" ? "bg-sky-400"
    : syncStatus.state === "connecting" ? "bg-slate-400"
    : syncStatus.state === "offline" ? "bg-amber-400"
    : "bg-red-400";
  const syncLabel =
    syncStatus.state === "synced" ? "Online — synced"
    : syncStatus.state === "syncing" ? "ກຳລັງ Sync..."
    : syncStatus.state === "connecting" ? "ກຳລັງເຊື່ອມຕໍ່..."
    : syncStatus.state === "offline" ? "Offline — ບັນທຶກໃນເຄື່ອງ"
    : "Sync ຜິດພາດ";

  // ── CART ACTION HANDLERS ─────────────────────────────────────
  const handleAddToCart = (item: MenuItem) => {
    setCart(prev => {
      const currentQty = prev[item.id] || 0;
      if (currentQty >= item.stockQty) {
        return prev; // stock limit reached
      }
      return {
        ...prev,
        [item.id]: currentQty + 1
      };
    });
  };

  const handleRefundToCart = (item: MenuItem) => {
    setCart(prev => {
      const currentQty = prev[item.id] || 0;
      return {
        ...prev,
        [item.id]: currentQty - 1
      };
    });
  };

  const handleRemoveFromCart = (item: MenuItem) => {
    setCart(prev => {
      const currentQty = prev[item.id] || 0;
      if (currentQty <= 1) {
        const next = { ...prev };
        delete next[item.id];
        return next;
      }
      return {
        ...prev,
        [item.id]: currentQty - 1
      };
    });
  };

  const handleUpdateCartQty = (itemId: number, qty: number) => {
    const item = menuItems.find(i => i.id === itemId);
    if (!item) return;

    if (qty <= 0) {
      setCart(prev => {
        const next = { ...prev };
        delete next[itemId];
        return next;
      });
      return;
    }

    const safeQty = Math.min(qty, item.stockQty);
    setCart(prev => ({
      ...prev,
      [itemId]: safeQty
    }));
  };

  const handleClearCart = () => {
    setCart({});
    setCartItemDiscounts({});
    setBillDiscount(null);
  };

  // ── PENDING ORDER ACTIONS ────────────────────────────────────
  const handleSaveCartAsPending = (label: string) => {
    if (Object.keys(cart).length === 0) return;
    const updated = db.savePendingOrder(label, cart);
    setPendingOrders(updated);
    setCart({}); // clear active cart
  };

  const handleResumePendingOrder = (orderId: string) => {
    const order = pendingOrders.find(o => o.id === orderId);
    if (!order) return;

    // Load items into active cart (replacing current active cart or merging them)
    setCart(order.cart);
    
    // Delete the pending order
    const updated = db.deletePendingOrder(orderId);
    setPendingOrders(updated);
  };

  const handleDiscardPendingOrder = (orderId: string) => {
    const updated = db.deletePendingOrder(orderId);
    setPendingOrders(updated);
  };

  // ── TRANSACTION RECORDING ───────────────────────────────────
  const handleRecordSale = async (
    paymentMethod: string, 
    amountTendered: number, 
    onSuccess: (sale: SaleWithItems) => void,
    splitTransferAmount?: number,
    splitCashAmount?: number
  ) => {
    if (Object.keys(cart).length === 0) return;

    const result = await db.recordSale(
      paymentMethod,
      amountTendered,
      cart,
      splitTransferAmount,
      splitCashAmount,
      cartItemDiscounts,
      billDiscount,
      false, // isRefund
      selectedMemberUid || undefined
    );

    // If we have an active quotation to convert, convert it!
    if (activeQuotationToConvert) {
      const saleId = result.sales.length > 0 ? Math.max(...result.sales.map(s => s.sale.id)) : 1;
      const qResult = db.convertQuotationToSale(activeQuotationToConvert.id, saleId);
      setQuotationsList(qResult.quotations);
      setActiveQuotationToConvert(null);
    }

    // Update active states
    setMenuItems(result.menu);
    setSalesList(result.sales);
    setStockLogs(result.logs);
    setMembers(db.getAllMembers()); // points/visits/spend may have changed
    setCart({}); // clear cart
    setCartItemDiscounts({}); // clear item discounts
    setBillDiscount(null); // clear bill discount
    setSelectedMemberUid(null); // clear selected member

    // Find the recorded sale to return in callback
    const sortedSales = result.sales;
    if (sortedSales.length > 0) {
      onSuccess(sortedSales[0]);
    }
  };

  // ── MEMBERSHIP ACTIONS ───────────────────────────────────────
  const handleSaveMember = (data: { uid?: string; name: string; phone: string; address?: string }) => {
    setMembers(db.saveMember(data));
  };
  const handleDeleteMember = (uid: string) => {
    setMembers(db.deleteMember(uid));
  };
  const handleAdjustMemberPoints = (uid: string, change: number, reason: string) => {
    setMembers(db.adjustMemberPoints(uid, change, reason));
  };

  // ── QUOTATION ACTIONS ────────────────────────────────────────
  const handleSaveQuotation = (
    quotationData: Partial<Quotation> & { items: Omit<QuotationItem, "id" | "quotationId">[] },
    onSuccess?: (quote: QuotationWithItems) => void
  ) => {
    const result = db.saveQuotation(quotationData);
    setQuotationsList(result.quotations);
    setMenuItems(result.menu); // Update menu for dynamic reservedQty changes
    
    const sorted = [...result.quotations].sort((a, b) => b.quotation.timestamp - a.quotation.timestamp);
    if (onSuccess && sorted.length > 0) {
      const found = sorted.find(q => q.quotation.id === quotationData.id) || sorted[0];
      onSuccess(found);
    }
  };

  const handleDeleteQuotation = (id: number) => {
    const result = db.deleteQuotation(id);
    setQuotationsList(result.quotations);
    setMenuItems(result.menu);
  };

  const handleLoadQuotationToCart = (quoteWithItems: QuotationWithItems) => {
    // 1. Clear cart
    setCart({});
    setCartItemDiscounts({});
    setBillDiscount(null);
    
    // 2. Load items
    const newCart: { [itemId: number]: number } = {};
    const itemDiscounts: { [itemId: number]: { type: "PERCENT" | "FIXED"; value: number } } = {};
    
    quoteWithItems.items.forEach(item => {
      newCart[item.menuItemId] = item.quantity;
      if (item.discountType && item.discountValue) {
        itemDiscounts[item.menuItemId] = {
          type: item.discountType,
          value: item.discountValue
        };
      }
    });
    
    setCart(newCart);
    setCartItemDiscounts(itemDiscounts);
    
    if (quoteWithItems.quotation.discountType && quoteWithItems.quotation.discountValue) {
      setBillDiscount({
        type: quoteWithItems.quotation.discountType,
        value: quoteWithItems.quotation.discountValue
      });
    } else {
      setBillDiscount(null);
    }
    
    // 3. Mark active quotation to convert
    setActiveQuotationToConvert(quoteWithItems.quotation);
    
    // 4. Send user to POS tab
    setActiveTab(AppTab.POS);
  };

  const handleRecordRefund = async (
    paymentMethod: string, 
    amountTendered: number, 
    onSuccess: (sale: SaleWithItems) => void,
    splitTransferAmount?: number,
    splitCashAmount?: number
  ) => {
    if (Object.keys(cart).length === 0) return;

    const result = await db.recordSale(
      paymentMethod, 
      amountTendered, 
      cart, 
      splitTransferAmount, 
      splitCashAmount,
      cartItemDiscounts,
      billDiscount,
      true // isRefund
    );
    
    // Update active states
    setMenuItems(result.menu);
    setSalesList(result.sales);
    setStockLogs(result.logs);
    setCart({}); // clear cart
    setCartItemDiscounts({}); // clear item discounts
    setBillDiscount(null); // clear bill discount

    // Find the recorded sale to return in callback
    const sortedSales = result.sales;
    if (sortedSales.length > 0) {
      onSuccess(sortedSales[0]);
    }
  };

  const handleRefundSale = (saleId: number) => {
    const result = db.refundSale(saleId);
    setMenuItems(result.menu);
    setSalesList(result.sales);
    setStockLogs(result.logs);
  };

  const handleUpdateCartItemDiscount = (itemId: number, type: "PERCENT" | "FIXED" | null, value: number) => {
    setCartItemDiscounts(prev => {
      const next = { ...prev };
      if (type === null || value <= 0) {
        delete next[itemId];
      } else {
        next[itemId] = { type, value };
      }
      return next;
    });
  };

  const handleUpdateBillDiscount = (type: "PERCENT" | "FIXED" | null, value: number) => {
    if (type === null || value <= 0) {
      setBillDiscount(null);
    } else {
      setBillDiscount({ type, value });
    }
  };

  const handleDeleteSale = (saleId: number) => {
    const result = db.deleteSaleAndItems(saleId);
    setSalesList(result.sales);
  };

  const handleUpdateSaleItems = (
    saleId: number,
    updatedItems: { menuItemId: number; quantity: number; price: number; name: string }[]
  ) => {
    const result = db.updateSaleWithItems(saleId, updatedItems);
    setMenuItems(result.menu);
    setSalesList(result.sales);
    setStockLogs(result.logs);
  };

  // ── MENU MANAGEMENT ACTIONS ──────────────────────────────────
  const handleAddMenuItem = (name: string, price: number, category: string, stock: number, threshold: number, barcode: string | null, imageUrl?: string | null, costPrice?: number, promoPrice?: number) => {
    const updated = db.insertMenuItem(name, price, category, stock, threshold, barcode, imageUrl, costPrice, promoPrice);
    setMenuItems(updated);
    setStockLogs(db.getAllStockLogs()); // stock logs might have updated
  };

  const handleUpdateMenuItem = (id: number, name: string, price: number, category: string, stock: number, threshold: number, barcode: string | null, imageUrl?: string | null, costPrice?: number, promoPrice?: number) => {
    const updated = db.updateMenuItem(id, name, price, category, stock, threshold, barcode, imageUrl, costPrice, promoPrice);
    setMenuItems(updated);
    setStockLogs(db.getAllStockLogs()); // stock logs might have updated
  };

  const handleDeleteMenuItem = (id: number) => {
    const updated = db.deleteMenuItem(id);
    setMenuItems(updated);
  };

  const handleBulkImport = (items: MenuItem[]) => {
    const updated = db.bulkImportMenuItems(items);
    setMenuItems(updated);
    setStockLogs(db.getAllStockLogs());
  };

  // ── INVENTORY MANAGEMENT ACTIONS ─────────────────────────────
  const handleRestockItem = (itemId: number, changeQty: number) => {
    const result = db.adjustStock(itemId, changeQty, "RESTOCK");
    setMenuItems(result.menu);
    setStockLogs(result.logs);
  };

  const handleAdjustStockItem = (itemId: number, changeQty: number, reason: string) => {
    const result = db.adjustStock(itemId, changeQty, reason);
    setMenuItems(result.menu);
    setStockLogs(result.logs);
  };

  return (
    <div id="app-root-shell" className="min-h-screen bg-slate-50 flex flex-col font-sans text-slate-800">
      
      {/* Dynamic Global Top Navigation Bar */}
      <header id="app-header" className="bg-slate-950 text-white shadow-md sticky top-0 z-40 select-none border-b border-white/10">
        <div className="max-w-[1600px] mx-auto px-3 sm:px-5 lg:px-8 h-16 lg:h-20 flex items-center justify-between gap-2">
          <button 
            id="app-logo-wrapper" 
            onClick={() => setActiveTab(AppTab.POS)}
            className="flex items-center gap-2.5 min-w-0 cursor-pointer text-left focus:outline-none hover:opacity-90 transition-opacity"
          >
            {settings.logoUrl ? (
              <img
                src={settings.logoUrl}
                alt={settings.shopName || "Logo"}
                className="w-10 h-10 lg:w-14 lg:h-14 rounded-xl object-cover shadow-inner shrink-0 bg-white/10"
              />
            ) : (
              <div className="p-2 lg:p-3 bg-gradient-to-br from-blue-600 to-sky-500 rounded-xl text-white shadow-inner shrink-0">
                <Waves className="w-5 h-5 lg:w-6 lg:h-6 animate-pulse" />
              </div>
            )}
            <div className="flex flex-col min-w-0 py-1">
              <h1 id="app-brand-name" className="text-sm sm:text-lg lg:text-xl font-extrabold tracking-tight font-sans leading-normal text-white truncate max-w-[44vw] sm:max-w-[280px] xl:max-w-none">{settings.shopName || "ມະຫາຈື່ນ ສະລອຍນ້ຳ"}</h1>
              <span className="text-[10px] lg:text-xs text-sky-300 font-bold uppercase mt-0.5 truncate max-w-[44vw] sm:max-w-[280px] xl:max-w-none">ລະບົບຕິດຕາມການຂາຍ & POS</span>
            </div>
          </button>
          
          <div className="flex items-center gap-2 sm:gap-3 xl:gap-5 min-w-0">
            {/* Navigation Action Pills (Desktop) */}
            <nav id="app-nav-desktop" className="hidden lg:flex items-center gap-1">
              {tabs.map(tab => (
                <button
                  key={tab.id}
                  id={`nav-btn-${tab.id}`}
                  onClick={() => setActiveTab(tab.id)}
                  title={tab.label}
                  className={`flex items-center gap-2 px-3 xl:px-4 py-2.5 rounded-xl text-sm font-bold transition-all cursor-pointer ${
                    activeTab === tab.id
                      ? "bg-blue-600 text-white shadow-sm shadow-blue-550"
                      : "text-slate-300 hover:text-white hover:bg-white/10"
                  }`}
                >
                  <tab.icon className="w-5 h-5" />
                  <span className="hidden xl:inline whitespace-nowrap">{tab.label}</span>
                </button>
              ))}
            </nav>

            {activeTabConfig && (
              <div className="lg:hidden flex items-center gap-1.5 min-w-0 px-2.5 py-1.5 rounded-full bg-white/10 text-sky-100 border border-white/10">
                <activeTabConfig.icon className="w-4 h-4 shrink-0" />
                <span className="text-[11px] font-bold truncate max-w-[26vw] sm:max-w-[180px]">{activeTabConfig.label}</span>
              </div>
            )}

            <div
              className={`hidden sm:flex text-xs xl:text-sm px-2.5 xl:px-3 py-1 rounded-full whitespace-nowrap items-center gap-1.5 ${syncTone}`}
              title={syncStatus.error || (syncStatus.lastSyncedAt ? `Last sync: ${new Date(syncStatus.lastSyncedAt).toLocaleTimeString()}` : "")}
            >
              <span className={`w-2 h-2 rounded-full shrink-0 ${syncDot}`} />
              <span className="hidden xl:inline">{syncLabel}</span>
              <span className="xl:hidden">{syncStatus.state === "synced" ? "Online" : syncStatus.state === "offline" ? "Offline" : "Sync"}</span>
            </div>

            {/* Compact sync indicator dot (mobile only) */}
            <span
              className={`sm:hidden w-2.5 h-2.5 rounded-full shrink-0 ${syncDot}`}
              title={syncLabel}
            />

            <div className="flex items-center gap-2 sm:gap-3 border-l border-white/10 pl-2 sm:pl-3 xl:pl-5 min-w-0">
              <span className="hidden sm:block text-xs xl:text-sm font-medium text-slate-300 truncate max-w-[120px] xl:max-w-[160px]"> {user.name} </span>
              <button
                onClick={handleLogout}
                className="flex items-center gap-2 text-slate-300 hover:text-red-400 transition-colors cursor-pointer"
                title="ອອກຈາກລະບົບ"
                aria-label="ອອກຈາກລະບົບ"
              >
                <LogOut className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main View Container Stage */}
      <main id="app-main-container" className="flex-1 max-w-[1600px] w-full mx-auto p-3 sm:p-4 lg:p-6 pb-28 lg:pb-6 overflow-hidden">
        <motion.div
          id="view-animation-stage"
          key={activeTab}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, ease: "easeOut" }}
          className="h-full"
        >
          {activeTab === "pos" && (
            <POSView
              menuItems={menuItems}
              cart={cart}
              pendingOrders={pendingOrders}
              onAddToCart={handleAddToCart}
              onRemoveFromCart={handleRemoveFromCart}
              onUpdateCartQty={handleUpdateCartQty}
              onClearCart={handleClearCart}
              onSaveCartAsPending={handleSaveCartAsPending}
              onResumePendingOrder={handleResumePendingOrder}
              onDiscardPendingOrder={handleDiscardPendingOrder}
              onRecordSale={handleRecordSale}
              onRecordRefund={handleRecordRefund}
              onRefundToCart={handleRefundToCart}
              cartItemDiscounts={cartItemDiscounts}
              onUpdateCartItemDiscount={handleUpdateCartItemDiscount}
              billDiscount={billDiscount}
              onUpdateBillDiscount={handleUpdateBillDiscount}
              onSaveQuotation={handleSaveQuotation}
              activeQuotationToConvert={activeQuotationToConvert}
              onCancelQuotationConversion={() => setActiveQuotationToConvert(null)}
              members={members}
              settings={settings}
              selectedMemberUid={selectedMemberUid}
              onSelectMember={setSelectedMemberUid}
            />
          )}

          {activeTab === "stock" && (
            <StockControlView
              menuItems={menuItems}
              stockLogs={stockLogs}
              onRestockItem={handleRestockItem}
              onAdjustStockItem={handleAdjustStockItem}
              onAddMenuItem={handleAddMenuItem}
              onUpdateMenuItem={handleUpdateMenuItem}
              onDeleteMenuItem={handleDeleteMenuItem}
            />
          )}

          {activeTab === "reports" && (
            <ReportsView
              salesList={salesList}
              menuItems={menuItems}
              onDeleteSale={handleDeleteSale}
              onUpdateSaleItems={handleUpdateSaleItems}
              onRefundSale={handleRefundSale}
              quotationsList={quotationsList}
              onDeleteQuotation={handleDeleteQuotation}
              onSaveQuotation={handleSaveQuotation}
              onLoadQuotationToCart={handleLoadQuotationToCart}
            />
          )}

          {activeTab === "members" && (
            <MembersView
              members={members}
              settings={settings}
              currentUser={user}
              onSaveMember={handleSaveMember}
              onDeleteMember={handleDeleteMember}
              onAdjustPoints={handleAdjustMemberPoints}
            />
          )}

          {activeTab === "settings" && (
            <SettingsView
              onSettingsSaved={refreshAllData}
              currentUser={user}
            />
          )}
        </motion.div>
      </main>

      {/* Mobile Sticky Footer Navigation Rail */}
      <footer id="app-footer-mobile" className="lg:hidden sticky bottom-0 bg-slate-950 border-t border-white/10 text-white pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] z-40 shadow-xl select-none">
        {/* flex (not a dynamic grid-cols-N class — Tailwind can't generate those at build time) */}
        <div className="flex text-center">
          {tabs.map(tab => (
            <button
              key={tab.id}
              id={`mobile-nav-${tab.id}`}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 min-w-0 flex flex-col items-center justify-center gap-1 px-0.5 py-1 cursor-pointer ${
                activeTab === tab.id ? "text-sky-300 font-bold" : "text-slate-400"
              }`}
            >
              <tab.icon className="w-5 h-5 shrink-0" />
              <span className="text-[9px] font-semibold truncate w-full">{tab.label}</span>
            </button>
          ))}
        </div>
      </footer>
    </div>
  );
}
