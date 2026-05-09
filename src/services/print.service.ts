// src/services/print.service.ts

import fs from "fs/promises";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import sharp from "sharp";

const execFileAsync = promisify(execFile);

type PrintItem = {
  name: string;
  quantity: number;
  price_at_time?: number;
  price?: number;
  comment?: string | null;
};

export async function printOrderReceipt(data: {
  orderId: string;
  waiterName?: string | null;
  servingMode?: string;
  total: number;
  items: PrintItem[];
}) {
  const receiptDir = path.join(process.cwd(), "printer", "tmp");
  await fs.mkdir(receiptDir, { recursive: true });

  const imagePath = path.join(receiptDir, `receipt-${data.orderId}.png`);

  const svg = `
  <svg width="576" height="900" xmlns="http://www.w3.org/2000/svg">
    <style>
      @font-face {
        font-family: Abyssinica;
        src: url('/usr/share/fonts/truetype/abyssinica/AbyssinicaSIL-Regular.ttf');
      }

      .receipt {
        font-family: Abyssinica, sans-serif;
        font-size: 28px;
        fill: #000;
      }

      .title {
        font-size: 40px;
        font-weight: bold;
        text-anchor: middle;
      }

      .center {
        text-anchor: middle;
      }

      .small {
        font-size: 22px;
      }

      .line {
        stroke: #000;
        stroke-width: 2;
      }
    </style>

    <rect width="100%" height="100%" fill="white"/>

    <text x="288" y="55" class="receipt title">ሶፊ ቤሶ</text>
    <text x="288" y="95" class="receipt center small">Kitchen Order</text>

    <line x1="20" y1="125" x2="556" y2="125" class="line"/>

    <text x="20" y="165" class="receipt small">Order: ${data.orderId.slice(0, 8)}</text>
    <text x="20" y="200" class="receipt small">Waiter: ${escapeHtml(data.waiterName ?? "Unknown")}</text>
    <text x="20" y="235" class="receipt small">Mode: ${data.servingMode ?? "individual"}</text>

    <line x1="20" y1="260" x2="556" y2="260" class="line"/>

    ${renderItems(data.items)}

    <line x1="20" y1="${320 + data.items.length * 80}" x2="556" y2="${320 + data.items.length * 80}" class="line"/>
    <text x="20" y="${370 + data.items.length * 80}" class="receipt">TOTAL</text>
    <text x="556" y="${370 + data.items.length * 80}" class="receipt" text-anchor="end">${data.total} ብር</text>

    <text x="288" y="${430 + data.items.length * 80}" class="receipt center small">እናመሰግናለን</text>
  </svg>
  `;

  await sharp(Buffer.from(svg)).png().toFile(imagePath);

  await execFileAsync("./printer-env/bin/python3", [
    "printer/print_image.py",
    imagePath,
  ]);

  await fs.unlink(imagePath).catch(() => {});
}

function renderItems(items: PrintItem[]) {
  return items
    .map((item, index) => {
      const y = 305 + index * 80;
      const price = Number(item.price_at_time ?? item.price ?? 0);
      const lineTotal = price * item.quantity;

      return `
        <text x="20" y="${y}" class="receipt">${item.quantity} x ${escapeHtml(item.name)}</text>
        <text x="556" y="${y}" class="receipt" text-anchor="end">${lineTotal} ብር</text>
        ${
          item.comment?.trim()
            ? `<text x="40" y="${y + 32}" class="receipt small">NOTE: ${escapeHtml(item.comment)}</text>`
            : ""
        }
      `;
    })
    .join("");
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}