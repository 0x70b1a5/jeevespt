/**
 * Fetch a web page's readable text with a real (headless) Chrome, so pages that
 * render client-side come back as a user would see them.
 *
 * One browser is kept warm and shared: fetches are serialized through it, and
 * it quits after IDLE_SHUTDOWN_MS without use (or on shutdownBrowser()).
 * Instead of sleeping a fixed time after load, we poll the page's visible text
 * until it stops changing — fast pages return in a couple of seconds, slow
 * client-rendered ones get up to SETTLE_MAX_MS.
 */

import { Builder, WebDriver } from 'selenium-webdriver';
import chrome from 'selenium-webdriver/chrome';

const PAGE_LOAD_TIMEOUT_MS = 30_000;
const SETTLE_POLL_MS = 500;
/** Consecutive unchanged polls before the page counts as settled (~1.5s). */
const SETTLE_STABLE_POLLS = 3;
const SETTLE_MAX_MS = 15_000;
const IDLE_SHUTDOWN_MS = 5 * 60_000;
export const DEFAULT_MAX_CHARS = 20_000;

let driverPromise: Promise<WebDriver> | null = null;
let queue: Promise<unknown> = Promise.resolve();
let idleTimer: NodeJS.Timeout | null = null;

export async function getWebpage(url: string, maxChars = DEFAULT_MAX_CHARS): Promise<string> {
    if (!url) {
        throw new Error('URL is required');
    }
    if (!url.startsWith('http')) {
        url = `https://${url}`;
    }
    return serialize(async () => {
        try {
            return await fetchWith(await getDriver(), url, maxChars);
        } catch (error) {
            // A dead browser session poisons every later fetch; start fresh once.
            if (!isSessionError(error)) throw error;
            console.warn('🌐 Browser session lost, relaunching:', (error as Error).message);
            await shutdownBrowser();
            return fetchWith(await getDriver(), url, maxChars);
        } finally {
            scheduleIdleShutdown();
        }
    });
}

/** Quit the shared browser, if running. Safe to call any time. */
export async function shutdownBrowser(): Promise<void> {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = null;
    const pending = driverPromise;
    driverPromise = null;
    if (!pending) return;
    try {
        await (await pending).quit();
    } catch { /* already gone */ }
}

async function fetchWith(driver: WebDriver, url: string, maxChars: number): Promise<string> {
    const started = Date.now();
    try {
        await driver.get(url);
    } catch (error) {
        // Slow subresources can blow the load timeout after the content is
        // already there; stop loading and read what rendered.
        if ((error as Error)?.name !== 'TimeoutError') throw error;
        await driver.executeScript('window.stop()');
    }

    await waitForStableText(
        () => driver.executeScript<PageActivity>(
            "return { text: document.body ? document.body.innerText.length : 0, resources: performance.getEntriesByType('resource').length }"
        ),
        { stablePolls: SETTLE_STABLE_POLLS, maxPolls: Math.ceil(SETTLE_MAX_MS / SETTLE_POLL_MS) },
        () => driver.sleep(SETTLE_POLL_MS)
    );

    const page = await driver.executeScript<{ title: string; url: string; text: string }>(EXTRACT_SCRIPT);
    // Park the tab so the page's scripts/media stop running between fetches.
    await driver.get('about:blank').catch(() => {});

    const content = formatPage(page, maxChars);
    console.log(`🌐 Fetched ${page.url} (${page.text.length} chars) in ${Date.now() - started}ms`);
    return content;
}

/** Visible text length plus network requests started so far. */
export interface PageActivity {
    text: number;
    resources: number;
}

/**
 * Poll `read` until the page's text AND its network activity hold steady for
 * `stablePolls` consecutive reads, or `maxPolls` is reached. Watching requests
 * keeps us waiting while a client-rendered page is still fetching its data,
 * even if the visible text hasn't changed yet. Exported for tests.
 */
