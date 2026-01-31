#!/usr/bin/env ts-node
/**
 * Quick script to explore tier dropdown options on Patreon
 */

import dotenv from 'dotenv';
dotenv.config();

import { Builder, By, until, WebDriver, Key } from 'selenium-webdriver';
import chrome from 'selenium-webdriver/chrome';
import * as fs from 'fs';
import * as path from 'path';

const outputDir = path.join(__dirname, '..', 'debug-output');

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
    return new Builder().forBrowser('chrome').setChromeOptions(options).build();
}

async function saveScreenshot(driver: WebDriver, name: string): Promise<void> {
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
    const screenshot = await driver.takeScreenshot();
    fs.writeFileSync(path.join(outputDir, `${name}.png`), screenshot, 'base64');
    console.log(`📸 Screenshot: ${name}.png`);
}

async function waitForElement(driver: WebDriver, selector: string, timeout: number = 10000): Promise<any> {
    const locator = selector.startsWith('/') ? By.xpath(selector) : By.css(selector);
    await driver.wait(until.elementLocated(locator), timeout);
    const element = await driver.findElement(locator);
    await driver.wait(until.elementIsVisible(element), timeout);
    return element;
}

async function main() {
    const email = process.env.PATREON_EMAIL!;
    const password = process.env.PATREON_PASSWORD!;
    let driver: WebDriver | null = null;

    try {
        driver = await createDriver();

        // Login
        await driver.get('https://www.patreon.com/login');
        await driver.sleep(3000);

        const emailField = await waitForElement(driver, 'input[name="email"]', 5000);
        await emailField.sendKeys(email);

        // Find continue button - try multiple approaches
        let continueBtn = null;
        const buttons = await driver.findElements(By.css('button'));
        for (const btn of buttons) {
            const text = await btn.getText();
            if (text.toLowerCase().includes('continue')) {
                continueBtn = btn;
                break;
            }
        }
        if (continueBtn) await continueBtn.click();
        await driver.sleep(3000);

        const passwordField = await waitForElement(driver, 'input[type="password"]', 5000);
        await passwordField.sendKeys(password);

        // Find login button again
        const buttons2 = await driver.findElements(By.css('button'));
        for (const btn of buttons2) {
            const text = await btn.getText();
            if (text.toLowerCase().includes('continue')) {
                await btn.click();
                break;
            }
        }
        await driver.sleep(6000);

        console.log('✅ Logged in');

        // Go to post creation
        await driver.get('https://www.patreon.com/posts/new');
        await driver.sleep(5000);

        // Dismiss popup
        await driver.actions().sendKeys(Key.ESCAPE).perform();
        await driver.sleep(1000);

        // Click "Paid access"
        const paidAccess = await waitForElement(driver, '//span[contains(text(), "Paid access")]', 5000);
        await driver.executeScript('arguments[0].click();', paidAccess);
        await driver.sleep(1000);
        console.log('✅ Selected Paid access');

        // Find and click the "All tiers" dropdown
        const allTiersBtn = await waitForElement(driver, '//button[contains(text(), "All tiers")]', 5000);
        await allTiersBtn.click();
        await driver.sleep(1000);

        await saveScreenshot(driver, 'tier-dropdown-open');
        console.log('📸 Captured tier dropdown');

        // List all visible options
        console.log('\n🎫 Available tier options:');
        const options = await driver.findElements(By.css('[role="option"], [role="menuitem"], [role="listbox"] li, [role="listbox"] div'));
        for (const opt of options) {
            try {
                const text = await opt.getText();
                if (text.trim()) console.log(`   - "${text.trim()}"`);
            } catch {}
        }

        // Also try finding checkboxes or labels in the dropdown
        const labels = await driver.findElements(By.css('label, [class*="tier"], [class*="option"]'));
        for (const label of labels) {
            try {
                const text = await label.getText();
                if (text.includes('$')) console.log(`   💰 "${text.trim()}"`);
            } catch {}
        }

    } catch (error) {
        console.error('❌ Error:', error);
        if (driver) await saveScreenshot(driver, 'tier-error');
    } finally {
        if (driver) await driver.quit();
    }
}

main();
