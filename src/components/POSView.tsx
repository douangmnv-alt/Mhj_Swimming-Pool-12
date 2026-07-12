/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef } from "react";
import { 
  ShoppingCart, Search, Camera, Delete, Trash2, Tag, Play, 
  CreditCard, Banknote, QrCode, ClipboardList, RefreshCw, X, Check, Save, Printer, Edit, Percent, FileText, Share2
} from "lucide-react";
import { MenuItem, PendingOrder, SaleWithItems, ShopSettings, Member, isOnPromo, effectivePrice } from "../types";
import CameraScanner from "./CameraScanner";
import { db } from "../utils/db";
import { shareReceiptHtmlAsPng } from "../utils/exporters";
import QRCode from "qrcode";

interface POSViewProps {
  menuItems: MenuItem[];
  cart: { [itemId: number]: number };
  pendingOrders: PendingOrder[];
  onAddToCart: (item: MenuItem) => void;
  onRemoveFromCart: (item: MenuItem) => void;
  onUpdateCartQty: (itemId: number, qty: number) => void;
  onClearCart: () => void;
  onSaveCartAsPending: (label: string) => void;
  onResumePendingOrder: (orderId: string) => void;
  onDiscardPendingOrder: (orderId: string) => void;
  onRecordSale: (
    paymentMethod: string, 
    amountTendered: number, 
    onSuccess: (sale: SaleWithItems) => void,
    splitTransferAmount?: number,
    splitCashAmount?: number
  ) => void;
  onRecordRefund: (
    paymentMethod: string, 
    amountTendered: number, 
    onSuccess: (sale: SaleWithItems) => void,
    splitTransferAmount?: number,
    splitCashAmount?: number
  ) => void;
  onRefundToCart: (item: MenuItem) => void;
  cartItemDiscounts?: { [itemId: number]: { type: "PERCENT" | "FIXED"; value: number } };
  onUpdateCartItemDiscount?: (itemId: number, type: "PERCENT" | "FIXED" | null, value: number) => void;
  billDiscount?: { type: "PERCENT" | "FIXED"; value: number } | null;
  onUpdateBillDiscount?: (type: "PERCENT" | "FIXED" | null, value: number) => void;
  onSaveQuotation?: (
    quotationData: any,
    onSuccess?: (quote: any) => void
  ) => void;
  activeQuotationToConvert?: any;
  onCancelQuotationConversion?: () => void;
  members?: Member[];
  settings?: ShopSettings;
  selectedMemberUid?: string | null;
  onSelectMember?: (uid: string | null) => void;
}

