/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { MenuItem, Sale, SaleItem, StockLog, SaleWithItems, PendingOrder, ShopSettings, User, Quotation, QuotationItem, QuotationWithItems, Member, MemberPointLog, isOnPromo, effectivePrice } from "../types";
import { notifyLocalDelete, notifyLocalWrite } from "./cloudSync";

// Write-through helper: persists locally (instant, works offline) and
// notifies the cloud sync engine so the change is mirrored to Firestore.
const persist = (key: string, data: unknown) => {
  localStorage.setItem(key, JSON.stringify(data));
  notifyLocalWrite(key);
};

const newUid = (): string =>
  (typeof crypto !== "undefined" && crypto.randomUUID)
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

// Keys for LocalStorage
const KEY_MENU_ITEMS = "saletracker_menu_items";
const KEY_SALES = "saletracker_sales";
const KEY_SALE_ITEMS = "saletracker_sale_items";
const KEY_STOCK_LOGS = "saletracker_stock_logs";
const KEY_PENDING_ORDERS = "saletracker_pending_orders";
const KEY_SETTINGS = "saletracker_settings";
const KEY_USERS = "saletracker_users";
const KEY_QUOTATIONS = "saletracker_quotations";
const KEY_QUOTATION_ITEMS = "saletracker_quotation_items";
const KEY_MEMBERS = "saletracker_members";
const KEY_MEMBER_POINT_LOGS = "saletracker_member_point_logs";

