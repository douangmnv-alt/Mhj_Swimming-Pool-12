/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as XLSX from "xlsx";
import html2canvas from "html2canvas";
import { effectivePrice, MenuItem, SaleWithItems } from "../types";
import { db } from "./db";

export type ReceiptPngShareResult = "shared" | "downloaded" | "cancelled";

const safeFileName = (name: string) => {
  let cleaned = name;
  ["\\", "/", ":", "*", "?", "\"", "<", ">", "|"].forEach(ch => {
    cleaned = cleaned.split(ch).join("-");
  });
  return cleaned;
};

const stripReceiptScripts = (html: string) =>
  html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");

const nextFrame = () =>
  new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });

const waitForReceiptImages = async (root: ParentNode) => {
  const images = Array.from(root.querySelectorAll("img"));
  await Promise.all(
    images.map(
      (image) =>
        new Promise<void>((resolve) => {
          if (image.complete) {
            resolve();
            return;
          }
          const done = () => resolve();
          image.addEventListener("load", done, { once: true });
          image.addEventListener("error", done, { once: true });
          window.setTimeout(done, 2500);
        })
    )
  );
};

const waitForReceiptReady = async (doc: Document, root: ParentNode) => {
  const fonts = (doc as Document & { fonts?: FontFaceSet }).fonts;
  if (fonts?.ready) {
    await fonts.ready.catch(() => undefined);
  }
  await waitForReceiptImages(root);
  await nextFrame();
};

const withTimeout = <T,>(promise: Promise<T>, timeoutMs: number, message: string) =>
  new Promise<T>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => reject(new Error(message)), timeoutMs);
    promise
      .then((value) => {
        window.clearTimeout(timeoutId);
        resolve(value);
      })
      .catch((error) => {
        window.clearTimeout(timeoutId);
        reject(error);
      });
  });

const canvasToPngBlob = (canvas: HTMLCanvasElement) =>
  new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error("Could not create receipt PNG."));
      }
    }, "image/png");
  });

const renderReceiptHtmlToPngBlob = async (receiptHtml: string) => {
  const sourceDoc = new DOMParser().parseFromString(stripReceiptScripts(receiptHtml), "text/html");
  const style = document.createElement("style");
  style.textContent = [
    Array.from(sourceDoc.querySelectorAll("style"))
      .map((styleNode) => styleNode.textContent || "")
      .join("\n")
      .replace(/(^|\n|\})\s*body\s*\{/g, "$1 .receipt-png-root {"),
    ".receipt-png-root { display: inline-block !important; margin: 0 !important; background: #fff !important; box-sizing: border-box !important; }",
    ".receipt-png-root .no-print { display: none !important; }",
    ".receipt-png-root * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }"
  ].join("\n");

  const root = document.createElement("div");
  root.className = "receipt-png-root";
  root.setAttribute("aria-hidden", "true");
  root.innerHTML = sourceDoc.body.innerHTML;
  root.querySelectorAll(".no-print, script").forEach((node) => node.remove());
  root.style.position = "fixed";
  root.style.left = "-10000px";
  root.style.top = "0";
  root.style.zIndex = "-1";
  root.style.pointerEvents = "none";
  document.head.appendChild(style);
  document.body.appendChild(root);

  try {
    await waitForReceiptReady(document, root);

    const width = Math.ceil(Math.max(root.scrollWidth, root.offsetWidth, 1));
    const height = Math.ceil(Math.max(root.scrollHeight, root.offsetHeight, 1));
    await nextFrame();

    const canvas = await withTimeout(
      html2canvas(root, {
        backgroundColor: "#ffffff",
        scale: Math.min(3, Math.max(2, window.devicePixelRatio || 1)),
        useCORS: true,
        allowTaint: false,
        logging: false,
        width,
        height,
        windowWidth: width + 8,
        windowHeight: height + 8,
        scrollX: 0,
        scrollY: 0
      }),
      12000,
      "Receipt PNG took too long to create."
    );

    return canvasToPngBlob(canvas);
  } finally {
    document.body.removeChild(root);
    document.head.removeChild(style);
  }
};

export const shareReceiptHtmlAsPng = async (
  receiptHtml: string,
  fileNameBase: string,
  title = "Receipt"
): Promise<ReceiptPngShareResult> => {
  const fileName = `${safeFileName(fileNameBase || title || "receipt")}.png`;
  const blob = await renderReceiptHtmlToPngBlob(receiptHtml);
  const file = new File([blob], fileName, { type: "image/png" });
  const shareData: ShareData = {
    title,
    files: [file]
  };
  const nav = navigator as Navigator & {
    canShare?: (data: ShareData) => boolean;
    share?: (data: ShareData) => Promise<void>;
  };

  if (typeof nav.share === "function" && (typeof nav.canShare !== "function" || nav.canShare(shareData))) {
    try {
      await nav.share(shareData);
      return "shared";
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return "cancelled";
      }
      console.warn("Receipt PNG share failed; downloading instead.", error);
    }
  }

  triggerDownload(blob, fileName, "image/png");
  return "downloaded";
};