export default function POSView({
  menuItems,
  cart,
  pendingOrders,
  onAddToCart,
  onRefundToCart,
  onRemoveFromCart,
  onUpdateCartQty,
  onClearCart,
  onSaveCartAsPending,
  onResumePendingOrder,
  onDiscardPendingOrder,
  onRecordSale,
  onRecordRefund,
  cartItemDiscounts = {},
  onUpdateCartItemDiscount = () => {},
  billDiscount = null,
  onUpdateBillDiscount = () => {},
  onSaveQuotation,
  activeQuotationToConvert = null,
  onCancelQuotationConversion,
  members = [],
  settings: settingsProp,
  selectedMemberUid = null,
  onSelectMember = () => {}
}: POSViewProps) {
  // Navigation & Search
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [isRefundMode, setIsRefundMode] = useState(false);
  const [isRefundSale, setIsRefundSale] = useState(false);

  // Dialog Controls
  const [showCameraScanner, setShowCameraScanner] = useState(false);
  const [showPendingDialog, setShowPendingDialog] = useState(false);
  const [showHoldDialog, setShowHoldDialog] = useState(false);
  const [holdLabel, setHoldLabel] = useState("");
  const [showPaymentDialog, setShowPaymentDialog] = useState(false);
  const [printData, setPrintData] = useState<SaleWithItems | null>(null);
  const [isSharingReceipt, setIsSharingReceipt] = useState(false);

  useEffect(() => {
    if (printData) {
      printReceiptNow(printData, printData.sale.id === 0 ? "Invoice" : "Receipt");
      setPrintData(null);
    }
  }, [printData]);
  const [paymentMethod, setPaymentMethod] = useState("CASH"); // CASH, TRANSFER, QR, SPLIT
  const [amountTenderedInput, setAmountTenderedInput] = useState("");
  const [splitTransferInput, setSplitTransferInput] = useState("");
  const [splitCashTenderedInput, setSplitCashTenderedInput] = useState("");
  
  const [showBillDiscountInput, setShowBillDiscountInput] = useState<boolean>(false);
  const [tempBillDiscountType, setTempBillDiscountType] = useState<'PERCENT' | 'FIXED'>('PERCENT');
  const [tempBillDiscountValue, setTempBillDiscountValue] = useState<string>("");

  // Quotation States
  const [showQuotationDialog, setShowQuotationDialog] = useState(false);
  const [quoteCustomerName, setQuoteCustomerName] = useState("");
  const [quoteCustomerContact, setQuoteCustomerContact] = useState("");
  const [quoteValidUntil, setQuoteValidUntil] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d.toISOString().split('T')[0];
  });
  const [quoteStatus, setQuoteStatus] = useState<'draft' | 'sent' | 'accepted'>('sent');
  const [quoteNotes, setQuoteNotes] = useState("");

  // Membership picker (phone-only search)
  const [memberSearch, setMemberSearch] = useState("");
  const selectedMember = members.find(m => m.uid === selectedMemberUid) || null;

  // Keyboard wedge barcode scanner buffer
  const barcodeBufferRef = useRef<string>("");
  const lastKeyTimeRef = useRef<number>(0);

  // Load active shop settings for taxes & custom rates
  const [settings, setSettings] = useState<ShopSettings>(() => db.getSettings());

  useEffect(() => {
    if (showPaymentDialog) {
      setSettings(db.getSettings());
    }
  }, [showPaymentDialog]);

  const roundMoney = (value: number) => Number((Math.round((Number(value) || 0) * 100) / 100).toFixed(2));
  const formatMoneyInput = (value: number) => roundMoney(value).toFixed(2);
  const parseMoneyInput = (value: string) => roundMoney(parseFloat(value) || 0);

  // Cart helper calculations
  const cartEntries = Object.entries(cart);
  const totalItemsCount = cartEntries.reduce((sum, [_, qty]) => sum + qty, 0);

  // Item-level discounts come from the product's promo price (set in Stock),
  // plus the whole-bill discount below.
  const cartItemDetails = cartEntries.map(([idStr, qty]) => {
    const id = parseInt(idStr);
    const item = menuItems.find(i => i.id === id);
    if (!item) return null;

    const discount = isOnPromo(item)
      ? { type: "FIXED" as const, value: roundMoney(item.price - effectivePrice(item)) }
      : undefined;

    const discountedPrice = roundMoney(effectivePrice(item));
    const lineOriginalTotal = roundMoney(item.price * qty);
    const lineDiscountedTotal = roundMoney(discountedPrice * qty);
    const lineDiscountAmount = roundMoney(lineOriginalTotal - lineDiscountedTotal);
    
    return {
      item,
      qty,
      originalPrice: item.price,
      discountedPrice,
      lineOriginalTotal,
      lineDiscountedTotal,
      lineDiscountAmount,
      discount
    };
  }).filter((d): d is NonNullable<typeof d> => d !== null);

  const subtotalBeforeDiscounts = cartItemDetails.reduce((sum, d) => sum + d.lineOriginalTotal, 0);
  const totalItemDiscountsAmount = cartItemDetails.reduce((sum, d) => sum + d.lineDiscountAmount, 0);
  const subtotalAfterItemDiscounts = cartItemDetails.reduce((sum, d) => sum + d.lineDiscountedTotal, 0);

  let billDiscountAmount = 0;
  if (billDiscount) {
    if (billDiscount.type === "PERCENT") {
      billDiscountAmount = subtotalAfterItemDiscounts * (billDiscount.value / 100);
    } else {
      billDiscountAmount = billDiscount.value;
    }
  }
  billDiscountAmount = roundMoney(Math.min(subtotalAfterItemDiscounts, billDiscountAmount));
  const finalSubtotal = roundMoney(Math.max(0, subtotalAfterItemDiscounts - billDiscountAmount));

  // We expose subtotal as finalSubtotal so that standard variables downstream work as is
  const subtotal = finalSubtotal;

  const vatAmount = settings.vatEnabled ? roundMoney(finalSubtotal * (settings.vatRate / 100)) : 0;
  const xxxAmount = settings.xxxRateEnabled ? roundMoney(finalSubtotal * (settings.xxxRate / 100)) : 0;
  const grandTotal = roundMoney(finalSubtotal + vatAmount + xxxAmount);

  // Membership: points to earn on this bill (only when enabled).
  const membershipEnabled = !!settings.membershipEnabled;
  const pointsToEarn = membershipEnabled ? Math.round(finalSubtotal * ((settings.pointRate || 0) / 100)) : 0;

  const receiptMoney = (value: number) => "₭" + roundMoney(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const receiptMoneyCompact = (value: number) => "₭" + Math.round(roundMoney(value)).toLocaleString();
  const receiptNumberCompact = (value: number) => Math.round(roundMoney(value)).toLocaleString();
  const receiptEscape = (value: unknown) => {
    const map: { [key: string]: string } = { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" };
    return String(value ?? "").replace(/[&<>"']/g, (char) => map[char] || char);
  };
  const receiptStamp = () => new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const paymentLabel = (method: string) => {
    if (method === "CASH") return "Cash / ເງິນສົດ";
    if (method === "TRANSFER") return "Transfer / ໂອນເງິນ";
    if (method === "SPLIT") return "Split / ແບ່ງຊຳລະ";
    if (method === "DRAFT") return "Draft / ບໍ່ທັນຊຳລະ";
    return "LaoQR / ໂອນຜ່ານ QR";
  };
  const openPrintWindow = (html: string, title = "Receipt") => {
    const screenWidth = window.screen?.availWidth || 1440;
    const screenHeight = window.screen?.availHeight || 900;
    const features = [
      "popup=yes",
      "toolbar=no",
      "location=no",
      "menubar=no",
      "status=no",
      "scrollbars=yes",
      "resizable=yes",
      "left=0",
      "top=0",
      "width=" + screenWidth,
      "height=" + screenHeight
    ].join(",");
    const printWindow = window.open("", "_blank", features);
    if (!printWindow) {
      showNotification("ກະລຸນາອະນຸຍາດ Popup ເພື່ອພິມໃບບິນ", true);
      return false;
    }
    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.document.title = title;
    try {
      printWindow.moveTo(0, 0);
      printWindow.resizeTo(screenWidth, screenHeight);
      printWindow.focus();
    } catch (error) {
      console.warn("Could not resize print window", error);
    }
    const closeAfterPrint = () => {
      window.setTimeout(() => {
        try {
          if (!printWindow.closed) printWindow.close();
        } catch (error) {
          console.warn("Could not close print window", error);
        }
      }, 500);
    };
    printWindow.addEventListener("afterprint", closeAfterPrint, { once: true });
    window.setTimeout(() => {
      const fire = () => {
        try {
          if ((printWindow as any).__printStarted) return;
          (printWindow as any).__printStarted = true;
          printWindow.focus();
          printWindow.print();
        } catch (error) {
          console.error("Receipt print failed", error);
        }
      };
      try {
        // Wait for Noto Sans Lao to finish loading so Lao text prints correctly.
        const fonts = (printWindow.document as any).fonts;
        if (fonts && fonts.ready) {
          fonts.ready.then(() => window.setTimeout(fire, 150));
          window.setTimeout(fire, 2500);
        } else {
          fire();
        }
      } catch (error) {
        fire();
      }
    }, 500);
    showNotification("ເປີດໜ້າພິມໃບບິນແບບເຕັມຈໍແລ້ວ");
    return true;
  };
  const buildReceiptPrintHtml = (saleWithItems: SaleWithItems) => {
    const shop = db.getSettings();
    const sale = saleWithItems.sale;
    const paperSize = shop.receiptPaperSize === "58mm" ? "58mm" : "80mm";
    const isNarrowPaper = paperSize === "58mm";
    const receiptWidth = isNarrowPaper ? "52mm" : "74mm";
    const bodyPadding = isNarrowPaper ? "4mm 2mm" : "5mm 2mm";
    const bodyFontSize = isNarrowPaper ? "12px" : "11px";
    const titleFontSize = isNarrowPaper ? "15px" : "16px";
    const itemColumns = isNarrowPaper ? "1fr 24px 78px" : "1fr 34px 90px";
    const totalColumns = isNarrowPaper ? "1fr 88px" : "1fr 112px";
    const totalFontSize = isNarrowPaper ? bodyFontSize : "13px";
    const totalAmountFontSize = isNarrowPaper ? bodyFontSize : "13px";
    const grandFontSize = isNarrowPaper ? "13px" : "15px";
    const grandAmountFontSize = isNarrowPaper ? "11px" : "15px";
    const separatorMargin = isNarrowPaper ? "7px 0" : "8px 0";
    const logoMaxHeight = isNarrowPaper ? "55px" : "75px";
    const qrSize = isNarrowPaper ? "221px" : "170px";
    const qrImageStyle = isNarrowPaper
      ? "width:" + qrSize + ";height:" + qrSize + ";object-fit:contain;margin-top:4px;filter:contrast(0.85) brightness(1.12);opacity:0.9;"
      : "width:" + qrSize + ";height:" + qrSize + ";object-fit:contain;margin-top:4px;";
    const itemsHtml = saleWithItems.items.map((saleItem) => {
      const unitPrice = Number(saleItem.price) || 0;
      const quantity = Number(saleItem.quantity || 0);
      const lineTotal = roundMoney(unitPrice * quantity);
      const discountText = saleItem.discountAmount && saleItem.discountAmount > 0
        ? "<div class=\"muted small\">Discount: -" + receiptMoney(saleItem.discountAmount) + "</div>"
        : "";
      if (isNarrowPaper) {
        return "<div class=\"item item-narrow\"><div class=\"item-name\">" + receiptEscape(saleItem.name)
          + discountText
          + "</div><div class=\"item-calc\"><span>" + quantity.toLocaleString() + " x " + receiptMoneyCompact(unitPrice) + "</span><span class=\"calc-fill\"></span><span class=\"calc-total\">" + receiptMoneyCompact(lineTotal) + "</span></div></div>";
      }
      return "<div class=\"item item-wide\"><span class=\"wide-name\">" + receiptEscape(saleItem.name) + "</span><span class=\"wide-qty\">" + quantity.toLocaleString() + "</span><span class=\"wide-price\">" + receiptNumberCompact(unitPrice) + "</span><span class=\"calc-total\">" + receiptNumberCompact(lineTotal) + "</span></div>"
        + (discountText ? "<div class=\"wide-discount\">" + discountText + "</div>" : "");
    }).join("");
    const itemsHeaderHtml = isNarrowPaper
      ? ""
      : "<div class=\"item item-wide item-wide-head\"><span class=\"wide-name\">ເມນູ (MENU)</span><span class=\"wide-qty\">ຈນ. (QTY)</span><span class=\"wide-price\">ລາຄາ (PR)</span><span class=\"calc-total\">ລວມ (TOTAL)</span></div>";
    const itemsStartSeparatorHtml = isNarrowPaper ? "<div class=\"separator\"></div>" : "";
    const itemsEndSeparatorHtml = isNarrowPaper ? "<div class=\"separator\"></div>" : "<div class=\"wide-table-end\"></div>";
    const subtotalValue = roundMoney(Number(sale.subtotal ?? 0));
    const totalItemDiscountValue = roundMoney(saleWithItems.items.reduce((sum, saleItem) => sum + Number(saleItem.discountAmount || 0), 0));
    const billDiscountValue = roundMoney(Number(sale.discountAmount || 0));
    const totalDiscountValue = roundMoney(totalItemDiscountValue + billDiscountValue);
    const vatValue = roundMoney(Number((sale as any).vatAmount || 0));
    const serviceValue = roundMoney(Number((sale as any).xxxAmount || 0));
    const serviceName = receiptEscape((sale as any).xxxName || shop.xxxRateName || "Service");
    const documentTitle = sale.id === 0 ? "INVOICE / ໃບບິນ" : "RECEIPT / ໃບບິນຮັບເງິນ";
    const saleReference = sale.id === 0 ? "" : "Sale #" + sale.id;
    const isUnpaid = sale.paymentMethod === "DRAFT";
    return [
      "<!doctype html>",
      "<html lang=\"lo\">",
      "<head>",
      "<meta charset=\"utf-8\" />",
      "<title>" + receiptEscape(documentTitle) + "</title>",
      "<link rel=\"preconnect\" href=\"https://fonts.googleapis.com\">",
      "<link rel=\"preconnect\" href=\"https://fonts.gstatic.com\" crossorigin>",
      "<link href=\"https://fonts.googleapis.com/css2?family=Noto+Sans+Lao:wght@400;500;700&display=swap\" rel=\"stylesheet\">",
      "<style>",
      "@page { size: " + paperSize + " auto; margin: 0; }",
      "body { width: " + receiptWidth + "; margin: 0 auto; padding: " + bodyPadding + "; font-family: 'Noto Sans Lao', Arial, sans-serif; color: #000; background: #fff; font-size: " + bodyFontSize + "; line-height: 1.35; }",
      ".center { text-align: center; } .bold { font-weight: 700; } .small { font-size: " + (isNarrowPaper ? "8px" : "9px") + "; overflow-wrap: anywhere; word-break: break-word; } .muted { color: #555; }",
      ".title { font-size: " + titleFontSize + "; margin: 4px 0; font-weight: 700; line-height: 1.2; } .separator { border-top: 1px dashed #000; margin: " + separatorMargin + "; }",
      ".item, .total { display: grid; grid-template-columns: " + itemColumns + "; gap: " + (isNarrowPaper ? "3px" : "4px") + "; align-items: start; margin: 4px 0; }",
      ".item-narrow { display: block; margin: 7px 0; } .item-narrow .item-name { font-size: 14px; font-weight: 400; line-height: 1.25; overflow-wrap: anywhere; }",
      ".item-narrow .item-calc { display: grid; grid-template-columns: auto 1fr auto; gap: 4px; align-items: end; margin-top: 2px; font-family: Arial, 'Noto Sans Lao', sans-serif; font-size: 13px; font-weight: 400; line-height: 1.2; white-space: nowrap; }",
      ".item-narrow .calc-fill { border-bottom: 1px dotted #000; min-width: 12px; transform: translateY(-3px); } .item-narrow .calc-total { font-weight: 400; }",
      ".item-wide { grid-template-columns: minmax(0, 1fr) 36px 64px 84px; gap: 5px; align-items: start; font-size: 16px; line-height: 1.15; margin: 6px 0; }",
      ".item-wide .wide-name { min-width: 0; overflow-wrap: anywhere; word-break: break-word; font-weight: 400; } .item-wide .wide-qty { text-align: center; } .item-wide .wide-price, .item-wide .calc-total { text-align: right; }",
      ".item-wide .wide-qty, .item-wide .wide-price, .item-wide .calc-total { font-family: 'Noto Sans Lao', Arial, sans-serif; font-weight: 400; white-space: nowrap; font-variant-numeric: tabular-nums; }",
      ".item-wide .calc-total { font-weight: 400; } .wide-discount { margin: -2px 0 5px; }",
      ".item-wide-head { border-top: 2px solid #98a2b3; border-bottom: 1px solid #cbd5e1; padding: 5px 0 4px; margin: 7px 0 9px; font-size: 8px; line-height: 1.1; font-weight: 800; color: #000; } .item-wide-head .wide-name, .item-wide-head .wide-qty, .item-wide-head .wide-price, .item-wide-head .calc-total { font-family: 'Noto Sans Lao', Arial, sans-serif; font-weight: 800; white-space: nowrap; }",
      ".wide-table-end { border-top: 2px solid #98a2b3; margin: 8px 0; }",
      ".item > div:first-child, .total > div:first-child { min-width: 0; overflow-wrap: anywhere; }",
      ".item:not(.item-narrow) div:nth-child(2), .item:not(.item-narrow) div:nth-child(3) { text-align: right; font-family: 'Courier New', 'Noto Sans Lao', monospace; white-space: nowrap; }",
      ".total div:last-child { text-align: right; font-family: " + (isNarrowPaper ? "Arial, 'Noto Sans Lao', sans-serif" : "'Noto Sans Lao', Arial, sans-serif") + "; font-size: " + totalAmountFontSize + "; font-weight: " + (isNarrowPaper ? "400" : "inherit") + "; white-space: nowrap; font-variant-numeric: tabular-nums; }",
      ".total { grid-template-columns: " + totalColumns + "; font-size: " + totalFontSize + "; line-height: 1.35; } .grand { font-size: " + grandFontSize + "; font-weight: " + (isNarrowPaper ? "400" : "700") + "; } .grand div:last-child { font-size: " + grandAmountFontSize + "; }",
      ".footer-msg { margin-top: 8px; }",
      isNarrowPaper ? ".grand { display: block; } .grand div:last-child { display: block; width: 100%; margin-top: 2px; }" : "",
      ".print-action { display: block; width: 100%; margin: 14px 0 6px; padding: 10px; border: 1px solid #111; border-radius: 6px; background: #111; color: #fff; font-weight: 700; cursor: pointer; }",
      "@media print { body { width: " + receiptWidth + "; } .no-print { display: none !important; } }",
      "</style>",
      "</head>",
      "<body>",
      "<button class=\"print-action no-print\" onclick=\"window.print()\">Print " + paperSize + " Receipt</button>",
      "<div class=\"center\">" + (shop.logoUrl ? "<img src=\"" + receiptEscape(shop.logoUrl) + "\" style=\"max-height:" + logoMaxHeight + ";max-width:100%;border-radius:6px;\" referrerpolicy=\"no-referrer\" />" : "") + "<h1 class=\"title\">" + receiptEscape(shop.shopName) + "</h1><div>Tel: " + receiptEscape(shop.phone) + "</div>" + "<div class=\"bold\">" + receiptEscape(documentTitle) + "</div>" + (saleReference ? "<div>" + receiptEscape(saleReference) + "</div>" : "") + "<div>" + receiptEscape(new Date(sale.timestamp).toLocaleString()) + "</div></div>",
      itemsStartSeparatorHtml,
      itemsHeaderHtml,
      itemsHtml,
      itemsEndSeparatorHtml,
      isUnpaid ? "" : "<div class=\"total\"><div>Payment:</div><div class=\"bold\">" + paymentLabel(sale.paymentMethod) + "</div></div>",
      subtotalValue > 0 ? "<div class=\"total\"><div>Subtotal / ລວມ:</div><div>" + receiptMoney(subtotalValue) + "</div></div>" : "",
      totalDiscountValue > 0 ? "<div class=\"total\"><div>Discount / ສ່ວນຫຼຸດ:</div><div>-" + receiptMoney(totalDiscountValue) + "</div></div>" : "",
      vatValue > 0 ? "<div class=\"total\"><div>VAT:</div><div>" + receiptMoney(vatValue) + "</div></div>" : "",
      serviceValue > 0 ? "<div class=\"total\"><div>" + serviceName + ":</div><div>" + receiptMoney(serviceValue) + "</div></div>" : "",
      "<div class=\"total grand\"><div>TOTAL / ທັງໝົດ:</div><div>" + receiptMoney(sale.totalAmount) + "</div></div>",
      isUnpaid ? "" : "<div class=\"total\"><div>Tendered / ຮັບມາ:</div><div>" + receiptMoney(sale.amountTendered || sale.totalAmount) + "</div></div>",
      isUnpaid ? "" : "<div class=\"total\"><div>Change / ເງິນທອນ:</div><div>" + receiptMoney(sale.changeGiven || 0) + "</div></div>",
      (sale as any).memberName ? "<div class=\"separator\"></div>" : "",
      (sale as any).memberName ? "<div class=\"total\"><div>Member / ສະມາຊິກ:</div><div class=\"bold\">" + receiptEscape((sale as any).memberName) + "</div></div>" : "",
      (sale as any).memberName ? "<div class=\"total\"><div>Points earned / ຄະແນນ:</div><div class=\"bold\">+" + Number((sale as any).pointsEarned || 0).toLocaleString() + "</div></div>" : "",
      (sale as any).memberName && (sale as any).memberUid ? "<div class=\"total\"><div>Balance / ຄົງເຫຼືອ:</div><div>" + Number((db.getMemberByUid((sale as any).memberUid)?.points) || 0).toLocaleString() + "</div></div>" : "",
      "<div class=\"separator\"></div>",
      shop.qrCodeUrl ? "<div class=\"center\"><div class=\"small muted\">Scan to Pay / ສະແກນຊຳລະເງິນ</div><img src=\"" + receiptEscape(shop.qrCodeUrl) + "\" style=\"" + qrImageStyle + "\" referrerpolicy=\"no-referrer\" /></div>" : "",
      shop.contact ? "<div class=\"center small muted\" style=\"margin-top:8px;\">" + receiptEscape(shop.contact) + "</div>" : "",
      "<div class=\"separator\"></div>",
      "<div class=\"center small footer-msg\"><div class=\"bold\">Thank you for your business!</div><div>Please come again</div></div>",
      "<script>window.addEventListener(\"afterprint\",function(){setTimeout(function(){window.close();},500);});window.addEventListener(\"load\",function(){var go=function(){window.focus();window.print();};var done=false;var once=function(){if(!done&&!window.__printStarted){done=true;window.__printStarted=true;go();}};if(document.fonts&&document.fonts.ready){document.fonts.ready.then(function(){setTimeout(once,150);});}setTimeout(once,2500);});</script>",
      "</body>",
      "</html>"
    ].join("\n");
  };
  const printReceiptNow = (saleWithItems: SaleWithItems, title = "Receipt") => {
    openPrintWindow(buildReceiptPrintHtml(saleWithItems), title);
  };

  const shareReceiptPngNow = async (saleWithItems: SaleWithItems, title = "Receipt") => {
    if (isSharingReceipt) return;
    setIsSharingReceipt(true);
    try {
      const sale = saleWithItems.sale;
      const fileBase = sale.id === 0
        ? `Invoice_${new Date(sale.timestamp).toISOString().slice(0, 10)}`
        : `Receipt_Sale_${sale.id}`;
      const result = await shareReceiptHtmlAsPng(buildReceiptPrintHtml(saleWithItems), fileBase, title);
      if (result === "shared") {
        showNotification("ແຊຣ໌ PNG ໃບບິນສຳເລັດແລ້ວ");
      } else if (result === "downloaded") {
        showNotification("ດາວໂຫຼດ PNG ໃບບິນສຳເລັດແລ້ວ");
      }
    } catch (error) {
      console.error("share receipt PNG failed", error);
      showNotification("ສ້າງ PNG ໃບບິນບໍ່ສຳເລັດ", true);
    } finally {
      setIsSharingReceipt(false);
    }
  };

  // ===== Quotation print (added directly) =====
  const fmtKipQ = (n) => `₭${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const buildQuotationPrintHtml = (q) => {
    const itemsHtml = (q.items || []).map((it) => {
      const lineTotal = (it.price || 0) * (it.quantity || 0) - (it.discountAmount || 0);
      return `<tr><td style="padding:4px 0;text-align:left;">${it.name || ""}<br/><span style="color:#666;font-size:11px;">${it.quantity} x ${fmtKipQ(it.price)}</span></td><td style="padding:4px 0;text-align:right;vertical-align:top;">${fmtKipQ(lineTotal)}</td></tr>`;
    }).join("");
    const validUntilStr = q.validUntil ? new Date(q.validUntil).toLocaleDateString("en-GB") : "-";
    const dateStr = new Date(q.timestamp || Date.now()).toLocaleString("en-GB");
    const notesHtml = q.notes ? `<div style="margin-top:10px;border-top:1px dashed #999;padding-top:8px;font-size:12px;"><strong>ໝາຍເຫດ (Notes):</strong><br/>${q.notes}</div>` : "";
    const qrHtml = qrCodeUrl ? `<div style="text-align:center;margin-top:14px;border-top:1px dashed #999;padding-top:10px;"><img src="${qrCodeUrl}" style="width:150px;height:150px;" /><div style="font-size:11px;color:#444;margin-top:4px;">${settings.contact || ""}</div></div>` : "";
    const discountHtml = (q.discountAmount && q.discountAmount > 0) ? `<tr><td>Discount</td><td style="text-align:right;">-${fmtKipQ(q.discountAmount)}</td></tr>` : "";
    const vatHtml = (q.vatAmount && q.vatAmount > 0) ? `<tr><td>VAT</td><td style="text-align:right;">${fmtKipQ(q.vatAmount)}</td></tr>` : "";
    const xxxHtml = (q.xxxAmount && q.xxxAmount > 0) ? `<tr><td>${q.xxxName || "Service"}</td><td style="text-align:right;">${fmtKipQ(q.xxxAmount)}</td></tr>` : "";
    return `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>ໃບສະເໜີລາຄາ</title>
      <style>@import url("https://fonts.googleapis.com/css2?family=Noto+Sans+Lao:wght@400;600;700&display=swap"); * { font-family: "Noto Sans Lao", sans-serif; box-sizing: border-box; } body { width: 300px; margin: 0 auto; padding: 12px; color: #111; } h2 { text-align:center; margin: 2px 0; font-size: 18px; } table { width: 100%; border-collapse: collapse; font-size: 12px; } .muted { color:#555; font-size: 12px; }</style></head>
      <body>
        <div style="text-align:center;"><h2>${settings.shopName || ""}</h2><div class="muted">${settings.contact || ""}</div><div class="muted">${settings.phone || ""}</div></div>
        <div style="text-align:center;border-top:2px solid #111;border-bottom:2px solid #111;margin:8px 0;padding:6px 0;font-weight:700;">ໃບສະເໜີລາຄາ (QUOTATION)</div>
        <div style="font-size:12px;"><div><strong>ຊື່ລູກຄ້າ:</strong> ${q.customerName || "-"}</div><div><strong>ເບີໂທ / ການຕິດຕໍ່:</strong> ${q.customerContact || "-"}</div><div><strong>Date:</strong> ${dateStr}</div><div><strong>ວັນໝົດອາຍຸ (Valid Until):</strong> ${validUntilStr}</div></div>
        <table style="margin-top:8px;border-top:1px dashed #999;padding-top:6px;"><tbody>${itemsHtml}</tbody></table>
        <table style="margin-top:6px;border-top:1px dashed #999;"><tr><td>ລວມຍອດສິນຄ້າ</td><td style="text-align:right;">${fmtKipQ(q.subtotal)}</td></tr>${discountHtml}${vatHtml}${xxxHtml}<tr style="font-weight:700;font-size:14px;border-top:2px solid #111;"><td>ຍອດລວມທີ່ຕ້ອງຊຳລະທັງໝົດ</td><td style="text-align:right;">${fmtKipQ(q.totalAmount)}</td></tr></table>
        ${notesHtml}
        ${qrHtml}
        <div style="text-align:center;font-size:11px;color:#666;margin-top:12px;">Thank you</div>
      </body></html>`;
  };

  const printQuotationNow = (q) => {
    try { openPrintWindow(buildQuotationPrintHtml(q)); showNotification("ເປີດໜ້າພິມໃບສະເຫນີລາຄາແບບເຕັມຈໍແລ້ວ", true); }
    catch (e) { console.error("print quotation failed", e); }
  };

  const buildDraftSaleFromCart = (method = "DRAFT"): SaleWithItems => ({
    sale: {
      id: 0,
      timestamp: Date.now(),
      totalAmount: grandTotal,
      paymentMethod: method,
      amountTendered: grandTotal,
      changeGiven: 0,
      discountType: billDiscount?.type,
      discountValue: billDiscount?.value,
      discountAmount: billDiscountAmount,
      subtotal: subtotalBeforeDiscounts,
      vatAmount,
      xxxAmount,
      xxxName: settings.xxxRateName
    },
    items: cartItemDetails.map((detail, index) => ({
      id: index + 1,
      saleId: 0,
      menuItemId: detail.item.id,
      name: detail.item.name,
      price: detail.discountedPrice,
      originalPrice: detail.originalPrice,
      discountType: detail.discount?.type,
      discountValue: detail.discount?.value,
      discountAmount: detail.lineDiscountAmount,
      quantity: detail.qty
    }))
  });
  const handlePrintCart = () => {
    if (cartItemDetails.length === 0) {
      showNotification("ກະຕ່າຍັງວ່າງ ບໍ່ມີໃບບິນໃຫ້ພິມ", true);
      return;
    }
    printReceiptNow(buildDraftSaleFromCart(), "Invoice");
  };
  const handleShareCartPng = () => {
    if (cartItemDetails.length === 0) {
      showNotification("ກະຕ່າຍັງວ່າງ ບໍ່ມີໃບບິນໃຫ້ແຊຣ໌", true);
      return;
    }
    shareReceiptPngNow(buildDraftSaleFromCart(), "Invoice");
  };

  // Dynamic QR code for payments
  const [qrCodeUrl, setQrCodeUrl] = useState<string>("");

  // Categories list
  const categories = ["All", ...Array.from(new Set(menuItems.map(item => item.category)))];

  // Global Keyboard Wedge Barcode Scanner Listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const now = Date.now();
      
      // If time between keystrokes is small (< 50ms), it is likely a hardware scanner input
      if (now - lastKeyTimeRef.current > 100) {
        barcodeBufferRef.current = "";
      }
      lastKeyTimeRef.current = now;

      if (e.key === "Enter") {
        const barcode = barcodeBufferRef.current.trim();
        if (barcode.length >= 4) {
          const matchedItem = menuItems.find(item => item.barcode === barcode);
          if (matchedItem) {
            if (matchedItem.stockQty > 0) {
              onAddToCart(matchedItem);
              showNotification(`ສະແກນ: ເພີ່ມ ${matchedItem.name} ເຂົ້າໃນກະຕ່າແລ້ວ!`);
            } else {
              showNotification(`${matchedItem.name} ໝົດສະຕັອກແລ້ວ!`, true);
            }
          } else {
            showNotification(`ບໍ່ພົບບາໂຄດ [${barcode}].`, true);
          }
          barcodeBufferRef.current = "";
          e.preventDefault();
        }
      } else if (e.key.length === 1) {
        barcodeBufferRef.current += e.key;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [menuItems, onAddToCart]);

  // Notifications
  const [notification, setNotification] = useState<{ message: string; isError?: boolean } | null>(null);
  const showNotification = (message: string, isError = false) => {
    setNotification({ message, isError });
    setTimeout(() => setNotification(null), 3000);
  };

  // Generate Payment QR when grandTotal or payment method changes
  useEffect(() => {
    if (showPaymentDialog && paymentMethod === "QR" && grandTotal > 0) {
      // Create a mock Lao QR payment payload (LaoQR standard mock or dynamic invoice link)
      const payPayload = `LaoQR://merchant?name=Mahajuen&amount=${formatMoneyInput(grandTotal)}&currency=LAK&desc=Order_${Date.now().toString().slice(-6)}`;
      QRCode.toDataURL(payPayload, { margin: 1, width: 220 })
        .then(url => setQrCodeUrl(url))
        .catch(err => console.error("QR creation failed", err));
    }
  }, [showPaymentDialog, paymentMethod, grandTotal]);

  // Initialize Split or Cash inputs on Payment Dialog show/change
  useEffect(() => {
    if (showPaymentDialog) {
      if (paymentMethod === "SPLIT") {
        const half = roundMoney(grandTotal / 2);
        setSplitTransferInput(formatMoneyInput(half));
        setSplitCashTenderedInput(formatMoneyInput(roundMoney(grandTotal - half)));
      } else if (paymentMethod === "CASH" || paymentMethod === "TRANSFER") {
        setAmountTenderedInput(formatMoneyInput(grandTotal));
      } else {
        setAmountTenderedInput("");
      }
    }
  }, [showPaymentDialog, paymentMethod, grandTotal]);

  // Filtered Menu Items
  const filteredItems = menuItems.filter(item => {
    const matchesCategory = selectedCategory === "All" || item.category === selectedCategory;
    const matchesSearch = item.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
      (item.barcode && item.barcode.includes(searchQuery));
    return matchesCategory && matchesSearch;
  });

  // Camera scan callback
  const handleCameraScan = (barcode: string) => {
    const matchedItem = menuItems.find(item => item.barcode === barcode || item.id.toString() === barcode);
    if (matchedItem) {
      if (matchedItem.stockQty > 0) {
        onAddToCart(matchedItem);
        showNotification(`ເພີ່ມ ${matchedItem.name} ເຂົ້າໃນກະຕ່າແລ້ວ!`);
        setShowCameraScanner(false);
      } else {
        showNotification(`${matchedItem.name} ໝົດສະຕັອກແລ້ວ!`, true);
      }
    } else {
      showNotification(`ບໍ່ພົບສິນຄ້າທີ່ມີບາໂຄດ/ລະຫັດ [${barcode}]`, true);
    }
  };

  // Handle Save cart
  const handleConfirmHold = () => {
    const label = holdLabel.trim() || `ລາຍການ #${pendingOrders.length + 1}`;
    onSaveCartAsPending(label);
    setHoldLabel("");
    setShowHoldDialog(false);
    showNotification(`ບັນທຶກລາຍການ "${label}" ແລ້ວ`);
  };

  // Handle Save Quotation
  const handleSaveQuotationClick = () => {
    if (cartItemDetails.length === 0) {
      showNotification("ກະຕ່າຍັງວ່າງ ບໍ່ມີລາຍການໃຫ້ບັນທຶກເປັນໃບສະເໜີລາຄາ", true);
      return;
    }
    setQuoteCustomerName("");
    setQuoteCustomerContact("");
    setQuoteNotes("");
    setQuoteStatus("sent");
    const d = new Date();
    d.setDate(d.getDate() + 7);
    setQuoteValidUntil(d.toISOString().split('T')[0]);
    setShowQuotationDialog(true);
  };

  const handleConfirmSaveQuotation = () => {
    if (!onSaveQuotation) return;

    const validDetails = cartItemDetails.filter((d): d is NonNullable<typeof d> => d !== null);

    const itemsPayload = validDetails.map(detail => ({
      menuItemId: detail.item.id,
      name: detail.item.name,
      price: detail.discountedPrice,
      originalPrice: detail.originalPrice,
      discountType: detail.discount?.type,
      discountValue: detail.discount?.value,
      discountAmount: detail.lineDiscountAmount,
      quantity: detail.qty,
      costPrice: detail.item.costPrice || 0
    }));

    const quotationPayload = {
      timestamp: Date.now(),
      totalAmount: grandTotal,
      subtotal: subtotalBeforeDiscounts,
      vatAmount: settings.vatEnabled ? vatAmount : undefined,
      xxxAmount: settings.xxxRateEnabled ? xxxAmount : undefined,
      xxxName: settings.xxxRateEnabled ? settings.xxxRateName : undefined,
      discountType: billDiscount?.type,
      discountValue: billDiscount?.value,
      discountAmount: billDiscountAmount,
      status: quoteStatus,
      customerName: quoteCustomerName.trim() || undefined,
      customerContact: quoteCustomerContact.trim() || undefined,
      notes: quoteNotes.trim() || undefined,
      validUntil: new Date(quoteValidUntil).getTime(),
      items: itemsPayload
    };

    onSaveQuotation(quotationPayload, (savedQuote) => {
      printQuotationNow(quotationPayload);
      showNotification(`ບັນທຶກໃບສະເໜີລາຄາ ${savedQuote.quotation.quoteNumber} ສຳເລັດແລ້ວ!`);
      setShowQuotationDialog(false);
      onClearCart();
    });
  };

  // Tender cash calculations
  const parsedTendered = parseMoneyInput(amountTenderedInput);
  const changeDue = roundMoney(Math.max(0, parsedTendered - grandTotal));

  const buildCurrentPaymentDraftSale = (): SaleWithItems => {
    let tenderedVal = parsedTendered;
    let splitTransferAmount: number | undefined;
    let splitCashAmount: number | undefined;

    if (paymentMethod === "SPLIT") {
      const transferVal = parseMoneyInput(splitTransferInput);
      const cashRequired = roundMoney(Math.max(0, grandTotal - transferVal));
      const cashTendered = parseMoneyInput(splitCashTenderedInput);
      tenderedVal = roundMoney(transferVal + cashTendered);
      splitTransferAmount = transferVal;
      splitCashAmount = cashRequired;
    } else if (paymentMethod !== "CASH") {
      tenderedVal = grandTotal;
    }

    const draftSaleWithItems = buildDraftSaleFromCart(paymentMethod);
    return {
      ...draftSaleWithItems,
      sale: {
        ...draftSaleWithItems.sale,
        amountTendered: tenderedVal,
        changeGiven: Math.max(0, tenderedVal - grandTotal),
        splitTransferAmount,
        splitCashAmount
      }
    };
  };

  // Complete checkout
  const handleCheckoutComplete = (isRefund: boolean = false) => {
    if (paymentMethod === "CASH" && parsedTendered < grandTotal) {
      showNotification("ຈຳນວນເງິນທີ່ຮັບມາ ບໍ່ພໍກັບຍອດລວມທີ່ຕ້ອງຊຳລະ!", true);
      return;
    }

    let tenderedVal = parsedTendered;
    let splitTransferAmount: number | undefined;
    let splitCashAmount: number | undefined;

    if (paymentMethod === "SPLIT") {
      const transferVal = parseMoneyInput(splitTransferInput);
      const cashRequired = roundMoney(Math.max(0, grandTotal - transferVal));
      const cashTendered = parseMoneyInput(splitCashTenderedInput);
      if (cashTendered < cashRequired) {
        showNotification("ຈຳນວນເງິນສົດທີ່ຮັບມາ ບໍ່ພໍກັບສ່ວນທີ່ເຫຼືອ!", true);
        return;
      }
      tenderedVal = roundMoney(transferVal + cashTendered);
      splitTransferAmount = transferVal;
      splitCashAmount = cashRequired;
    }

    const action = isRefund ? onRecordRefund : onRecordSale;
    
    action(paymentMethod, tenderedVal, (sale) => {
      setShowPaymentDialog(false);
      setAmountTenderedInput("");
      setSplitTransferInput("");
      setSplitCashTenderedInput("");
      showNotification(isRefund ? "ດຳເນີນການຄືນເງິນສຳເລັດແລ້ວ!" : "ດຳເນີນການຊຳລະເງິນສຳເລັດແລ້ວ!");
    }, splitTransferAmount, splitCashAmount);
  };

  return (
    <div id="pos-view-container" className="grid grid-cols-1 lg:grid-cols-12 gap-4 lg:gap-5 h-full p-0 sm:p-1 lg:p-2 select-none relative">
      {/* Toast Notification */}
      {notification && (
        <div
          id="pos-toast"
          className={`fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-3 rounded-xl border shadow-xl text-sm font-semibold transition-transform animate-bounce ${
            notification.isError 
              ? "bg-rose-50 border-rose-200 text-rose-700" 
              : "bg-blue-50 border-blue-200 text-blue-700"
          }`}
        >
          <div className={`w-2 h-2 rounded-full ${notification.isError ? "bg-rose-500" : "bg-blue-500"}`} />
          {notification.message}
        </div>
      )}

      {/* LEFT: Product Catalog Section (Columns: 7) */}
      <div id="pos-catalog-section" className="lg:col-span-7 xl:col-span-8 flex min-w-0 flex-col gap-3 lg:gap-4">
        {/* Search & Scanner Actions */}
        <div id="pos-search-bar-container" className="bg-white p-3 sm:p-4 rounded-xl border border-slate-100 shadow-[0_4px_20px_rgba(0,0,0,0.01)] flex flex-wrap gap-2.5 sm:gap-3 items-center justify-between">
          <div id="pos-search-input-wrapper" className="relative flex-1 min-w-[min(100%,220px)]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              id="pos-search-input"
              type="text"
              placeholder="ຄົ້ນຫາສິນຄ້າດ້ວຍຊື່ ຫຼື ບາໂຄດ... (ພ້ອມສະແກນ)"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-150 rounded-xl text-sm focus:outline-none focus:border-blue-500 focus:bg-white transition-colors"
            />
          </div>

          <div id="pos-header-actions" className="flex items-center gap-2 w-full min-[520px]:w-auto">
            <button
              id="pos-cam-scan-btn"
              onClick={() => setShowCameraScanner(true)}
              aria-label="ເປີດກ້ອງສະແກນບາໂຄດ"
              title="ເປີດກ້ອງສະແກນບາໂຄດ"
              className="flex flex-1 min-[520px]:flex-none items-center justify-center gap-1.5 px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-sm font-semibold border border-slate-200 transition-colors cursor-pointer"
            >
              <Camera className="w-4 h-4 text-slate-500" />
              <span>ສະແກນດ້ວຍກ້ອງ</span>
            </button>
            <button
              id="pos-pending-list-btn"
              onClick={() => setShowPendingDialog(true)}
              aria-label="ເປີດລາຍການຄ້າງຈ່າຍ"
              title="ເປີດລາຍການຄ້າງຈ່າຍ"
              className="relative flex flex-1 min-[520px]:flex-none items-center justify-center gap-1.5 px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-sm font-semibold border border-slate-200 transition-colors cursor-pointer"
            >
              <ClipboardList className="w-4 h-4 text-slate-500" />
              <span>ຄ້າງຈ່າຍ</span>
              {pendingOrders.length > 0 && (
                <span className="absolute -top-1.5 -right-1.5 flex h-4.5 w-4.5 items-center justify-center rounded-full bg-blue-600 text-[10px] font-bold text-white ring-2 ring-white">
                  {pendingOrders.length}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Category Selector Pills */}
        <div id="pos-categories" className="flex gap-2 overflow-x-auto pb-1 scrollbar-thin">
          {categories.map(cat => (
            <button
              id={`pos-category-pill-${cat}`}
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`px-4 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all border cursor-pointer ${
                selectedCategory === cat
                  ? "bg-blue-600 border-blue-600 text-white shadow-sm"
                  : "bg-white border-slate-150 text-slate-600 hover:bg-slate-50"
              }`}
            >
              {cat === "All" ? "ທັງໝົດ" : cat}
            </button>
          ))}
        </div>

        {/* Product Grid */}
        <div
          id="pos-product-grid"
          className="flex-1 lg:overflow-y-auto pr-1 grid grid-cols-2 min-[480px]:grid-cols-3 md:grid-cols-4 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-2.5 sm:gap-3 content-start auto-rows-min lg:max-h-[calc(100vh-260px)]"
        >
          {filteredItems.length === 0 ? (
            <div id="pos-empty-catalog" className="col-span-full bg-white rounded-2xl border border-slate-100 p-12 text-center flex flex-col items-center justify-center gap-3">
              <Search className="w-8 h-8 text-slate-300" />
              <p className="text-sm font-medium text-slate-400">ບໍ່ມີສິນຄ້າທີ່ກົງກັບການຄົ້ນຫາ.</p>
            </div>
          ) : (
            filteredItems.map(item => {
              const isLowStock = item.stockQty <= item.lowStockThreshold;
              const isOutOfStock = item.stockQty === 0;
              const qtyInCart = cart[item.id] || 0;
              const onPromo = isOnPromo(item);
              const sellPrice = effectivePrice(item);

              return (
                <div
                  id={`pos-product-card-${item.id}`}
                  key={item.id}
                  onClick={() => isRefundMode ? onRefundToCart(item) : !isOutOfStock && onAddToCart(item)}
                  className={`bg-white border rounded-xl p-2 flex flex-col gap-1.5 shadow-[0_4px_12px_rgba(0,0,0,0.01)] transition-all relative select-none text-center min-h-[182px] sm:min-h-[198px] ${
                    isOutOfStock
                      ? "opacity-60 border-slate-150 cursor-not-allowed"
                      : "border-slate-100 hover:border-blue-300 hover:shadow-md cursor-pointer active:scale-98"
                  }`}
                >
                  {/* Image Space — 1:1 */}
                  <div className="w-full aspect-square rounded-lg bg-slate-50 border border-slate-100 overflow-hidden flex items-center justify-center relative">
                    {item.imageUrl ? (
                      <img
                        src={item.imageUrl}
                        alt={item.name}
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="flex flex-col items-center justify-center text-slate-300">
                        <Tag className="w-5 h-5 text-slate-200" />
                        <span className="text-[8px] mt-0.5 text-slate-400 font-sans">ບໍ່ມີຮູບ</span>
                      </div>
                    )}
                    {onPromo && (
                      <span className="absolute top-1 left-1 text-[8px] font-bold bg-blue-600 text-white px-1 py-0.5 rounded">
                        SALE
                      </span>
                    )}
                    {qtyInCart > 0 && (
                      <span className="absolute top-1 right-1 min-w-[16px] h-4 flex items-center justify-center text-[9px] font-bold bg-emerald-500 text-white px-1 rounded-full">
                        {qtyInCart}
                      </span>
                    )}
                  </div>

                  {/* Name + price, centered */}
                  <h4 className="font-semibold text-slate-800 text-[11px] line-clamp-2 leading-tight text-center">
                    {item.name}
                  </h4>
                  <div className="flex items-baseline justify-center gap-1">
                    <span className={`font-bold text-sm ${onPromo ? "text-blue-600" : "text-slate-900"}`}>
                      ₭{sellPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                    {onPromo && (
                      <span className="text-[9px] text-slate-400 line-through">
                        ₭{item.price.toLocaleString()}
                      </span>
                    )}
                  </div>

                  <div className="text-[10px] font-medium text-slate-500 leading-none">
                    {isOutOfStock ? (
                      <span className="text-rose-600 bg-rose-50 px-1.5 py-0.5 rounded font-bold">ໝົດສະຕັອກ</span>
                    ) : isLowStock ? (
                      <span className="text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded font-bold">ໃກ້ໝົດ: ຍັງ {item.stockQty}</span>
                    ) : (
                      <span>ຍັງເຫຼືອ: {item.stockQty}</span>
                    )}
                  </div>

                  {/* +/- quantity controls */}
                  <div
                    className="flex items-center justify-center gap-1 mt-auto pt-1"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      id={`pos-product-minus-${item.id}`}
                      onClick={() => qtyInCart > 0 && onRemoveFromCart(item)}
                      disabled={qtyInCart === 0}
                      className={`w-7 h-7 flex items-center justify-center rounded-lg border text-sm font-bold transition-colors ${
                        qtyInCart === 0
                          ? "border-slate-100 text-slate-200 cursor-not-allowed"
                          : "border-slate-200 text-slate-600 hover:bg-slate-100 cursor-pointer"
                      }`}
                      aria-label={`ຫຼຸດ ${item.name}`}
                    >
                      -
                    </button>
                    <span className="w-7 text-center text-xs font-bold text-slate-700">{qtyInCart}</span>
                    <button
                      id={`pos-product-plus-${item.id}`}
                      onClick={() => {
                        if (isRefundMode) {
                          onRefundToCart(item);
                        } else if (isOutOfStock || qtyInCart >= item.stockQty) {
                          showNotification(`ມີພຽງ ${item.stockQty} ຊິ້ນໃນສະຕັອກ!`, true);
                        } else {
                          onAddToCart(item);
                        }
                      }}
                      className="w-7 h-7 flex items-center justify-center rounded-lg border border-blue-200 bg-blue-50 text-blue-600 hover:bg-blue-100 text-sm font-bold transition-colors cursor-pointer"
                      aria-label={`ເພີ່ມ ${item.name}`}
                    >
                      +
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* RIGHT: Active Shopping Cart Section (Columns: 5) */}
      <div id="pos-cart-section" className="lg:col-span-5 xl:col-span-4 bg-white rounded-2xl border border-slate-100 shadow-[0_8px_30px_rgb(0,0,0,0.02)] flex min-w-0 flex-col overflow-hidden scroll-mt-20 lg:sticky lg:top-24 lg:max-h-[calc(100vh-120px)]">
        {/* Cart Header */}
        <div id="pos-cart-header" className="p-4 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShoppingCart className="w-5 h-5 text-blue-600" />
            <h3 className="font-bold text-slate-800 text-sm">ກະຕ່າສິນຄ້າ</h3>
            {totalItemsCount > 0 && (
              <span className="px-2 py-0.5 bg-blue-100 text-blue-800 text-[10px] font-bold rounded-full">
                {totalItemsCount} ລາຍການ
              </span>
            )}
          </div>
          {cartEntries.length > 0 && (
            <button
              id="pos-clear-cart-btn"
              onClick={() => {
                onClearCart();
                showNotification("ໂມຄະທັງໝົດໃນກະຕ່າແລ້ວ");
              }}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-bold text-rose-600 bg-rose-50 hover:bg-rose-100 border border-rose-200 transition-all cursor-pointer font-sans"
              title="ໂມຄະການຂາຍທັງໝົດ"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>ໂມຄະທັງໝົດ</span>
            </button>
          )}
        </div>

        {activeQuotationToConvert && (
          <div id="quotation-conversion-banner" className="bg-amber-50 border-b border-amber-100 px-4 py-2.5 flex items-center justify-between text-xs text-amber-800 font-semibold animate-fade-in">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="shrink-0 block w-2 h-2 rounded-full bg-amber-500 animate-pulse"></span>
              <span className="truncate">ກຳລັງປ່ຽນໃບສະເໜີລາຄາ <span className="font-bold">{activeQuotationToConvert.quoteNumber}</span> ເປັນການຂາຍ...</span>
            </div>
            {onCancelQuotationConversion && (
              <button
                onClick={() => {
                  onCancelQuotationConversion();
                  onClearCart();
                  showNotification("ຍົກເລີກການປ່ຽນໃບສະເໜີລາຄາແລ້ວ");
                }}
                className="text-[10px] text-rose-600 bg-white border border-rose-200 px-2 py-0.5 rounded-lg font-bold hover:bg-rose-50 transition-colors shrink-0"
              >
                ຍົກເລີກ
              </button>
            )}
          </div>
        )}

        {/* Cart Items List */}
        <div id="pos-cart-items-wrapper" className="flex-1 overflow-y-auto p-4 space-y-3">
          {cartEntries.length === 0 ? (
            <div id="pos-cart-empty" className="h-full flex flex-col items-center justify-center text-center gap-3 py-16">
              <div className="p-3 bg-slate-50 rounded-full text-slate-300">
                <ShoppingCart className="w-6 h-6" />
              </div>
              <p className="text-xs text-slate-400 font-medium max-w-[160px] leading-normal">
                ກະຕ່າສິນຄ້າຂອງທ່ານຍັງວ່າງເປົ່າ. ເລືອກສິນຄ້າເພື່ອເພີ່ມເຂົ້າກະຕ່າ.
              </p>
            </div>
          ) : (
            cartEntries.map(([idStr, quantity]) => {
              const id = parseInt(idStr);
              const item = menuItems.find(i => i.id === id);
              if (!item) return null;

              const onPromo = isOnPromo(item);
              const discountedPrice = effectivePrice(item);
              const lineOriginalTotal = item.price * quantity;
              const lineDiscountedTotal = discountedPrice * quantity;

              return (
                <div
                  id={`pos-cart-item-${id}`}
                  key={id}
                  className="flex flex-col p-2 bg-slate-50/70 border border-slate-100 rounded-2xl hover:bg-slate-50 transition-all"
                >
                  <div className="flex items-center flex-wrap gap-x-2.5 gap-y-1.5">
                    {/* Thumbnail */}
                    <div className="w-9 h-9 rounded-lg bg-white border border-slate-150 overflow-hidden flex items-center justify-center shrink-0">
                      {item.imageUrl ? (
                        <img 
                          src={item.imageUrl} 
                          alt={item.name} 
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover" 
                        />
                      ) : (
                        <Tag className="w-4 h-4 text-slate-300" />
                      )}
                    </div>

                    <div className="flex-1 min-w-[140px]">
                      <h5 className="font-semibold text-slate-800 text-xs truncate leading-normal">
                        {item.name}
                      </h5>
                      <div className="flex items-center flex-wrap gap-1 mt-0.5">
                        {onPromo ? (
                          <>
                            <span className="text-[10px] font-bold text-blue-600 font-mono">
                              ₭{discountedPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                            </span>
                            <span className="text-[9px] text-slate-400 line-through font-mono">
                              ₭{item.price.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                            </span>
                          </>
                        ) : (
                          <span className="text-[9px] font-bold text-slate-400 font-mono block">
                            ₭{item.price.toLocaleString(undefined, { minimumFractionDigits: 2 })} each
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Quantity controls (wraps under the name on narrow screens) */}
                    <div className="flex items-center gap-1.5 bg-white border border-slate-150 rounded-lg p-0.5 ml-auto">
                      <button
                        id={`pos-cart-item-minus-${id}`}
                        onClick={() => onRemoveFromCart(item)}
                        className="w-5.5 h-5.5 flex items-center justify-center rounded hover:bg-slate-100 text-slate-500 text-xs font-bold transition-colors cursor-pointer"
                      >
                        -
                      </button>
                      <input
                        id={`pos-cart-item-qty-input-${id}`}
                        type="number"
                        value={quantity}
                        onChange={(e) => onUpdateCartQty(id, parseInt(e.target.value) || 0)}
                        className="w-8 text-center text-xs font-bold focus:outline-none border-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      />
                      <button
                        id={`pos-cart-item-plus-${id}`}
                        onClick={() => {
                          if (quantity < item.stockQty) {
                            onAddToCart(item);
                          } else {
                            showNotification(`ມີພຽງ ${item.stockQty} ຊິ້ນໃນສະຕັອກ!`, true);
                          }
                        }}
                        className="w-5.5 h-5.5 flex items-center justify-center rounded hover:bg-slate-100 text-slate-500 text-xs font-bold transition-colors cursor-pointer"
                      >
                        +
                      </button>
                    </div>

                    <div className="flex items-center gap-1">
                      <div className="text-right min-w-[65px]">
                        <span className="text-xs font-bold text-slate-800 font-mono block">
                          ₭{lineDiscountedTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </span>
                        {onPromo && (
                          <span className="text-[9px] text-slate-400 line-through font-mono block">
                            ₭{lineOriginalTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                          </span>
                        )}
                      </div>
                      <button
                        id={`pos-cart-item-void-${id}`}
                        onClick={() => {
                          onUpdateCartQty(id, 0);
                          showNotification(`ໂມຄະສິນຄ້າ "${item.name}" ສຳເລັດແລ້ວ`);
                        }}
                        className="p-1 hover:bg-rose-50 text-slate-300 hover:text-rose-600 rounded-lg transition-colors cursor-pointer"
                        title="ໂມຄະ (Void)"
                        aria-label={`ໂມຄະສິນຄ້າ ${item.name}`}
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Cart Summary & Action Buttons */}
        <div id="pos-cart-summary" className="p-4 border-t border-slate-100 bg-slate-50/50 space-y-2">
          <div className="flex items-baseline justify-between text-xs text-slate-500 font-semibold">
            <span>ລວມຍອດສິນຄ້າ (Subtotal)</span>
            <span className="font-mono">₭{subtotalBeforeDiscounts.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
          </div>

          {totalItemDiscountsAmount > 0 && (
            <div className="flex items-baseline justify-between text-xs text-blue-600 font-bold animate-fade-in">
              <span>ສ່ວນຫຼຸດສິນຄ້າ (Item Discounts)</span>
              <span className="font-mono">-₭{totalItemDiscountsAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
            </div>
          )}

          {/* Interactive Whole-Bill Discount Controls */}
          <div id="whole-bill-discount-container" className="py-1">
            {showBillDiscountInput ? (
              <div className="flex items-center gap-2 bg-blue-50/60 border border-blue-150 p-2 rounded-xl text-xs animate-fade-in justify-between">
                <div className="flex items-center gap-1.5 flex-1 min-w-0">
                  <span className="font-bold text-slate-700 text-[10px] shrink-0">ສ່ວນຫຼຸດບິນ:</span>
                  <select
                    value={tempBillDiscountType}
                    onChange={(e) => setTempBillDiscountType(e.target.value as 'PERCENT' | 'FIXED')}
                    className="text-[10px] bg-white border border-slate-300 rounded px-1 py-0.5 focus:outline-none shrink-0"
                  >
                    <option value="PERCENT">% (ເປີເຊັນ)</option>
                    <option value="FIXED">₭ (ກີບ)</option>
                  </select>
                  <input
                    type="number"
                    placeholder={tempBillDiscountType === "PERCENT" ? "%" : "₭"}
                    value={tempBillDiscountValue}
                    onChange={(e) => setTempBillDiscountValue(e.target.value)}
                    className="w-16 text-[10px] font-bold px-1.5 py-0.5 bg-white border border-slate-300 rounded focus:outline-none font-mono font-sans"
                    autoFocus
                  />
                </div>
                <div className="flex gap-1 shrink-0">
                  <button
                    onClick={() => {
                      const val = parseFloat(tempBillDiscountValue) || 0;
                      onUpdateBillDiscount(tempBillDiscountType, val);
                      setShowBillDiscountInput(false);
                      setTempBillDiscountValue("");
                    }}
                    className="px-2 py-0.5 bg-blue-600 text-white rounded text-[9px] font-bold hover:bg-blue-750 transition-colors"
                  >
                    ໃສ່
                  </button>
                  <button
                    onClick={() => {
                      onUpdateBillDiscount(null, 0);
                      setShowBillDiscountInput(false);
                      setTempBillDiscountValue("");
                    }}
                    className="px-2 py-0.5 bg-rose-500 text-white rounded text-[9px] font-bold hover:bg-rose-600 transition-colors"
                  >
                    ລຶບ
                  </button>
                  <button
                    onClick={() => setShowBillDiscountInput(false)}
                    className="px-1.5 py-0.5 bg-slate-200 text-slate-600 rounded text-[9px] font-bold hover:bg-slate-300 transition-colors"
                  >
                    ປິດ
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex justify-between items-center bg-slate-100/40 hover:bg-slate-100/80 border border-slate-200/50 p-1.5 rounded-xl transition-all">
                <div className="flex items-center gap-1 text-[10px] font-bold text-slate-500">
                  <Percent className="w-3 h-3 text-blue-500" />
                  <span>ສ່ວນຫຼຸດບິນທັງໝົດ (Bill Discount)</span>
                </div>
                {billDiscount ? (
                  <button
                    onClick={() => {
                      setTempBillDiscountType(billDiscount.type);
                      setTempBillDiscountValue(billDiscount.value.toString());
                      setShowBillDiscountInput(true);
                    }}
                    className="flex items-center gap-1 px-2 py-0.5 bg-blue-50 hover:bg-blue-100 text-blue-600 rounded-lg text-[10px] font-bold transition-all cursor-pointer font-sans"
                  >
                    <span>
                      {billDiscount.type === "PERCENT" ? `${billDiscount.value}%` : `₭${billDiscount.value.toLocaleString()}`}
                    </span>
                    <Edit className="w-2.5 h-2.5 ml-0.5" />
                  </button>
                ) : (
                  <button
                    onClick={() => {
                      setTempBillDiscountType("PERCENT");
                      setTempBillDiscountValue("");
                      setShowBillDiscountInput(true);
                    }}
                    className="flex items-center gap-1 px-2 py-0.5 bg-white hover:bg-slate-200 border border-slate-300 text-slate-500 rounded-lg text-[9px] font-bold transition-all cursor-pointer font-sans"
                  >
                    <span>+ ສ່ວນຫຼຸດບິນ</span>
                  </button>
                )}
              </div>
            )}
          </div>

          {billDiscountAmount > 0 && (
            <div className="flex items-baseline justify-between text-xs text-emerald-600 font-bold animate-fade-in">
              <span>ສ່ວນຫຼຸດບິນທັງໝົດ (Bill Discount)</span>
              <span className="font-mono">-₭{billDiscountAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
            </div>
          )}

          {settings.vatEnabled && (
            <div className="flex items-baseline justify-between text-xs text-slate-500 font-semibold animate-fade-in">
              <span>VAT ({settings.vatRate}%)</span>
              <span className="font-mono text-slate-600">₭{vatAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
            </div>
          )}

          {settings.xxxRateEnabled && (
            <div className="flex items-baseline justify-between text-xs text-slate-500 font-semibold animate-fade-in">
              <span>{settings.xxxRateName} ({settings.xxxRate}%)</span>
              <span className="font-mono text-slate-600">₭{xxxAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
            </div>
          )}

          <div className="flex items-baseline justify-between border-t border-slate-100 pt-2 my-1">
            <span className="text-slate-700 text-xs font-bold">ຍອດລວມທັງໝົດ</span>
            <span className="text-xl font-bold text-blue-600 font-mono">
              ₭{grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <button
              id="pos-print-btn"
              onClick={handlePrintCart}
              disabled={cartEntries.length === 0}
              className="col-span-2 flex items-center justify-center gap-1.5 py-2.5 bg-slate-800 hover:bg-slate-900 disabled:opacity-50 text-white disabled:cursor-not-allowed font-bold rounded-xl text-xs transition-colors cursor-pointer"
            >
              <Printer className="w-4 h-4" />
              <span>ພິມໃບບິນ</span>
            </button>
            <button
              id="pos-share-png-btn"
              onClick={handleShareCartPng}
              disabled={cartEntries.length === 0 || isSharingReceipt}
              className="col-span-2 flex items-center justify-center gap-1.5 py-2.5 bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white disabled:cursor-not-allowed font-bold rounded-xl text-xs transition-colors cursor-pointer"
            >
              <Share2 className="w-4 h-4" />
              <span>{isSharingReceipt ? "ກຳລັງສ້າງ PNG..." : "ແຊຣ໌ PNG ໃບບິນ"}</span>
            </button>
            <button
              id="pos-quotation-btn"
              onClick={handleSaveQuotationClick}
              disabled={cartEntries.length === 0}
              className="col-span-2 flex items-center justify-center gap-1.5 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white disabled:cursor-not-allowed font-bold rounded-xl text-xs transition-colors cursor-pointer"
            >
              <FileText className="w-4 h-4" />
              <span>ບັນທຶກເປັນໃບສະເໜີລາຄາ</span>
            </button>
            <button
              id="pos-hold-btn"
              onClick={() => cartEntries.length > 0 && setShowHoldDialog(true)}
              disabled={cartEntries.length === 0}
              className="flex items-center justify-center gap-1.5 py-2.5 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-700 disabled:cursor-not-allowed font-bold rounded-xl text-xs border border-slate-200 transition-colors cursor-pointer"
            >
              <Save className="w-4 h-4 text-slate-500" />
              <span>ພັກບິນໄວ້</span>
            </button>
            <button
              id="pos-pay-btn"
              onClick={() => {
                setIsRefundSale(false);
                cartEntries.length > 0 && setShowPaymentDialog(true);
              }}
              disabled={cartEntries.length === 0}
              className="flex items-center justify-center gap-1.5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-200 disabled:text-slate-400 text-white disabled:cursor-not-allowed font-bold rounded-xl text-xs transition-colors shadow-sm shadow-blue-200 cursor-pointer"
            >
              <Banknote className="w-4 h-4" />
              <span>ຊຳລະເງິນ</span>
            </button>
            <button
              id="pos-refund-btn"
              onClick={() => {
                setIsRefundSale(true);
                cartEntries.length > 0 && setShowPaymentDialog(true);
              }}
              disabled={cartEntries.length === 0}
              className="flex items-center justify-center gap-1.5 py-2.5 bg-amber-500 hover:bg-amber-600 disabled:bg-slate-200 disabled:text-slate-400 text-white disabled:cursor-not-allowed font-bold rounded-xl text-xs transition-colors shadow-sm shadow-amber-200 cursor-pointer"
            >
              <RefreshCw className="w-4 h-4" />
              <span>ຄືນເງິນ</span>
            </button>
          </div>
        </div>
      </div>

      {/* Print-only Invoice */}
      <div className="hidden print:block p-8 font-mono text-xs text-slate-900 w-full">
        <div className="text-center mb-6">
          <h1 className="text-xl font-bold">{settings.shopName}</h1>
          <p>{settings.contact}</p>
          <p>{settings.phone}</p>
          <p>{new Date().toLocaleString()}</p>
        </div>
        <div className="border-t border-b border-black py-2 mb-4">
          {cartItemDetails.map(d => (
            <div key={d.item.id} className="flex justify-between py-1">
              <span>{d.item.name} x {d.qty}</span>
              <span>₭{(d.lineDiscountedTotal).toLocaleString()}</span>
            </div>
          ))}
        </div>
        <div className="text-right">
          <p>ຍອດລວມ: ₭{grandTotal.toLocaleString()}</p>
        </div>
      </div>

      {/* ── FLOATING CART SUMMARY BAR (mobile only — the cart lives below the fold) ── */}
      {totalItemsCount > 0 && (
        <button
          id="pos-mobile-cart-bar"
          onClick={() => document.getElementById("pos-cart-section")?.scrollIntoView({ behavior: "smooth", block: "start" })}
          className="lg:hidden fixed bottom-[76px] left-3 right-3 z-30 flex items-center justify-between gap-3 px-4 py-3 bg-blue-600 text-white rounded-2xl shadow-xl shadow-blue-600/30 active:scale-98 transition-transform cursor-pointer"
        >
          <span className="flex items-center gap-2 text-xs font-bold">
            <ShoppingCart className="w-4.5 h-4.5" />
            {totalItemsCount} ລາຍການ — ເບິ່ງກະຕ່າ
          </span>
          <span className="font-mono font-bold text-sm">₭{grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
        </button>
      )}

      {/* ── CAMERA SCANNER OVERLAY DIALOG ── */}
      {showCameraScanner && (
        <CameraScanner
          onScan={handleCameraScan}
          onClose={() => setShowCameraScanner(false)}
          title="ເຄື່ອງສະແກນບາໂຄດ / QR"
        />
      )}

      {/* ── HOLD CART DIALOG (HOLD LABELLING) ── */}
      {showHoldDialog && (
        <div id="hold-dialog-overlay" className="fixed inset-0 z-50 bg-slate-950/40 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in">
          <div id="hold-dialog" className="bg-white border border-slate-100 rounded-3xl p-6 w-full max-w-md shadow-2xl space-y-4">
            <div className="flex justify-between items-center border-b border-slate-100 pb-3">
              <h3 className="text-sm font-bold text-slate-800">ພັກບິນ / ບັນທຶກໄວ້</h3>
              <button onClick={() => setShowHoldDialog(false)} aria-label="ປິດໜ້າຕ່າງພັກບິນ" title="ປິດ" className="p-1 rounded hover:bg-slate-50 text-slate-400">
                <X className="w-4.5 h-4.5" />
              </button>
            </div>
            
            <div className="space-y-1.5">
              <label className="text-[11px] font-bold text-slate-500">ຊື່ໂຕະ / ຂໍ້ມູນລູກຄ້າ</label>
              <input
                id="hold-label-input"
                type="text"
                placeholder="ຕົວຢ່າງ: ໂຕະ 4, ທ່ານ ສົມຈິດ, ບິນທີ 1"
                value={holdLabel}
                onChange={(e) => setHoldLabel(e.target.value)}
                className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
            </div>

            <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
              <button
                onClick={() => setShowHoldDialog(false)}
                className="px-4 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-600 font-semibold hover:bg-slate-100 transition-all cursor-pointer"
              >
                ຍົກເລີກ
              </button>
              <button
                onClick={handleConfirmHold}
                className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-all cursor-pointer"
              >
                ບັນທຶກ
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── SAVE AS QUOTATION DIALOG ── */}
      {showQuotationDialog && (
        <div id="quotation-dialog-overlay" className="fixed inset-0 z-50 bg-slate-950/40 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in font-sans">
          <div id="quotation-dialog" className="bg-white border border-slate-100 rounded-3xl p-4 sm:p-6 w-full max-w-md shadow-2xl space-y-4 max-h-[92vh] overflow-y-auto">
            <div className="flex justify-between items-center border-b border-slate-100 pb-3">
              <h3 className="text-sm font-bold text-slate-800">ບັນທຶກເປັນໃບສະເໜີລາຄາ</h3>
              <button onClick={() => setShowQuotationDialog(false)} aria-label="ປິດໜ້າຕ່າງ" title="ປິດ" className="p-1 rounded hover:bg-slate-50 text-slate-400">
                <X className="w-4.5 h-4.5" />
              </button>
            </div>
            
            <div className="space-y-3">
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-500">ຊື່ລູກຄ້າ (Customer Name)</label>
                <input
                  id="quote-customer-name"
                  type="text"
                  placeholder="ຕົວຢ່າງ: ທ່ານ ສົມສັກ"
                  value={quoteCustomerName}
                  onChange={(e) => setQuoteCustomerName(e.target.value)}
                  className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 font-sans"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-500 font-sans">ເບີໂທ / ການຕິດຕໍ່ (Customer Contact)</label>
                <input
                  id="quote-customer-contact"
                  type="text"
                  placeholder="ຕົວຢ່າງ: 020 9999 8888"
                  value={quoteCustomerContact}
                  onChange={(e) => setQuoteCustomerContact(e.target.value)}
                  className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 font-sans"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-slate-500 font-sans">ວັນໝົດອາຍຸ (Valid Until)</label>
                  <input
                    id="quote-valid-until"
                    type="date"
                    value={quoteValidUntil}
                    onChange={(e) => setQuoteValidUntil(e.target.value)}
                    className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 font-sans"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-slate-500 font-sans">ສະຖານະ (Status)</label>
                  <select
                    id="quote-status"
                    value={quoteStatus}
                    onChange={(e) => setQuoteStatus(e.target.value as any)}
                    className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 font-sans"
                  >
                    <option value="sent">ສົ່ງແລ້ວ (Sent)</option>
                    <option value="draft">ສະບັບຮ່າງ (Draft)</option>
                    <option value="accepted">ຍອມຮັບແລ້ວ (Accepted)</option>
                  </select>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-500 font-sans">ໝາຍເຫດ (Notes)</label>
                <textarea
                  id="quote-notes"
                  placeholder="ລາຍລະອຽດເພີ່ມເຕີມ..."
                  value={quoteNotes}
                  onChange={(e) => setQuoteNotes(e.target.value)}
                  rows={2}
                  className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 font-sans resize-none"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
              <button
                onClick={() => setShowQuotationDialog(false)}
                className="px-4 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-600 font-semibold hover:bg-slate-100 transition-all cursor-pointer font-sans"
              >
                ຍົກເລີກ
              </button>
              <button
                onClick={handleConfirmSaveQuotation}
                className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-all cursor-pointer font-sans"
              >
                ບັນທຶກ
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── PENDING ORDERS LIST DIALOG (TABS) ── */}
      {showPendingDialog && (
        <div id="tabs-dialog-overlay" className="fixed inset-0 z-50 bg-slate-950/40 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in">
          <div id="tabs-dialog" className="bg-white border border-slate-100 rounded-3xl p-4 sm:p-6 w-full max-w-2xl shadow-2xl flex flex-col max-h-[88vh] overflow-hidden">
            <div className="flex justify-between items-center border-b border-slate-100 pb-3 mb-4">
              <div>
                <h3 className="text-base font-bold text-slate-800">ລາຍການຄ້າງຈ່າຍ / ໂຕະທີ່ພັກໄວ້</h3>
                <p className="text-[11px] text-slate-400 font-semibold">{pendingOrders.length} ລາຍການລໍຖ້າການຊຳລະເງິນ</p>
              </div>
              <button onClick={() => setShowPendingDialog(false)} aria-label="ປິດລາຍການຄ້າງຈ່າຍ" title="ປິດ" className="p-1 rounded hover:bg-slate-50 text-slate-400">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-3 pr-1">
              {pendingOrders.length === 0 ? (
                <div className="py-16 text-center text-slate-400 text-xs">
                  ບໍ່ມີລາຍການຄ້າງຈ່າຍໃນຂະນະນີ້.
                </div>
              ) : (
                pendingOrders.map(order => {
                  const orderTotal = Object.entries(order.cart).reduce((sum, [idStr, qty]) => {
                    const item = menuItems.find(i => i.id === parseInt(idStr));
                    return sum + (item ? item.price * qty : 0);
                  }, 0);
                  const totalQty = Object.values(order.cart).reduce((s, q) => s + q, 0);

                  return (
                    <div
                      id={`pending-tab-card-${order.id}`}
                      key={order.id}
                      className="border border-slate-150 rounded-2xl p-4 bg-slate-50/40 hover:bg-slate-50 transition-colors flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4"
                    >
                      <div className="space-y-1.5 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-slate-800 text-sm">{order.label}</span>
                          <span className="text-[10px] bg-amber-100 text-amber-700 font-bold px-2 py-0.5 rounded-full">
                            ຄ້າງຊຳລະ
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-500 font-semibold">
                          ເລີ່ມແຕ່: {new Date(order.createdAt).toLocaleTimeString()} · {totalQty} ລາຍການ
                        </p>
                        <div className="flex flex-wrap gap-2 pt-1">
                          {Object.entries(order.cart).slice(0, 3).map(([idStr, qty]) => {
                            const item = menuItems.find(i => i.id === parseInt(idStr));
                            return item ? (
                              <span key={idStr} className="text-[10px] text-slate-600 bg-white border border-slate-100 px-2 py-0.5 rounded font-medium">
                                {item.name} x{qty}
                              </span>
                            ) : null;
                          })}
                          {Object.keys(order.cart).length > 3 && (
                            <span className="text-[10px] text-slate-400 font-medium self-center">
                              +{Object.keys(order.cart).length - 3} ເພີ່ມເຕີມ
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex sm:flex-col items-end gap-3 w-full sm:w-auto border-t sm:border-none pt-3 sm:pt-0">
                        <span className="font-bold text-slate-900 font-mono text-sm self-center sm:self-auto">
                          ₭{orderTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </span>
                        <div className="flex gap-2 ml-auto">
                          <button
                            id={`pending-tab-discard-${order.id}`}
                            onClick={() => {
                              onDiscardPendingOrder(order.id);
                              showNotification(`ລົບລາຍການ "${order.label}" ແລ້ວ`);
                            }}
                            className="p-1.5 border border-rose-200 text-rose-500 hover:bg-rose-50 rounded-xl transition-colors cursor-pointer"
                            title="ລົບລາຍການພັກບິນ"
                            aria-label={"ລົບລາຍການພັກບິນ " + order.label}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                          <button
                            id={`pending-tab-resume-${order.id}`}
                            onClick={() => {
                              onResumePendingOrder(order.id);
                              setShowPendingDialog(false);
                              showNotification(`ດຶງຄືນລາຍການ "${order.label}" ແລ້ວ`);
                            }}
                            className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-all cursor-pointer"
                            aria-label={"ດຶງຄືນລາຍການພັກບິນ " + order.label}
                            title="ດຶງຄືນລາຍການພັກບິນ"
                          >
                            <Play className="w-3 h-3" />
                            ດຶງຄືນ
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div className="border-t border-slate-100 pt-3 text-right">
              <button
                onClick={() => setShowPendingDialog(false)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs transition-colors cursor-pointer"
              >
                ປິດໜ້າຕ່າງ
              </button>
            </div>
          </div>
        </div>
      )}

      {printData && (
        <div id="print-receipt-section" className="hidden print:block p-4 font-mono text-[10px] text-black w-full">
            <div className="text-center mb-4">
                <h2 className="font-bold">{db.getSettings().shopName}</h2>
                <p>{db.getSettings().contact}</p>
                <p>Tel: {db.getSettings().phone}</p>
            </div>
            <div className="border-t border-b border-black py-2 mb-2">
                <p>Date: {new Date(printData.sale.timestamp).toLocaleString()}</p>
                <p>Sale ID: {printData.sale.id}</p>
            </div>
            <table className="w-full mb-4">
                <thead>
                    <tr>
                        <th className="text-left">Item</th>
                        <th className="text-right">Qty</th>
                        <th className="text-right">Price</th>
                        <th className="text-right">Total</th>
                    </tr>
                </thead>
                <tbody>
                    {printData.items.map(item => (
                        <tr key={item.id}>
                            <td>{item.name}</td>
                            <td className="text-right">{item.quantity}</td>
                            <td className="text-right">{item.price.toFixed(2)}</td>
                            <td className="text-right">{(item.price * item.quantity).toFixed(2)}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
            <div className="border-t border-black pt-2 text-right">
                <p>Subtotal: {printData.sale.subtotal?.toFixed(2)}</p>
                <p>Discount: {printData.sale.discountAmount?.toFixed(2)}</p>
                <p className="font-bold">Grand Total: {printData.sale.totalAmount.toFixed(2)}</p>
                <p>Payment: {printData.sale.paymentMethod}</p>
                <p>Paid: {printData.sale.amountTendered.toFixed(2)}</p>
                <p>Change: {printData.sale.changeGiven.toFixed(2)}</p>
            </div>
        </div>
      )}
      {showPaymentDialog && (
        <div id="pay-dialog-overlay" className="fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in">
          <div id="pay-dialog" className="bg-white border border-slate-100 rounded-3xl p-4 sm:p-6 w-full max-w-lg shadow-2xl flex flex-col gap-5 max-h-[92vh] overflow-y-auto">
            <div className="flex justify-between items-center border-b border-slate-100 pb-3">
              <div>
                <h3 className={"text-base font-bold " + (isRefundSale ? "text-amber-700" : "text-slate-800")}>
                  {isRefundSale ? "REFUND / ຄືນເງິນ" : "ຊຳລະໃບບິນ / ຄິດໄລ່ເງິນ"}
                </h3>
                <p className="text-[11px] text-slate-400 font-semibold">
                  {isRefundSale ? "ກວດສອບລາຍການທີ່ຈະຄືນເງິນ ແລະ ຢືນຢັນ Refund" : "ກວດສອບລາຍລະອຽດ ແລະ ດຳເນີນການຊຳລະ"}
                </p>
              </div>
              <button onClick={() => setShowPaymentDialog(false)} aria-label={isRefundSale ? "ປິດໜ້າຕ່າງ Refund" : "ປິດໜ້າຕ່າງຊຳລະເງິນ"} title="ປິດ" className="p-1 rounded hover:bg-slate-50 text-slate-400">
                <X className="w-5 h-5" />
              </button>
            </div>

            {isRefundSale && (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-semibold text-amber-800 leading-relaxed">
                REFUND ONLY: ການຢືນຢັນນີ້ຈະບັນທຶກເປັນລາຍການຄືນເງິນ ແລະ ປັບສະຕັອກກັບຄືນ.
              </div>
            )}

            {/* Bill Amount */}
            <div className={(isRefundSale ? "bg-amber-50 border-amber-200" : "bg-slate-50 border-slate-100") + " p-4 rounded-2xl flex flex-col gap-1.5 border"}>
              <div className="flex justify-between items-baseline text-xs text-slate-500 font-semibold">
                <span>ລວມຍອດສິນຄ້າ (Subtotal)</span>
                <span className="font-mono">₭{subtotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
              </div>
              
              {settings.vatEnabled && (
                <div className="flex justify-between items-baseline text-xs text-slate-500 font-semibold animate-fade-in">
                  <span>VAT ({settings.vatRate}%)</span>
                  <span className="font-mono text-slate-600">₭{vatAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                </div>
              )}

              {settings.xxxRateEnabled && (
                <div className="flex justify-between items-baseline text-xs text-slate-500 font-semibold animate-fade-in">
                  <span>{settings.xxxRateName} ({settings.xxxRate}%)</span>
                  <span className="font-mono text-slate-600">₭{xxxAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                </div>
              )}

              <div className="flex justify-between items-baseline border-t border-slate-200/60 pt-2 mt-1">
                <span className="text-xs font-bold text-slate-700">ຍອດລວມທີ່ຕ້ອງຊຳລະທັງໝົດ (Grand Total)</span>
                <span className="text-2xl font-bold text-blue-600 font-mono">
                  ₭{grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </span>
              </div>
            </div>

            {/* Membership picker (phone search) — only when enabled and not a refund */}
            {membershipEnabled && !isRefundSale && (
              <div className="rounded-2xl border border-blue-100 bg-blue-50/50 p-3 flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-blue-700">ສະມາຊິກ (Membership) — ບໍ່ບັງຄັບ</span>
                  {pointsToEarn > 0 && (
                    <span className="text-[11px] font-bold text-emerald-600">+{pointsToEarn.toLocaleString()} point</span>
                  )}
                </div>
                {selectedMember ? (
                  <div className="flex items-center justify-between bg-white rounded-xl border border-blue-200 px-3 py-2">
                    <div className="min-w-0">
                      <div className="text-sm font-bold truncate">{selectedMember.name}</div>
                      <div className="text-[11px] text-slate-500">{selectedMember.phone} · {Math.round(selectedMember.points).toLocaleString()} point</div>
                    </div>
                    <button onClick={() => { onSelectMember(null); setMemberSearch(""); }} className="text-slate-400 hover:text-rose-500 cursor-pointer" title="ຍົກເລີກ">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <div>
                    <input
                      type="tel"
                      inputMode="numeric"
                      placeholder="ຄົ້ນຫາດ້ວຍເບີໂທ..."
                      value={memberSearch}
                      onChange={e => setMemberSearch(e.target.value)}
                      className="w-full p-2 bg-white border border-blue-150 rounded-xl text-sm focus:outline-none focus:border-blue-500"
                    />
                    {memberSearch.trim() && (
                      <div className="mt-1.5 max-h-32 overflow-auto flex flex-col gap-1">
                        {members.filter(m => m.phone.includes(memberSearch.trim())).slice(0, 6).map(m => (
                          <button key={m.uid} onClick={() => { onSelectMember(m.uid!); setMemberSearch(""); }} className="text-left bg-white hover:bg-blue-50 border border-slate-100 rounded-lg px-3 py-1.5 cursor-pointer">
                            <span className="text-sm font-semibold">{m.name}</span>
                            <span className="text-[11px] text-slate-500 ml-2">{m.phone}</span>
                          </button>
                        ))}
                        {members.filter(m => m.phone.includes(memberSearch.trim())).length === 0 && (
                          <div className="text-[11px] text-slate-400 px-2 py-1">ບໍ່ພົບເບີໂທນີ້ (ເພີ່ມສະມາຊິກໃນແທັບ ສະມາຊິກ)</div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Payment Method Selector */}
            <div className="space-y-2">
              <span className="text-[11px] font-bold text-slate-500 block">ເລືອກຊ່ອງທາງການຊຳລະເງິນ (ສາມາດເລືອກທັງສອງເພື່ອແບ່ງຊຳລະ)</span>
              <div className="grid grid-cols-3 gap-3">
                <button
                   id="pay-method-cash"
                   onClick={() => {
                     if (paymentMethod === "TRANSFER") {
                       setPaymentMethod("SPLIT");
                       const half = roundMoney(grandTotal / 2);
                        setSplitTransferInput(formatMoneyInput(half));
                        setSplitCashTenderedInput(formatMoneyInput(roundMoney(grandTotal - half)));
                     } else if (paymentMethod === "SPLIT") {
                       setPaymentMethod("TRANSFER");
                     } else {
                       setPaymentMethod("CASH");
                     }
                   }}
                   className={`flex flex-col items-center gap-1.5 py-3 border rounded-2xl font-bold text-xs transition-all cursor-pointer ${
                     paymentMethod === "CASH" || paymentMethod === "SPLIT"
                       ? "bg-blue-50 border-blue-500 text-blue-700 shadow-sm shadow-blue-50"
                       : "bg-white border-slate-150 hover:bg-slate-50 text-slate-600"
                   }`}
                >
                  <Banknote className="w-5 h-5" />
                  <span>ເງິນສົດ</span>
                </button>
                <button
                   id="pay-method-transfer"
                   onClick={() => {
                     if (paymentMethod === "CASH") {
                       setPaymentMethod("SPLIT");
                       const half = roundMoney(grandTotal / 2);
                        setSplitTransferInput(formatMoneyInput(half));
                        setSplitCashTenderedInput(formatMoneyInput(roundMoney(grandTotal - half)));
                     } else if (paymentMethod === "SPLIT") {
                       setPaymentMethod("CASH");
                     } else {
                       setPaymentMethod("TRANSFER");
                     }
                   }}
                   className={`flex flex-col items-center gap-1.5 py-3 border rounded-2xl font-bold text-xs transition-all cursor-pointer ${
                     paymentMethod === "TRANSFER" || paymentMethod === "SPLIT"
                       ? "bg-blue-50 border-blue-500 text-blue-700 shadow-sm shadow-blue-50"
                       : "bg-white border-slate-150 hover:bg-slate-50 text-slate-600"
                   }`}
                >
                  <CreditCard className="w-5 h-5" />
                  <span>ໂອນເງິນ</span>
                </button>
                <button
                   id="pay-method-qr"
                   onClick={() => setPaymentMethod("QR")}
                   className={`flex flex-col items-center gap-1.5 py-3 border rounded-2xl font-bold text-xs transition-all cursor-pointer ${
                     paymentMethod === "QR"
                       ? "bg-blue-50 border-blue-500 text-blue-700 shadow-sm shadow-blue-50"
                       : "bg-white border-slate-150 hover:bg-slate-50 text-slate-600"
                   }`}
                >
                  <QrCode className="w-5 h-5" />
                  <span>BCEL One / QR</span>
                </button>
              </div>
            </div>

            {/* Payment Context Section */}
            {paymentMethod === "CASH" ? (
              <div className="space-y-4 animate-fade-in">
                <div className="space-y-1.5">
                  <span className="text-[11px] font-bold text-slate-500 block">ຈຳນວນເງິນສົດທີ່ຮັບມາ</span>
                  <div className="relative">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-bold text-slate-400 font-mono">₭</span>
                    <input
                      id="cash-tendered-input"
                      type="number"
                      placeholder="ປ້ອນຈຳນວນເງິນ..."
                      value={amountTenderedInput}
                      min="0"
                      step="0.01"
                      onChange={(e) => setAmountTenderedInput(e.target.value)}
                      onBlur={() => amountTenderedInput && setAmountTenderedInput(formatMoneyInput(parseMoneyInput(amountTenderedInput)))}
                      className="w-full pl-8 pr-4 py-2.5 border border-slate-200 rounded-xl text-sm font-bold font-mono focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                </div>

                {/* Cash fast click helpers */}
                <div className="flex gap-2 flex-wrap">
                  {[grandTotal, 10000, 20000, 50000, 100000].map(val => (
                    <button
                      id={`cash-helper-${val}`}
                      key={val}
                      onClick={() => setAmountTenderedInput(formatMoneyInput(val))}
                      className="px-3 py-1 bg-slate-100 hover:bg-slate-200 text-[11px] font-bold text-slate-600 rounded-lg border border-slate-200 transition-colors cursor-pointer"
                    >
                      ₭{Math.round(val).toLocaleString()}
                    </button>
                  ))}
                </div>

                {/* Change return details */}
                <div className="border-t border-slate-100 pt-3 flex justify-between items-baseline">
                  <span className="text-xs font-bold text-slate-500">ເງິນທອນ</span>
                  <span className={`text-lg font-bold font-mono ${changeDue > 0 ? "text-blue-600" : "text-slate-400"}`}>
                    ₭{changeDue.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </span>
                </div>
              </div>
            ) : paymentMethod === "SPLIT" ? (
              <div className="space-y-4 animate-fade-in border border-slate-100 rounded-2xl p-4 bg-slate-50/50">
                <span className="text-[11px] font-bold text-blue-700 block uppercase tracking-wider font-sans">ແບ່ງຊຳລະ (ເງິນສົດ + ໂອນເງິນ)</span>
                
                <div className="grid grid-cols-3 gap-3">
                  {/* Transfer portion input */}
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-slate-500">ຈຳນວນເງິນໂອນ</label>
                    <div className="relative">
                      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400 font-mono">₭</span>
                      <input
                        id="split-transfer-input"
                        type="number"
                        placeholder="ຈຳນວນໂອນ..."
                        value={splitTransferInput}
                        min="0"
                        step="0.01"
                        onChange={(e) => {
                          const val = e.target.value;
                          setSplitTransferInput(val);
                          const tVal = parseMoneyInput(val);
                          const remaining = roundMoney(Math.max(0, grandTotal - tVal));
                          setSplitCashTenderedInput(formatMoneyInput(remaining));
                        }}
                        onBlur={() => splitTransferInput && setSplitTransferInput(formatMoneyInput(parseMoneyInput(splitTransferInput)))}
                        className="w-full pl-6 pr-2 py-2 border border-slate-200 rounded-xl text-xs font-bold font-mono focus:outline-none focus:border-blue-500"
                      />
                    </div>
                  </div>

                  {/* Cash received input */}
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-slate-500">ຈຳນວນເງິນສົດທີ່ຮັບມາ</label>
                    <div className="relative">
                      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400 font-mono">₭</span>
                      <input
                        id="split-cash-tendered-input"
                        type="number"
                        placeholder="ປ້ອນເງິນສົດຮັບມາ..."
                        value={splitCashTenderedInput}
                        min="0"
                        step="0.01"
                        onChange={(e) => {
                          const val = e.target.value;
                          setSplitCashTenderedInput(val);
                          const cVal = parseMoneyInput(val);
                          const remaining = roundMoney(Math.max(0, grandTotal - cVal));
                          setSplitTransferInput(formatMoneyInput(remaining));
                        }}
                        onBlur={() => splitCashTenderedInput && setSplitCashTenderedInput(formatMoneyInput(parseMoneyInput(splitCashTenderedInput)))}
                        className="w-full pl-6 pr-2 py-2 border border-slate-200 rounded-xl text-xs font-bold font-mono focus:outline-none focus:border-blue-500"
                      />
                    </div>
                  </div>

                  {/* Change due (calculated) */}
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-slate-500">ເງິນທອນ (ເງິນສົດ)</label>
                    <div className="relative bg-white border border-slate-200 rounded-xl h-[34px] flex items-center px-2.5">
                      <span className={`text-xs font-extrabold font-mono ${
                        (parseFloat(splitCashTenderedInput) || 0) - Math.max(0, grandTotal - (parseFloat(splitTransferInput) || 0)) > 0
                          ? "text-blue-600"
                          : "text-slate-500"
                      }`}>
                        ₭{roundMoney(Math.max(0, parseMoneyInput(splitCashTenderedInput) - Math.max(0, grandTotal - parseMoneyInput(splitTransferInput)))).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Cash fast helpers for split cash received */}
                <div className="flex gap-1.5 flex-wrap border-t border-slate-100 pt-3">
                  {[Math.max(0, grandTotal - (parseFloat(splitTransferInput) || 0)), 10000, 20000, 50000, 100000].map(val => (
                    <button
                      id={`split-cash-helper-${val}`}
                      key={val}
                      type="button"
                      onClick={() => {
                        setSplitCashTenderedInput(formatMoneyInput(val));
                        const remaining = roundMoney(Math.max(0, grandTotal - val));
                        setSplitTransferInput(formatMoneyInput(remaining));
                      }}
                      className="px-2.5 py-1 bg-white hover:bg-slate-100 text-[10px] font-bold text-slate-600 rounded-lg border border-slate-200 transition-colors cursor-pointer"
                    >
                      ₭{Math.round(val).toLocaleString()}
                    </button>
                  ))}
                </div>

                {/* Bank transfer instructions for the transfer portion */}
                <div className="border-t border-slate-100 pt-3 space-y-1 text-[10px]">
                  <p className="font-bold text-slate-700">ທະນາຄານການຄ້າຕ່າງປະទេດລາວ (BCEL) - ໂອນສ່ວນທີ່ເຫຼືອ</p>
                  <p className="text-slate-600 font-sans">ຊື່ບັນຊີ: <strong className="text-slate-800 font-sans">ມະຫາຈື່ນ ສະລອຍນ້ຳ (Mahajuen)</strong> | ເລກບັນຊີ: <strong className="text-slate-800 font-mono">160-12-00-01234567-001</strong></p>
                </div>
              </div>
            ) : paymentMethod === "QR" ? (
              <div className="flex flex-col items-center gap-2 py-2 text-center animate-fade-in">
                {qrCodeUrl ? (
                  <img id="qr-payment-image" src={qrCodeUrl} alt="LaoQR Bill payment" className="w-[180px] h-[180px] object-contain border border-slate-150 p-2 rounded-2xl bg-white" />
                ) : (
                  <div className="w-[180px] h-[180px] bg-slate-100 animate-pulse rounded-2xl border border-slate-150 flex items-center justify-center">
                    <QrCode className="w-8 h-8 text-slate-300" />
                  </div>
                )}
                <span className="text-[10px] font-bold text-slate-500 mt-1 uppercase tracking-wider">ກະລຸນາສະແກນ LaoQR ນີ້ດ້ວຍແອັບທະນາຄານຂອງທ່ານ</span>
                <p className="text-[10px] text-slate-400 max-w-xs font-medium">ຍອດເງິນຄິດໄລ່ອັດຕະໂນມັດ: ₭{grandTotal.toLocaleString()}</p>
              </div>
            ) : (
              <div className="border border-slate-100 rounded-2xl p-4 bg-slate-50 text-slate-700 space-y-2 animate-fade-in">
                <span className="text-[10px] font-bold text-slate-400 block tracking-wider">ຂໍ້ມູນບັນຊີທະນາຄານ</span>
                <div className="space-y-1 text-xs">
                  <p className="font-bold text-slate-800">ທະນາຄານການຄ້າຕ່າງປະເທດລາວ (BCEL)</p>
                  <p className="font-medium text-slate-600 font-sans">ຊື່ບັນຊີ: <strong className="text-slate-800 font-sans">ມະຫາຈື່ນ ສະລອຍນ້ຳ (Mahajuen)</strong></p>
                  <p className="font-medium text-slate-600 font-mono">ເລກບັນຊີ: <strong className="text-slate-800">160-12-00-01234567-001</strong></p>
                  <p className="text-[10px] text-slate-400 font-semibold italic pt-1">
                    {isRefundSale ? "REFUND: ກວດສອບຍອດໂອນ/ຄືນເງິນໃຫ້ຖືກຕ້ອງກ່ອນຢືນຢັນ." : "ກະລຸນາກວດສອບຍອດໂອນໃຫ້ຖືກຕ້ອງກ່ອນກົດສຳເລັດການຂາຍ."}
                  </p>
                </div>
              </div>
            )}

            {/* Bottom Complete Buttons with Export/Printing at the Green Mark */}
            <div className="flex justify-between items-center border-t border-slate-100 pt-3">
              <div className="flex flex-wrap gap-2">
                <button
                  id="pay-dialog-print-draft"
                  type="button"
                  onClick={() => {
                    printReceiptNow(buildCurrentPaymentDraftSale(), "Invoice");
                    setPrintData(null);
                  }}
                  className="flex items-center gap-1.5 px-3.5 py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-xl text-xs font-bold border border-emerald-200 transition-all cursor-pointer shadow-sm"
                  title="ພິມໃບບິນ"
                >
                  <Printer className="w-4 h-4 text-emerald-600" />
                  <span>ພິມໃບບິນ</span>
                </button>
                <button
                  id="pay-dialog-share-png"
                  type="button"
                  onClick={() => shareReceiptPngNow(buildCurrentPaymentDraftSale(), "Invoice")}
                  disabled={isSharingReceipt}
                  className="flex items-center gap-1.5 px-3.5 py-2 bg-sky-50 hover:bg-sky-100 disabled:opacity-50 text-sky-700 rounded-xl text-xs font-bold border border-sky-200 transition-all cursor-pointer shadow-sm disabled:cursor-not-allowed"
                  title="ແຊຣ໌ PNG ໃບບິນ"
                >
                  <Share2 className="w-4 h-4 text-sky-600" />
                  <span>{isSharingReceipt ? "PNG..." : "ແຊຣ໌ PNG"}</span>
                </button>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => setShowPaymentDialog(false)}
                  className="px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-600 font-semibold hover:bg-slate-100 transition-all cursor-pointer"
                >
                  ຍົກເລີກ
                </button>
                <button
                  id="pos-pay-confirm"
                  onClick={() => handleCheckoutComplete(isRefundSale)}
                  className={`px-5 py-2 ${isRefundSale ? "bg-amber-500 hover:bg-amber-600 shadow-amber-550" : "bg-blue-600 hover:bg-blue-700 shadow-blue-550"} text-white rounded-xl text-xs font-bold transition-all shadow-md cursor-pointer`}
                >
                  {isRefundSale ? "ຢືນຢັນການຄືນເງິນ" : "ຢືນຢັນການຊຳລະ"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