const DEFAULT_SETTINGS: ShopSettings = {
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

// Menu starts empty — real products come from the cloud (or are added by
// the manager). Seeding sample products here would pollute the shared
// cloud database every time the app opens on a new device.
const DEFAULT_MENU_ITEMS: MenuItem[] = [];

const roundMoney = (value: number) => Number((Math.round((Number(value) || 0) * 100) / 100).toFixed(2));

const isToday = (timestamp: number): boolean => {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = start.getTime() + 24 * 60 * 60 * 1000;
  return timestamp >= start.getTime() && timestamp < end;
};

export const db = {
  // ── INIT & SEED ──────────────────────────────────────────────
  init() {
    if (!localStorage.getItem(KEY_MENU_ITEMS)) {
      localStorage.setItem(KEY_MENU_ITEMS, JSON.stringify(DEFAULT_MENU_ITEMS));
    }
    if (!localStorage.getItem(KEY_SALES)) {
      localStorage.setItem(KEY_SALES, JSON.stringify([]));
    }
    if (!localStorage.getItem(KEY_SALE_ITEMS)) {
      localStorage.setItem(KEY_SALE_ITEMS, JSON.stringify([]));
    }
    if (!localStorage.getItem(KEY_STOCK_LOGS)) {
      localStorage.setItem(KEY_STOCK_LOGS, JSON.stringify([]));
    }
    if (!localStorage.getItem(KEY_PENDING_ORDERS)) {
      localStorage.setItem(KEY_PENDING_ORDERS, JSON.stringify([]));
    }
    if (!localStorage.getItem(KEY_SETTINGS)) {
      localStorage.setItem(KEY_SETTINGS, JSON.stringify(DEFAULT_SETTINGS));
    }
    if (!localStorage.getItem(KEY_QUOTATIONS)) {
      localStorage.setItem(KEY_QUOTATIONS, JSON.stringify([]));
    }
    if (!localStorage.getItem(KEY_QUOTATION_ITEMS)) {
      localStorage.setItem(KEY_QUOTATION_ITEMS, JSON.stringify([]));
    }
    if (!localStorage.getItem(KEY_MEMBERS)) {
      localStorage.setItem(KEY_MEMBERS, JSON.stringify([]));
    }
    if (!localStorage.getItem(KEY_MEMBER_POINT_LOGS)) {
      localStorage.setItem(KEY_MEMBER_POINT_LOGS, JSON.stringify([]));
    }
    // Seed the default manager when users are missing OR empty — this also
    // protects the shop from ever being locked out with zero users.
    let needUserSeed = false;
    try {
      const rawUsers = localStorage.getItem(KEY_USERS);
      needUserSeed = !rawUsers || (JSON.parse(rawUsers) as User[]).length === 0;
    } catch {
      needUserSeed = true;
    }
    if (needUserSeed) {
      const defaultUser: User = {
        username: "Manivanh",
        password: "1234",
        name: "Manivanh",
        role: "Manager",
        permissions: ["pos", "stock", "reports", "members", "settings"],
        tabPermissions: { pos: true, stock: true, reports: true, members: true, settings: true }
      };
      localStorage.setItem(KEY_USERS, JSON.stringify([defaultUser]));
    }
  },

  // ── USER MANAGEMENT ──────────────────────────────────────────
  getUsers(): User[] {
    this.init();
    return JSON.parse(localStorage.getItem(KEY_USERS) || "[]");
  },

  saveUser(user: User): User[] {
    const users = this.getUsers();
    const index = users.findIndex(u => u.username === user.username);
    if (index !== -1) {
      users[index] = user;
    } else {
      users.push(user);
    }
    persist(KEY_USERS, users);
    return users;
  },

  deleteUser(username: string): User[] {
    const users = this.getUsers();
    const deleted = users.find(u => u.username === username);
    const filtered = users.filter(u => u.username !== username);
    persist(KEY_USERS, filtered);
    if (deleted) notifyLocalDelete(KEY_USERS, deleted);
    return filtered;
  },

  // ── SHOP SETTINGS ───────────────────────────────────────────
  getSettings(): ShopSettings {
    this.init();
    const stored = localStorage.getItem(KEY_SETTINGS);
    if (!stored) {
      return DEFAULT_SETTINGS;
    }
    try {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(stored) };
    } catch (e) {
      return DEFAULT_SETTINGS;
    }
  },

  saveSettings(settings: ShopSettings): ShopSettings {
    persist(KEY_SETTINGS, settings);
    return settings;
  },

  // ── MENU ITEMS ───────────────────────────────────────────────
  getAllMenuItems(): MenuItem[] {
    this.init();
    const items: MenuItem[] = JSON.parse(localStorage.getItem(KEY_MENU_ITEMS) || "[]");

    // Dynamically calculate reservedQty from active quotations
    const quotations: Quotation[] = JSON.parse(localStorage.getItem(KEY_QUOTATIONS) || "[]");
    const quotationItems: QuotationItem[] = JSON.parse(localStorage.getItem(KEY_QUOTATION_ITEMS) || "[]");
    const activeQuotations = quotations.filter(q => q.status !== 'draft' && q.status !== 'converted' && q.status !== 'expired' && q.validUntil >= Date.now());
    const activeQuoteIds = new Set(activeQuotations.map(q => q.id));

    const reservedCounts: { [itemId: number]: number } = {};
    quotationItems.forEach(item => {
      if (activeQuoteIds.has(item.quotationId)) {
        reservedCounts[item.menuItemId] = (reservedCounts[item.menuItemId] || 0) + item.quantity;
      }
    });

    return items.map(item => ({
      ...item,
      reservedQty: reservedCounts[item.id] || 0
    }));
  },

  getMenuItemById(id: number): MenuItem | null {
    const items = this.getAllMenuItems();
    return items.find(item => item.id === id) || null;
  },

  getMenuItemByBarcode(barcode: string): MenuItem | null {
    const items = this.getAllMenuItems();
    return items.find(item => item.barcode === barcode) || null;
  },

  isBarcodeAlreadyUsed(barcode: string, excludeId: number): boolean {
    if (!barcode.trim()) return false;
    const items = this.getAllMenuItems();
    return items.some(item => item.barcode === barcode && item.id !== excludeId);
  },

  insertMenuItem(name: string, price: number, category: string, stockQty: number, lowStockThreshold: number, barcode: string | null, imageUrl?: string | null, costPrice?: number, promoPrice?: number): MenuItem[] {
    const items = this.getAllMenuItems();
    const nextId = items.length > 0 ? Math.max(...items.map(i => i.id)) + 1 : 1;
    const newItem: MenuItem = {
      uid: newUid(),
      id: nextId,
      name,
      price,
      category: category || "General",
      stockQty,
      lowStockThreshold,
      barcode: barcode?.trim() || null,
      imageUrl: imageUrl || null,
      costPrice: costPrice !== undefined ? costPrice : 0,
      promoPrice: promoPrice !== undefined ? promoPrice : 0
    };

    items.push(newItem);
    persist(KEY_MENU_ITEMS, items);

    // Log the initial stock if stock is > 0
    if (stockQty > 0) {
      this.insertStockLog(nextId, name, stockQty, "RESTOCK", stockQty);
    }

    return items;
  },

  updateMenuItem(id: number, name: string, price: number, category: string, stockQty: number, lowStockThreshold: number, barcode: string | null, imageUrl?: string | null, costPrice?: number, promoPrice?: number): MenuItem[] {
    const items = this.getAllMenuItems();
    const index = items.findIndex(item => item.id === id);
    if (index !== -1) {
      const oldStock = items[index].stockQty;
      const difference = stockQty - oldStock;

      items[index] = {
        uid: items[index].uid,
        id,
        name,
        price,
        category: category || "General",
        stockQty,
        lowStockThreshold,
        barcode: barcode?.trim() || null,
        imageUrl: imageUrl || null,
        costPrice: costPrice !== undefined ? costPrice : (items[index].costPrice || 0),
        promoPrice: promoPrice !== undefined ? promoPrice : (items[index].promoPrice || 0)
      };

      persist(KEY_MENU_ITEMS, items);

      // If stock count changed, record a stock log
      if (difference !== 0) {
        this.insertStockLog(
          id,
          name,
          difference,
          difference > 0 ? "RESTOCK" : "ADJUSTMENT",
          stockQty
        );
      }
    }
    return items;
  },

  deleteMenuItem(id: number): MenuItem[] {
    const items = this.getAllMenuItems();
    const deleted = items.find(item => item.id === id);
    const updated = items.filter(item => item.id !== id);
    persist(KEY_MENU_ITEMS, updated);
    if (deleted) notifyLocalDelete(KEY_MENU_ITEMS, deleted);
    return updated;
  },

  // ── STOCK LOGS ────────────────────────────────────────────────
  getAllStockLogs(): StockLog[] {
    this.init();
    return JSON.parse(localStorage.getItem(KEY_STOCK_LOGS) || "[]");
  },

  insertStockLog(menuItemId: number, menuItemName: string, changeQty: number, reason: string, stockAfter: number): StockLog[] {
    const logs = this.getAllStockLogs();
    const nextId = logs.length > 0 ? Math.max(...logs.map(l => l.id)) + 1 : 1;
    const newLog: StockLog = {
      uid: newUid(),
      id: nextId,
      menuItemId,
      menuItemName,
      changeQty,
      reason,
      timestamp: Date.now(),
      stockAfter
    };
    logs.push(newLog);
    // Limit to 200 logs for efficiency, just like Android LIMIT 200
    const sortedLogs = logs.sort((a, b) => b.timestamp - a.timestamp).slice(0, 200);
    persist(KEY_STOCK_LOGS, sortedLogs);
    return sortedLogs;
  },

  adjustStock(menuItemId: number, changeQty: number, reason: string): { menu: MenuItem[], logs: StockLog[] } {
    const items = this.getAllMenuItems();
    const itemIndex = items.findIndex(i => i.id === menuItemId);
    if (itemIndex === -1) return { menu: items, logs: this.getAllStockLogs() };

    const item = items[itemIndex];
    const newStock = Math.max(0, item.stockQty + changeQty);
    items[itemIndex].stockQty = newStock;
    persist(KEY_MENU_ITEMS, items);

    const logs = this.insertStockLog(menuItemId, item.name, changeQty, reason, newStock);
    return { menu: items, logs };
  },

  setStockForItem(menuItemId: number, qty: number, threshold: number): { menu: MenuItem[], logs: StockLog[] } {
    const items = this.getAllMenuItems();
    const itemIndex = items.findIndex(i => i.id === menuItemId);
    if (itemIndex === -1) return { menu: items, logs: this.getAllStockLogs() };

    const item = items[itemIndex];
    const oldStock = item.stockQty;
    const difference = qty - oldStock;

    items[itemIndex].stockQty = qty;
    items[itemIndex].lowStockThreshold = threshold;
    persist(KEY_MENU_ITEMS, items);

    let logs = this.getAllStockLogs();
    if (difference !== 0) {
      logs = this.insertStockLog(
        menuItemId,
        item.name,
        difference,
        difference > 0 ? "RESTOCK" : "ADJUSTMENT",
        qty
      );
    }
    return { menu: items, logs };
  },

  // ── SALES ────────────────────────────────────────────────────
  getAllSalesWithItems(): SaleWithItems[] {
    this.init();
    const sales: Sale[] = JSON.parse(localStorage.getItem(KEY_SALES) || "[]");
    const saleItems: SaleItem[] = JSON.parse(localStorage.getItem(KEY_SALE_ITEMS) || "[]");

    return sales.map(sale => {
      const items = saleItems.filter(item => item.saleId === sale.id);
      return { sale, items };
    }).sort((a, b) => b.sale.timestamp - a.sale.timestamp);
  },

  async recordSale(
    paymentMethod: string, 
    amountTendered: number, 
    cart: { [itemId: number]: number },
    splitTransferAmount?: number,
    splitCashAmount?: number,
    itemDiscounts?: { [itemId: number]: { type: "PERCENT" | "FIXED"; value: number } },
    billDiscount?: { type: "PERCENT" | "FIXED"; value: number } | null,
    isRefund?: boolean,
    memberUid?: string
  ): Promise<{ menu: MenuItem[], sales: SaleWithItems[], logs: StockLog[] }> {
    const sales: Sale[] = JSON.parse(localStorage.getItem(KEY_SALES) || "[]");
    const saleId = sales.length > 0 ? Math.max(...sales.map(s => typeof s.id === 'number' ? s.id : 0)) + 1 : 1;
    const safeAmountTendered = roundMoney(amountTendered);
    const safeSplitTransferAmount = splitTransferAmount !== undefined ? roundMoney(splitTransferAmount) : undefined;
    const safeSplitCashAmount = splitCashAmount !== undefined ? roundMoney(splitCashAmount) : undefined;

    const itemsList = this.getAllMenuItems();
    const saleItems: SaleItem[] = JSON.parse(localStorage.getItem(KEY_SALE_ITEMS) || "[]");
    let subtotalAll = 0;
    const itemsToInsert: SaleItem[] = [];

    // Process each cart item
    Object.entries(cart).forEach(([idStr, quantity]) => {
      const id = parseInt(idStr);
      const menuItem = itemsList.find(i => i.id === id);
      if (!menuItem) return;

      let discountInfo = itemDiscounts?.[id];
      const originalPrice = roundMoney(menuItem.price);
      let unitDiscount = 0;

      if (discountInfo) {
        if (discountInfo.type === "PERCENT") {
          unitDiscount = originalPrice * (discountInfo.value / 100);
        } else {
          unitDiscount = discountInfo.value;
        }
      } else if (isOnPromo(menuItem)) {
        // No explicit discount passed: the product's promo price applies.
        unitDiscount = originalPrice - roundMoney(effectivePrice(menuItem));
        discountInfo = { type: "FIXED", value: roundMoney(unitDiscount) };
      }

      unitDiscount = roundMoney(unitDiscount);
      const discountedPrice = roundMoney(Math.max(0, originalPrice - unitDiscount));
      const q = isRefund ? -quantity : quantity;
      const lineDiscountAmount = roundMoney((originalPrice - discountedPrice) * q);
      const lineSubtotal = roundMoney(discountedPrice * q);

      subtotalAll = roundMoney(subtotalAll + lineSubtotal);

      itemsToInsert.push({
        id: saleItems.length + itemsToInsert.length + 1,
        saleId,
        menuItemId: id,
        name: menuItem.name + (isRefund ? " (ຄືນເຄື່ອງ)" : ""),
        price: discountedPrice,
        quantity: q,
        costPrice: menuItem.costPrice || 0,
        originalPrice,
        discountType: discountInfo?.type,
        discountValue: discountInfo?.value,
        discountAmount: lineDiscountAmount
      });

      // Adjust stock
      const newStock = Math.max(0, menuItem.stockQty - q);
      menuItem.stockQty = newStock;

      // Add Stock Log
      this.insertStockLog(id, menuItem.name, -q, isRefund ? "REFUND" : "SALE", newStock);
    });

    // Whole-bill discount calculation. Refund rows carry negative quantities,
    // so the bill discount must keep the same sign as the transaction.
    let billDiscountAmount = 0;
    if (billDiscount) {
      const discountBase = Math.abs(subtotalAll);
      if (billDiscount.type === "PERCENT") {
        billDiscountAmount = discountBase * (billDiscount.value / 100);
      } else {
        billDiscountAmount = billDiscount.value;
      }
      billDiscountAmount = roundMoney(Math.min(discountBase, Math.max(0, billDiscountAmount)));
      if (isRefund) {
        billDiscountAmount = -billDiscountAmount;
      }
    }
    const finalSubtotal = roundMoney(isRefund ? (subtotalAll - billDiscountAmount) : Math.max(0, subtotalAll - billDiscountAmount));

    const settings = this.getSettings();
    let vatAmount = 0;
    let xxxAmount = 0;

    if (settings.vatEnabled) {
      vatAmount = roundMoney(finalSubtotal * (settings.vatRate / 100));
    }
    if (settings.xxxRateEnabled) {
      xxxAmount = roundMoney(finalSubtotal * (settings.xxxRate / 100));
    }
    const finalTotalAmount = roundMoney(finalSubtotal + vatAmount + xxxAmount);

    const tendered = (paymentMethod === "CASH" || paymentMethod === "SPLIT") ? safeAmountTendered : finalTotalAmount;
    const change = roundMoney(Math.max(0, tendered - finalTotalAmount));

    const newSale: Sale = {
      uid: newUid(),
      id: saleId,
      timestamp: Date.now(),
      totalAmount: finalTotalAmount,
      paymentMethod,
      amountTendered: tendered,
      changeGiven: change,
      subtotal: subtotalAll,
      vatAmount: settings.vatEnabled ? vatAmount : undefined,
      xxxAmount: settings.xxxRateEnabled ? xxxAmount : undefined,
      xxxName: settings.xxxRateEnabled ? settings.xxxRateName : undefined,
      splitTransferAmount: safeSplitTransferAmount,
      splitCashAmount: safeSplitCashAmount,
      // Store bill discount on the Sale level
      discountType: billDiscount?.type,
      discountValue: billDiscount?.value,
      discountAmount: billDiscountAmount,
      isRefund
    };

    // Membership: award points on a real sale (never on refunds — earned
    // points are kept). Points = finalSubtotal * (pointRate / 100).
    if (!isRefund && memberUid && settings.membershipEnabled) {
      const members: Member[] = JSON.parse(localStorage.getItem(KEY_MEMBERS) || "[]");
      const mIndex = members.findIndex(m => m.uid === memberUid);
      if (mIndex !== -1) {
        const member = members[mIndex];
        const pointsEarned = Math.round(finalSubtotal * (settings.pointRate / 100));
        member.points = (member.points || 0) + pointsEarned;
        member.visits = (member.visits || 0) + 1;
        member.totalSpend = roundMoney((member.totalSpend || 0) + finalTotalAmount);
        members[mIndex] = member;
        persist(KEY_MEMBERS, members);

        this.insertMemberPointLog({
          memberUid,
          memberName: member.name,
          changePoints: pointsEarned,
          pointsAfter: member.points,
          reason: "SALE",
          billAmount: finalSubtotal,
          rateUsed: settings.pointRate,
          saleId
        });

        newSale.memberUid = memberUid;
        newSale.memberName = member.name;
        newSale.pointsEarned = pointsEarned;
      }
    }

    sales.push(newSale);
    saleItems.push(...itemsToInsert);

    persist(KEY_SALES, sales);
    persist(KEY_SALE_ITEMS, saleItems);
    persist(KEY_MENU_ITEMS, itemsList);

    return {
      menu: itemsList,
      sales: this.getAllSalesWithItems(),
      logs: this.getAllStockLogs()
    };
  },

  refundSale(saleId: number): { menu: MenuItem[], sales: SaleWithItems[], logs: StockLog[] } {
    this.init();
    const itemsList = this.getAllMenuItems();
    const sales: Sale[] = JSON.parse(localStorage.getItem(KEY_SALES) || "[]");
    const saleItems: SaleItem[] = JSON.parse(localStorage.getItem(KEY_SALE_ITEMS) || "[]");

    const originalSaleIndex = sales.findIndex(s => s.id === saleId);
    if (originalSaleIndex === -1) {
      return {
        menu: itemsList,
        sales: this.getAllSalesWithItems(),
        logs: this.getAllStockLogs()
      };
    }

    const originalSale = sales[originalSaleIndex];
    const originalItems = saleItems.filter(si => si.saleId === saleId);

    // Create a new refund sale
    const refundSaleId = sales.length > 0 ? Math.max(...sales.map(s => s.id)) + 1 : 1;

    // Calculate negative values
    const negativeItems: SaleItem[] = [];
    let nextSaleItemId = saleItems.length > 0 ? Math.max(...saleItems.map(si => si.id)) + 1 : 1;

    originalItems.forEach(item => {
      negativeItems.push({
        id: nextSaleItemId++,
        saleId: refundSaleId,
        menuItemId: item.menuItemId,
        name: item.name + " (ຄືນເຄື່ອງ)", // Returned item label
        price: item.price,
        quantity: -item.quantity, // negative quantity
        costPrice: item.costPrice || 0,
        discountType: item.discountType,
        discountValue: item.discountValue,
        discountAmount: item.discountAmount ? -item.discountAmount : undefined,
        originalPrice: item.originalPrice
      });

      // Put stock back
      const menuItem = itemsList.find(mi => mi.id === item.menuItemId);
      if (menuItem) {
        const newStock = menuItem.stockQty + item.quantity;
        menuItem.stockQty = newStock;
        this.insertStockLog(menuItem.id, menuItem.name, item.quantity, "REFUND", newStock);
      }
    });

    const refundSale: Sale = {
      uid: newUid(),
      id: refundSaleId,
      timestamp: Date.now(),
      totalAmount: -originalSale.totalAmount,
      paymentMethod: "REFUND",
      amountTendered: -originalSale.amountTendered,
      changeGiven: -originalSale.changeGiven,
      subtotal: originalSale.subtotal ? -originalSale.subtotal : undefined,
      vatAmount: originalSale.vatAmount ? -originalSale.vatAmount : undefined,
      xxxAmount: originalSale.xxxAmount ? -originalSale.xxxAmount : undefined,
      xxxName: originalSale.xxxName,
      splitTransferAmount: originalSale.splitTransferAmount ? -originalSale.splitTransferAmount : undefined,
      splitCashAmount: originalSale.splitCashAmount ? -originalSale.splitCashAmount : undefined,
      discountType: originalSale.discountType,
      discountValue: originalSale.discountValue,
      discountAmount: originalSale.discountAmount ? -originalSale.discountAmount : undefined,
      isRefund: true,
      refundedSaleId: saleId
    };

    sales.push(refundSale);
    saleItems.push(...negativeItems);

    persist(KEY_SALES, sales);
    persist(KEY_SALE_ITEMS, saleItems);
    persist(KEY_MENU_ITEMS, itemsList);

    return {
      menu: itemsList,
      sales: this.getAllSalesWithItems(),
      logs: this.getAllStockLogs()
    };
  },

  updateSaleWithItems(
    saleId: number,
    updatedItems: { menuItemId: number; quantity: number; price: number; name: string }[]
  ): { menu: MenuItem[], sales: SaleWithItems[], logs: StockLog[] } {
    this.init();
    const itemsList = this.getAllMenuItems();
    const sales: Sale[] = JSON.parse(localStorage.getItem(KEY_SALES) || "[]");
    let saleItems: SaleItem[] = JSON.parse(localStorage.getItem(KEY_SALE_ITEMS) || "[]");

    const saleIndex = sales.findIndex(s => s.id === saleId);
    if (saleIndex === -1) {
      return {
        menu: itemsList,
        sales: this.getAllSalesWithItems(),
        logs: this.getAllStockLogs()
      };
    }

    const sale = sales[saleIndex];
    const existingSaleItems = saleItems.filter(si => si.saleId === saleId);

    const existingMap = new Map<number, SaleItem>();
    existingSaleItems.forEach(item => {
      existingMap.set(item.menuItemId, item);
    });

    const updatedMap = new Map<number, { menuItemId: number; quantity: number; price: number; name: string }>();
    updatedItems.forEach(item => {
      updatedMap.set(item.menuItemId, item);
    });

    // Handle existing items (updated or removed)
    existingSaleItems.forEach(oldItem => {
      const newItem = updatedMap.get(oldItem.menuItemId);
      const menuItem = itemsList.find(mi => mi.id === oldItem.menuItemId);
      
      if (!newItem) {
        // completely removed from sale, return full quantity back to stock
        if (menuItem) {
          const newStock = menuItem.stockQty + oldItem.quantity;
          menuItem.stockQty = newStock;
          this.insertStockLog(menuItem.id, menuItem.name, oldItem.quantity, "RESTOCK", newStock);
        }
      } else {
        // quantity changed
        const diffQty = newItem.quantity - oldItem.quantity;
        if (diffQty !== 0 && menuItem) {
          const newStock = Math.max(0, menuItem.stockQty - diffQty);
          menuItem.stockQty = newStock;
          this.insertStockLog(
            menuItem.id, 
            menuItem.name, 
            -diffQty, 
            diffQty > 0 ? "SALE" : "RESTOCK", 
            newStock
          );
        }
      }
    });

    // Handle completely new items added to the sale
    updatedItems.forEach(newItem => {
      if (!existingMap.has(newItem.menuItemId)) {
        const menuItem = itemsList.find(mi => mi.id === newItem.menuItemId);
        if (menuItem) {
          const newStock = Math.max(0, menuItem.stockQty - newItem.quantity);
          menuItem.stockQty = newStock;
          this.insertStockLog(
            menuItem.id, 
            menuItem.name, 
            -newItem.quantity, 
            "SALE", 
            newStock
          );
        }
      }
    });

    // Replace sale items in localstorage for this sale
    saleItems = saleItems.filter(si => si.saleId !== saleId);

    let nextSaleItemId = saleItems.length > 0 ? Math.max(...saleItems.map(si => si.id)) + 1 : 1;
    const newSaleItems: SaleItem[] = updatedItems.map(it => {
      const menuItem = itemsList.find(mi => mi.id === it.menuItemId);
      return {
        id: nextSaleItemId++,
        saleId,
        menuItemId: it.menuItemId,
        name: it.name,
        price: it.price,
        quantity: it.quantity,
        costPrice: menuItem ? (menuItem.costPrice || 0) : 0
      };
    });

    saleItems.push(...newSaleItems);

    // Recalculate sale totals
    let totalProductAmount = updatedItems.reduce((sum, it) => sum + it.price * it.quantity, 0);

    const settings = this.getSettings();
    const subtotal = totalProductAmount;
    let vatAmount = 0;
    let xxxAmount = 0;

    if (settings.vatEnabled) {
      vatAmount = subtotal * (settings.vatRate / 100);
    }
    if (settings.xxxRateEnabled) {
      xxxAmount = subtotal * (settings.xxxRate / 100);
    }
    const finalTotalAmount = subtotal + vatAmount + xxxAmount;

    let amountTendered = sale.amountTendered;
    let changeGiven = sale.changeGiven;
    let splitTransferAmount = sale.splitTransferAmount;
    let splitCashAmount = sale.splitCashAmount;

    if (sale.paymentMethod === "SPLIT") {
      const oldTotal = sale.totalAmount;
      if (oldTotal > 0) {
        const ratio = finalTotalAmount / oldTotal;
        if (splitTransferAmount !== undefined) {
          splitTransferAmount = Math.round(splitTransferAmount * ratio);
        }
        if (splitCashAmount !== undefined) {
          splitCashAmount = Math.round(splitCashAmount * ratio);
        }
      } else {
        splitTransferAmount = finalTotalAmount;
        splitCashAmount = 0;
      }
      amountTendered = (splitTransferAmount ?? 0) + (splitCashAmount ?? 0);
      changeGiven = 0;
    } else if (sale.paymentMethod !== "CASH") {
      amountTendered = finalTotalAmount;
      changeGiven = 0;
    } else {
      if (amountTendered < finalTotalAmount) {
        amountTendered = finalTotalAmount;
      }
      changeGiven = Math.max(0, amountTendered - finalTotalAmount);
    }

    sales[saleIndex] = {
      ...sale,
      subtotal,
      totalAmount: finalTotalAmount,
      vatAmount: settings.vatEnabled ? vatAmount : undefined,
      xxxAmount: settings.xxxRateEnabled ? xxxAmount : undefined,
      amountTendered,
      changeGiven,
      splitTransferAmount,
      splitCashAmount
    };

    persist(KEY_SALES, sales);
    persist(KEY_SALE_ITEMS, saleItems);
    persist(KEY_MENU_ITEMS, itemsList);

    return {
      menu: itemsList,
      sales: this.getAllSalesWithItems(),
      logs: this.getAllStockLogs()
    };
  },

  deleteSaleAndItems(saleId: number): { sales: SaleWithItems[] } {
    this.init();
    const sales: Sale[] = JSON.parse(localStorage.getItem(KEY_SALES) || "[]");
    const saleItems: SaleItem[] = JSON.parse(localStorage.getItem(KEY_SALE_ITEMS) || "[]");
    const deleted = sales.find(s => s.id === saleId);

    const filteredSales = sales.filter(s => s.id !== saleId);
    const filteredItems = saleItems.filter(i => i.saleId !== saleId);

    persist(KEY_SALES, filteredSales);
    persist(KEY_SALE_ITEMS, filteredItems);
    if (deleted) notifyLocalDelete(KEY_SALES, deleted);

    return { sales: this.getAllSalesWithItems() };
  },

  // ── PENDING ORDERS ───────────────────────────────────────────
  getPendingOrders(): PendingOrder[] {
    this.init();
    const orders: PendingOrder[] = JSON.parse(localStorage.getItem(KEY_PENDING_ORDERS) || "[]");
    const todayOrders = orders.filter(o => isToday(o.createdAt));
    if (todayOrders.length !== orders.length) {
      // Local cache cleanup only: never notify cloud sync for automatic expiry.
      localStorage.setItem(KEY_PENDING_ORDERS, JSON.stringify(todayOrders));
    }
    return todayOrders;
  },

  savePendingOrder(label: string, cart: { [itemId: number]: number }): PendingOrder[] {
    const orders = this.getPendingOrders();
    const newOrder: PendingOrder = {
      id: Math.random().toString(36).substring(2, 9),
      label,
      cart,
      createdAt: Date.now()
    };
    orders.push(newOrder);
    persist(KEY_PENDING_ORDERS, orders);
    return orders;
  },

  deletePendingOrder(id: string): PendingOrder[] {
    const orders = this.getPendingOrders();
    const deleted = orders.find(o => o.id === id);
    const filtered = orders.filter(o => o.id !== id);
    persist(KEY_PENDING_ORDERS, filtered);
    if (deleted) notifyLocalDelete(KEY_PENDING_ORDERS, deleted);
    return filtered;
  },

  // Bulk Import Overwrite/Sync
  bulkImportMenuItems(itemsToImport: MenuItem[]): MenuItem[] {
    const existing = this.getAllMenuItems();
    const merged = [...existing];

    itemsToImport.forEach(imported => {
      // Find matching item: barcode first, then name (case-insensitive)
      const matchIndex = merged.findIndex(e => 
        (imported.barcode && e.barcode && imported.barcode.trim() === e.barcode.trim()) ||
        (e.name.trim().toLowerCase() === imported.name.trim().toLowerCase())
      );

      if (matchIndex !== -1) {
        // Update existing item
        const existingItem = merged[matchIndex];
        merged[matchIndex] = {
          ...existingItem,
          name: imported.name,
          price: imported.price,
          category: imported.category || existingItem.category,
          stockQty: imported.stockQty !== undefined ? imported.stockQty : existingItem.stockQty,
          lowStockThreshold: imported.lowStockThreshold !== undefined ? imported.lowStockThreshold : existingItem.lowStockThreshold,
          barcode: imported.barcode || existingItem.barcode,
          imageUrl: imported.imageUrl || existingItem.imageUrl || null
        };

        // If stock changed, record stock log
        const oldStock = existingItem.stockQty;
        const diff = merged[matchIndex].stockQty - oldStock;
        if (diff !== 0) {
          this.insertStockLog(
            existingItem.id,
            imported.name,
            diff,
            diff > 0 ? "RESTOCK" : "ADJUSTMENT",
            merged[matchIndex].stockQty
          );
        }
      } else {
        // Insert new item
        const nextId = merged.length > 0 ? Math.max(...merged.map(m => m.id)) + 1 : 1;
        const newItem: MenuItem = {
          ...imported,
          id: nextId
        };
        merged.push(newItem);

        if (newItem.stockQty > 0) {
          this.insertStockLog(newItem.id, newItem.name, newItem.stockQty, "RESTOCK", newItem.stockQty);
        }
      }
    });

    persist(KEY_MENU_ITEMS, merged);
    return merged;
  },

  // ── QUOTATIONS ────────────────────────────────────────────────
  getAllQuotationsWithItems(): QuotationWithItems[] {
    this.init();
    const quotations: Quotation[] = JSON.parse(localStorage.getItem(KEY_QUOTATIONS) || "[]");
    const quotationItems: QuotationItem[] = JSON.parse(localStorage.getItem(KEY_QUOTATION_ITEMS) || "[]");

    return quotations.map(quotation => {
      const items = quotationItems.filter(item => item.quotationId === quotation.id);
      return { quotation, items };
    }).sort((a, b) => b.quotation.timestamp - a.quotation.timestamp);
  },

  saveQuotation(
    quotationData: Partial<Quotation> & { items: Omit<QuotationItem, "id" | "quotationId">[] }
  ): { quotations: QuotationWithItems[], menu: MenuItem[] } {
    this.init();
    const quotations: Quotation[] = JSON.parse(localStorage.getItem(KEY_QUOTATIONS) || "[]");
    let quotationItems: QuotationItem[] = JSON.parse(localStorage.getItem(KEY_QUOTATION_ITEMS) || "[]");

    let id = quotationData.id;
    let quoteNumber = quotationData.quoteNumber;

    if (!id) {
      id = quotations.length > 0 ? Math.max(...quotations.map(q => q.id)) + 1 : 1;
      let nextSeq = 1;
      quotations.forEach(q => {
        const numStr = q.quoteNumber.replace("QT-", "");
        const parsed = parseInt(numStr);
        if (!isNaN(parsed) && parsed >= nextSeq) {
          nextSeq = parsed + 1;
        }
      });
      quoteNumber = `QT-${String(nextSeq).padStart(4, '0')}`;
    }

    const existingQuote = quotations.find(q => q.id === id);
    const finalQuotation: Quotation = {
      uid: existingQuote?.uid || newUid(),
      id,
      quoteNumber: quoteNumber || `QT-0001`,
      timestamp: quotationData.timestamp || Date.now(),
      totalAmount: quotationData.totalAmount || 0,
      subtotal: quotationData.subtotal,
      vatAmount: quotationData.vatAmount,
      xxxAmount: quotationData.xxxAmount,
      xxxName: quotationData.xxxName,
      discountType: quotationData.discountType,
      discountValue: quotationData.discountValue,
      discountAmount: quotationData.discountAmount,
      status: quotationData.status || 'draft',
      customerName: quotationData.customerName,
      customerContact: quotationData.customerContact,
      notes: quotationData.notes,
      validUntil: quotationData.validUntil || (Date.now() + 7 * 24 * 60 * 60 * 1000),
      convertedSaleId: quotationData.convertedSaleId
    };

    quotationItems = quotationItems.filter(item => item.quotationId !== id);

    let nextItemId = quotationItems.length > 0 ? Math.max(...quotationItems.map(i => i.id)) + 1 : 1;
    const insertedItems: QuotationItem[] = quotationData.items.map(item => ({
      ...item,
      id: nextItemId++,
      quotationId: id!
    }));

    quotationItems.push(...insertedItems);

    const existingIndex = quotations.findIndex(q => q.id === id);
    if (existingIndex !== -1) {
      quotations[existingIndex] = finalQuotation;
    } else {
      quotations.push(finalQuotation);
    }

    persist(KEY_QUOTATIONS, quotations);
    persist(KEY_QUOTATION_ITEMS, quotationItems);

    return {
      quotations: this.getAllQuotationsWithItems(),
      menu: this.getAllMenuItems()
    };
  },

  deleteQuotation(id: number): { quotations: QuotationWithItems[], menu: MenuItem[] } {
    this.init();
    const quotations: Quotation[] = JSON.parse(localStorage.getItem(KEY_QUOTATIONS) || "[]");
    const quotationItems: QuotationItem[] = JSON.parse(localStorage.getItem(KEY_QUOTATION_ITEMS) || "[]");
    const deleted = quotations.find(q => q.id === id);

    const filteredQuotations = quotations.filter(q => q.id !== id);
    const filteredItems = quotationItems.filter(item => item.quotationId !== id);

    persist(KEY_QUOTATIONS, filteredQuotations);
    persist(KEY_QUOTATION_ITEMS, filteredItems);
    if (deleted) notifyLocalDelete(KEY_QUOTATIONS, deleted);

    return {
      quotations: this.getAllQuotationsWithItems(),
      menu: this.getAllMenuItems()
    };
  },

  convertQuotationToSale(quotationId: number, saleId: number): { quotations: QuotationWithItems[], menu: MenuItem[] } {
    this.init();
    const quotations: Quotation[] = JSON.parse(localStorage.getItem(KEY_QUOTATIONS) || "[]");
    const qIndex = quotations.findIndex(q => q.id === quotationId);
    if (qIndex !== -1) {
      quotations[qIndex].status = 'converted';
      quotations[qIndex].convertedSaleId = saleId;
      persist(KEY_QUOTATIONS, quotations);
    }
    return {
      quotations: this.getAllQuotationsWithItems(),
      menu: this.getAllMenuItems()
    };
  },

  // ── MEMBERSHIP ───────────────────────────────────────────────
  getAllMembers(): Member[] {
    this.init();
    const members: Member[] = JSON.parse(localStorage.getItem(KEY_MEMBERS) || "[]");
    return members.sort((a, b) => a.name.localeCompare(b.name));
  },

  getMemberByUid(uid: string): Member | null {
    return this.getAllMembers().find(m => m.uid === uid) || null;
  },

  isPhoneAlreadyUsed(phone: string, excludeUid?: string): boolean {
    const p = phone.trim();
    if (!p) return false;
    return this.getAllMembers().some(m => m.phone.trim() === p && m.uid !== excludeUid);
  },

  saveMember(data: { uid?: string; name: string; phone: string; address?: string }): Member[] {
    this.init();
    const members: Member[] = JSON.parse(localStorage.getItem(KEY_MEMBERS) || "[]");
    if (data.uid) {
      const index = members.findIndex(m => m.uid === data.uid);
      if (index !== -1) {
        members[index] = {
          ...members[index],
          name: data.name.trim(),
          phone: data.phone.trim(),
          address: data.address?.trim() || ""
        };
      }
    } else {
      const nextId = members.length > 0 ? Math.max(...members.map(m => m.id)) + 1 : 1;
      members.push({
        uid: newUid(),
        id: nextId,
        name: data.name.trim(),
        phone: data.phone.trim(),
        address: data.address?.trim() || "",
        points: 0,
        visits: 0,
        totalSpend: 0,
        createdAt: Date.now()
      });
    }
    persist(KEY_MEMBERS, members);
    return this.getAllMembers();
  },

  deleteMember(uid: string): Member[] {
    const existing = this.getAllMembers();
    const deleted = existing.find(m => m.uid === uid);
    const members = existing.filter(m => m.uid !== uid);
    persist(KEY_MEMBERS, members);
    if (deleted) notifyLocalDelete(KEY_MEMBERS, deleted);
    return members;
  },

  getAllMemberPointLogs(): MemberPointLog[] {
    this.init();
    return JSON.parse(localStorage.getItem(KEY_MEMBER_POINT_LOGS) || "[]");
  },

  getMemberPointLogs(memberUid: string): MemberPointLog[] {
    return this.getAllMemberPointLogs()
      .filter(l => l.memberUid === memberUid)
      .sort((a, b) => b.timestamp - a.timestamp);
  },

  insertMemberPointLog(entry: Omit<MemberPointLog, "id" | "uid" | "timestamp">): MemberPointLog[] {
    const logs = this.getAllMemberPointLogs();
    const nextId = logs.length > 0 ? Math.max(...logs.map(l => l.id)) + 1 : 1;
    logs.push({ ...entry, uid: newUid(), id: nextId, timestamp: Date.now() });
    // Cap at 500 entries for storage efficiency.
    const trimmed = logs.sort((a, b) => b.timestamp - a.timestamp).slice(0, 500);
    persist(KEY_MEMBER_POINT_LOGS, trimmed);
    return trimmed;
  },

  // Manual point adjustment (Manager action). Positive to add, negative to deduct.
  adjustMemberPoints(memberUid: string, changePoints: number, reason: string): Member[] {
    this.init();
    const members: Member[] = JSON.parse(localStorage.getItem(KEY_MEMBERS) || "[]");
    const index = members.findIndex(m => m.uid === memberUid);
    if (index === -1) return this.getAllMembers();
    const member = members[index];
    member.points = Math.max(0, (member.points || 0) + changePoints);
    members[index] = member;
    persist(KEY_MEMBERS, members);
    this.insertMemberPointLog({
      memberUid,
      memberName: member.name,
      changePoints,
      pointsAfter: member.points,
      reason: reason || "ADJUSTMENT"
    });
    return this.getAllMembers();
  }
};
