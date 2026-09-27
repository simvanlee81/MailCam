import { starte } from "./browser-helfer.mjs";
const { url, browser, stop } = await starte("/home/claude/post-kamera/dist");
const page = await browser.newPage();
await page.goto(url + "/sdktest.html");
try { console.log(JSON.stringify(await page.evaluate(() => window.sdkTest()))); } catch (e) { console.log("FEHLER:", e.message.slice(0, 400)); }
await stop();
