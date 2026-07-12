/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface User {
  username: string;
  /** legacy plain-text PIN — migrated to passwordHash on first login */
  password?: string;
  /** salted SHA-256 hash of the PIN (see utils/security.ts) */
  passwordHash?: string;
  name: string;
  role: 'Manager' | 'Cashier';
  permissions: string[];
  tabPermissions?: {
    pos: boolean;
    stock: boolean;
    reports: boolean;
    settings: boolean;
    members?: boolean; // Membership tab — default off for Cashier, granted by Manager
  };
}

export interface MenuItem {
  uid?: string; // globally-unique cloud id (new records)
  id: number;
  name: string;
  price: number;
  category: string;
  stockQty: number;
  lowStockThreshold: number;
  barcode: string | null;
  imageUrl?: string | null;
  costPrice?: number;
  /** promotional selling price — active only when > 0 and < price */
  promoPrice?: number;
  reservedQty?: number;
}

/** True when the item has a valid promotional price. */
export const isOnPromo = (item: MenuItem): boolean =>
  typeof item.promoPrice === "number" && item.promoPrice > 0 && item.promoPrice < item.price;

/** The price the customer actually pays: promo price when active, else normal price. */
export const effectivePrice = (item: MenuItem): number =>
  isOnPromo(item) ? (item.promoPrice as number) : item.price;

export interface ShopSettings {
  shopName: string;
  phone: string;
  contact: string;
  qrCodeUrl: string | null;
  logoUrl: string | null;
  receiptPaperSize: "58mm" | "80mm";
  vatEnabled: boolean;
  vatRate: number; // percentage, e.g. 10
  xxxRateEnabled: boolean;
  xxxRateName: string; // custom rate name like "Service Charge"
  xxxRate: number; // percentage, e.g. 5
  // Membership / loyalty points
  membershipEnabled: boolean;
  // Points earned per bill = finalSubtotal * (pointRate / 100).
  // e.g. pointRate = 1 → 10,000 LAK bill earns 100 points.
  pointRate: number; // percentage
}

export interface Sale {
  uid?: string; // globally-unique cloud id (new records)
  id: number;
  timestamp: number;
  totalAmount: number;
  paymentMethod: string; // "CASH", "TRANSFER", "QR"
  amountTendered: number;
  changeGiven: number;
  subtotal?: number;
  vatAmount?: number;
  xxxAmount?: number;
  xxxName?: string;
  splitTransferAmount?: number;
  splitCashAmount?: number;
  // New discount and refund fields
  discountType?: "PERCENT" | "FIXED";
  discountValue?: number;
  discountAmount?: number;
  isRefund?: boolean;
  refundedSaleId?: number;
  // Membership: which member this bill was attributed to, and points earned
  memberUid?: string;
  memberName?: string;
  pointsEarned?: number;
}

export interface SaleItem {
  id: number;
  saleId: number;
  menuItemId: number;
  name: string;
  price: number;
  quantity: number;
  costPrice?: number;
  // New discount fields
  discountType?: "PERCENT" | "FIXED";
  discountValue?: number;
  discountAmount?: number;
  originalPrice?: number;
}

export interface StockLog {
  uid?: string; // globally-unique cloud id (new records)
  id: number;
  menuItemId: number;
  menuItemName: string;
  changeQty: number;
  reason: string; // "SALE", "RESTOCK", "ADJUSTMENT", "DAMAGE"
  timestamp: number;
  stockAfter: number;
}

export interface SaleWithItems {
  sale: Sale;
  items: SaleItem[];
}

export interface Quotation {
  uid?: string; // globally-unique cloud id (new records)
  id: number;
  quoteNumber: string; // format "QT-0001"
  timestamp: number;
  totalAmount: number;
  subtotal?: number;
  vatAmount?: number;
  xxxAmount?: number;
  xxxName?: string;
  discountType?: "PERCENT" | "FIXED";
  discountValue?: number;
  discountAmount?: number;
  status: 'draft' | 'sent' | 'accepted' | 'expired' | 'converted';
  customerName?: string;
  customerContact?: string;
  notes?: string;
  validUntil: number; // expiry date timestamp
  convertedSaleId?: number; // set when converted
}

export interface QuotationItem {
  id: number;
  quotationId: number;
  menuItemId: number;
  name: string;
  price: number;
  quantity: number;
  costPrice?: number;
  discountType?: "PERCENT" | "FIXED";
  discountValue?: number;
  discountAmount?: number;
  originalPrice?: number;
}

export interface QuotationWithItems {
  quotation: Quotation;
  items: QuotationItem[];
}

export interface PendingOrder {
  id: string;
  label: string;
  cart: { [menuItemId: number]: number }; // menuItemId -> quantity
  createdAt: number;
}

export interface Member {
  uid?: string; // globally-unique cloud id
  id: number;
  name: string;
  phone: string;
  address?: string;
  points: number;
  visits: number;
  totalSpend: number;
  createdAt: number;
}

export interface MemberPointLog {
  uid?: string; // globally-unique cloud id
  id: number;
  memberUid: string;
  memberName: string;
  changePoints: number; // + earned / manual add, - manual deduct
  pointsAfter: number;
  reason: string; // "SALE" | "ADJUSTMENT"
  billAmount?: number; // for SALE: the bill subtotal points were based on
  rateUsed?: number; // for SALE: pointRate % at the time
  saleId?: number; // for SALE: the linked bill
  timestamp: number;
}

export enum DateFilterType {
  TODAY = "TODAY",
  YESTERDAY = "YESTERDAY",
  LAST_7_DAYS = "LAST_7_DAYS",
  THIS_MONTH = "THIS_MONTH",
  CUSTOM = "CUSTOM",
}

export enum AppTab {
  POS = "pos",
  STOCK = "stock",
  REPORTS = "reports",
  MEMBERS = "members",
  SETTINGS = "settings",
}

export enum RowStatus {
  NEW = "NEW",
  UPDATE = "UPDATE",
  ERROR = "ERROR",
}

export interface ImportRow {
  rowNumber: number;
  status: RowStatus;
  item: MenuItem | null;
  message: string;
}

export interface ImportPreview {
  rows: ImportRow[];
  fatalError: string | null;
  newCount: number;
  updateCount: number;
  errorCount: number;
  validItems: MenuItem[];
}
