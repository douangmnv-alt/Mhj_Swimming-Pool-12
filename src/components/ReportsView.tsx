/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from "react";
import { 
  TrendingUp, Calendar, Trash2, Printer, ChevronDown, ChevronUp, FileSpreadsheet, FileText, X, Layers, Wallet, Banknote, ArrowRightLeft, Edit, Plus, Minus, Share2
} from "lucide-react";
import { SaleWithItems, DateFilterType, MenuItem, Quotation, QuotationItem, QuotationWithItems } from "../types";
import { exporters } from "../utils/exporters";
import { db } from "../utils/db";
import QRCode from "qrcode";

interface ReportsViewProps {
  salesList: SaleWithItems[];
  menuItems: MenuItem[];
  onDeleteSale: (id: number) => void;
  onUpdateSaleItems: (
    saleId: number,
    updatedItems: { menuItemId: number; quantity: number; price: number; name: string }[]
  ) => void;
  onRefundSale: (id: number) => void;
  quotationsList?: QuotationWithItems[];
  onDeleteQuotation?: (id: number) => void;
  onSaveQuotation?: (
    quotationData: any,
    onSuccess?: (quote: any) => void
  ) => void;
  onLoadQuotationToCart?: (quote: QuotationWithItems) => void;
}

export default function ReportsView({ 
  salesList, 
  menuItems, 
  onDeleteSale, 
  onUpdateSaleItems, 
  onRefundSale,
  quotationsList = [],
  onDeleteQuotation,
  onSaveQuotation,
  onLoadQuotationToCart
}: ReportsViewProps) {
  // Helper date conversions
  const toLocalDateString = (date: Date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  // Filters
  const [filterType, setFilterType] = useState<DateFilterType>(DateFilterType.TODAY);
  const [customStart, setCustomStart] = useState<string>(() => toLocalDateString(new Date()));
  const [customEnd, setCustomEnd] = useState<string>(() => toLocalDateString(new Date()));
  const [showCustomPicker, setShowCustomPicker] = useState(false);

  // Subtab for Sales vs Quotations
  const [subTab, setSubTab] = useState<'sales' | 'quotations'>('sales');

  // Quotation editing and custom states
  const [editingQuotation, setEditingQuotation] = useState<QuotationWithItems | null>(null);
  const [editQuoteCustomerName, setEditQuoteCustomerName] = useState("");
  const [editQuoteCustomerContact, setEditQuoteCustomerContact] = useState("");
  const [editQuoteNotes, setEditQuoteNotes] = useState("");
  const [editQuoteStatus, setEditQuoteStatus] = useState<'draft' | 'sent' | 'accepted' | 'expired' | 'converted'>('sent');
  const [editQuoteValidUntil, setEditQuoteValidUntil] = useState("");
  const [editQuoteItems, setEditQuoteItems] = useState<{ menuItemId: number; quantity: number; price: number; originalPrice: number; name: string; discountType?: "PERCENT" | "FIXED"; discountValue?: number; discountAmount?: number }[]>([]);
  const [editQuoteSelectedProductToAdd, setEditQuoteSelectedProductToAdd] = useState("");

  const handleStartEditQuotation = (q: QuotationWithItems) => {
    setEditingQuotation(q);
    setEditQuoteCustomerName(q.quotation.customerName || "");
    setEditQuoteCustomerContact(q.quotation.customerContact || "");
    setEditQuoteNotes(q.quotation.notes || "");
    setEditQuoteStatus(q.quotation.status);
    setEditQuoteValidUntil(new Date(q.quotation.validUntil).toISOString().split('T')[0]);
    setEditQuoteItems(
      q.items.map(it => ({
        menuItemId: it.menuItemId,
        quantity: it.quantity,
        price: it.price,
        originalPrice: it.originalPrice,
        name: it.name,
        discountType: it.discountType,
        discountValue: it.discountValue,
        discountAmount: it.discountAmount
      }))
    );
  };

  const handleUpdateEditingQuoteQty = (itemId: number, delta: number) => {
    setEditQuoteItems(prev => {
      return prev.map(it => {
        if (it.menuItemId === itemId) {
          const newQty = Math.max(1, it.quantity + delta);
          let lineDiscountAmount = 0;
          if (it.discountType === "PERCENT" && it.discountValue) {
            lineDiscountAmount = (it.originalPrice * (it.discountValue / 100)) * newQty;
          } else if (it.discountType === "FIXED" && it.discountValue) {
            lineDiscountAmount = it.discountValue * newQty;
          }
          return {
            ...it,
            quantity: newQty,
            discountAmount: lineDiscountAmount
          };
        }
        return it;
      });
    });
  };

  const handleRemoveEditingQuoteItem = (itemId: number) => {
    setEditQuoteItems(prev => prev.filter(it => it.menuItemId !== itemId));
  };

  const handleAddingProductToEditingQuote = (productIdStr: string) => {
    const prodId = parseInt(productIdStr);
    if (!prodId) return;
    const prod = menuItems.find(m => m.id === prodId);
    if (!prod) return;

    setEditQuoteItems(prev => {
      const existing = prev.find(it => it.menuItemId === prodId);
      if (existing) {
        return prev.map(it => {
          if (it.menuItemId === prodId) {
            return { ...it, quantity: it.quantity + 1 };
          }
          return it;
        });
      } else {
        return [
          ...prev,
          {
            menuItemId: prod.id,
            quantity: 1,
            price: prod.price,
            originalPrice: prod.price,
            name: prod.name,
            discountAmount: 0
          }
        ];
      }
    });
    setEditQuoteSelectedProductToAdd("");
  };

  const handleSaveEditedQuotation = () => {
    if (!editingQuotation || !onSaveQuotation) return;

    const subtotal = editQuoteItems.reduce((sum, it) => sum + it.price * it.quantity, 0);
    const shop = db.getSettings();
    let vatAmount = 0;
    let xxxAmount = 0;
    if (shop.vatEnabled) {
      vatAmount = subtotal * (shop.vatRate / 100);
    }
    if (shop.xxxRateEnabled) {
      xxxAmount = subtotal * (shop.xxxRate / 100);
    }
    const totalAmount = subtotal + vatAmount + xxxAmount;

    const updatedPayload = {
      id: editingQuotation.quotation.id,
      quoteNumber: editingQuotation.quotation.quoteNumber,
      timestamp: editingQuotation.quotation.timestamp,
      totalAmount,
      subtotal,
      vatAmount: shop.vatEnabled ? vatAmount : undefined,
      xxxAmount: shop.xxxRateEnabled ? xxxAmount : undefined,
      xxxName: shop.xxxRateEnabled ? shop.xxxRateName : undefined,
      status: editQuoteStatus,
      customerName: editQuoteCustomerName.trim() || undefined,
      customerContact: editQuoteCustomerContact.trim() || undefined,
      notes: editQuoteNotes.trim() || undefined,
      validUntil: new Date(editQuoteValidUntil).getTime(),
      items: editQuoteItems.map(it => ({
        menuItemId: it.menuItemId,
        name: it.name,
        price: it.price,
        originalPrice: it.originalPrice,
        discountType: it.discountType,
        discountValue: it.discountValue,
        discountAmount: it.discountAmount || 0,
        quantity: it.quantity
      }))
    };

    onSaveQuotation(updatedPayload, () => {
      showNotification("ແກ້ໄຂໃບສະເໜີລາຄາສຳເລັດແລ້ວ!");
      setEditingQuotation(null);
    });
  };

  const buildQuotationPrintHtml = (quoteWithItems: QuotationWithItems) => {
    const shop = db.getSettings();
    const q = quoteWithItems.quotation;
    const itemsHtml = quoteWithItems.items.map((item) => {
      const lineTotal = (Number(item.price) || 0) * (Number(item.quantity) || 0);
      const discountText = item.discountAmount && item.discountAmount > 0
        ? `<div class="muted small">Discount: -${item.discountAmount.toLocaleString()}</div>`
        : "";
      return `<div class="item"><div><strong>${item.name}</strong>${discountText}</div><div>x${Number(item.quantity).toLocaleString()}</div><div>${lineTotal.toLocaleString()}</div></div>`;
    }).join("");

    const subtotalValue = Number(q.subtotal ?? 0);
    const totalItemDiscountValue = quoteWithItems.items.reduce((sum, item) => sum + Number(item.discountAmount || 0), 0);
    const billDiscountValue = Number(q.discountAmount || 0);
    const totalDiscountValue = totalItemDiscountValue + billDiscountValue;
    const vatValue = Number(q.vatAmount || 0);
    const serviceValue = Number(q.xxxAmount || 0);
    const serviceName = q.xxxName || shop.xxxRateName || "Service";

    return [
      "<!doctype html>",
      "<html lang=\"lo\">",
      "<head>",
      "<meta charset=\"utf-8\" />",
      "<title>QUOTATION / ໃບສະເໜີລາຄາ</title>",
      "<link rel=\"preconnect\" href=\"https://fonts.googleapis.com\">",
      "<link rel=\"preconnect\" href=\"https://fonts.gstatic.com\" crossorigin>",
      "<link href=\"https://fonts.googleapis.com/css2?family=Noto+Sans+Lao:wght@400;500;700&display=swap\" rel=\"stylesheet\">",
      "<style>",
      "@page { size: 80mm auto; margin: 0; }",
      "body { width: 74mm; margin: 0 auto; padding: 5mm 2mm; font-family: 'Noto Sans Lao', Arial, sans-serif; color: #000; background: #fff; font-size: 11px; line-height: 1.4; }",
      ".center { text-align: center; } .bold { font-weight: 700; } .small { font-size: 9px; } .muted { color: #555; }",
      ".title { font-size: 16px; margin: 4px 0; font-weight: 700; } .separator { border-top: 1px dashed #000; margin: 8px 0; }",
      ".item, .total { display: grid; grid-template-columns: 1fr 34px 86px; gap: 4px; align-items: start; margin: 4px 0; }",
      ".item div:nth-child(2), .item div:nth-child(3), .total div:last-child { text-align: right; font-family: 'Courier New', monospace; }",
      ".total { grid-template-columns: 1fr 86px; font-size: 11px; } .grand { font-size: 14px; font-weight: 700; }",
      ".print-action { display: block; width: 100%; margin: 14px 0 6px; padding: 10px; border: 1px solid #111; border-radius: 6px; background: #111; color: #fff; font-weight: 700; cursor: pointer; }",
      "@media print { body { width: 74mm; } .no-print { display: none !important; } }",
      "</style>",
      "</head>",
      "<body>",
      "<button class=\"print-action no-print\" onclick=\"window.print()\">Print Quotation</button>",
      `<div class="center">${shop.logoUrl ? `<img src="${shop.logoUrl}" style="max-height:75px;max-width:100%;border-radius:6px;" referrerpolicy="no-referrer" />` : ""}<h1 class="title">${shop.shopName}</h1><div>Tel: ${shop.phone}</div>${shop.contact ? `<div class="small muted">${shop.contact}</div>` : ""}<div class="bold" style="font-size:12px; margin-top:4px;">QUOTATION / ໃບສະເໜີລາຄາ</div><div class="bold">${q.quoteNumber}</div><div>Date: ${new Date(q.timestamp).toLocaleString()}</div></div>`,
      "<div class=\"separator\"></div>",
      `<div class="small font-sans" style="margin-bottom: 6px;">`,
      `<div><strong>ລູກຄ້າ / Customer:</strong> ${q.customerName || "—"}</div>`,
      `<div><strong>ເບີໂທ / Contact:</strong> ${q.customerContact || "—"}</div>`,
      `<div><strong>ກຳນົດຍື່ນ / Valid Until:</strong> ${new Date(q.validUntil).toLocaleDateString()}</div>`,
      `<div><strong>ສະຖານະ / Status:</strong> ${q.status.toUpperCase()}</div>`,
      `</div>`,
      "<div class=\"separator\"></div>",
      itemsHtml,
      "<div class=\"separator\"></div>",
      subtotalValue > 0 ? `<div class="total"><div>Subtotal / ລວມ:</div><div>${subtotalValue.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div></div>` : "",
      totalDiscountValue > 0 ? `<div class="total"><div>Discount / ສ່ວນຫຼຸດ:</div><div>-${totalDiscountValue.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div></div>` : "",
      vatValue > 0 ? `<div class="total"><div>VAT:</div><div>${vatValue.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div></div>` : "",
      serviceValue > 0 ? `<div class="total"><div>${serviceName}:</div><div>${serviceValue.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div></div>` : "",
      `<div class="total grand"><div>TOTAL / ທັງໝົດ:</div><div>${q.totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div></div>`,
      q.notes ? `<div class="separator"></div><div class="small" style="white-space: pre-wrap;"><strong>ໝາຍເຫດ / Notes:</strong> ${q.notes}</div>` : "",
      "<div class=\"separator\"></div>",
      "<div class=\"center small\"><div class=\"bold\">Thank you for choosing us!</div></div>",
      "<script>window.addEventListener(\"afterprint\",function(){setTimeout(function(){window.close();},500);});window.addEventListener(\"load\",function(){setTimeout(function(){window.focus();window.print();},500);});</script>",
      "</body>",
      "</html>"
    ].join("\n");
  };

  const handlePrintQuotationClick = async (quote: QuotationWithItems) => {
    let html = buildQuotationPrintHtml(quote);
        try {
          const _settings = await db.getSettings();
          let _qrUrl = "";
          try {
            const _payPayload = [(_settings && _settings.shopName) || "", (_settings && _settings.phone) || "", "QUOTE", (quote && quote.quotation && quote.quotation.totalAmount) || 0].join("|");
            _qrUrl = await QRCode.toDataURL(_payPayload, { margin: 1, width: 220 });
          } catch (e) { console.error("quotation QR failed", e); }
          const _shopName = (_settings && _settings.shopName) || "";
          const _contact = (_settings && _settings.contact) || "";
          const _phone = (_settings && _settings.phone) || "";
          const _header = `<div style="text-align:center;font-family:'Noto Sans Lao',sans-serif;margin-bottom:8px;"><div style="font-size:18px;font-weight:700;">${_shopName}</div><div style="font-size:12px;color:#555;">${_contact}</div><div style="font-size:12px;color:#555;">${_phone}</div></div>`;
          const _qrBlock = _qrUrl ? `<div style="text-align:center;margin-top:14px;border-top:1px dashed #999;padding-top:10px;font-family:'Noto Sans Lao',sans-serif;"><img src="${_qrUrl}" style="width:150px;height:150px;" /><div style="font-size:11px;color:#444;margin-top:4px;">${_contact}</div></div>` : "";
          html = html.replace("<body>", "<body>" + _header);
          if (_qrBlock) { html = html.replace("</body>", _qrBlock + "</body>"); }
        } catch (e) { console.error("quotation print enrich failed", e); }
    const screenWidth = window.screen.width;
    const screenHeight = window.screen.height;
    const features = [
      "scrollbars=yes",
      "resizable=yes",
      "left=0",
      "top=0",
      "width=" + screenWidth,
      "height=" + screenHeight
    ].join(",");
    const printWindow = window.open("", "_blank", features);
    if (!printWindow) {
      showNotification("ກະລຸນາອະນຸຍາດ Popup ເພື່ອພິມໃບສະເໜີລາຄາ", true);
      return;
    }
    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.document.title = "Quotation_" + quote.quotation.quoteNumber;
    try {
      printWindow.moveTo(0, 0);
      printWindow.resizeTo(screenWidth, screenHeight);
      printWindow.focus();
    } catch (e) {
      console.warn("Could not resize", e);
    }
    window.setTimeout(() => {
      try {
        printWindow.focus();
        printWindow.print();
      } catch (err) {
        console.error(err);
      }
    }, 500);
    showNotification("ເປີດໜ້າພິມໃບສະເໜີລາຄາແລ້ວ");
  };

  // Helper to select filter and sync the custom date inputs
  const selectFilter = (type: DateFilterType) => {
    setFilterType(type);
    const start = new Date();
    const end = new Date();

    switch (type) {
      case DateFilterType.TODAY:
        setCustomStart(toLocalDateString(start));
        setCustomEnd(toLocalDateString(end));
        break;
      case DateFilterType.YESTERDAY:
        start.setDate(start.getDate() - 1);
        end.setDate(end.getDate() - 1);
        setCustomStart(toLocalDateString(start));
        setCustomEnd(toLocalDateString(end));
        break;
      case DateFilterType.LAST_7_DAYS:
        start.setDate(start.getDate() - 6);
        setCustomStart(toLocalDateString(start));
        setCustomEnd(toLocalDateString(end));
        break;
      case DateFilterType.THIS_MONTH:
        start.setDate(1);
        setCustomStart(toLocalDateString(start));
        setCustomEnd(toLocalDateString(end));
        break;
    }
  };

  // Expanded Cards
  const [expandedSales, setExpandedSales] = useState<{ [id: number]: boolean }>({});

  const toggleExpand = (id: number) => {
    setExpandedSales(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const [expandedQuotes, setExpandedQuotes] = useState<{ [id: number]: boolean }>({});
  const toggleExpandQuote = (id: number) => {
    setExpandedQuotes(prev => ({ ...prev, [id]: !prev[id] }));
  };
  const [quoteSearch, setQuoteSearch] = useState("");
  const [quoteToDeleteId, setQuoteToDeleteId] = useState<number | null>(null);

  // Helper date conversions
  const getFilterTimestamps = (type: DateFilterType, startStr: string, endStr: string): [number, number] => {
    const start = new Date();
    const end = new Date();

    switch (type) {
      case DateFilterType.TODAY:
        start.setHours(0, 0, 0, 0);
        end.setHours(23, 59, 59, 999);
        return [start.getTime(), end.getTime()];

      case DateFilterType.YESTERDAY:
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        yesterday.setHours(0, 0, 0, 0);
        
        const yesterdayEnd = new Date();
        yesterdayEnd.setDate(yesterdayEnd.getDate() - 1);
        yesterdayEnd.setHours(23, 59, 59, 999);
        return [yesterday.getTime(), yesterdayEnd.getTime()];

      case DateFilterType.LAST_7_DAYS:
        start.setDate(start.getDate() - 6);
        start.setHours(0, 0, 0, 0);
        end.setHours(23, 59, 59, 999);
        return [start.getTime(), end.getTime()];

      case DateFilterType.THIS_MONTH:
        start.setDate(1);
        start.setHours(0, 0, 0, 0);
        end.setHours(23, 59, 59, 999);
        return [start.getTime(), end.getTime()];

      case DateFilterType.CUSTOM:
        const s = new Date(startStr);
        s.setHours(0, 0, 0, 0);
        const e = new Date(endStr);
        e.setHours(23, 59, 59, 999);
        return [s.getTime(), e.getTime()];
    }
  };

  const [startTimestamp, endTimestamp] = getFilterTimestamps(filterType, customStart, customEnd);

  // Filter Sales list based on timestamps
  const filteredSales = salesList.filter(item => {
    return item.sale.timestamp >= startTimestamp && item.sale.timestamp <= endTimestamp;
  });

  // Filter Quotations list based on timestamps & search
  const filteredQuotations = (quotationsList || []).filter(item => {
    if (quoteSearch.trim()) {
      const s = quoteSearch.toLowerCase();
      const numMatch = item.quotation.quoteNumber.toLowerCase().includes(s);
      const custMatch = item.quotation.customerName?.toLowerCase().includes(s) || false;
      const contactMatch = item.quotation.customerContact?.toLowerCase().includes(s) || false;
      const notesMatch = item.quotation.notes?.toLowerCase().includes(s) || false;
      if (!numMatch && !custMatch && !contactMatch && !notesMatch) return false;
    }
    const ts = item.quotation.timestamp;
    return ts >= startTimestamp && ts <= endTimestamp;
  });

  // KPI Calculations
  const refundTransactions = filteredSales.filter(item =>
    item.sale.isRefund || item.sale.paymentMethod === "REFUND" || item.sale.totalAmount < 0 ||
    item.items.some(lineItem => lineItem.quantity < 0 || lineItem.price < 0)
  );
  const getRefundAmount = (item: SaleWithItems) => {
    const refundedItemTotal = item.items.reduce((sum, lineItem) => {
      const lineTotal = lineItem.price * lineItem.quantity;
      return lineTotal < 0 ? sum + Math.abs(lineTotal) : sum;
    }, 0);

    return refundedItemTotal > 0 ? refundedItemTotal : Math.abs(item.sale.totalAmount);
  };
  const totalRefundAmount = refundTransactions.reduce((sum, item) => sum + getRefundAmount(item), 0);
  const totalRevenue = filteredSales.reduce((sum, item) => sum + item.sale.totalAmount, 0);

  // --- Summary breakdowns (by category & by payment type) ---
  const categoryLookup = new Map(menuItems.map((mi) => [mi.id, mi.category]));

  const categoryBreakdown = (() => {
    const acc: Record<string, { total: number; qty: number }> = {};
    filteredSales.forEach((entry) => {
      entry.items.forEach((it) => {
        const cat = categoryLookup.get(it.menuItemId) || "General";
        if (!acc[cat]) acc[cat] = { total: 0, qty: 0 };
        acc[cat].total += it.price * it.quantity;
        acc[cat].qty += it.quantity;
      });
    });
    return Object.entries(acc)
      .map(([category, d]) => ({ category, total: d.total, qty: d.qty }))
      .sort((a, b) => b.total - a.total);
  })();

  const paymentBreakdown = (() => {
    const acc: Record<string, { total: number; count: number }> = {};
    filteredSales.forEach((entry) => {
      if (entry.sale.isRefund) {
        if (!acc["REFUND"]) acc["REFUND"] = { total: 0, count: 0 };
        acc["REFUND"].total += entry.sale.totalAmount;
        acc["REFUND"].count += 1;
      } else if (entry.sale.paymentMethod === "SPLIT") {
        const transferAmt = entry.sale.splitTransferAmount !== undefined 
          ? entry.sale.splitTransferAmount 
          : entry.sale.totalAmount;
        const cashAmt = entry.sale.splitCashAmount !== undefined 
          ? entry.sale.splitCashAmount 
          : 0;

        if (transferAmt > 0) {
          if (!acc["TRANSFER"]) acc["TRANSFER"] = { total: 0, count: 0 };
          acc["TRANSFER"].total += transferAmt;
          acc["TRANSFER"].count += 1;
        }
        if (cashAmt > 0) {
          if (!acc["CASH"]) acc["CASH"] = { total: 0, count: 0 };
          acc["CASH"].total += cashAmt;
          acc["CASH"].count += 1;
        }
      } else {
        const method = entry.sale.paymentMethod || "OTHER";
        if (!acc[method]) acc[method] = { total: 0, count: 0 };
        acc[method].total += entry.sale.totalAmount;
        acc[method].count += 1;
      }
    });
    return Object.entries(acc)
      .map(([method, d]) => ({ method, total: d.total, count: d.count }))
      .sort((a, b) => b.total - a.total);
  })();

  const grandRevenue = totalRevenue || 0;
  const cur = "\u20AD";

  const paymentLabel = (method: string) => {
    const labels: Record<string, string> = {
      CASH: "ເງິນສົດ",
      TRANSFER: "Transfer / ໂອນເງິນ",
      QR: "ໂອນ (QR)",
      HOLD: "ພັກບິນ",
      SPLIT: "ແບ່ງຊຳລະ (ສົດ+ໂອນ)",
    };
    return labels[method] || method;
  };

  const totalTransactionsCount = filteredSales.length;
  const averageTicketSize = totalTransactionsCount > 0 ? totalRevenue / totalTransactionsCount : 0;

  // Calculate profit
  const totalProfit = filteredSales.reduce((profitSum, item) => {
    const subtotalAfterItemDiscounts = item.items.reduce((sum, it) => sum + it.price * it.quantity, 0);
    const billDiscountAmt = item.sale.discountAmount || 0;
    const finalSubtotal = subtotalAfterItemDiscounts - billDiscountAmt;
      
    const cost = item.items.reduce((sum, it) => {
      const menuItem = menuItems.find(mi => mi.id === it.menuItemId);
      const c = it.costPrice !== undefined ? it.costPrice : (menuItem?.costPrice || 0);
      return sum + c * it.quantity;
    }, 0);
    
    return profitSum + (finalSubtotal - cost);
  }, 0);

  const profitMargin = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0;

  // Date Range string display
  const getDateRangeString = () => {
    const options: Intl.DateTimeFormatOptions = { year: "numeric", month: "short", day: "numeric" };
    const sStr = new Date(startTimestamp).toLocaleDateString("lo-LA", options);
    const eStr = new Date(endTimestamp).toLocaleDateString("lo-LA", options);
    return filterType === DateFilterType.TODAY ? sStr : sStr + " - " + eStr;
  };

  const handleExportCSV = () => {
    try {
      exporters.exportToCSV(filteredSales, getDateRangeString());
      showNotification("ສົ່ງອອກ CSV ສຳເລັດແລ້ວ!");
    } catch (error) {
      console.error("CSV export failed", error);
      showNotification("ສົ່ງອອກ CSV ບໍ່ສຳເລັດ.", true);
    }
  };

  const handleExportExcel = () => {
    try {
      exporters.exportToExcel(filteredSales, getDateRangeString());
      showNotification("ສົ່ງອອກ Excel ສຳເລັດແລ້ວ!");
    } catch (error) {
      console.error("Excel export failed", error);
      showNotification("ສົ່ງອອກ Excel ບໍ່ສຳເລັດ.", true);
    }
  };

  const getFilterLabelLao = (val: DateFilterType) => {
    switch (val) {
      case DateFilterType.TODAY: return "ມື້ນີ້";
      case DateFilterType.YESTERDAY: return "ມື້ວານນີ້";
      case DateFilterType.LAST_7_DAYS: return "7 ວັນຫຼ້າສຸດ";
      case DateFilterType.THIS_MONTH: return "ເດືອນນີ້";
      case DateFilterType.CUSTOM: return "ກຳນົດເອງ";
      default: return val;
    }
  };

  // Dialog Controls
  const [saleToDeleteId, setSaleToDeleteId] = useState<number | null>(null);
  const [saleToRefundId, setSaleToRefundId] = useState<number | null>(null);
  const [sharingReceiptId, setSharingReceiptId] = useState<number | null>(null);
  const [notification, setNotification] = useState<{ message: string; isError?: boolean } | null>(null);
  const showNotification = (message: string, isError = false) => {
    setNotification({ message, isError });
    window.setTimeout(() => setNotification(null), 3500);
  };

  const handleShareReceiptPng = async (saleWithItems: SaleWithItems) => {
    const saleId = saleWithItems.sale.id;
    setSharingReceiptId(saleId);
    try {
      const result = await exporters.shareReceiptPng(saleWithItems);
      if (result === "shared") {
        showNotification("ແຊຣ໌ PNG ໃບບິນສຳເລັດແລ້ວ");
      } else if (result === "downloaded") {
        showNotification("ດາວໂຫຼດ PNG ໃບບິນສຳເລັດແລ້ວ");
      }
    } catch (error) {
      console.error("Share receipt PNG failed", error);
      showNotification("ສ້າງ PNG ໃບບິນບໍ່ສຳເລັດ", true);
    } finally {
      setSharingReceiptId(null);
    }
  };

  // Edit Sale Items States
  const [editingSale, setEditingSale] = useState<SaleWithItems | null>(null);
  const [editingItems, setEditingItems] = useState<{ menuItemId: number; quantity: number; price: number; name: string }[]>([]);
  const [selectedProductToAdd, setSelectedProductToAdd] = useState<string>("");

  const handleStartEdit = (sale: SaleWithItems) => {
    setEditingSale(sale);
    setEditingItems(
      sale.items.map(it => ({
        menuItemId: it.menuItemId,
        quantity: it.quantity,
        price: it.price,
        name: it.name
      }))
    );
    setSelectedProductToAdd("");
  };

  const handleUpdateEditingQty = (menuItemId: number, change: number) => {
    setEditingItems(prev =>
      prev.map(item => {
        if (item.menuItemId === menuItemId) {
          const newQty = Math.max(1, item.quantity + change);
          return { ...item, quantity: newQty };
        }
        return item;
      })
    );
  };

  const handleRemoveEditingItem = (menuItemId: number) => {
    setEditingItems(prev => prev.filter(item => item.menuItemId !== menuItemId));
  };

  const handleAddingProductToEditingSale = (menuItemIdStr: string) => {
    const id = parseInt(menuItemIdStr);
    if (isNaN(id)) return;
    const product = menuItems.find(mi => mi.id === id);
    if (!product) return;

    const exists = editingItems.find(it => it.menuItemId === id);
    if (exists) {
      setEditingItems(prev =>
        prev.map(it => (it.menuItemId === id ? { ...it, quantity: it.quantity + 1 } : it))
      );
    } else {
      setEditingItems(prev => [
        ...prev,
        {
          menuItemId: id,
          quantity: 1,
          price: product.price,
          name: product.name
        }
      ]);
    }
    setSelectedProductToAdd("");
  };

  const handleSaveEditedSale = () => {
    if (!editingSale) return;
    if (editingItems.length === 0) {
      showNotification("ກະລຸນາເພີ່ມສິນຄ້າຢ່າງນ້ອຍ 1 ລາຍການກ່ອນບັນທຶກ.", true);
      return;
    }
    try {
      onUpdateSaleItems(editingSale.sale.id, editingItems);
      showNotification("ບັນທຶກການແກ້ໄຂບິນສຳເລັດແລ້ວ!");
      setEditingSale(null);
      setEditingItems([]);
    } catch (error) {
      console.error("Sale update failed", error);
      showNotification("ບັນທຶກການແກ້ໄຂບິນບໍ່ສຳເລັດ.", true);
    }
  };

  // Confirm delete handler
  const handleConfirmDelete = () => {
    if (saleToDeleteId !== null) {
      try {
        onDeleteSale(saleToDeleteId);
        showNotification("ລຶບທຸລະກຳຂາຍສຳເລັດແລ້ວ!");
        setSaleToDeleteId(null);
      } catch (error) {
        console.error("Delete sale failed", error);
        showNotification("ລຶບທຸລະກຳຂາຍບໍ່ສຳເລັດ.", true);
      }
    }
  };

  // Confirm refund handler
  const handleConfirmRefund = () => {
    if (saleToRefundId !== null) {
      try {
        onRefundSale(saleToRefundId);
        showNotification("ສ້າງລາຍການຄືນເງິນສຳເລັດແລ້ວ!");
        setSaleToRefundId(null);
      } catch (error) {
        console.error("Refund sale failed", error);
        showNotification("ຄືນເງິນບໍ່ສຳເລັດ.", true);
      }
    }
  };

  return (
    <div id="reports-view-container" className="space-y-6 h-full p-1 lg:p-4 select-none">
      {notification && (
        <div className={`fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-3 rounded-xl border shadow-xl text-sm font-semibold ${
          notification.isError
            ? "bg-rose-50 border-rose-200 text-rose-700"
            : "bg-emerald-50 border-emerald-200 text-emerald-700"
        }`}>
          <div className={`w-2 h-2 rounded-full ${notification.isError ? "bg-rose-500" : "bg-emerald-500"}`} />
          <span>{notification.message}</span>
        </div>
      )}
      {/* Filters Header Dashboard */}
      <div id="reports-filter-card" className="bg-white p-4 rounded-3xl border border-slate-100 shadow-[0_4px_20px_rgba(0,0,0,0.01)] flex flex-wrap gap-4 items-center justify-between">
        <div className="flex items-center gap-3">
          <Calendar className="w-5 h-5 text-blue-600" />
          <h2 className="text-sm font-bold text-slate-800 font-sans">ລາຍງານຍອດຂາຍ</h2>
        </div>

        {/* Date Range Inputs (Green Mark area) */}
        <div id="reports-header-date-range" className="flex items-center gap-2.5 text-xs font-semibold font-sans">
          <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider">ເລືອກຊ່ວງວັນທີ:</span>
          <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-150 rounded-2xl px-3 py-1.5 shadow-inner">
            <input
              id="reports-header-start-date"
              type="date"
              value={customStart}
              onChange={(e) => {
                setCustomStart(e.target.value);
                setFilterType(DateFilterType.CUSTOM);
              }}
              className="bg-transparent border-none text-xs font-bold text-slate-700 focus:outline-none font-mono cursor-pointer"
            />
            <span className="text-slate-300 font-bold text-xs mx-1">ຫາ</span>
            <input
              id="reports-header-end-date"
              type="date"
              value={customEnd}
              onChange={(e) => {
                setCustomEnd(e.target.value);
                setFilterType(DateFilterType.CUSTOM);
              }}
              className="bg-transparent border-none text-xs font-bold text-slate-700 focus:outline-none font-mono cursor-pointer"
            />
          </div>
        </div>

        {/* Filter Selection Tabs */}
        <div className="flex flex-wrap gap-2">
          {(Object.keys(DateFilterType) as Array<keyof typeof DateFilterType>).map(key => {
            const val = DateFilterType[key];
            if (val === DateFilterType.CUSTOM) return null; // handled by inputs directly
            return (
              <button
                id={`reports-filter-btn-${val}`}
                key={val}
                onClick={() => selectFilter(val)}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all cursor-pointer font-sans ${
                  filterType === val
                    ? "bg-blue-50 border-blue-500 text-blue-700 shadow-sm"
                    : "bg-slate-50 hover:bg-slate-100 border-slate-150 text-slate-600"
                }`}
              >
                {getFilterLabelLao(val)}
              </button>
            );
          })}

          <button
            id="reports-filter-btn-custom"
            onClick={() => setFilterType(DateFilterType.CUSTOM)}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all cursor-pointer font-sans ${
              filterType === DateFilterType.CUSTOM
                ? "bg-blue-50 border-blue-500 text-blue-700 shadow-sm"
                : "bg-slate-50 hover:bg-slate-100 border-slate-150 text-slate-600"
            }`}
          >
            ກຳນົດເອງ
          </button>
        </div>
      </div>

      {/* Sub-tab Switcher: Sales vs Quotations */}
      <div className="flex bg-slate-100 p-1 rounded-2xl w-full sm:w-fit border border-slate-200">
        <button
          onClick={() => setSubTab('sales')}
          className={`flex-1 sm:flex-initial px-6 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer font-sans ${
            subTab === 'sales'
              ? "bg-white text-blue-600 shadow-sm"
              : "text-slate-600 hover:text-slate-800"
          }`}
        >
          <TrendingUp className="w-4.5 h-4.5 inline-block mr-1.5 -mt-0.5" />
          ການຂາຍ (Sales)
        </button>
        <button
          onClick={() => setSubTab('quotations')}
          className={`flex-1 sm:flex-initial px-6 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer font-sans ${
            subTab === 'quotations'
              ? "bg-white text-emerald-600 shadow-sm"
              : "text-slate-600 hover:text-slate-800"
          }`}
        >
          <FileText className="w-4.5 h-4.5 inline-block mr-1.5 -mt-0.5" />
          ໃບສະເໜີລາຄາ (Quotations)
        </button>
      </div>

      {subTab === 'sales' ? (
        <>
          {/* KPI Cards Bento Grid */}
      <div id="reports-kpi-grid" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {/* Total Revenue KPI */}
        <div className="bg-white p-5 rounded-3xl border border-slate-100 shadow-[0_4px_16px_rgba(0,0,0,0.01)] flex items-center justify-between">
          <div className="space-y-1.5">
            <span className="text-xs font-semibold text-slate-400 font-sans">ຍອດຂາຍລວມ</span>
            <h3 className="text-xl font-bold text-slate-900 font-mono">
              ₭{totalRevenue.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </h3>
            <p className="text-[10px] text-slate-400 font-bold uppercase">{getDateRangeString()}</p>
          </div>
          <div className="p-3 bg-blue-50 text-blue-600 border border-blue-100 rounded-2xl">
            <TrendingUp className="w-6 h-6" />
          </div>
        </div>

        {/* Total Profit KPI */}
        <div className="bg-white p-5 rounded-3xl border border-slate-100 shadow-[0_4px_16px_rgba(0,0,0,0.01)] flex items-center justify-between">
          <div className="space-y-1.5">
            <span className="text-xs font-semibold text-slate-400 font-sans">ກຳໄລລວມ</span>
            <h3 className="text-xl font-bold text-emerald-700 font-mono">
              ₭{totalProfit.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </h3>
            <p className="text-[10px] text-emerald-600 font-bold uppercase">Margin: {profitMargin.toFixed(1)}%</p>
          </div>
          <div className="p-3 bg-emerald-50 text-emerald-600 border border-emerald-100 rounded-2xl">
            <Banknote className="w-6 h-6" />
          </div>
        </div>

        {/* Total Refund KPI */}
        <div className="bg-white p-5 rounded-3xl border border-slate-100 shadow-[0_4px_16px_rgba(0,0,0,0.01)] flex items-center justify-between">
          <div className="space-y-1.5">
            <span className="text-xs font-semibold text-slate-400 font-sans">ຍອດຄືນເງິນລວມ</span>
            <h3 className="text-xl font-bold text-rose-700 font-mono">
              ₭{totalRefundAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </h3>
            <p className="text-[10px] text-rose-500 font-semibold italic font-sans">{refundTransactions.length} ບິນຄືນເງິນ</p>
          </div>
          <div className="p-3 bg-rose-50 text-rose-600 border border-rose-100 rounded-2xl">
            <ArrowRightLeft className="w-6 h-6" />
          </div>
        </div>

        {/* Transaction Count KPI */}
        <div className="bg-white p-5 rounded-3xl border border-slate-100 shadow-[0_4px_16px_rgba(0,0,0,0.01)] flex items-center justify-between">
          <div className="space-y-1.5">
            <span className="text-xs font-semibold text-slate-400 font-sans">ຈຳນວນທຸລະກຳ</span>
            <h3 className="text-xl font-bold text-slate-900 font-mono">
              {totalTransactionsCount} <span className="font-sans">ບິນ</span>
            </h3>
            <p className="text-[10px] text-slate-400 font-semibold italic font-sans">ບິນທີ່ຂາຍແລ້ວ</p>
          </div>
          <div className="p-3 bg-indigo-50 text-indigo-500 border border-indigo-100 rounded-2xl">
            <Calendar className="w-6 h-6" />
          </div>
        </div>

        {/* Average Ticket KPI */}
        <div className="bg-white p-5 rounded-3xl border border-slate-100 shadow-[0_4px_16px_rgba(0,0,0,0.01)] flex items-center justify-between">
          <div className="space-y-1.5">
            <span className="text-xs font-semibold text-slate-400 font-sans">ຍອດຂາຍສະເລ່ຍຕໍ່ບິນ</span>
            <h3 className="text-xl font-bold text-slate-900 font-mono">
              ₭{averageTicketSize.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </h3>
            <p className="text-[10px] text-slate-400 font-semibold italic font-sans">ລາຍຮັບສະເລ່ຍ</p>
          </div>
          <div className="p-3 bg-amber-50 text-amber-500 border border-amber-100 rounded-2xl">
            <TrendingUp className="w-6 h-6 transform rotate-90" />
          </div>
        </div>
      </div>

      {/* Summary Breakdown: by Category & by Payment Type */}
      <div id="reports-summary-grid" className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
        {/* By Category */}
        <div className="bg-white p-5 rounded-3xl border border-slate-100 shadow-[0_4px_24px_rgba(0,0,0,0.03)]">
          <div className="flex items-center gap-2 mb-4">
            <div className="p-2 bg-indigo-50 text-indigo-600 border border-indigo-100 rounded-xl">
              <Layers className="w-4 h-4" />
            </div>
            <h3 className="text-sm font-bold text-slate-700 font-sans">{"ສະຫຼຸບຕາມໝວດໝູ່"}</h3>
          </div>
          {categoryBreakdown.length === 0 ? (
            <p className="text-xs text-slate-400 py-4 text-center font-sans">—</p>
          ) : (
            <div className="space-y-2">
              {categoryBreakdown.map((row) => {
                const pct = grandRevenue > 0 ? (row.total / grandRevenue) * 100 : 0;
                return (
                  <div key={row.category} id={`reports-cat-row-${row.category}`} className="space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-slate-600 font-sans truncate">{row.category}</span>
                      <span className="text-xs font-bold text-slate-800 font-mono whitespace-nowrap">{cur}{row.total.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div className="h-full bg-gradient-to-r from-indigo-500 to-blue-500 rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-[10px] text-slate-400 font-mono w-12 text-right">{pct.toFixed(1)}%</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* By Payment Type */}
        <div className="bg-white p-5 rounded-3xl border border-slate-100 shadow-[0_4px_24px_rgba(0,0,0,0.03)]">
          <div className="flex items-center gap-2 mb-4">
            <div className="p-2 bg-emerald-50 text-emerald-600 border border-emerald-100 rounded-xl">
              <Wallet className="w-4 h-4" />
            </div>
            <h3 className="text-sm font-bold text-slate-700 font-sans">{"ສະຫຼຸບຕາມການຊຳລະ"}</h3>
          </div>
          {paymentBreakdown.length === 0 ? (
            <p className="text-xs text-slate-400 py-4 text-center font-sans">—</p>
          ) : (
            <div className="space-y-2.5">
              {paymentBreakdown.map((row) => {
                const pct = grandRevenue > 0 ? (row.total / grandRevenue) * 100 : 0;
                const isCash = row.method === "CASH";
                return (
                  <div key={row.method} id={`reports-pay-row-${row.method}`} className="flex items-center justify-between gap-3 p-2.5 rounded-2xl bg-slate-50 border border-slate-100">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className={`p-1.5 rounded-lg ${isCash ? "bg-emerald-100 text-emerald-600" : "bg-blue-100 text-blue-600"}`}>
                        {isCash ? <Banknote className="w-4 h-4" /> : <ArrowRightLeft className="w-4 h-4" />}
                      </div>
                      <div className="flex flex-col min-w-0">
                        <span className="text-xs font-bold text-slate-700 font-sans truncate">{paymentLabel(row.method)}</span>
                        <span className="text-[10px] text-slate-400 font-sans">{row.count} ({pct.toFixed(1)}%)</span>
                      </div>
                    </div>
                    <span className="text-sm font-bold text-slate-800 font-mono whitespace-nowrap">{cur}{row.total.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Reports Actions Bar (XLSX, CSV) */}
      <div id="reports-export-actions" className="bg-white p-4 rounded-3xl border border-slate-100 flex justify-between items-center font-sans">
        <span className="text-xs font-bold text-slate-500">ພົບ {filteredSales.length} ທຸລະກຳ</span>
        <div className="flex gap-2">
          <button
            id="reports-export-csv"
            disabled={filteredSales.length === 0}
            onClick={handleExportCSV}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 disabled:opacity-40 rounded-xl text-xs font-bold border border-slate-200 transition-colors cursor-pointer"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-slate-500" />
            <span>ສົ່ງອອກ CSV</span>
          </button>
          <button
            id="reports-export-excel"
            disabled={filteredSales.length === 0}
            onClick={handleExportExcel}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-teal-500 hover:bg-teal-600 disabled:bg-slate-200 disabled:text-slate-400 text-white disabled:cursor-not-allowed rounded-xl text-xs font-bold transition-colors shadow-sm shadow-teal-100 cursor-pointer"
          >
            <FileText className="w-3.5 h-3.5" />
            <span>ສົ່ງອອກ Excel</span>
          </button>
        </div>
      </div>

      {/* Transactions Collapsible Log */}
      <div id="reports-logs-wrapper" className="space-y-3 max-h-[500px] overflow-y-auto pr-1">
        {filteredSales.length === 0 ? (
          <div id="reports-empty-logs" className="bg-white rounded-3xl border border-slate-100 p-12 text-center text-slate-400 text-xs font-sans">
            ບໍ່ມີລາຍການຂາຍໃນຊ່ວງເວລາທີ່ເລືອກ.
          </div>
        ) : (
          filteredSales.map((item, index) => {
            const isExpanded = !!expandedSales[item.sale.id];
            const dateStr = new Date(item.sale.timestamp).toLocaleString("lo-LA");
            const totalQty = item.items.reduce((sum, it) => sum + it.quantity, 0);

            return (
              <div
                id={`transaction-card-${item.sale.id}`}
                key={`${item.sale.id}-${index}`}
                className="bg-white border border-slate-100 rounded-2xl overflow-hidden shadow-[0_4px_12px_rgba(0,0,0,0.01)] hover:border-slate-200 transition-colors"
              >
                {/* Header Row */}
                <div
                  id={`transaction-header-${item.sale.id}`}
                  onClick={() => toggleExpand(item.sale.id)}
                  className="py-2 px-4 flex justify-between items-center gap-4 cursor-pointer hover:bg-slate-50/50 transition-colors select-none"
                >
                  <div className="flex-1 min-w-0 flex items-center gap-3">
                    <span className="text-[10px] font-bold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-md font-mono">
                      #{item.sale.id}
                    </span>
                    <div className="min-w-0 flex-1 flex items-center gap-2.5">
                      <span className="text-xs font-semibold text-slate-600 whitespace-nowrap">{dateStr}</span>
                      <span className="text-slate-200">|</span>
                      <span className="text-[11px] text-slate-400 font-medium truncate block">
                        {item.items.map(it => `${it.name} x${it.quantity}`).join(", ")}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <span className="text-[9px] bg-slate-100 text-slate-500 font-bold px-2 py-0.5 rounded-full uppercase font-sans">
                      {paymentLabel(item.sale.paymentMethod)}
                    </span>
                    <span className="font-bold text-slate-800 font-mono text-xs whitespace-nowrap">
                      ₭{item.sale.totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </span>
                    {isExpanded ? <ChevronUp className="w-3.5 h-3.5 text-slate-400" /> : <ChevronDown className="w-3.5 h-3.5 text-slate-400" />}
                  </div>
                </div>

                {/* Collapsed Items Section */}
                {isExpanded && (
                  <div id={`transaction-expanded-${item.sale.id}`} className="px-4 pb-4 border-t border-slate-50 bg-slate-50/20 pt-3.5 space-y-3.5 animate-fade-in">
                    {/* Item list */}
                    <div className="space-y-2">
                      <span className="text-[10px] font-bold text-slate-400 block tracking-wider font-sans">ລາຍການສິນຄ້າທີ່ຂາຍ</span>
                      <div className="space-y-1.5 font-mono text-[11px]">
                        {item.items.map((it, index) => {
                          const hasDiscount = it.originalPrice && it.originalPrice > it.price;
                          return (
                            <div key={`${it.id}-${index}`} className="space-y-0.5">
                              <div className="flex justify-between text-slate-700">
                                <span>• {it.name} x{it.quantity}</span>
                                <span>₭{(it.price * it.quantity).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                              </div>
                              {hasDiscount && (
                                <div className="text-[9px] text-blue-600 pl-3 flex justify-between">
                                  <span>(ສ່ວນຫຼຸດສິນຄ້າ: {it.discountType === "PERCENT" ? `${it.discountValue}%` : `₭${it.discountValue?.toLocaleString()}`})</span>
                                  <span>-₭{(it.discountAmount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    <div className="border-t border-slate-100 my-2" />

                    {/* Change given etc */}
                    <div className="grid grid-cols-2 gap-4 font-mono text-[11px]">
                      <div className="space-y-1 text-slate-500 font-sans text-xs">
                        <p>ຍອດລວມ: ₭{item.sale.totalAmount.toLocaleString()}</p>
                        {item.sale.discountAmount !== undefined && item.sale.discountAmount > 0 && (
                          <p className="text-blue-600 font-sans">
                            • ສ່ວນຫຼຸດບິນ: -₭{item.sale.discountAmount.toLocaleString()}
                          </p>
                        )}
                        <p>ຊຳລະດ້ວຍ: {paymentLabel(item.sale.paymentMethod)}</p>
                        {item.sale.paymentMethod === "SPLIT" && (
                          <p className="text-[10px] text-slate-400 font-sans pl-2">
                            • ໂອນເງິນ: ₭{(item.sale.splitTransferAmount ?? item.sale.totalAmount).toLocaleString()} <br/>
                            • ເງິນສົດ: ₭{(item.sale.splitCashAmount ?? 0).toLocaleString()}
                          </p>
                        )}
                      </div>
                      <div className="space-y-1 text-slate-500 text-right font-sans text-xs">
                        <p>ຮັບເງິນມາ: ₭{item.sale.amountTendered.toLocaleString()}</p>
                        <p>ເງິນທອນ: ₭{item.sale.changeGiven.toLocaleString()}</p>
                      </div>
                    </div>

                    {/* Actions: Re-print Receipt, Edit, Delete */}
                    <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
                      <button
                        id={`transaction-print-${item.sale.id}`}
                        onClick={() => exporters.printReceipt(item)}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-[10px] font-bold border border-slate-200 transition-colors cursor-pointer font-sans"
                      >
                        <Printer className="w-3.5 h-3.5 text-slate-500" />
                        <span>ໃບບິນ</span>
                      </button>
                      <button
                        id={`transaction-share-png-${item.sale.id}`}
                        onClick={() => handleShareReceiptPng(item)}
                        disabled={sharingReceiptId === item.sale.id}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-sky-50 hover:bg-sky-100 disabled:opacity-50 text-sky-600 rounded-xl text-[10px] font-bold border border-sky-200 transition-colors cursor-pointer disabled:cursor-not-allowed font-sans"
                      >
                        <Share2 className="w-3.5 h-3.5" />
                        <span>{sharingReceiptId === item.sale.id ? "PNG..." : "PNG"}</span>
                      </button>
                      <button
                        id={`transaction-edit-${item.sale.id}`}
                        onClick={() => handleStartEdit(item)}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-600 rounded-xl text-[10px] font-bold border border-blue-200 transition-colors cursor-pointer font-sans"
                      >
                        <Edit className="w-3.5 h-3.5" />
                        <span>ແກ້ໄຂລາຍການ</span>
                      </button>
                      <button
                        id={`transaction-delete-${item.sale.id}`}
                        onClick={() => setSaleToDeleteId(item.sale.id)}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-600 rounded-xl text-[10px] font-bold border border-rose-200 transition-colors cursor-pointer font-sans"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>ລຶບລາຍການ</span>
                      </button>
                      <button
                        id={`transaction-refund-${item.sale.id}`}
                        onClick={() => setSaleToRefundId(item.sale.id)}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-600 rounded-xl text-[10px] font-bold border border-amber-200 transition-colors cursor-pointer font-sans"
                      >
                        <ArrowRightLeft className="w-3.5 h-3.5" />
                        <span>ຄືນເງິນ</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
      </>
      ) : (
        <div id="quotations-view-subtab" className="space-y-4 animate-fade-in font-sans">
          {/* Quotations Header Actions & Search */}
          <div className="bg-white p-4 rounded-3xl border border-slate-100 shadow-[0_4px_16px_rgba(0,0,0,0.01)] flex flex-wrap gap-3 items-center justify-between">
            <div className="flex-1 min-w-[250px]">
              <input
                id="quote-search-input"
                type="text"
                placeholder="ຄົ້ນຫາໃບສະເໜີລາຄາ... (ເລກທີ, ຊື່ລູກຄ້າ, ເບີໂທ)"
                value={quoteSearch}
                onChange={(e) => setQuoteSearch(e.target.value)}
                className="w-full px-4 py-2 bg-slate-50 border border-slate-150 rounded-2xl text-xs font-semibold focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 font-sans"
              />
            </div>
            <div className="text-xs font-bold text-slate-500">
              ພົບ {filteredQuotations.length} ໃບສະເໜີລາຄາ
            </div>
          </div>

          {/* Quotations List Wrapper */}
          <div id="quotations-list-wrapper" className="space-y-3 max-h-[500px] overflow-y-auto pr-1">
            {filteredQuotations.length === 0 ? (
              <div className="bg-white rounded-3xl border border-slate-100 p-12 text-center text-slate-400 text-xs font-sans">
                ບໍ່ມີໃບບັນທຶກສະເໜີລາຄາໃນຊ່ວງເວລາທີ່ເລືອກ.
              </div>
            ) : (
              filteredQuotations.map((item, index) => {
                const isExpanded = !!expandedQuotes[item.quotation.id];
                const dateStr = new Date(item.quotation.timestamp).toLocaleString("lo-LA");
                const validStr = new Date(item.quotation.validUntil).toLocaleDateString("lo-LA");
                const isExpired = Date.now() > item.quotation.validUntil && item.quotation.status !== 'converted';

                // Status tag styling
                let statusLabel = "";
                let statusClass = "";
                switch (item.quotation.status) {
                  case 'draft':
                    statusLabel = "ສະບັບຮ່າງ (Draft)";
                    statusClass = "bg-slate-100 text-slate-600";
                    break;
                  case 'sent':
                    statusLabel = "ສົ່ງແລ້ວ (Sent)";
                    statusClass = "bg-blue-50 text-blue-600 border border-blue-100";
                    break;
                  case 'accepted':
                    statusLabel = "ຍອມຮັບ (Accepted)";
                    statusClass = "bg-emerald-50 text-emerald-600 border border-emerald-100";
                    break;
                  case 'expired':
                    statusLabel = "ໝົດອາຍຸ (Expired)";
                    statusClass = "bg-rose-50 text-rose-600 border border-rose-100";
                    break;
                  case 'converted':
                    statusLabel = "ປ່ຽນເປັນການຂາຍແລ້ວ (Converted)";
                    statusClass = "bg-teal-100 text-teal-800";
                    break;
                }

                if (isExpired && item.quotation.status !== 'converted') {
                  statusLabel = "ໝົດອາຍຸ (Expired)";
                  statusClass = "bg-rose-50 text-rose-600 border border-rose-100";
                }

                return (
                  <div
                    key={`${item.quotation.id}-${index}`}
                    id={`quotation-card-${item.quotation.id}`}
                    className="bg-white border border-slate-100 rounded-2xl overflow-hidden shadow-[0_4px_12px_rgba(0,0,0,0.01)] hover:border-slate-200 transition-colors"
                  >
                    {/* Header Row */}
                    <div
                      onClick={() => toggleExpandQuote(item.quotation.id)}
                      className="py-3 px-4 flex justify-between items-center gap-4 cursor-pointer hover:bg-slate-50/50 transition-colors select-none font-sans"
                    >
                      <div className="flex-1 min-w-0 flex items-center gap-3">
                        <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 border border-emerald-100 px-2 py-0.5 rounded-md font-mono">
                          {item.quotation.quoteNumber}
                        </span>
                        <div className="min-w-0 flex-1 flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2.5">
                          <span className="text-xs font-semibold text-slate-600 whitespace-nowrap">{dateStr}</span>
                          <span className="hidden sm:inline text-slate-200">|</span>
                          <span className="text-xs font-bold text-slate-800 truncate">
                            {item.quotation.customerName ? `ລູກຄ້າ: ${item.quotation.customerName}` : "ບໍ່ມີຊື່ລູກຄ້າ"}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 font-sans">
                        <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full uppercase ${statusClass}`}>
                          {statusLabel}
                        </span>
                        <span className="font-bold text-emerald-600 font-mono text-xs whitespace-nowrap">
                          ₭{item.quotation.totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </span>
                        {isExpanded ? <ChevronUp className="w-3.5 h-3.5 text-slate-400" /> : <ChevronDown className="w-3.5 h-3.5 text-slate-400" />}
                      </div>
                    </div>

                    {/* Expansible Section */}
                    {isExpanded && (
                      <div className="px-4 pb-4 border-t border-slate-50 bg-slate-50/20 pt-3.5 space-y-3.5 animate-fade-in font-sans">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {/* Info Column */}
                          <div className="space-y-1.5 text-xs text-slate-600">
                            <p><strong>ເບີຕິດຕໍ່ລູກຄ້າ:</strong> {item.quotation.customerContact || "—"}</p>
                            <p><strong>ວັນທີຍື່ນສະເໜີ:</strong> {dateStr}</p>
                            <p className={isExpired ? "text-rose-600 font-bold" : ""}>
                              <strong>ກຳນົດໝົດອາຍຸ:</strong> {validStr} {isExpired && "(ໝົດອາຍຸແລ້ວ)"}
                            </p>
                            {item.quotation.notes && <p><strong>ໝາຍເຫດ:</strong> {item.quotation.notes}</p>}
                            {item.quotation.convertedSaleId && (
                              <p className="text-teal-600 font-bold">
                                <strong>ເຊື່ອມໂຍງບິນຂາຍ:</strong> #{item.quotation.convertedSaleId}
                              </p>
                            )}
                          </div>

                          {/* Items summary */}
                          <div className="space-y-2">
                            <span className="text-[10px] font-bold text-slate-400 block tracking-wider uppercase font-sans">ລາຍການໃນໃບສະເໜີລາຄາ</span>
                            <div className="space-y-1.5 font-mono text-[11px] bg-white p-3 rounded-2xl border border-slate-100">
                              {item.items.map((it, index) => (
                                <div key={`${it.id}-${index}`} className="flex justify-between text-slate-700">
                                  <span>• {it.name} x{it.quantity}</span>
                                  <span>₭{(it.price * it.quantity).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                                </div>
                              ))}
                              <div className="border-t border-slate-100 pt-1.5 mt-1.5 flex justify-between font-bold text-xs text-slate-800 font-sans">
                                <span>ຍອດລວມທັງໝົດ:</span>
                                <span className="font-mono text-emerald-600">₭{item.quotation.totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Action Buttons */}
                        <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
                          <button
                            onClick={() => handlePrintQuotationClick(item)}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-[10px] font-bold border border-slate-200 transition-colors cursor-pointer font-sans"
                          >
                            <Printer className="w-3.5 h-3.5 text-slate-500" />
                            <span>ພິມໃບສະເໜີລາຄາ / Print PDF</span>
                          </button>

                          {item.quotation.status !== 'converted' && (
                            <>
                              <button
                                onClick={() => handleStartEditQuotation(item)}
                                className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-600 rounded-xl text-[10px] font-bold border border-blue-200 transition-colors cursor-pointer font-sans"
                              >
                                <Edit className="w-3.5 h-3.5" />
                                <span>ແກ້ໄຂ / Edit</span>
                              </button>

                              <button
                                onClick={() => onLoadQuotationToCart && onLoadQuotationToCart(item)}
                                className="flex items-center gap-1.5 px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-[10px] font-bold transition-colors cursor-pointer font-sans"
                              >
                                <ArrowRightLeft className="w-3.5 h-3.5" />
                                <span>ປ່ຽນເປັນການຂາຍ / ສົ່ງໄປ POS</span>
                              </button>
                            </>
                          )}

                          <button
                            onClick={() => setQuoteToDeleteId(item.quotation.id)}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-600 rounded-xl text-[10px] font-bold border border-rose-200 transition-colors cursor-pointer font-sans"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>ລຶບ / Delete</span>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* DELETE CONFIRM DIALOG */}
      {saleToDeleteId !== null && (
        <div id="delete-dialog-overlay" className="fixed inset-0 z-50 bg-slate-950/40 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in font-sans">
          <div id="delete-dialog" className="bg-white border border-slate-100 rounded-3xl p-6 w-full max-w-sm shadow-2xl space-y-4">
            <div className="flex justify-between items-center border-b border-slate-100 pb-2">
              <h3 className="text-sm font-bold text-slate-800">ຢືນຢັນການລຶບ</h3>
              <button onClick={() => setSaleToDeleteId(null)} aria-label="ປິດການຢືນຢັນລຶບ" title="ປິດ" className="p-1 rounded hover:bg-slate-50 text-slate-400">
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-slate-500 leading-relaxed font-semibold">
              ທ່ານແນ່ໃຈບໍ່ວ່າຕ້ອງການລຶບທຸລະກຳຂາຍ #{saleToDeleteId}? ລາຍການນີ້ຈະຖືກລຶບອອກຈາກລະບົບຢ່າງຖາວອນ.
            </p>
            <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
              <button
                onClick={() => setSaleToDeleteId(null)}
                className="px-4 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-600 font-semibold hover:bg-slate-100 transition-all cursor-pointer font-sans"
              >
                ຍົກເລີກ
              </button>
              <button
                onClick={handleConfirmDelete}
                className="px-4 py-1.5 bg-rose-500 hover:bg-rose-600 text-white rounded-xl text-xs font-bold transition-all cursor-pointer font-sans"
              >
                ລຶບຖາວອນ
              </button>
            </div>
          </div>
        </div>
      )}

      {/* REFUND CONFIRM DIALOG */}
      {saleToRefundId !== null && (
        <div id="refund-dialog-overlay" className="fixed inset-0 z-50 bg-slate-950/40 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in font-sans">
          <div id="refund-dialog" className="bg-white border border-slate-100 rounded-3xl p-6 w-full max-w-sm shadow-2xl space-y-4">
            <div className="flex justify-between items-center border-b border-slate-100 pb-2">
              <h3 className="text-sm font-bold text-amber-700">ຢືນຢັນ REFUND / ຄືນເງິນ</h3>
              <button onClick={() => setSaleToRefundId(null)} aria-label="ປິດການຢືນຢັນຄືນເງິນ" title="ປິດ" className="p-1 rounded hover:bg-slate-50 text-slate-400">
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-slate-500 leading-relaxed font-semibold">
              REFUND ONLY: ກຳລັງຈະຄືນເງິນທຸລະກຳຂາຍ #{saleToRefundId}. ລະບົບຈະສ້າງລາຍການຄືນເງິນຕິດລົບ, ບັນທຶກຍອດຄືນເງິນ, ແລະ ເພີ່ມສິນຄ້າກັບຄືນເຂົ້າສະຕັອກ.
            </p>
            <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
              <button
                onClick={() => setSaleToRefundId(null)}
                className="px-4 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-600 font-semibold hover:bg-slate-100 transition-all cursor-pointer font-sans"
              >
                ຍົກເລີກ
              </button>
              <button
                onClick={handleConfirmRefund}
                className="px-4 py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-xs font-bold transition-all cursor-pointer font-sans"
              >
                ຢືນຢັນຄືນເງິນ / Confirm Refund
              </button>
            </div>
          </div>
        </div>
      )}

      {/* EDIT SALE ITEMS DIALOG */}
      {editingSale && (
        <div id="edit-items-modal-overlay" className="fixed inset-0 z-50 bg-slate-950/40 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in font-sans">
          <div id="edit-items-modal" className="bg-white border border-slate-100 rounded-3xl p-6 w-full max-w-lg shadow-2xl flex flex-col max-h-[85vh]">
            
            {/* Header */}
            <div className="flex justify-between items-center border-b border-slate-100 pb-3 mb-4">
              <div>
                <h3 className="text-sm font-extrabold text-slate-800">ແກ້ໄຂລາຍການສິນຄ້າ / Edit Items</h3>
                <p className="text-[10px] text-slate-400 font-semibold mt-0.5">ແກ້ໄຂຈຳນວນ ຫຼື ເພີ່ມ/ລຶບສິນຄ້າໃນບິນຂາຍ #{editingSale.sale.id}</p>
              </div>
              <button 
                onClick={() => setEditingSale(null)} 
                aria-label="ປິດການແກ້ໄຂບິນ"
                title="ປິດ"
                className="text-slate-400 hover:text-slate-600 p-1.5 bg-slate-50 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Selector to Add New Item */}
            <div className="bg-blue-50/50 p-3 rounded-2xl border border-blue-100/60 mb-4 space-y-1.5">
              <label className="text-[10px] font-bold text-blue-600 uppercase tracking-wider font-sans block">ເພີ່ມສິນຄ້າໃໝ່ເຂົ້າໃນບິນ</label>
              <select
                value={selectedProductToAdd}
                onChange={(e) => {
                  setSelectedProductToAdd(e.target.value);
                  handleAddingProductToEditingSale(e.target.value);
                }}
                className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              >
                <option value="">-- ເລືອກສິນຄ້າເພື່ອເພີ່ມໃໝ່ / Add Item --</option>
                {menuItems.map(item => (
                  <option key={item.id} value={item.id}>
                    {item.name} (₭{item.price.toLocaleString()}) {item.stockQty <= 0 ? "[ສິນຄ້າໝົດ]" : `[ຄົງເຫຼືອ ${item.stockQty}]`}
                  </option>
                ))}
              </select>
            </div>

            {/* List of items being edited */}
            <div className="flex-1 overflow-y-auto space-y-2.5 pr-1.5 min-h-[150px]">
              {editingItems.length === 0 ? (
                <div className="text-center py-8 text-slate-400 text-xs">
                  ບໍ່ມີລາຍການສິນຄ້າໃນບິນນີ້. ກະລຸນາເພີ່ມສິນຄ້າ.
                </div>
              ) : (
                editingItems.map(item => {
                  const itemTotal = item.price * item.quantity;
                  return (
                    <div 
                      key={item.menuItemId} 
                      className="flex items-center justify-between p-3 bg-slate-50/85 border border-slate-100 rounded-2xl"
                    >
                      {/* Product Name */}
                      <div className="min-w-0 flex-1 pr-3">
                        <p className="text-xs font-bold text-slate-700 truncate">{item.name}</p>
                        <p className="text-[10px] text-slate-400 font-bold font-mono mt-0.5">₭{item.price.toLocaleString()}</p>
                      </div>

                      {/* Quantity Selector & Actions */}
                      <div className="flex items-center gap-3">
                        <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-xl px-1.5 py-1 shadow-sm">
                          <button
                            type="button"
                            aria-label={`ຫຼຸດຈຳນວນ ${item.name}`}
                            title="ຫຼຸດຈຳນວນ"
                            onClick={() => handleUpdateEditingQty(item.menuItemId, -1)}
                            className="p-1 hover:bg-slate-100 text-slate-500 rounded-lg transition-colors cursor-pointer"
                          >
                            <Minus className="w-3 h-3" />
                          </button>
                          <span className="w-7 text-center text-xs font-bold font-mono text-slate-700">
                            {item.quantity}
                          </span>
                          <button
                            type="button"
                            aria-label={`ເພີ່ມຈຳນວນ ${item.name}`}
                            title="ເພີ່ມຈຳນວນ"
                            onClick={() => handleUpdateEditingQty(item.menuItemId, 1)}
                            className="p-1 hover:bg-slate-100 text-slate-500 rounded-lg transition-colors cursor-pointer"
                          >
                            <Plus className="w-3 h-3" />
                          </button>
                        </div>

                        {/* Line total */}
                        <span className="w-20 text-right text-xs font-bold font-mono text-slate-800">
                          ₭{itemTotal.toLocaleString()}
                        </span>

                        {/* Remove */}
                        <button
                          type="button"
                          aria-label={`ລຶບ ${item.name} ອອກຈາກບິນ`}
                          title="ລຶບສິນຄ້າອອກຈາກບິນ"
                          onClick={() => handleRemoveEditingItem(item.menuItemId)}
                          className="p-1.5 hover:bg-rose-50 text-rose-500 hover:text-rose-700 rounded-lg transition-colors cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Totals Summary */}
            <div className="border-t border-slate-100 pt-3.5 mt-4 space-y-1.5 font-sans text-xs bg-slate-50/50 p-3 rounded-2xl">
              {(() => {
                const sub = editingItems.reduce((sum, it) => sum + it.price * it.quantity, 0);
                const sett = db.getSettings();
                let vat = 0;
                let xxx = 0;
                if (sett.vatEnabled) {
                  vat = sub * (sett.vatRate / 100);
                }
                if (sett.xxxRateEnabled) {
                  xxx = sub * (sett.xxxRate / 100);
                }
                const total = sub + vat + xxx;
                return (
                  <>
                    <div className="flex justify-between text-slate-500 font-semibold">
                      <span>ມູນຄ່າສິນຄ້າ (Subtotal):</span>
                      <span className="font-mono">₭{sub.toLocaleString()}</span>
                    </div>
                    {sett.vatEnabled && (
                      <div className="flex justify-between text-slate-500 font-semibold">
                        <span>ອາກອນ (VAT {sett.vatRate}%):</span>
                        <span className="font-mono">₭{vat.toLocaleString()}</span>
                      </div>
                    )}
                    {sett.xxxRateEnabled && (
                      <div className="flex justify-between text-slate-500 font-semibold">
                        <span>{sett.xxxRateName} ({sett.xxxRate}%):</span>
                        <span className="font-mono">₭{xxx.toLocaleString()}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-slate-800 font-extrabold text-sm border-t border-slate-200/60 pt-1.5 mt-1.5">
                      <span>ຍອດລວມທັງໝົດ (Grand Total):</span>
                      <span className="font-mono text-blue-600">₭{total.toLocaleString()}</span>
                    </div>
                  </>
                );
              })()}
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-2 border-t border-slate-100 pt-3 mt-4">
              <button
                onClick={() => setEditingSale(null)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-all cursor-pointer"
              >
                ຍົກເລີກ / Cancel
              </button>
              <button
                onClick={handleSaveEditedSale}
                className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-all cursor-pointer font-sans"
              >
                ບັນທຶກການແກ້ໄຂ / Save
              </button>
            </div>

          </div>
        </div>
      )}

      {/* QUOTATION DELETE CONFIRM DIALOG */}
      {quoteToDeleteId !== null && (
        <div id="quote-delete-overlay" className="fixed inset-0 z-50 bg-slate-950/40 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in font-sans">
          <div id="quote-delete-dialog" className="bg-white border border-slate-100 rounded-3xl p-6 w-full max-w-sm shadow-2xl space-y-4">
            <div className="flex justify-between items-center border-b border-slate-100 pb-2">
              <h3 className="text-sm font-bold text-slate-800">ຢືນຢັນການລຶບໃບສະເໜີລາຄາ</h3>
              <button onClick={() => setQuoteToDeleteId(null)} aria-label="ປິດການຢືນຢັນລຶບ" title="ປິດ" className="p-1 rounded hover:bg-slate-50 text-slate-400">
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-slate-500 leading-relaxed font-semibold">
              ທ່ານແນ່ໃຈບໍ່ວ່າຕ້ອງການລຶບໃບສະເໜີລາຄານີ້? ລາຍການນີ້ຈະຖືກລຶບອອກຈາກລະບົບຢ່າງຖາວອນ.
            </p>
            <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
              <button
                onClick={() => setQuoteToDeleteId(null)}
                className="px-4 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-600 font-semibold hover:bg-slate-100 transition-all cursor-pointer font-sans"
              >
                ຍົກເລີກ
              </button>
              <button
                onClick={() => {
                  if (quoteToDeleteId !== null && onDeleteQuotation) {
                    onDeleteQuotation(quoteToDeleteId);
                    showNotification("ລຶບໃບສະເໜີລາຄາສຳເລັດແລ້ວ!");
                    setQuoteToDeleteId(null);
                  }
                }}
                className="px-4 py-1.5 bg-rose-500 hover:bg-rose-600 text-white rounded-xl text-xs font-bold transition-all cursor-pointer font-sans"
              >
                ລຶບຖາວອນ
              </button>
            </div>
          </div>
        </div>
      )}

      {/* EDIT QUOTATION DIALOG */}
      {editingQuotation && (
        <div id="edit-quote-modal-overlay" className="fixed inset-0 z-50 bg-slate-950/40 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in font-sans">
          <div id="edit-quote-modal" className="bg-white border border-slate-100 rounded-3xl p-6 w-full max-w-lg shadow-2xl flex flex-col max-h-[85vh]">
            
            {/* Header */}
            <div className="flex justify-between items-center border-b border-slate-100 pb-3 mb-4">
              <div>
                <h3 className="text-sm font-extrabold text-slate-800 font-sans">ແກ້ໄຂໃບສະເໜີລາຄາ / Edit Quotation</h3>
                <p className="text-[10px] text-slate-400 font-semibold mt-0.5 font-sans">ເລກທີ: {editingQuotation.quotation.quoteNumber}</p>
              </div>
              <button 
                onClick={() => setEditingQuotation(null)} 
                className="text-slate-400 hover:text-slate-600 p-1.5 bg-slate-50 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Form Fields */}
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-500">ຊື່ລູກຄ້າ</label>
                <input
                  type="text"
                  value={editQuoteCustomerName}
                  onChange={(e) => setEditQuoteCustomerName(e.target.value)}
                  className="w-full px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-500">ເບີຕິດຕໍ່</label>
                <input
                  type="text"
                  value={editQuoteCustomerContact}
                  onChange={(e) => setEditQuoteCustomerContact(e.target.value)}
                  className="w-full px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-500 font-sans">ວັນໝົດອາຍຸ (Valid Until)</label>
                <input
                  type="date"
                  value={editQuoteValidUntil}
                  onChange={(e) => setEditQuoteValidUntil(e.target.value)}
                  className="w-full px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-500 font-sans">ສະຖານະ</label>
                <select
                  value={editQuoteStatus}
                  onChange={(e) => setEditQuoteStatus(e.target.value as any)}
                  className="w-full px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none"
                >
                  <option value="sent">ສົ່ງແລ້ວ (Sent)</option>
                  <option value="draft">ສະບັບຮ່າງ (Draft)</option>
                  <option value="accepted">ຍອມຮັບແລ້ວ (Accepted)</option>
                  <option value="expired">ໝົດອາຍຸ (Expired)</option>
                  <option value="converted">ປ່ຽນເປັນການຂາຍແລ້ວ (Converted)</option>
                </select>
              </div>
              <div className="col-span-2 space-y-1">
                <label className="text-[10px] font-bold text-slate-500">ໝາຍເຫດ</label>
                <input
                  type="text"
                  value={editQuoteNotes}
                  onChange={(e) => setEditQuoteNotes(e.target.value)}
                  className="w-full px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                />
              </div>
            </div>

            {/* Selector to Add New Item */}
            <div className="bg-emerald-50/50 p-3 rounded-2xl border border-emerald-100/60 mb-4 space-y-1.5">
              <label className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider font-sans block">ເພີ່ມສິນຄ້າໃໝ່ເຂົ້າໃນໃບສະເໜີລາຄາ</label>
              <select
                value={editQuoteSelectedProductToAdd}
                onChange={(e) => {
                  setEditQuoteSelectedProductToAdd(e.target.value);
                  handleAddingProductToEditingQuote(e.target.value);
                }}
                className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
              >
                <option value="">-- ເລືອກສິນຄ້າເພື່ອເພີ່ມໃໝ່ / Add Item --</option>
                {menuItems.map(item => (
                  <option key={item.id} value={item.id}>
                    {item.name} (₭{item.price.toLocaleString()})
                  </option>
                ))}
              </select>
            </div>

            {/* List of items being edited */}
            <div className="flex-1 overflow-y-auto space-y-2.5 pr-1.5 min-h-[150px]">
              {editQuoteItems.length === 0 ? (
                <div className="text-center py-8 text-slate-400 text-xs font-sans">
                  ບໍ່ມີລາຍການສິນຄ້າໃນໃບສະເໜີລາຄານີ້. ກະລຸນາເພີ່ມສິນຄ້າ.
                </div>
              ) : (
                editQuoteItems.map(item => {
                  const itemTotal = item.price * item.quantity;
                  return (
                    <div 
                      key={item.menuItemId} 
                      className="flex items-center justify-between p-3 bg-slate-50/85 border border-slate-100 rounded-2xl"
                    >
                      <div className="min-w-0 flex-1 pr-3">
                        <p className="text-xs font-bold text-slate-700 truncate">{item.name}</p>
                        <p className="text-[10px] text-slate-400 font-bold font-mono mt-0.5">₭{item.price.toLocaleString()}</p>
                      </div>

                      <div className="flex items-center gap-3">
                        <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-xl px-1.5 py-1 shadow-sm">
                          <button
                            type="button"
                            onClick={() => handleUpdateEditingQuoteQty(item.menuItemId, -1)}
                            className="p-1 hover:bg-slate-100 text-slate-500 rounded-lg transition-colors cursor-pointer"
                          >
                            <Minus className="w-3 h-3" />
                          </button>
                          <span className="w-7 text-center text-xs font-bold font-mono text-slate-700">
                            {item.quantity}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleUpdateEditingQuoteQty(item.menuItemId, 1)}
                            className="p-1 hover:bg-slate-100 text-slate-500 rounded-lg transition-colors cursor-pointer"
                          >
                            <Plus className="w-3 h-3" />
                          </button>
                        </div>

                        <span className="w-20 text-right text-xs font-bold font-mono text-slate-800">
                          ₭{itemTotal.toLocaleString()}
                        </span>

                        <button
                          type="button"
                          onClick={() => handleRemoveEditingQuoteItem(item.menuItemId)}
                          className="p-1.5 hover:bg-rose-50 text-rose-500 hover:text-rose-700 rounded-lg transition-colors cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Totals Summary */}
            <div className="border-t border-slate-100 pt-3.5 mt-4 space-y-1.5 font-sans text-xs bg-slate-50/50 p-3 rounded-2xl">
              {(() => {
                const sub = editQuoteItems.reduce((sum, it) => sum + it.price * it.quantity, 0);
                const sett = db.getSettings();
                let vat = 0;
                let xxx = 0;
                if (sett.vatEnabled) {
                  vat = sub * (sett.vatRate / 100);
                }
                if (sett.xxxRateEnabled) {
                  xxx = sub * (sett.xxxRate / 100);
                }
                const total = sub + vat + xxx;
                return (
                  <>
                    <div className="flex justify-between text-slate-500 font-semibold">
                      <span>ມູນຄ່າສິນຄ້າ (Subtotal):</span>
                      <span className="font-mono">₭{sub.toLocaleString()}</span>
                    </div>
                    {sett.vatEnabled && (
                      <div className="flex justify-between text-slate-500 font-semibold">
                        <span>ອາກອນ (VAT {sett.vatRate}%):</span>
                        <span className="font-mono">₭{vat.toLocaleString()}</span>
                      </div>
                    )}
                    {sett.xxxRateEnabled && (
                      <div className="flex justify-between text-slate-500 font-semibold">
                        <span>{sett.xxxRateName} ({sett.xxxRate}%):</span>
                        <span className="font-mono">₭{xxx.toLocaleString()}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-slate-800 font-extrabold text-sm border-t border-slate-200/60 pt-1.5 mt-1.5">
                      <span>ຍອດລວມທັງໝົດ (Grand Total):</span>
                      <span className="font-mono text-emerald-600">₭{total.toLocaleString()}</span>
                    </div>
                  </>
                );
              })()}
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-2 border-t border-slate-100 pt-3 mt-4">
              <button
                onClick={() => setEditingQuotation(null)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-all cursor-pointer"
              >
                ຍົກເລີກ / Cancel
              </button>
              <button
                onClick={handleSaveEditedQuotation}
                className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all cursor-pointer font-sans"
              >
                ບັນທຶກການແກ້ໄຂ / Save
              </button>
            </div>

          </div>
        </div>
      )}
    </div>
  );
}
