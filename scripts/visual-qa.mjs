#!/usr/bin/env node

import { spawn } from "node:child_process";
import { accessSync, constants, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { dashboardMetadata } from "../src/dashboard.mjs";

const LOAD_TIMEOUT_MS = 60_000;

function pause(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

function parseArguments(argv) {
  const result = { outputDir: "/tmp/eg4-home-assistant-qa" };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--output-dir") result.outputDir = argv[++index];
    else if (argv[index] === "--help" || argv[index] === "-h") {
      console.log("Usage: node scripts/visual-qa.mjs [--output-dir DIR]");
      process.exit(0);
    } else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  if (!result.outputDir) throw new Error("--output-dir requires a directory");
  return result;
}

async function freePort() {
  return new Promise((resolvePromise, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolvePromise(address.port));
    });
  });
}

async function waitForJson(url, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) return response.json();
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await pause(100);
  }
  throw new Error(`Chromium DevTools endpoint did not become ready: ${lastError?.message ?? "timeout"}`);
}

class CdpSession {
  constructor(url, timeoutMs = 15_000) {
    this.url = url;
    this.timeoutMs = timeoutMs;
    this.socket = null;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
  }

  async connect() {
    this.socket = new WebSocket(this.url);
    await new Promise((resolvePromise, reject) => {
      const timer = setTimeout(() => reject(new Error("CDP WebSocket connection timed out")), this.timeoutMs);
      this.socket.addEventListener("open", () => {
        clearTimeout(timer);
        resolvePromise();
      }, { once: true });
      this.socket.addEventListener("error", () => {
        clearTimeout(timer);
        reject(new Error("CDP WebSocket connection failed"));
      }, { once: true });
    });
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id && this.pending.has(message.id)) {
        const pending = this.pending.get(message.id);
        this.pending.delete(message.id);
        clearTimeout(pending.timer);
        if (message.error) pending.reject(new Error(`${message.error.code}: ${message.error.message}`));
        else pending.resolve(message.result);
        return;
      }
      for (const listener of this.listeners.get(message.method) ?? []) listener(message.params ?? {});
    });
  }

  call(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolvePromise, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP command timed out: ${method}`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve: resolvePromise, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  on(method, listener) {
    const listeners = this.listeners.get(method) ?? [];
    listeners.push(listener);
    this.listeners.set(method, listeners);
  }

  close() {
    this.socket?.close();
  }
}

async function waitForLoad(session, action) {
  let loaded = false;
  const promise = new Promise((resolvePromise) => {
    session.on("Page.loadEventFired", () => {
      loaded = true;
      resolvePromise();
    });
  });
  await action();
  if (!loaded) {
    await Promise.race([
      promise,
      pause(LOAD_TIMEOUT_MS).then(() => { throw new Error("Home Assistant page load timed out"); }),
    ]);
  }
}

const INSPECTION_EXPRESSION = `(() => {
  const tags = [];
  const text = [];
  const visit = (root) => {
    for (const element of root.querySelectorAll('*')) {
      tags.push(element.localName);
      if (['hui-error-card', 'ha-alert', 'mwc-button', 'ha-button'].includes(element.localName)) {
        const value = (element.innerText || element.textContent || '').trim();
        if (value) text.push(value.slice(0, 500));
      }
      if (element.shadowRoot) visit(element.shadowRoot);
    }
  };
  visit(document);
  const errorTags = tags.filter((tag) => tag === 'hui-error-card' || tag === 'hui-warning');
  return {
    path: location.pathname,
    title: document.title,
    hasHomeAssistant: tags.includes('home-assistant'),
    hasLovelace: tags.includes('ha-panel-lovelace') && (tags.includes('hui-root') || tags.includes('hui-view')),
    loginVisible: tags.includes('ha-authorize') || tags.includes('ha-auth-form'),
    errorTags,
    alertText: [...new Set(text)],
    renderedCards: tags.filter((tag) => tag.startsWith('hui-') || tag.startsWith('ha-energy-')).length,
  };
})()`;

async function evaluate(session, expression) {
  const result = await session.call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "Browser evaluation failed");
  return result.result.value;
}

async function waitForDashboard(session, expectedPath) {
  const deadline = Date.now() + LOAD_TIMEOUT_MS;
  let inspection;
  while (Date.now() < deadline) {
    inspection = await evaluate(session, INSPECTION_EXPRESSION);
    if (inspection.loginVisible) throw new Error("Home Assistant showed a login form after long-lived-token injection");
    if (inspection.hasLovelace && inspection.path === expectedPath) break;
    await pause(500);
  }
  if (!inspection?.hasLovelace || inspection.path !== expectedPath) {
    throw new Error(`Dashboard did not render at ${expectedPath}; last path was ${inspection?.path ?? "unknown"}`);
  }
  await pause(4_000);
  inspection = await evaluate(session, INSPECTION_EXPRESSION);
  if (inspection.errorTags.length) throw new Error(`Home Assistant rendered ${inspection.errorTags.length} dashboard error card(s)`);
  return inspection;
}

async function screenshot(session, { baseUrl, view, viewport, outputDir }) {
  await session.call("Emulation.setDeviceMetricsOverride", viewport);
  const expectedPath = `/${dashboardMetadata.urlPath}/${view}`;
  await waitForLoad(session, () => session.call("Page.navigate", { url: `${baseUrl}${expectedPath}` }));
  const inspection = await waitForDashboard(session, expectedPath);
  const capture = await session.call("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
  const filename = `${viewport.mobile ? "mobile" : "desktop"}-${view}.png`;
  writeFileSync(join(outputDir, filename), Buffer.from(capture.data, "base64"));
  return { filename, viewport: { width: viewport.width, height: viewport.height, mobile: viewport.mobile }, inspection };
}

async function stopBrowser(browser) {
  if (browser.exitCode != null) return;
  browser.kill("SIGTERM");
  const exited = new Promise((resolvePromise) => browser.once("exit", resolvePromise));
  const stopped = await Promise.race([
    exited.then(() => true),
    pause(3_000).then(() => false),
  ]);
  if (!stopped && browser.exitCode == null) {
    browser.kill("SIGKILL");
    await Promise.race([
      exited,
      pause(3_000),
    ]);
  }
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  const baseUrl = String(process.env.HA_BASE_URL ?? "").replace(/\/$/, "");
  const token = process.env.EG4_HA_TOKEN ?? process.env.HA_TOKEN;
  if (!baseUrl) throw new Error("Set HA_BASE_URL");
  if (!token) throw new Error("Set HA_TOKEN or EG4_HA_TOKEN");

  const chromium = process.env.CHROMIUM_BIN ?? "/usr/bin/chromium-browser";
  accessSync(chromium, constants.X_OK);
  const outputDir = resolve(args.outputDir);
  mkdirSync(outputDir, { recursive: true, mode: 0o700 });
  const profileDir = mkdtempSync(join(tmpdir(), "eg4-ha-chromium-"));
  const port = await freePort();
  const browser = spawn(chromium, [
    "--headless=new",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    "about:blank",
  ], { stdio: ["ignore", "ignore", "ignore"] });
  let session;
  try {
    await waitForJson(`http://127.0.0.1:${port}/json/version`);
    const page = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(`${baseUrl}/`)}`, { method: "PUT" }).then((response) => response.json());
    session = new CdpSession(page.webSocketDebuggerUrl);
    await session.connect();
    await Promise.all([
      session.call("Page.enable"),
      session.call("Runtime.enable"),
      session.call("Log.enable"),
    ]);
    const consoleErrors = [];
    session.on("Log.entryAdded", ({ entry }) => {
      if (entry?.level === "error") consoleErrors.push(String(entry.text).slice(0, 500));
    });

    await waitForDashboardOrigin(session, baseUrl);
    const authData = {
      hassUrl: baseUrl,
      clientId: null,
      expires: Date.now() + 1e11,
      refresh_token: "",
      access_token: token,
      expires_in: 1e11,
    };
    await evaluate(session, `localStorage.setItem('hassTokens', ${JSON.stringify(JSON.stringify(authData))}); true`);

    const captures = [];
    for (const view of ["live", "energy"]) {
      captures.push(await screenshot(session, {
        baseUrl,
        view,
        outputDir,
        viewport: { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false },
      }));
      captures.push(await screenshot(session, {
        baseUrl,
        view,
        outputDir,
        viewport: { width: 390, height: 844, deviceScaleFactor: 2, mobile: true },
      }));
    }
    const report = {
      checked_at: new Date().toISOString(),
      dashboard_path: dashboardMetadata.urlPath,
      captures,
      console_errors: consoleErrors,
    };
    const reportPath = join(outputDir, "report.json");
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    console.log(`visual-qa-ok captures=${captures.length} report=${reportPath} console_errors=${consoleErrors.length}`);
  } finally {
    session?.close();
    await stopBrowser(browser);
    rmSync(profileDir, { recursive: true, force: true });
  }
}

async function waitForDashboardOrigin(session, baseUrl) {
  const targetOrigin = new URL(baseUrl).origin;
  const deadline = Date.now() + LOAD_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const origin = await evaluate(session, "location.origin");
    if (origin === targetOrigin) return;
    await session.call("Page.navigate", { url: `${baseUrl}/` });
    await pause(500);
  }
  throw new Error("Chromium did not reach the Home Assistant origin for token injection");
}

main().catch((error) => {
  console.error(`ERROR: ${error.message}`);
  process.exitCode = 1;
});
