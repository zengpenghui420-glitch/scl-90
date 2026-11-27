// Phone-sized flow check. Needs Chrome plus puppeteer-core:
// PUPPETEER_CORE=/path/to/puppeteer-core.js node tools/browser-check.mjs
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const puppeteer = (await import(process.env.PUPPETEER_CORE || "puppeteer-core")).default;
const ORDER = "P738291046152837465";
const CODE = "SCAB23";
const outDir = process.env.SHOT_DIR || "/tmp/scl90-shots";
fs.mkdirSync(outDir, { recursive: true });

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function startServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const rel = url.pathname === "/" ? "/index.html" : url.pathname;
    const full = path.normalize(path.join(root, rel));
    if (!full.startsWith(root) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
      res.writeHead(404);
      res.end("no");
      return;
    }
    const type = full.endsWith(".html") ? "text/html; charset=utf-8" : "text/plain";
    res.writeHead(200, { "content-type": type, "cache-control": "no-store" });
    res.end(fs.readFileSync(full));
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

function json(status, obj) {
  return {
    status,
    contentType: "application/json",
    body: JSON.stringify(obj),
    headers: { "access-control-allow-origin": "*", "cache-control": "no-store" }
  };
}

const world = {
  vaultPosts: 0,
  vaultGets: 0,
  mantleGets: 0,
  mantlePosts: 0,
  remaining: 3,
  urls: [],
  unexpected: [],
  bodies: []
};

function resetWorld() {
  world.vaultPosts = 0;
  world.vaultGets = 0;
  world.mantleGets = 0;
  world.mantlePosts = 0;
  world.remaining = 3;
  world.urls = [];
  world.unexpected = [];
  world.bodies = [];
}

function note(req) {
  const u = req.url();
  world.urls.push(req.method() + " " + u.split("?")[0]);
  if (u.includes("/order/") || u.includes("/orders/")) world.unexpected.push(u);
}

async function handle(req) {
  const u = req.url();
  if (req.method() === "OPTIONS") {
    await req.respond({
      status: 204,
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET,POST,OPTIONS",
        "access-control-allow-headers": "content-type,x-device-id,x-mantle-key",
        "access-control-max-age": "600"
      }
    });
    return;
  }
  if (u.includes("/order/") || u.includes("/orders/")) {
    note(req);
    await req.abort();
    return;
  }
  if (u.includes("/redeem") && req.method() === "POST") {
    note(req);
    const body = JSON.parse(req.postData() || "{}");
    world.bodies.push(body);
    world.vaultPosts += 1;
    assert(body.quiz === "scl" && body.code === CODE && !body.orderId, "vault body " + req.postData());
    await req.respond(json(404, { ok: false, error: "not_found" }));
    return;
  }
  if (u.includes("/get") && u.includes("quiz=")) {
    note(req);
    world.vaultGets += 1;
    const parsed = new URL(u);
    assert(parsed.searchParams.get("quiz") === "scl", "vault peek quiz");
    assert(parsed.searchParams.get("code") === CODE, "vault peek code");
    await req.respond(json(404, { ok: false, error: "not_found" }));
    return;
  }
  if (u.includes("mantledb.sh")) {
    note(req);
    if (u.includes("/orders/")) {
      world.unexpected.push(u);
      await req.abort();
      return;
    }
    if (req.method() === "GET") {
      world.mantleGets += 1;
      assert(u.includes("/sc/" + CODE), "mantle collection " + u);
      await req.respond(json(200, { remaining: world.remaining, max: 3 }));
      return;
    }
    const body = JSON.parse(req.postData() || "{}");
    assert(body.key === "remaining" && body.by === -1, "mantle decrement");
    assert(u.includes("/increment/") && u.includes("/sc/" + CODE), "mantle increment path");
    world.mantlePosts += 1;
    world.remaining -= 1;
    await req.respond(json(200, { remaining: world.remaining }));
    return;
  }
  if (u.startsWith("http://127.0.0.1") || u.startsWith("http://localhost")) {
    await req.continue();
    return;
  }
  world.unexpected.push(u);
  await req.abort();
}

async function overflow(page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
}

async function shot(page, name) {
  await page.screenshot({ path: path.join(outDir, name), fullPage: false });
}