export async function waitForStableText(
    read: () => Promise<PageActivity>,
    opts: { stablePolls: number; maxPolls: number },
    sleep: () => Promise<void>
): Promise<void> {
    let last: PageActivity | null = null;
    let stable = 0;
    for (let poll = 0; poll < opts.maxPolls; poll++) {
        const now = await read();
        if (now.text > 0 && last && now.text === last.text && now.resources === last.resources) {
            if (++stable >= opts.stablePolls) return;
        } else {
            stable = 0;
        }
        last = now;
        await sleep();
    }
}

/**
 * Runs in the page. Reads rendered text (`innerText` skips scripts, styles and
 * hidden elements) from the main content, with site chrome — nav bars, page
 * headers/footers, sidebars, cookie dialogs — hidden first. Headers inside the
 * main content are kept (they hold article titles). Falls back to the whole
 * body when that leaves too little to be the real content.
 */
const EXTRACT_SCRIPT = `
    const MIN = 200;
    const hidden = [];
    for (const el of document.querySelectorAll(
        'nav, aside, dialog, [role=navigation], [role=dialog], [role=banner], [role=contentinfo], header, footer'
    )) {
        if (el.closest('main, article, [role=main]') && (el.tagName === 'HEADER' || el.tagName === 'FOOTER')) continue;
        hidden.push([el, el.style.display]);
        el.style.setProperty('display', 'none', 'important');
    }
    let text = '';
    for (const sel of ['main', 'article', '[role=main]']) {
        const el = document.querySelector(sel);
        const t = el ? el.innerText || '' : '';
        if (t.trim().length >= MIN) { text = t; break; }
    }
    if (!text && document.body) text = document.body.innerText || '';
    if (text.trim().length < MIN) {
        for (const [el, display] of hidden) el.style.display = display;
        text = document.body ? document.body.innerText || '' : '';
    }
    return { title: document.title || '', url: location.href, text };
`;

/** Normalize whitespace and truncate, telling the model if anything was cut. Exported for tests. */
export function formatPage(page: { title: string; url: string; text: string }, maxChars: number): string {
    const text = page.text
        .split('\n')
        .map(line => line.replace(/[ \t ]+/g, ' ').trim())
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    const body = text.length > maxChars
        ? `${text.slice(0, maxChars)}\n\n[…truncated: ${text.length - maxChars} more characters]`
        : text;
    return `Title: ${page.title.trim()}\nURL: ${page.url}\n\n${body}`;
}

function serialize<T>(task: () => Promise<T>): Promise<T> {
    const run = queue.then(task, task);
    queue = run.catch(() => {});
    return run;
}

function getDriver(): Promise<WebDriver> {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = null;
    if (!driverPromise) {
        driverPromise = launchBrowser().catch(error => {
            driverPromise = null;
            throw error;
        });
    }
    return driverPromise;
}

async function launchBrowser(): Promise<WebDriver> {
    console.log('🌐 Launching headless Chrome...');
    const options = new chrome.Options();
    options.addArguments(
        '--headless=new',
        '--disable-gpu',
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--disable-extensions',
        '--window-size=1366,900'
    );
    const driver = await new Builder().forBrowser('chrome').setChromeOptions(options).build();
    await driver.manage().setTimeouts({ pageLoad: PAGE_LOAD_TIMEOUT_MS, script: 10_000 });

    // Headless Chrome announces itself as "HeadlessChrome", which many sites
    // block. Present the real version as regular Chrome (never goes stale,
    // unlike a hardcoded UA string).
    try {
        const ua = await driver.executeScript<string>('return navigator.userAgent');
        await (driver as any).sendDevToolsCommand('Emulation.setUserAgentOverride', {
            userAgent: ua.replace('HeadlessChrome', 'Chrome')
        });
    } catch (error) {
        console.warn('🌐 Could not override user agent:', (error as Error).message);
    }
    return driver;
}

function scheduleIdleShutdown(): void {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
        console.log('🌐 Closing idle headless Chrome');
        shutdownBrowser();
    }, IDLE_SHUTDOWN_MS);
    idleTimer.unref();
}

function isSessionError(error: unknown): boolean {
    const name = (error as Error)?.name ?? '';
    const message = (error as Error)?.message ?? '';
    return name === 'NoSuchSessionError'
        || /invalid session id|session deleted|chrome not reachable|disconnected/i.test(message);
}
