// End-to-end walk-through against a running server, with screenshots in ./screenshots.
// Usage: node scripts/e2e-demo.mjs [baseUrl]
// 1) patient books on a 390px phone and pays the deposit via the sandbox checkout
// 2) receptionist logs in, offers the cancelled 5:30 slot to the waiting list, simulates the reply
import puppeteer from "puppeteer-core";
import fs from "node:fs";

const BASE = process.argv[2] || "http://localhost:3000";
const exe = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
fs.mkdirSync("screenshots", { recursive: true });
const browser = await puppeteer.launch({ executablePath: exe, headless: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log("•", ...a);

async function shot(page, name, full = true) {
  await sleep(400);
  await page.screenshot({ path: `screenshots/${name}.png`, fullPage: full });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  log(`${name}.png${overflow > 0 ? `  (horizontal overflow ${overflow}px!)` : ""}`);
}
const click = async (page, text) => {
  const el = await page.waitForSelector(`::-p-text(${text})`, { timeout: 15000 });
  await el.click();
};

// ---------- patient on mobile ----------
const phone = await browser.newPage();
await phone.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
phone.on("pageerror", (e) => console.error("page error:", e.message));
await phone.goto(`${BASE}/book`, { waitUntil: "networkidle0" });
await phone.waitForSelector(".doc-btn .chip-tint");
await (await phone.$(".doc-btn")).click();
await shot(phone, "book-1-service-doctor", false);
await click(phone, "التالي");
await phone.waitForSelector(".slot-btn:not(:disabled)");
await shot(phone, "book-2-time", false);
// pick a day that also has taken slots if possible, then the first free time
const days = await phone.$$(".day-btn");
for (const d of days) {
  await d.click();
  await sleep(150);
  if (await phone.$(".slot-btn:disabled")) break;
}
await (await phone.$(".slot-btn:not(:disabled)")).click();
await shot(phone, "book-2-time-selected", false);
await click(phone, "التالي");
await phone.waitForSelector("input[name=name]");
await phone.type("input[name=name]", "منى خالد عبد الرحمن");
await phone.type("input[name=phone]", "01012345678");
await click(phone, "بطاقة بنكية");
await shot(phone, "book-3-details", true);
await click(phone, "ادفع وأكّد");
await phone.waitForNavigation({ waitUntil: "networkidle0" });
await shot(phone, "pay-sandbox", false);
await click(phone, "ادفع (عملية ناجحة)");
await phone.waitForSelector(".done-title");
await sleep(800);
const title = await phone.$eval(".done-title", (e) => e.textContent);
log("confirmation page:", title);
await shot(phone, "book-4-confirmed", true);

// English version of the landing page on mobile
await phone.goto(`${BASE}/en`, { waitUntil: "networkidle0" });
await shot(phone, "landing-en-mobile", false);

// ---------- reception on desktop ----------
const desk = await browser.newPage();
await desk.setViewport({ width: 1440, height: 940 });
desk.on("pageerror", (e) => console.error("page error:", e.message));
await desk.goto(`${BASE}/login`, { waitUntil: "networkidle0" });
await desk.type("input[name=email]", "reception@basma-dental.example");
await desk.type("input[name=password]", "Basma#Desk2026");
await desk.click("form.panel button[type=submit]");
await desk.waitForSelector(".kpis", { timeout: 60000 });
await shot(desk, "reception-1-board", true);
const offer = await desk.$("::-p-text(اعرضه على قائمة الانتظار)");
if (offer) {
  await offer.click();
  await desk.waitForSelector(".flash", { timeout: 60000 });
  log("flash:", await desk.$eval(".flash", (e) => e.textContent).catch(() => "-"));
  await shot(desk, "reception-2-offered", true);
  const accept = await desk.$("::-p-text(ضغط «احجزه»)");
  if (accept) {
    await accept.click();
    await desk.waitForFunction(() => !document.querySelector(".flash")?.textContent?.includes("إرسال العرض"), { timeout: 60000 });
    log("flash:", await desk.$eval(".flash", (e) => e.textContent).catch(() => "-"));
    await shot(desk, "reception-3-filled", true);
  }
} else log("no open cancelled slot on the board (it may be in the past)");
for (const [path, name] of [
  ["/dashboard/messages", "dash-messages"],
  ["/dashboard/payments", "dash-payments"],
  ["/dashboard/reports", "dash-reports"],
  ["/dashboard/doctors", "dash-doctors"],
  ["/dashboard/patients", "dash-patients"],
  ["/dashboard/waitlist", "dash-waitlist"],
  ["/dashboard/new", "dash-new"],
]) {
  await desk.goto(`${BASE}${path}`, { waitUntil: "networkidle0" });
  await shot(desk, name, false);
}
// tablet width for the board
await desk.setViewport({ width: 1024, height: 768 });
await desk.goto(`${BASE}/dashboard`, { waitUntil: "networkidle0" });
await shot(desk, "reception-tablet", false);

await browser.close();