async function setCode(page, value) {
  await page.$eval("#codeInput", (el, v) => {
    el.value = v;
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}

async function openModal(page) {
  await page.click("#btnStart");
  await page.waitForSelector("#codeMask:not([hidden])");
}

async function confirm(page) {
  await page.click("#btnCodeOk");
}

const server = await startServer();
const base = "http://127.0.0.1:" + server.address().port + "/";
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME || "/usr/bin/google-chrome",
  headless: true,
  args: [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--host-resolver-rules=MAP snappy-tundra-7uesdvk-zengpenghui420-glitch.vercel.app 127.0.0.1, MAP mantledb.sh 127.0.0.1"
  ]
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    handle(req).catch((err) => {
      console.error(err);
      req.abort().catch(() => {});
    });
  });

  await page.goto(base, { waitUntil: "domcontentloaded" });
  assert(await page.$eval("h1", (el) => el.textContent.includes("SCL-90")), "title");
  assert(await page.$eval(".disclaimer", (el) => el.textContent.includes("不能替代专业诊断")), "disclaimer");
  assert(await overflow(page), "cover overflow 390");
  await shot(page, "cover-390.png");

  await openModal(page);
  assert(world.unexpected.length === 0 && world.vaultPosts === 0 && world.mantleGets === 0, "opening the dialog called the network");
  assert(await page.$eval("#codeTitle", (el) => el.textContent) === "输入订单号", "modal title");
  assert((await page.$eval("#codeHint", (el) => el.textContent)).includes("我的订单"), "xhs copy");
  assert((await page.$eval("#codeHint", (el) => el.textContent)).includes("3 次"), "three uses");
  assert(!(await page.$eval("#codeMask", (el) => el.innerText)).includes("验证码"), "modal advertises codes");
  const fit = await page.$eval("#codeInput", (el) => {
    const panel = el.closest(".panel").getBoundingClientRect();
    const box = el.getBoundingClientRect();
    el.value = "P738291046152837465";
    return {
      inside: box.left >= panel.left - 1 && box.right <= panel.right + 1,
      fits: el.scrollWidth <= el.clientWidth + 2,
      hint: true
    };
  });
  assert(fit.inside, "input outside panel");
  assert(fit.fits, "order id does not fit the field");
  assert(await overflow(page), "modal overflow 390");
  await shot(page, "modal-390.png");

  await page.setViewport({ width: 320, height: 640, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  assert(await overflow(page), "modal overflow 320");
  const fit320 = await page.$eval("#codeInput", (el) => el.scrollWidth <= el.clientWidth + 2);
  assert(fit320, "order id does not fit at 320");
  await shot(page, "modal-320.png");
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

  await setCode(page, "P111111111111111111");
  await confirm(page);
  await page.waitForFunction(() => document.getElementById("toast").textContent.includes("格式不对"));
  assert(world.unexpected.length === 0 && world.vaultPosts === 0 && world.mantleGets === 0, "invalid order hit the network");
  assert(!(await page.$("#quiz.active")), "invalid order started the quiz");

  await setCode(page, "P9900000000000001378");
  await confirm(page);
  await page.waitForFunction(() => document.getElementById("toast").textContent.includes("格式不对"));
  assert(!(await page.$("#quiz.active")), "19-digit order started the quiz");

  await setCode(page, ORDER);
  await new Promise((r) => setTimeout(r, 400));
  assert(world.vaultGets === 0 && world.vaultPosts === 0 && world.mantleGets === 0, "order preview called the network");
  await confirm(page);
  await page.waitForSelector("#quiz.active");
  assert(await page.evaluate((id) => shownOrderUses(id), ORDER) === 1, "first display count");
  assert((await page.$eval("#toast", (el) => el.textContent)).includes("还可以测 2 次"), "first toast");
  assert(world.unexpected.length === 0 && world.vaultPosts === 0 && world.mantlePosts === 0, "first unlock called the network");
  assert(await page.$eval("#qText", (el) => el.textContent) === "头痛", "first question");
  assert(await overflow(page), "quiz overflow");
  await shot(page, "quiz-390.png");

  await page.click("#btnBack");
  await page.waitForSelector("#start.active");
  assert((await page.$eval("#btnStart", (el) => el.textContent)) === "继续测试", "continue label");
  await page.click("#btnStart");
  await page.waitForSelector("#quiz.active");
  assert(await page.evaluate((id) => shownOrderUses(id), ORDER) === 1, "continue changed the display");

  await page.click("#btnBack");
  await page.waitForSelector("#start.active");
  await page.click("#btnRestart");
  await page.waitForSelector("#codeMask:not([hidden])");
  assert(await page.evaluate((id) => shownOrderUses(id), ORDER) === 1, "opening retry changed the display");
  await page.click("#codeClose");

  await page.evaluate(() => {
    window.SCL90.setAnswers(Array(90).fill(1));
    window.SCL90.finish();
  });
  await page.waitForSelector("#result.active", { timeout: 4000 });
  assert(await page.$eval("#resultInner", (el) => el.textContent.includes("不能替代专业诊断")), "result disclaimer");
  assert(await overflow(page), "result overflow");
  await shot(page, "result-390.png");

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("#result.active", { timeout: 4000 });
  assert(await page.evaluate((id) => shownOrderUses(id), ORDER) === 1, "refresh changed the display");
  assert(world.unexpected.length === 0 && world.vaultPosts === 0 && world.mantleGets === 0, "refresh called the network");

  await page.click("#btnHome");
  await page.waitForSelector("#start.active");
  await page.click("#btnLast");
  await page.waitForSelector("#result.active");
  assert(await page.evaluate((id) => shownOrderUses(id), ORDER) === 1, "view last changed the display");

  async function retest(expected, toastPart) {
    await page.click("#btnRetry");
    await page.waitForSelector("#codeMask:not([hidden])");
    assert(await page.evaluate((id) => shownOrderUses(id), ORDER) === expected - 1, "opening retest changed the display");
    await confirm(page);
    await page.waitForSelector("#quiz.active");
    assert(await page.evaluate((id) => shownOrderUses(id), ORDER) === expected, "retest display " + expected);
    assert((await page.$eval("#toast", (el) => el.textContent)).includes(toastPart), "retest toast " + toastPart);
    await page.evaluate(() => {
      window.SCL90.setAnswers(Array(90).fill(1));
      window.SCL90.finish();
    });
    await page.waitForSelector("#result.active", { timeout: 4000 });
  }
  await retest(2, "还可以测 1 次");
  await retest(3, "这是最后一次");
  await page.click("#btnRetry");
  await page.waitForSelector("#codeMask:not([hidden])");
  await confirm(page);
  await page.waitForSelector("#quiz.active");
  await page.waitForFunction(() => document.getElementById("toast").textContent === "验证成功");
  assert(await page.evaluate((id) => shownOrderUses(id), ORDER) === 4, "later entry display");
  assert(world.unexpected.length === 0 && world.vaultPosts === 0 && world.mantlePosts === 0, "later entry called the network");

  await page.close();
  resetWorld();
  const legacyContext = await browser.createBrowserContext();
  const legacy = await legacyContext.newPage();
  await legacy.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await legacy.setRequestInterception(true);
  legacy.on("request", (req) => {
    handle(req).catch((err) => {
      console.error(err);
      req.abort().catch(() => {});
    });
  });
  await legacy.goto(base, { waitUntil: "domcontentloaded" });
  await openModal(legacy);
  await setCode(legacy, CODE);
  await new Promise((r) => setTimeout(r, 400));
  assert(world.unexpected.length === 0, "legacy preview hit an order route");
  assert(world.vaultGets >= 1 && world.vaultPosts === 0, "legacy preview did not ask the vault");
  assert(world.mantleGets >= 1 && world.mantlePosts === 0, "legacy preview did not read mantle");
  await confirm(legacy);
  await legacy.waitForSelector("#quiz.active");
  assert(world.vaultPosts === 1 && world.bodies[0].code === CODE && !world.bodies[0].orderId, "legacy confirm missed the vault");
  assert(world.mantlePosts === 1 && world.remaining === 2, "legacy confirm decremented");
  assert(world.unexpected.length === 0, "legacy confirm hit an order route");
  const mantlePosts = world.mantlePosts;
  const mantleGets = world.mantleGets;
  const vaultPosts = world.vaultPosts;
  await legacy.reload({ waitUntil: "domcontentloaded" });
  await legacy.waitForSelector("#quiz.active");
  assert(world.mantlePosts === mantlePosts && world.mantleGets === mantleGets && world.vaultPosts === vaultPosts, "legacy refresh hit the network");
  await legacy.evaluate(() => {
    window.SCL90.setAnswers(Array(90).fill(1));
    window.SCL90.finish();
  });
  await legacy.waitForSelector("#result.active", { timeout: 4000 });
  const afterFinishGets = world.mantleGets;
  const afterFinishPosts = world.mantlePosts;
  await legacy.reload({ waitUntil: "domcontentloaded" });
  await legacy.waitForSelector("#result.active", { timeout: 4000 });
  assert(world.mantleGets === afterFinishGets && world.mantlePosts === afterFinishPosts, "legacy result refresh hit mantle");
  assert(world.unexpected.length === 0, "legacy result refresh hit an order route");
  await legacy.click("#btnHome");
  await legacy.waitForSelector("#start.active");
  await legacy.click("#btnLast");
  await legacy.waitForSelector("#result.active");
  assert(world.mantleGets === afterFinishGets && world.vaultPosts === 1, "view last hit the network");
  await legacy.close();
  await legacyContext.close();

  resetWorld();
  const linkContext = await browser.createBrowserContext();
  const linked = await linkContext.newPage();
  await linked.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await linked.setRequestInterception(true);
  linked.on("request", (req) => {
    handle(req).catch((err) => {
      console.error(err);
      req.abort().catch(() => {});
    });
  });
  await linked.goto(base + "?code=" + ORDER, { waitUntil: "domcontentloaded" });
  assert(await linked.$eval("#urlHint", (el) => !el.hidden), "link hint hidden");
  assert(world.vaultPosts === 0 && world.unexpected.length === 0, "link redeemed before confirm");
  await openModal(linked);
  assert(await linked.$eval("#codeInput", (el) => el.value) === ORDER, "link did not fill the order");
  await new Promise((r) => setTimeout(r, 400));
  assert(world.vaultPosts === 0 && world.mantleGets === 0, "link preview called the network");
  await confirm(linked);
  await linked.waitForSelector("#quiz.active");
  assert(await linked.evaluate((id) => shownOrderUses(id), ORDER) === 1, "link confirm display");
  assert(world.vaultPosts === 0 && world.unexpected.length === 0, "link confirm called an order route");
  await linked.close();
  await linkContext.close();

  console.log("browser ok", {
    orderUses: 4,
    shots: fs.readdirSync(outDir)
  });
} finally {
  await browser.close();
  server.close();
}