const triggerDownload = (content: BlobPart | Blob, fileName: string, mimeType: string) => {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = safeFileName(fileName);
  link.rel = "noopener";
  link.style.display = "none";
  document.body.appendChild(link);
  try {
    link.click();
  } finally {
    document.body.removeChild(link);
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }
};

const downloadWorkbook = (workbook: XLSX.WorkBook, fileName: string) => {
  const workbookData = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
  triggerDownload(
    new Blob([workbookData], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    fileName,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
};

const escapeHtml = (value: unknown) => String(value ?? "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&#39;");

const CODE128_PATTERNS = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213",
  "221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132",
  "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211",
  "212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331",
  "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111",
  "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214",
  "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141",
  "214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141",
  "114131", "311141", "411131", "211412", "211214", "211232", "2331112"
] as const;

const barcodeCode128BValue = (char: string) => {
  const code = char.charCodeAt(0);
  if (code < 32 || code > 126) {
    throw new Error("Barcode supports English letters, numbers, and common symbols only.");
  }
  return code - 32;
};

const buildCode128BSvg = (rawValue: string) => {
  const value = rawValue.trim();
  if (!value) {
    throw new Error("This product does not have a barcode.");
  }

  const codes = [104, ...Array.from(value).map(barcodeCode128BValue)];
  const checksum = codes.reduce((sum, code, index) => sum + (index === 0 ? code : code * index), 0) % 103;
  const patterns = [...codes.map(code => CODE128_PATTERNS[code]), CODE128_PATTERNS[checksum], CODE128_PATTERNS[106]];
  const quietZone = 10;
  let x = quietZone;
  const rects: string[] = [];

  patterns.forEach(pattern => {
    Array.from(pattern).forEach((widthChar, index) => {
      const width = Number(widthChar);
      if (index % 2 === 0) {
        rects.push(`<rect x="${x}" y="0" width="${width}" height="48" />`);
      }
      x += width;
    });
  });

  const viewBoxWidth = x + quietZone;
  return `<svg role="img" aria-label="${escapeHtml(value)}" viewBox="0 0 ${viewBoxWidth} 48" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg"><rect width="${viewBoxWidth}" height="48" fill="#fff" />${rects.join("")}</svg>`;
};

const buildBarcodeLabelsHtml = (labels: Array<{ item: MenuItem; quantity: number }>, autoPrint = true) => {
  const labelPages: string[] = [];

  labels.forEach(({ item, quantity }) => {
    const barcode = (item.barcode || "").trim();
    const barcodeSvg = buildCode128BSvg(barcode);
    const price = Number(effectivePrice(item) || 0).toLocaleString();
    const copyCount = Math.max(1, Math.min(999, Math.floor(quantity || 1)));

    for (let copy = 0; copy < copyCount; copy += 1) {
      labelPages.push([
        "<section class=\"barcode-label\">",
        "<div class=\"label-head\">",
        "<div class=\"label-name\">" + escapeHtml(item.name) + "</div>",
        "<div class=\"label-price\">₭" + escapeHtml(price) + "</div>",
        "</div>",
        "<div class=\"label-bars\">" + barcodeSvg + "</div>",
        "<div class=\"label-code\">" + escapeHtml(barcode) + "</div>",
        "</section>"
      ].join(""));
    }
  });

  const autoPrintScript = autoPrint
    ? "<script>window.addEventListener(\"afterprint\",function(){setTimeout(function(){window.close();},500);});window.addEventListener(\"load\",function(){setTimeout(function(){window.focus();window.print();},500);});</script>"
    : "";

  return [
    "<!doctype html>",
    "<html lang=\"lo\">",
    "<head>",
    "<meta charset=\"utf-8\" />",
    "<title>20mm Barcode Labels</title>",
    "<style>",
    "@page { size: 50mm 20mm; margin: 0; }",
    "html, body { margin: 0; padding: 0; background: #fff; }",
    "body { font-family: 'Noto Sans Lao', Arial, sans-serif; color: #111827; }",
    ".barcode-label { width: 50mm; height: 20mm; box-sizing: border-box; padding: 0.8mm 1.5mm 0.5mm; overflow: hidden; break-after: page; page-break-after: always; background: #fff; }",
    ".label-head { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 1.1mm; align-items: start; height: 4.5mm; }",
    ".label-name { font-size: 6px; line-height: 1.05; font-weight: 700; max-height: 4.4mm; overflow: hidden; word-break: break-word; }",
    ".label-price { font-family: Arial, sans-serif; font-size: 7.5px; line-height: 1; font-weight: 700; white-space: nowrap; }",
    ".label-bars { height: 7.4mm; margin-top: 0.25mm; }",
    ".label-bars svg { display: block; width: 100%; height: 100%; shape-rendering: crispEdges; }",
    ".label-code { font-family: Arial, sans-serif; font-size: 12px; line-height: 1; text-align: center; letter-spacing: 0; white-space: nowrap; overflow: hidden; margin-top: 0.15mm; }",
    "@media screen { body { background: #e2e8f0; padding: 12px; } .barcode-label { border: 1px solid #cbd5e1; margin: 0 auto 8px; } }",
    "</style>",
    "</head>",
    "<body>",
    labelPages.join(""),
    autoPrintScript,
    "</body>",
    "</html>"
  ].join("\n");
};

const openPrintWindow = (html: string, title: string) => {
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
    alert("Please allow popups to print.");
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
        console.error("Print failed", error);
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
  return true;
};

export const exporters = {
  // ── CSV EXPORT ───────────────────────────────────────────────
  exportToCSV(salesList: SaleWithItems[], dateRangeString: string) {
    const csvRows = [
      ["Sales Report", dateRangeString],
      ["Generated", new Date().toLocaleString()],
      [],
      ["Transaction ID", "Date/Time", "Items Sold", "Total Amount"]
    ];

    let totalSales = 0;
    salesList.forEach(item => {
      const itemsSummary = item.items
        .map(it => `${it.name} x${it.quantity} (₭${it.price.toFixed(2)})`)
        .join("; ");
      
      csvRows.push([
        item.sale.id.toString(),
        new Date(item.sale.timestamp).toLocaleString(),
        itemsSummary,
        `₭${item.sale.totalAmount.toFixed(2)}`
      ]);
      totalSales += item.sale.totalAmount;
    });

    csvRows.push([]);
    csvRows.push(["", "", "GRAND TOTAL", `₭${totalSales.toFixed(2)}`]);

    const csvContent = csvRows.map(e => e.map(val => `"${val.replace(/"/g, '""')}"`).join(",")).join("\n");
    
    const formattedRange = dateRangeString.replace(/\s+/g, "_").replace(/\//g, "-");
    triggerDownload("\uFEFF" + csvContent, `Sales_Report_${formattedRange}.csv`, "text/csv;charset=utf-8;");
  },

  // ── EXCEL EXPORT ─────────────────────────────────────────────
  exportToExcel(salesList: SaleWithItems[], dateRangeString: string) {
    const formattedData = salesList.map(item => {
      const itemsSummary = item.items
        .map(it => `${it.name} x${it.quantity} @ ₭${it.price.toFixed(2)}`)
        .join("\n");
      const totalQty = item.items.reduce((sum, it) => sum + it.quantity, 0);

      return {
        "Sale ID": item.sale.id,
        "Date / Time": new Date(item.sale.timestamp).toLocaleString(),
        "Items Sold": itemsSummary,
        "Qty": totalQty,
        "Total Amount (₭)": item.sale.totalAmount
      };
    });

    const ws = XLSX.utils.json_to_sheet(formattedData);
    
    // Add columns widths for Excel
    ws["!cols"] = [
      { wch: 10 }, // Sale ID
      { wch: 25 }, // Date / Time
      { wch: 45 }, // Items Sold
      { wch: 8 },  // Qty
      { wch: 18 }  // Total Amount
    ];

    // Create Workbook
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Sales Report");
    
    const formattedRange = dateRangeString.replace(/\s+/g, "_").replace(/\//g, "-");
    downloadWorkbook(wb, `Sales_Report_${formattedRange}.xlsx`);
  },

  // ── RECEIPT PRINT ────────────────────────────────────────────
  buildReceiptHtml(saleWithItems: SaleWithItems) {
    const sale = saleWithItems.sale;
    const items = saleWithItems.items;
    const dateStr = new Date(sale.timestamp).toLocaleString();
    const settings = db.getSettings();
    const paperSize = settings.receiptPaperSize === "58mm" ? "58mm" : "80mm";
    const isNarrowPaper = paperSize === "58mm";
    const receiptWidth = isNarrowPaper ? "52mm" : "74mm";
    const bodyPadding = isNarrowPaper ? "4mm 2mm" : "5mm 2mm";
    const bodyFontSize = isNarrowPaper ? "12px" : "11px";
    const titleFontSize = isNarrowPaper ? "15px" : "16px";
    const itemQtyWidth = isNarrowPaper ? "26px" : "36px";
    const itemPriceWidth = isNarrowPaper ? "78px" : "64px";
    const totalAmountWidth = isNarrowPaper ? "90px" : "112px";
    const totalFontSize = isNarrowPaper ? bodyFontSize : "13px";
    const totalAmountFontSize = isNarrowPaper ? "10px" : "13px";
    const grandFontSize = isNarrowPaper ? "13px" : "15px";
    const grandAmountFontSize = isNarrowPaper ? "11px" : "15px";
    const logoMaxHeight = isNarrowPaper ? "55px" : "75px";
    const qrMaxWidth = isNarrowPaper ? "221px" : "170px";
    const qrImageStyle = isNarrowPaper
      ? `max-width: ${qrMaxWidth}; aspect-ratio: 1; object-fit: contain; background: #fff; padding: 3px; filter: contrast(0.85) brightness(1.12); opacity: 0.9;`
      : `max-width: ${qrMaxWidth}; aspect-ratio: 1; border: 1px solid #ddd; padding: 4px; border-radius: 4px;`;
    const itemMoney = (value: number) => `${isNarrowPaper ? "₭" : ""}${Math.round(value || 0).toLocaleString()}`;


    const itemsHtml = items
      .map(
        it => {
          const unitPrice = Number(it.price || 0);
          const quantity = Number(it.quantity || 0);
          const lineTotal = unitPrice * quantity;
          const originalRow = (it.originalPrice && it.originalPrice > it.price)
            ? `<div class="receipt-row receipt-discount-row">
                 <span>Orig: ₭${it.originalPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })} (-${it.discountType === "PERCENT" ? `${it.discountValue}%` : `₭${it.discountValue?.toLocaleString()}`})</span>
                 <span>Disc: -₭${(it.discountAmount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
               </div>`
            : "";
          if (isNarrowPaper) {
            return `
              <div class="receipt-row receipt-row-narrow">
                <div class="receipt-item-desc">${it.name}</div>
                <div class="receipt-item-detail">
                  <span>${quantity.toLocaleString()} x ${itemMoney(unitPrice)}</span>
                  <span class="receipt-item-fill"></span>
                  <span class="receipt-item-total">${itemMoney(lineTotal)}</span>
                </div>
              </div>
              ${originalRow}
            `;
          }
          return `
            <div class="receipt-row receipt-row-wide">
              <span class="receipt-wide-name">${it.name}</span>
              <span class="receipt-item-qty">${quantity.toLocaleString()}</span>
              <span class="receipt-item-price">${itemMoney(unitPrice)}</span>
              <span class="receipt-item-total">${itemMoney(lineTotal)}</span>
            </div>
            ${originalRow}
          `;
        }
      )
      .join("");
    const itemsHeaderHtml = isNarrowPaper ? "" : `
            <div class="receipt-row receipt-row-wide receipt-row-wide-head">
              <span class="receipt-wide-name">ເມນູ (MENU)</span>
              <span class="receipt-item-qty">ຈນ. (QTY)</span>
              <span class="receipt-item-price">ລາຄາ (PR)</span>
              <span class="receipt-item-total">ລວມ (TOTAL)</span>
            </div>
          `;
    const itemsStartSeparatorHtml = isNarrowPaper ? `<div class="separator"></div>` : "";
    const itemsEndSeparatorHtml = isNarrowPaper ? `<div class="separator"></div>` : `<div class="receipt-wide-table-end"></div>`;

    // Calculate dynamic tax breakdown for drafts or fetch from sale
    let subtotal = sale.subtotal || 0;
    let vatAmount = sale.vatAmount || 0;
    let xxxAmount = sale.xxxAmount || 0;
    let xxxName = sale.xxxName || "";
    let grandTotal = sale.totalAmount;

    if (sale.id === 0) {
      subtotal = sale.totalAmount; // Draft sale has raw sum in totalAmount
      vatAmount = settings.vatEnabled ? subtotal * (settings.vatRate / 100) : 0;
      xxxAmount = settings.xxxRateEnabled ? subtotal * (settings.xxxRate / 100) : 0;
      xxxName = settings.xxxRateEnabled ? settings.xxxRateName : "";
      grandTotal = subtotal + vatAmount + xxxAmount;
    } else {
      // Historical or stored sales
      if (sale.subtotal === undefined) {
        // Fallback for older transactions before breakdown fields
        subtotal = sale.totalAmount;
      }
    }

    const hasBreakdown = (sale.id === 0 && (settings.vatEnabled || settings.xxxRateEnabled)) || 
                          (sale.id !== 0 && (vatAmount > 0 || xxxAmount > 0));
    const receiptHtml = `
      <html>
        <head>
          <title>Receipt_Sale_${sale.id}</title>
          <link rel="preconnect" href="https://fonts.googleapis.com">
          <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
          <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Lao:wght@400;500;700&display=swap" rel="stylesheet">
          <style>
            @page {
              size: ${paperSize} auto;
              margin: 0;
            }
            body {
              width: ${receiptWidth};
              margin: 0 auto;
              padding: ${bodyPadding};
              font-family: 'Noto Sans Lao', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
              color: #000;
              background: #fff;
              font-size: ${bodyFontSize};
              line-height: 1.35;
            }
            .center {
              text-align: center;
            }
            .print-action {
              display: block;
              width: 100%;
              margin: 14px 0 6px;
              padding: 10px;
              border: 1px solid #111;
              border-radius: 6px;
              background: #111;
              color: #fff;
              font-weight: 700;
              cursor: pointer;
            }
            .bold {
              font-weight: bold;
            }
            .header-title {
              font-size: ${titleFontSize};
              margin: 4px 0;
              font-weight: 700;
              line-height: 1.2;
            }
            .separator {
              border-top: 1px dashed #000;
              margin: 8px 0;
              width: 100%;
            }
            .receipt-row {
              display: flex;
              justify-content: space-between;
              margin: 3px 0;
              align-items: center;
            }
            .receipt-row-narrow {
              display: block;
              margin: 7px 0;
            }
            .receipt-row-wide {
              display: grid;
              grid-template-columns: minmax(0, 1fr) 36px 64px 84px;
              gap: 5px;
              align-items: start;
              font-size: 16px;
              line-height: 1.15;
              margin: 6px 0;
            }
            .receipt-row-wide-head {
              border-top: 2px solid #98a2b3;
              border-bottom: 1px solid #cbd5e1;
              padding: 5px 0 4px;
              margin: 7px 0 9px;
              font-size: 8px;
              line-height: 1.1;
              font-weight: 800;
              color: #000;
            }
            .receipt-row-wide-head .receipt-wide-name,
            .receipt-row-wide-head .receipt-item-qty,
            .receipt-row-wide-head .receipt-item-price,
            .receipt-row-wide-head .receipt-item-total {
              font-family: 'Noto Sans Lao', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
              font-weight: 800;
              white-space: nowrap;
            }
            .receipt-item-desc {
              flex: 1;
              min-width: 0;
              overflow-wrap: anywhere;
              padding-right: 4px;
              font-weight: 500;
            }
            .receipt-row-narrow .receipt-item-desc {
              padding-right: 0;
              font-size: 14px;
              font-weight: 400;
              line-height: 1.25;
            }
            .receipt-item-detail {
              display: grid;
              grid-template-columns: auto 1fr auto;
              gap: 4px;
              align-items: end;
              margin-top: 2px;
              font-family: ${isNarrowPaper ? "Arial, 'Noto Sans Lao', sans-serif" : "'Courier New', 'Noto Sans Lao', Courier, monospace"};
              font-size: 13px;
              font-weight: ${isNarrowPaper ? "400" : "inherit"};
              line-height: 1.2;
              white-space: nowrap;
            }
            .receipt-item-fill {
              border-bottom: 1px dotted #000;
              min-width: 12px;
              transform: translateY(-3px);
            }
            .receipt-item-total {
              font-weight: ${isNarrowPaper ? "400" : "700"};
            }
            .receipt-wide-name {
              min-width: 0;
              overflow-wrap: anywhere;
              word-break: break-word;
              font-weight: 400;
            }
            .receipt-item-qty {
              width: ${itemQtyWidth};
              text-align: center;
              font-family: 'Noto Sans Lao', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
              font-weight: ${isNarrowPaper ? "800" : "400"};
              white-space: nowrap;
              font-variant-numeric: tabular-nums;
            }
            .receipt-item-price {
              width: ${itemPriceWidth};
              text-align: right;
              font-family: 'Noto Sans Lao', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
              font-weight: ${isNarrowPaper ? "800" : "400"};
              white-space: nowrap;
              font-variant-numeric: tabular-nums;
            }
            .receipt-row-wide .receipt-item-total {
              text-align: right;
              font-family: 'Noto Sans Lao', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
              font-weight: 400;
              white-space: nowrap;
              font-variant-numeric: tabular-nums;
            }
            .receipt-wide-table-end {
              border-top: 2px solid #98a2b3;
              margin: 8px 0;
            }
            .receipt-discount-row {
              font-size: ${isNarrowPaper ? "11px" : "9px"};
              color: #555;
              gap: 4px;
              margin-top: -2px;
              padding-left: ${isNarrowPaper ? "4px" : "10px"};
            }
            .receipt-discount-row span:first-child {
              min-width: 0;
              overflow-wrap: anywhere;
            }
            .totals-section {
              margin-top: 8px;
            }
            .totals-row {
              display: flex;
              justify-content: space-between;
              gap: 8px;
              font-size: ${totalFontSize};
              margin: 3px 0;
              align-items: center;
              line-height: 1.35;
            }
            .totals-row span:first-child {
              min-width: 0;
              overflow-wrap: anywhere;
            }
            .totals-row span:last-child {
              width: ${totalAmountWidth};
              text-align: right;
              font-family: ${isNarrowPaper ? "Arial, 'Noto Sans Lao', sans-serif" : "'Noto Sans Lao', -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, sans-serif"};
              font-size: ${totalAmountFontSize};
              font-weight: ${isNarrowPaper ? "400" : "500"};
              white-space: nowrap;
              font-variant-numeric: tabular-nums;
            }
            .totals-row.font-large {
              ${isNarrowPaper ? "display: block;" : ""}
              font-size: ${grandFontSize};
              margin: 5px 0;
            }
            .totals-row.font-large span:last-child {
              ${isNarrowPaper ? "display: block; width: 100%; margin-top: 2px;" : ""}
              font-size: ${grandAmountFontSize};
            }
            ${isNarrowPaper ? ".totals-row.font-large .bold { font-weight: 400; }" : ""}
            .footer-msg {
              margin-top: 15px;
              font-size: 10px;
            }
            @media print {
              body {
                width: ${receiptWidth};
              }
              .no-print {
                display: none;
              }
            }
          </style>
        </head>
        <body>
          <button class="print-action no-print" onclick="window.print()">Print ${paperSize} Receipt</button>
          <div class="center">
            ${settings.logoUrl ? `
              <div style="margin-bottom: 8px;">
                <img src="${settings.logoUrl}" style="max-height: ${logoMaxHeight}; max-width: 100%; border-radius: 6px;" referrerPolicy="no-referrer" />
              </div>
            ` : ""}
            <h1 class="bold header-title">${settings.shopName}</h1>
            <div>Tel: ${settings.phone}</div>
            ${settings.contact ? `<div style="font-size: 10px; color: #555; max-width: 100%; word-break: break-word;">${settings.contact}</div>` : ""}
            <div class="bold" style="margin-top: 5px;">${sale.id === 0 ? "INVOICE / ໃບບິນ" : "RECEIPT / ໃບບິນຮັບເງິນ"}</div>
            ${sale.id === 0 ? "" : `<div>Sale #${sale.id}</div>`}
            <div>${dateStr}</div>
          </div>

          ${itemsStartSeparatorHtml}

          <div class="items-list">
            ${itemsHeaderHtml}
            ${itemsHtml}
          </div>

          ${itemsEndSeparatorHtml}

          <div class="totals-section">
            ${sale.paymentMethod === "DRAFT" ? "" : `
            <div class="totals-row">
              <span>Payment:</span>
              <span class="bold">${
                sale.paymentMethod === "CASH"
                  ? "Cash / ເງິນສົດ"
                  : sale.paymentMethod === "TRANSFER"
                    ? "Transfer / ໂອນເງິນ"
                    : sale.paymentMethod === "SPLIT"
                      ? "Split / ແບ່ງຊຳລະ (ສົດ+ໂອນ)"
                      : "LaoQR / ໂອນຜ່ານ QR"
              }</span>
            </div>`}

            ${hasBreakdown ? `
              <div class="totals-row">
                <span>Subtotal / ລວມ:</span>
                <span>₭${subtotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
              </div>
            ` : ""}

            ${(sale.discountAmount && sale.discountAmount > 0) ? `
              <div class="totals-row" style="color: #000;">
                <span>Discount / ສ່ວນຫຼຸດບິນ:</span>
                <span>-₭${sale.discountAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
              </div>
            ` : ""}

            ${vatAmount > 0 ? `
              <div class="totals-row">
                <span>VAT (${settings.vatRate}%):</span>
                <span>₭${vatAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
              </div>
            ` : ""}

            ${xxxAmount > 0 ? `
              <div class="totals-row">
                <span>${xxxName || 'Charge'} (${settings.xxxRate}%):</span>
                <span>₭${xxxAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
              </div>
            ` : ""}

            <div class="totals-row font-large">
              <span class="bold">TOTAL / ທັງໝົດ:</span>
              <span class="bold">₭${grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
            </div>

            ${sale.paymentMethod === "DRAFT" ? "" : `
            <div class="totals-row">
              <span>Tendered / ຮັບມາ:</span>
              <span>₭${(sale.id === 0 ? grandTotal : sale.amountTendered).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
            </div>
            <div class="totals-row">
              <span>Change / ເງິນທອນ:</span>
              <span>₭${(sale.id === 0 ? 0 : sale.changeGiven).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
            </div>`}
          </div>

          <div class="separator"></div>

          ${settings.qrCodeUrl ? `
            <div class="center" style="margin: 8px 0 4px 0;">
              <div class="bold" style="font-size: 9px; margin-bottom: 4px; letter-spacing: 0.5px;">Scan to Pay / ສະແກນຊຳລະເງິນ</div>
              <img src="${settings.qrCodeUrl}" style="${qrImageStyle}" referrerPolicy="no-referrer" />
            </div>
          ` : ""}

          <div class="separator"></div>

          <div class="center footer-msg">
            <div class="bold">Thank you for your business!</div>
            <div>Please come again</div>
          </div>

        </body>
      </html>
    `;

    return {
      html: receiptHtml,
      title: sale.id === 0 ? "Invoice" : "Receipt Sale " + sale.id,
      fileBase: sale.id === 0 ? "Invoice" : "Receipt_Sale_" + sale.id
    };
  },

  printReceipt(saleWithItems: SaleWithItems) {
    const receipt = exporters.buildReceiptHtml(saleWithItems);
    openPrintWindow(receipt.html, receipt.title);
  },

  shareReceiptPng(saleWithItems: SaleWithItems) {
    const receipt = exporters.buildReceiptHtml(saleWithItems);
    return shareReceiptHtmlAsPng(receipt.html, receipt.fileBase, receipt.title);
  },

  printBarcodeLabels(labels: Array<{ item: MenuItem; quantity: number }>) {
    const printableLabels = labels.filter(({ item, quantity }) => item.barcode?.trim() && quantity > 0);
    if (printableLabels.length === 0) {
      throw new Error("No products with barcode were selected for label printing.");
    }
    openPrintWindow(buildBarcodeLabelsHtml(printableLabels), "20mm Barcode Labels");
  },

  downloadBarcodeLabelsFile(menuItems: MenuItem[]) {
    const printableLabels = menuItems
      .filter(item => item.barcode?.trim())
      .map(item => ({ item, quantity: 1 }));

    if (printableLabels.length === 0) {
      throw new Error("No products with barcode were found for label export.");
    }

    const fileDate = new Date().toISOString().slice(0, 10);
    triggerDownload(
      buildBarcodeLabelsHtml(printableLabels, false),
      `Barcode_Labels_20mm_${fileDate}.html`,
      "text/html;charset=utf-8"
    );

    return {
      exportedCount: printableLabels.length,
      skippedCount: menuItems.length - printableLabels.length
    };
  },

  // ── STOCK EXCEL EXPORT ──────────────────────────────────────────
  exportStockToExcel(menuItems: any[]) {
    const formattedData = menuItems.map(item => {
      const isOutOfStock = item.stockQty <= 0;
      const isLowStock = !isOutOfStock && item.stockQty <= item.lowStockThreshold;
      const status = isOutOfStock ? "ໝົດສະຕັອກ (Out of Stock)" : isLowStock ? "ສະຕັອກໜ້ອຍ (Low Stock)" : "ປົກກະຕິ (In Stock)";

      return {
        "ລະຫັດສິນຄ້າ (ID)": item.id,
        "ຊື່ສິນຄ້າ (Product Name)": item.name,
        "ບາໂຄດ (Barcode)": item.barcode || "ບໍ່ມີ",
        "ໝວດໝູ່ (Category)": item.category || "General",
        "ລາຄາ (Price)": item.price,
        "ຈຳນວນຄົງເຫຼືອ (Stock Qty)": item.stockQty,
        "ເກນເຕືອນ (Threshold)": item.lowStockThreshold,
        "ສະຖານະ (Status)": status
      };
    });

    const ws = XLSX.utils.json_to_sheet(formattedData);
    
    ws["!cols"] = [
      { wch: 10 }, // ID
      { wch: 30 }, // Name
      { wch: 18 }, // Barcode
      { wch: 18 }, // Category
      { wch: 15 }, // Price
      { wch: 15 }, // Stock Qty
      { wch: 15 }, // Threshold
      { wch: 25 }  // Status
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Inventory Report");
    downloadWorkbook(wb, `Inventory_Report_${new Date().toISOString().slice(0, 10)}.xlsx`);
  },

  // ── MEMBERS EXCEL EXPORT ─────────────────────────────────────────
  async exportMembersToExcel(members: any[], pointLogs: any[]) {
    const memberRows = members.map(m => ({
      "ຊື່ (Name)": m.name,
      "ເບີໂທ (Phone)": m.phone,
      "ທີ່ຢູ່ (Address)": m.address || "",
      "Points": Math.round(m.points || 0),
      "ຈຳນວນເຂົ້າ (Visits)": Math.round(m.visits || 0),
      "ຍອດຊື້ລວມ (Total Spend)": Math.round(m.totalSpend || 0),
      "ວັນທີສະໝັກ (Joined)": m.createdAt ? new Date(m.createdAt).toLocaleDateString("en-GB") : ""
    }));
    const memberSheet = XLSX.utils.json_to_sheet(memberRows);
    memberSheet["!cols"] = [{ wch: 24 }, { wch: 16 }, { wch: 30 }, { wch: 10 }, { wch: 14 }, { wch: 18 }, { wch: 16 }];

    const logRows = [...pointLogs]
      .sort((a, b) => b.timestamp - a.timestamp)
      .map(l => ({
        "ວັນທີ (Date)": new Date(l.timestamp).toLocaleString("en-GB"),
        "ສະມາຊິກ (Member)": l.memberName,
        "ປະເພດ (Type)": l.reason,
        "ຈຳນວນ (Points)": Math.round(l.changePoints || 0),
        "ຄົງເຫຼືອ (Balance)": Math.round(l.pointsAfter || 0),
        "ຍອດບິນ (Bill)": l.billAmount ? Math.round(l.billAmount) : "",
        "ອັດຕາ % (Rate)": l.rateUsed ?? ""
      }));
    const logSheet = XLSX.utils.json_to_sheet(logRows);
    logSheet["!cols"] = [{ wch: 20 }, { wch: 24 }, { wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 12 }];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, memberSheet, "Members");
    XLSX.utils.book_append_sheet(wb, logSheet, "Point History");
    downloadWorkbook(wb, `Members_${new Date().toISOString().slice(0, 10)}.xlsx`);
  },

  // ── STOCK PDF EXPORT ─────────────────────────────────────────────
  exportStockToPDF(menuItems: any[]) {
    const settings = db.getSettings();
    const dateStr = new Date().toLocaleString();
    const fileDate = new Date().toISOString().slice(0, 10);

    const rowsHtml = menuItems.map((item, index) => {
      const isOutOfStock = item.stockQty <= 0;
      const isLowStock = !isOutOfStock && item.stockQty <= item.lowStockThreshold;
      const statusText = isOutOfStock ? "ໝົດສະຕັອກ" : isLowStock ? "ສະຕັອກໜ້ອຍ" : "ປົກກະຕິ";
      const statusColor = isOutOfStock ? "#e11d48" : isLowStock ? "#d97706" : "#16a34a";
      return "<tr>"
        + "<td style=\"text-align:center;\">" + (index + 1) + "</td>"
        + "<td><strong>" + escapeHtml(item.name) + "</strong><br/><small>" + escapeHtml(item.barcode || "-") + "</small></td>"
        + "<td>" + escapeHtml(item.category || "General") + "</td>"
        + "<td style=\"text-align:right;\">₭" + Number(item.price || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + "</td>"
        + "<td style=\"text-align:right;\">" + Number(item.stockQty || 0).toLocaleString() + "</td>"
        + "<td style=\"text-align:right;\">" + Number(item.lowStockThreshold || 0).toLocaleString() + "</td>"
        + "<td style=\"text-align:center;font-weight:700;color:" + statusColor + ";\">" + statusText + "</td>"
        + "</tr>";
    }).join("");

    const logoHtml = settings.logoUrl ? "<img src=\"" + settings.logoUrl + "\" alt=\"logo\" />" : "";
    const reportHtml = [
      "<!doctype html>",
      "<html lang=\"lo\">",
      "<head>",
      "<meta charset=\"utf-8\" />",
      "<title>Inventory Report</title>",
      "<style>",
      "@page { size: A4 portrait; margin: 15mm; }",
      "body { font-family: 'Noto Sans Lao', Arial, sans-serif; color: #1e293b; font-size: 11px; line-height: 1.4; }",
      "h1 { text-align: center; font-size: 20px; margin: 18px 0; border-bottom: 2px solid #3b82f6; padding-bottom: 10px; }",
      ".shop { display: flex; gap: 14px; align-items: center; margin-bottom: 14px; }",
      ".shop img { max-width: 70px; max-height: 60px; border-radius: 6px; }",
      ".shop-name { font-size: 18px; font-weight: 700; }",
      ".meta { display: flex; justify-content: space-between; margin-bottom: 12px; color: #475569; }",
      "table { width: 100%; border-collapse: collapse; }",
      "th, td { border: 1px solid #cbd5e1; padding: 7px 8px; vertical-align: middle; }",
      "th { background: #f1f5f9; text-align: left; }",
      "tr:nth-child(even) { background: #f8fafc; }",
      ".footer { margin-top: 26px; text-align: center; color: #94a3b8; font-size: 10px; }",
      "</style>",
      "</head>",
      "<body>",
      "<div class=\"shop\">" + logoHtml + "<div><div class=\"shop-name\">" + escapeHtml(settings.shopName) + "</div><div>ໂທ: " + escapeHtml(settings.phone) + " | " + escapeHtml(settings.contact) + "</div></div></div>",
      "<h1>ລາຍງານສະຕັອກສິນຄ້າຄົງເຫຼືອ / Inventory Report</h1>",
      "<div class=\"meta\"><div>ວັນທີສ້າງລາຍງານ: <strong>" + dateStr + "</strong></div><div>ຈຳນວນລາຍການທັງໝົດ: <strong>" + menuItems.length + "</strong></div></div>",
      "<table><thead><tr><th style=\"width:40px;text-align:center;\">#</th><th>ຊື່ສິນຄ້າ / ບາໂຄດ</th><th>ໝວດໝູ່</th><th style=\"text-align:right;\">ລາຄາ</th><th style=\"text-align:right;\">ຄົງເຫຼືອ</th><th style=\"text-align:right;\">ເກນເຕືອນ</th><th style=\"text-align:center;\">ສະຖານະ</th></tr></thead><tbody>" + rowsHtml + "</tbody></table>",
      "<div class=\"footer no-print\">Use the browser print dialog to print or save as PDF.</div>",
      "<script>window.addEventListener(\"afterprint\",function(){setTimeout(function(){window.close();},500);});window.addEventListener(\"load\",function(){setTimeout(function(){window.focus();window.print();},500);});</script>",
      "</body>",
      "</html>"
    ].join("\n");

    openPrintWindow(reportHtml, "Inventory Report " + fileDate);
  }
};
