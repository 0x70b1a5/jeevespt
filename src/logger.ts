/**
 * Prefixes every console log/warn/error/info line with a timestamp.
 *
 * The bot's logs were previously bare, which made it impossible to tell
 * *when* something happened (e.g. "did this response fail to send last
 * night, or this morning?"). Patching console once here adds timestamps to
 * all ~200 existing call sites without touching any of them.
 *
 * Import this module for its side effect as the very first thing in the
 * process entry point, before anything logs.
 */

function timestamp(): string {
    // Local time with timezone offset, so log lines are unambiguous about
    // when they happened relative to the machine the bot runs on.
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const offsetMin = -now.getTimezoneOffset();
    const sign = offsetMin >= 0 ? '+' : '-';
    const offH = pad(Math.floor(Math.abs(offsetMin) / 60));
    const offM = pad(Math.abs(offsetMin) % 60);
    return (
        `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ` +
        `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}` +
        `.${String(now.getMilliseconds()).padStart(3, '0')} ${sign}${offH}${offM}`
    );
}

type ConsoleMethod = 'log' | 'info' | 'warn' | 'error' | 'debug';

let installed = false;

export function installTimestampedLogging(): void {
    if (installed) return;
    installed = true;

    const methods: ConsoleMethod[] = ['log', 'info', 'warn', 'error', 'debug'];
    for (const method of methods) {
        const original = console[method].bind(console);
        console[method] = (...args: unknown[]) => {
            original(`[${timestamp()}]`, ...args);
        };
    }
}
