#!/usr/bin/env ts-node
/**
 * Manual Patreon login helper - runs in NON-HEADLESS mode
 *
 * This script opens a visible browser window so you can:
 * 1. Complete any Cloudflare challenges
 * 2. Log in to Patreon manually
 *
 * The session will be saved to .chrome-profile for future headless runs.
 *
 * Usage: npx ts-node scripts/patreon-login.ts
 */

import dotenv from 'dotenv';
dotenv.config();

import { Builder, By, until, WebDriver } from 'selenium-webdriver';
import chrome from 'selenium-webdriver/chrome';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';

const CHROME_PROFILE_DIR = path.join(process.cwd(), '.chrome-profile');

async function createVisibleDriver(): Promise<WebDriver> {
    if (!fs.existsSync(CHROME_PROFILE_DIR)) {
        fs.mkdirSync(CHROME_PROFILE_DIR, { recursive: true });
    }

    const options = new chrome.Options();
    options.addArguments(
        // NO --headless flag - this opens a visible window
        '--disable-gpu',
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--window-size=1200,800',
        `--user-data-dir=${CHROME_PROFILE_DIR}`,
        '--disable-blink-features=AutomationControlled',
        '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    options.excludeSwitches('enable-automation');

    return new Builder()
        .forBrowser('chrome')
        .setChromeOptions(options)
        .build();
}

function waitForEnter(prompt: string): Promise<void> {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    return new Promise((resolve) => {
        rl.question(prompt, () => {
            rl.close();
            resolve();
        });
    });
}

async function main() {
    console.log(`
╔════════════════════════════════════════════════════════════════╗
║           PATREON LOGIN HELPER (Non-Headless Mode)             ║
╠════════════════════════════════════════════════════════════════╣
║  A Chrome window will open. Please:                            ║
║    1. Complete any Cloudflare challenges                       ║
║    2. Log in to Patreon with your credentials                  ║
║    3. Wait until you see the Patreon home/dashboard            ║
║    4. Come back here and press Enter                           ║
║                                                                 ║
║  The session will be saved for future headless runs.           ║
╚════════════════════════════════════════════════════════════════╝
`);

    let driver: WebDriver | null = null;

    try {
        console.log('🚀 Opening Chrome browser...\n');
        driver = await createVisibleDriver();

        await driver.get('https://www.patreon.com/login');
        console.log('📍 Navigated to Patreon login page');
        console.log('👆 Please complete the login in the browser window.\n');

        await waitForEnter('Press Enter when you have logged in successfully...');

        // Verify login succeeded
        const currentUrl = await driver.getCurrentUrl();
        const pageTitle = await driver.getTitle();

        console.log(`\n📍 Current URL: ${currentUrl}`);
        console.log(`📍 Page title: ${pageTitle}`);

        if (currentUrl.includes('login')) {
            console.log('\n⚠️  Warning: Still on login page. Session may not be saved correctly.');
        } else {
            console.log('\n✅ Login appears successful!');
            console.log(`📁 Session saved to: ${CHROME_PROFILE_DIR}`);
            console.log('\n🎉 You can now use the headless Patreon posting commands.');
        }

    } catch (error) {
        console.error('\n❌ Error:', error);
        process.exit(1);
    } finally {
        if (driver) {
            console.log('\n🧹 Closing browser...');
            await driver.quit();
        }
    }
}

main().catch(console.error);
