#!/usr/bin/env ts-node
/**
 * Page exploration script - captures screenshots and page source for debugging
 * Usage: npx ts-node scripts/explore-page.ts <url> [output-prefix]
 *
 * Example:
 *   npx ts-node scripts/explore-page.ts https://nitter.tiekoetter.com/elonmusk nitter
 *   npx ts-node scripts/explore-page.ts https://www.patreon.com/login patreon-login
 */

import { Builder, By, WebDriver } from 'selenium-webdriver';
import chrome from 'selenium-webdriver/chrome';
import * as fs from 'fs';
import * as path from 'path';

async function createDriver(): Promise<WebDriver> {
    const options = new chrome.Options();
    options.addArguments(
        '--headless',
        '--disable-gpu',
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--window-size=1920,1080',
        '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    return new Builder()
        .forBrowser('chrome')
        .setChromeOptions(options)
        .build();
}

async function main() {
    const url = process.argv[2];
    const prefix = process.argv[3] || 'page';

    if (!url) {
        console.error('Usage: npx ts-node scripts/explore-page.ts <url> [output-prefix]');
        console.error('Example: npx ts-node scripts/explore-page.ts https://nitter.tiekoetter.com/jack nitter');
        process.exit(1);
    }

    const outputDir = path.join(__dirname, '..', 'debug-output');
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    let driver: WebDriver | null = null;

    try {
        console.log(`\n🚀 Starting browser...`);
        driver = await createDriver();

        console.log(`📡 Navigating to: ${url}`);
        await driver.get(url);

        console.log(`⏳ Waiting for page to load...`);
        await driver.sleep(5000);

        // Capture screenshot
        const screenshot = await driver.takeScreenshot();
        const screenshotPath = path.join(outputDir, `${prefix}-screenshot.png`);
        fs.writeFileSync(screenshotPath, screenshot, 'base64');
        console.log(`📸 Screenshot saved: ${screenshotPath}`);

        // Capture page source
        const pageSource = await driver.getPageSource();
        const sourcePath = path.join(outputDir, `${prefix}-source.html`);
        fs.writeFileSync(sourcePath, pageSource);
        console.log(`📄 Page source saved: ${sourcePath}`);

        // Get current URL (might have redirected)
        const currentUrl = await driver.getCurrentUrl();
        console.log(`📍 Current URL: ${currentUrl}`);

        // Try to identify key elements
        console.log(`\n🔍 Identifying key elements...\n`);

        const elementTypes = [
            { name: 'Forms', selector: 'form' },
            { name: 'Inputs', selector: 'input' },
            { name: 'Buttons', selector: 'button' },
            { name: 'Links', selector: 'a' },
            { name: 'Contenteditable', selector: '[contenteditable="true"]' },
            { name: 'Textareas', selector: 'textarea' },
            { name: 'Timeline items', selector: '.timeline-item, .tweet, [class*="tweet"]' },
        ];

        for (const { name, selector } of elementTypes) {
            try {
                const elements = await driver.findElements(By.css(selector));
                const visibleCount = await Promise.all(
                    elements.slice(0, 20).map(async el => {
                        try { return await el.isDisplayed(); }
                        catch { return false; }
                    })
                ).then(results => results.filter(Boolean).length);

                if (elements.length > 0) {
                    console.log(`  ${name}: ${elements.length} found (${visibleCount} visible)`);

                    // Show first few elements' attributes
                    for (const el of elements.slice(0, 3)) {
                        try {
                            const id = await el.getAttribute('id');
                            const name = await el.getAttribute('name');
                            const type = await el.getAttribute('type');
                            const placeholder = await el.getAttribute('placeholder');
                            const className = await el.getAttribute('class');

                            const attrs = [];
                            if (id) attrs.push(`id="${id}"`);
                            if (name) attrs.push(`name="${name}"`);
                            if (type) attrs.push(`type="${type}"`);
                            if (placeholder) attrs.push(`placeholder="${placeholder}"`);
                            if (className) attrs.push(`class="${className.substring(0, 50)}"`);

                            if (attrs.length > 0) {
                                console.log(`    - ${attrs.join(' ')}`);
                            }
                        } catch {}
                    }
                }
            } catch {}
        }

        // Try to extract text content summary
        console.log(`\n📝 Page text preview:`);
        const bodyText = await driver.findElement(By.css('body')).getText();
        console.log(bodyText.substring(0, 1000).replace(/\n+/g, '\n') + '...');

    } catch (error) {
        console.error(`\n❌ Error:`, error);
    } finally {
        if (driver) {
            await driver.quit();
            console.log(`\n🧹 Browser closed`);
        }
    }
}

main().catch(console.error);
