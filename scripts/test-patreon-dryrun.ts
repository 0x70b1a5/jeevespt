#!/usr/bin/env ts-node
/**
 * Dry-run test for Patreon posting - fills form but does NOT post
 * Usage: npx ts-node scripts/test-patreon-dryrun.ts
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
        '--disable-software-rasterizer',
        '--disable-extensions',
        '--window-size=1920,1080',
        '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    return new Builder()
        .forBrowser('chrome')
        .setChromeOptions(options)
        .build();
}

async function saveScreenshot(driver: WebDriver, name: string): Promise<void> {
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }
    const screenshot = await driver.takeScreenshot();
    const filepath = path.join(outputDir, `${name}.png`);
    fs.writeFileSync(filepath, screenshot, 'base64');
    console.log(`📸 Screenshot saved: ${filepath}`);
}

async function savePageSource(driver: WebDriver, name: string): Promise<void> {
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }
    const source = await driver.getPageSource();
    const filepath = path.join(outputDir, `${name}.html`);
    fs.writeFileSync(filepath, source);
    console.log(`📄 Page source saved: ${filepath}`);
}

async function waitForElement(driver: WebDriver, selector: string, timeout: number = 10000): Promise<any> {
    const locator = selector.startsWith('/') ? By.xpath(selector) : By.css(selector);
    await driver.wait(until.elementLocated(locator), timeout);
    const element = await driver.findElement(locator);
    await driver.wait(until.elementIsVisible(element), timeout);
    return element;
}

async function safeClick(driver: WebDriver, element: any): Promise<void> {
    await driver.executeScript('arguments[0].scrollIntoView({behavior: "smooth", block: "center"});', element);
    await driver.sleep(500);
    await element.click();
}

async function main() {
    console.log('\n🧪 Patreon Dry-Run Test (will NOT post)\n');

    const email = process.env.PATREON_EMAIL;
    const password = process.env.PATREON_PASSWORD;

    if (!email || !password) {
        console.error('❌ PATREON_EMAIL and PATREON_PASSWORD must be set in .env');
        process.exit(1);
    }

    console.log(`📧 Using email: ${email}`);

    let driver: WebDriver | null = null;

    try {
        driver = await createDriver();
        console.log('🚀 WebDriver initialized\n');

        // ========== STEP 1: LOGIN ==========
        console.log('═'.repeat(50));
        console.log('STEP 1: Login to Patreon');
        console.log('═'.repeat(50));

        await driver.get('https://www.patreon.com/login');
        await driver.sleep(3000);
        await saveScreenshot(driver, '01-login-page');

        // Find email field
        const emailSelectors = [
            'input[name="email"]',
            'input[type="email"]',
            '#email',
            'input[placeholder*="email" i]'
        ];

        let emailField = null;
        for (const selector of emailSelectors) {
            try {
                emailField = await waitForElement(driver, selector, 5000);
                console.log(`✅ Found email field: ${selector}`);
                break;
            } catch {
                continue;
            }
        }

        if (!emailField) {
            await saveScreenshot(driver, '01-error-no-email-field');
            await savePageSource(driver, '01-error-no-email-field');
            throw new Error('Could not find email input field');
        }

        await emailField.clear();
        await emailField.sendKeys(email);
        console.log('📧 Entered email');

        // Patreon uses two-step login: email first, then password
        // Click "Continue" button to proceed to password page
        const continueSelectors = [
            '//button[contains(text(), "Continue")]',
            'button[type="submit"]',
            'button[data-tag="continue-button"]'
        ];

        let continueButton = null;
        for (const selector of continueSelectors) {
            try {
                continueButton = await waitForElement(driver, selector, 3000);
                const text = await continueButton.getText();
                if (text.toLowerCase().includes('continue')) {
                    console.log(`✅ Found continue button: "${text}"`);
                    break;
                }
            } catch {
                continue;
            }
        }

        if (continueButton) {
            await safeClick(driver, continueButton);
            console.log('⏳ Clicked Continue, waiting for password page...');
            await driver.sleep(3000);
            await saveScreenshot(driver, '02-after-continue');
        }

        // Find password field (now on second page)
        let passwordField = null;
        const passwordSelectors = [
            'input[type="password"]',
            'input[name="password"]',
            '#password'
        ];

        for (const selector of passwordSelectors) {
            try {
                passwordField = await waitForElement(driver, selector, 5000);
                console.log(`✅ Found password field: ${selector}`);
                break;
            } catch {
                continue;
            }
        }

        if (!passwordField) {
            await saveScreenshot(driver, '02-error-no-password-field');
            await savePageSource(driver, '02-error-no-password-field');
            throw new Error('Could not find password field');
        }

        await passwordField.clear();
        await passwordField.sendKeys(password);
        console.log('🔑 Entered password');

        await saveScreenshot(driver, '03-credentials-entered');

        // Find and click login button
        const loginButtonSelectors = [
            'button[type="submit"]',
            '//button[contains(text(), "Log in")]',
            '//button[contains(text(), "Log In")]',
            'button[data-tag="login-button"]'
        ];

        let loginButton = null;
        for (const selector of loginButtonSelectors) {
            try {
                loginButton = await waitForElement(driver, selector, 3000);
                const text = await loginButton.getText();
                console.log(`✅ Found login button: "${text}"`);
                break;
            } catch {
                continue;
            }
        }

        if (!loginButton) {
            console.log('⚠️ Login button not found, pressing Enter...');
            await passwordField.sendKeys(Key.RETURN);
        } else {
            await safeClick(driver, loginButton);
        }

        console.log('⏳ Waiting for login to complete...');
        await driver.sleep(6000);

        const postLoginUrl = await driver.getCurrentUrl();
        console.log(`📍 Post-login URL: ${postLoginUrl}`);
        await saveScreenshot(driver, '03-post-login');

        if (postLoginUrl.includes('login')) {
            await savePageSource(driver, '03-login-failed');
            throw new Error('Login failed - still on login page');
        }

        console.log('✅ Login successful!\n');

        // ========== STEP 2: NAVIGATE TO POST CREATION ==========
        console.log('═'.repeat(50));
        console.log('STEP 2: Navigate to post creation');
        console.log('═'.repeat(50));

        await driver.get('https://www.patreon.com/posts/new');
        await driver.sleep(5000);

        const postPageUrl = await driver.getCurrentUrl();
        console.log(`📍 Post page URL: ${postPageUrl}`);
        await saveScreenshot(driver, '04-post-creation-page');

        if (postPageUrl.includes('login')) {
            throw new Error('Redirected to login - session not persisted');
        }

        // ========== STEP 3: DISMISS ANY POPUPS ==========
        console.log('\n' + '═'.repeat(50));
        console.log('STEP 3: Dismiss any popups/modals');
        console.log('═'.repeat(50));

        // Look for modal close buttons or dismiss buttons
        const dismissSelectors = [
            'button[aria-label="Close"]',
            'button[aria-label="close"]',
            '[aria-label="Close modal"]',
            '.modal-close',
            '//button[contains(@class, "close")]',
            '//button[contains(text(), "×")]',
            'svg[aria-label="Close"]',
            '[data-testid="close-button"]'
        ];

        for (const selector of dismissSelectors) {
            try {
                const closeBtn = await waitForElement(driver, selector, 2000);
                if (await closeBtn.isDisplayed()) {
                    console.log(`✅ Found close button: ${selector}`);
                    await safeClick(driver, closeBtn);
                    await driver.sleep(1000);
                    console.log('📍 Dismissed popup');
                    break;
                }
            } catch {
                continue;
            }
        }

        // Also try clicking outside any modal or pressing Escape
        try {
            await driver.actions().sendKeys(Key.ESCAPE).perform();
            await driver.sleep(500);
            console.log('📍 Sent Escape key');
        } catch {}

        await saveScreenshot(driver, '05-after-dismiss-popup');

        // ========== STEP 4: FILL POST FORM ==========
        console.log('\n' + '═'.repeat(50));
        console.log('STEP 4: Fill post form');
        console.log('═'.repeat(50));

        const testTitle = 'Weekly Twitter Digest - Jan 24 to Jan 31, 2026';
        const testContent = `# Weekly Twitter Digest - Jan 24 to Jan 31, 2026

**@testuser**

---

## Wednesday, January 29

> This is a sample tweet from the digest. It shows how tweets will be formatted in the Patreon post.

> Another tweet from the same day with some interesting content.

## Sunday, January 26

> A tweet from earlier in the week demonstrating the date grouping feature.

---

*5 tweets total*`;

        // Find title input - Patreon uses a contenteditable div or special input for title
        const titleSelectors = [
            '[data-placeholder="Title"]',
            '[placeholder="Title"]',
            'h1[contenteditable="true"]',
            'div[data-placeholder="Title"]',
            '[aria-label*="title" i]',
            'input[placeholder*="title" i]',
            'input[name="title"]'
        ];

        let titleField = null;
        for (const selector of titleSelectors) {
            try {
                titleField = await waitForElement(driver, selector, 3000);
                console.log(`✅ Found title field: ${selector}`);
                break;
            } catch {
                continue;
            }
        }

        if (!titleField) {
            // Look for editable elements that might be the title
            const editables = await driver.findElements(By.css('[contenteditable="true"], input'));
            console.log(`🔍 Found ${editables.length} editable elements, checking each...`);
            for (const el of editables) {
                try {
                    const placeholder = await el.getAttribute('placeholder') || await el.getAttribute('data-placeholder');
                    const ariaLabel = await el.getAttribute('aria-label');
                    const text = await el.getText();
                    const isDisplayed = await el.isDisplayed();

                    if (isDisplayed) {
                        console.log(`   - placeholder="${placeholder}", aria-label="${ariaLabel}", text="${text?.substring(0, 30)}"`);
                    }

                    if (isDisplayed && (
                        (placeholder && placeholder.toLowerCase().includes('title')) ||
                        (text && text.toLowerCase() === 'title') ||
                        (ariaLabel && ariaLabel.toLowerCase().includes('title'))
                    )) {
                        titleField = el;
                        console.log('   ✅ Using this element for title');
                        break;
                    }
                } catch {}
            }
        }

        if (titleField) {
            await safeClick(driver, titleField);
            await driver.sleep(300);

            const tagName = await titleField.getTagName();
            const isContentEditable = await titleField.getAttribute('contenteditable');

            if (tagName === 'input' || tagName === 'textarea') {
                await titleField.clear();
                await titleField.sendKeys(testTitle);
            } else if (isContentEditable === 'true') {
                // Clear and set via JS for contenteditable
                await driver.executeScript(`
                    arguments[0].innerText = '';
                    arguments[0].focus();
                `, titleField);
                await titleField.sendKeys(testTitle);
            } else {
                await titleField.sendKeys(testTitle);
            }
            console.log(`📋 Entered title: "${testTitle}"`);
        } else {
            console.log('⚠️ Could not find title field');
            await savePageSource(driver, '05-no-title-field');
        }

        await driver.sleep(1000);
        await saveScreenshot(driver, '05-title-entered');

        // Find content editor
        const contentSelectors = [
            '[contenteditable="true"]',
            '.ProseMirror',
            '[role="textbox"]',
            'textarea',
            '.editor-content'
        ];

        let contentField = null;
        for (const selector of contentSelectors) {
            try {
                const elements = await driver.findElements(By.css(selector));
                for (const el of elements) {
                    if (await el.isDisplayed()) {
                        contentField = el;
                        console.log(`✅ Found content field: ${selector}`);
                        break;
                    }
                }
                if (contentField) break;
            } catch {
                continue;
            }
        }

        if (!contentField) {
            console.log('⚠️ Could not find content editor');
            await savePageSource(driver, '06-no-content-field');
        } else {
            // Use JavaScript click to avoid overlay issues
            try {
                await driver.executeScript('arguments[0].click(); arguments[0].focus();', contentField);
            } catch {
                await safeClick(driver, contentField);
            }
            await driver.sleep(500);

            const tagName = await contentField.getTagName();
            if (tagName === 'textarea') {
                await contentField.clear();
                await contentField.sendKeys(testContent);
            } else {
                // For contenteditable divs - clear first, then set content
                await driver.executeScript(`
                    arguments[0].innerHTML = '';
                    arguments[0].focus();
                `, contentField);
                // Type the content instead of setting innerHTML for better compatibility
                await contentField.sendKeys(testContent);
            }
            console.log('📝 Entered post content');
        }

        await driver.sleep(1000);
        await saveScreenshot(driver, '06-content-entered');

        // ========== STEP 5: CHECK FOR TIER SELECTOR ==========
        console.log('\n' + '═'.repeat(50));
        console.log('STEP 5: Look for tier/access selector');
        console.log('═'.repeat(50));

        // From the screenshot, we see "Paid access" option in the right panel
        // We need to click on it to select paid tier
        const tierSelectors = [
            '//span[contains(text(), "Paid access")]',
            '//div[contains(text(), "Paid access")]',
            '[aria-label="Paid access"]',
            'input[aria-label="Paid access"]',
            '//label[contains(text(), "Paid access")]',
            '//span[contains(text(), "Paid members")]',
            '[data-tag="tier-selector"]'
        ];

        let tierOption = null;
        for (const selector of tierSelectors) {
            try {
                tierOption = await waitForElement(driver, selector, 3000);
                const text = await tierOption.getText();
                console.log(`✅ Found tier option: "${text}" (${selector})`);
                break;
            } catch {
                continue;
            }
        }

        if (!tierOption) {
            // Look in the Settings panel on the right
            console.log('🔍 Looking for tier options in settings panel...');
            const settingsElements = await driver.findElements(By.css('[class*="settings"], [class*="audience"], [class*="access"]'));
            for (const el of settingsElements) {
                try {
                    const text = await el.getText();
                    if (text.toLowerCase().includes('paid')) {
                        console.log(`   Found settings area with "paid": ${text.substring(0, 50)}...`);
                    }
                } catch {}
            }

            // Try finding radio buttons or checkboxes for access
            const radioInputs = await driver.findElements(By.css('input[type="radio"], input[type="checkbox"]'));
            for (const input of radioInputs) {
                try {
                    const ariaLabel = await input.getAttribute('aria-label');
                    const name = await input.getAttribute('name');
                    const isDisplayed = await input.isDisplayed();
                    if (isDisplayed || ariaLabel) {
                        console.log(`   Radio/checkbox: aria-label="${ariaLabel}", name="${name}"`);
                        if (ariaLabel && ariaLabel.toLowerCase().includes('paid')) {
                            tierOption = input;
                            break;
                        }
                    }
                } catch {}
            }
        }

        if (tierOption) {
            console.log('📍 Tier option found - clicking to select paid access');
            try {
                await driver.executeScript('arguments[0].click();', tierOption);
                await driver.sleep(1000);
                console.log('✅ Clicked tier option');
                await saveScreenshot(driver, '07-tier-selected');

                // Now explore the "All tiers" dropdown
                console.log('\n🔍 Looking for tier dropdown...');
                const allTiersSelectors = [
                    '//button[contains(text(), "All tiers")]',
                    '//div[contains(text(), "All tiers")]',
                    '[aria-label*="tier" i]'
                ];

                for (const selector of allTiersSelectors) {
                    try {
                        const dropdown = await waitForElement(driver, selector, 3000);
                        console.log(`✅ Found tier dropdown: ${selector}`);
                        await driver.executeScript('arguments[0].click();', dropdown);
                        await driver.sleep(1500);
                        await saveScreenshot(driver, '07b-tier-dropdown-open');

                        // Uncheck the $1 tier (sea anemone) by clicking its row
                        console.log('\n🎫 Unchecking $1 tier (sea anemone)...');

                        // Find elements containing "sea anemone" and click to toggle
                        const seaAnemoneSelectors = [
                            '//label[contains(., "sea anemone")]',
                            '//div[contains(., "sea anemone") and contains(., "$1")]',
                            '//span[contains(text(), "sea anemone")]/..',
                            '//div[contains(text(), "sea anemone")]'
                        ];

                        let clicked = false;
                        for (const selector of seaAnemoneSelectors) {
                            try {
                                const elements = await driver.findElements(By.xpath(selector));
                                for (const el of elements) {
                                    const text = await el.getText();
                                    if (text.includes('sea anemone') && text.includes('$1')) {
                                        console.log(`   Found: "${text.substring(0, 50)}..."`);
                                        await driver.executeScript('arguments[0].click();', el);
                                        console.log('   ✅ Clicked sea anemone row to uncheck');
                                        clicked = true;
                                        await driver.sleep(500);
                                        break;
                                    }
                                }
                                if (clicked) break;
                            } catch {}
                        }

                        if (!clicked) {
                            // Try finding by just the span text
                            try {
                                const span = await driver.findElement(By.xpath('//span[text()="sea anemone"]'));
                                await driver.executeScript('arguments[0].click();', span);
                                console.log('   ✅ Clicked sea anemone span');
                                clicked = true;
                            } catch {}
                        }

                        if (!clicked) {
                            console.log('   ⚠️ Could not find sea anemone tier to uncheck');
                        }

                        await driver.sleep(500);
                        await saveScreenshot(driver, '07c-after-tier-selection');
                        break;
                    } catch {
                        continue;
                    }
                }
            } catch (e) {
                console.log(`⚠️ Could not click tier: ${e}`);
            }
        } else {
            console.log('⚠️ Paid tier option not found - post might default to free/public');
        }

        // ========== STEP 6: IDENTIFY PUBLISH BUTTON ==========
        console.log('\n' + '═'.repeat(50));
        console.log('STEP 6: Identify publish button (NOT clicking)');
        console.log('═'.repeat(50));

        const publishSelectors = [
            'button[data-tag="publish-button"]',
            '//button[contains(text(), "Publish")]',
            '//button[contains(text(), "Post")]',
            '[data-testid="publish-button"]'
        ];

        let publishButton = null;
        for (const selector of publishSelectors) {
            try {
                publishButton = await waitForElement(driver, selector, 3000);
                const text = await publishButton.getText();
                console.log(`✅ Found publish button: "${text}"`);
                break;
            } catch {
                continue;
            }
        }

        if (!publishButton) {
            const buttons = await driver.findElements(By.css('button'));
            for (const btn of buttons) {
                try {
                    const text = await btn.getText();
                    if (text.toLowerCase().includes('publish') || text.toLowerCase().includes('post')) {
                        if (await btn.isDisplayed()) {
                            publishButton = btn;
                            console.log(`✅ Found publish button via text search: "${text}"`);
                            break;
                        }
                    }
                } catch {}
            }
        }

        if (publishButton) {
            console.log('🛑 Publish button identified - NOT clicking (dry run)');
        } else {
            console.log('⚠️ Could not find publish button');
        }

        // Final screenshot
        await saveScreenshot(driver, '08-final-form-state');
        await savePageSource(driver, '08-final-form-state');

        // ========== SUMMARY ==========
        console.log('\n' + '═'.repeat(50));
        console.log('DRY RUN COMPLETE');
        console.log('═'.repeat(50));
        console.log(`
Results:
  ✅ Login: Success
  ${titleField ? '✅' : '❌'} Title field: ${titleField ? 'Found and filled' : 'Not found'}
  ${contentField ? '✅' : '❌'} Content field: ${contentField ? 'Found and filled' : 'Not found'}
  ${tierOption ? '✅' : '⚠️'} Tier selector: ${tierOption ? 'Found and clicked' : 'Not found (may default to public)'}
  ${publishButton ? '✅' : '❌'} Publish button: ${publishButton ? 'Found (not clicked)' : 'Not found'}

Screenshots saved to: ${outputDir}
`);

    } catch (error) {
        console.error('\n❌ Error:', error);
        if (driver) {
            await saveScreenshot(driver, 'error-state');
            await savePageSource(driver, 'error-state');
        }
        process.exit(1);
    } finally {
        if (driver) {
            await driver.quit();
            console.log('🧹 Browser closed');
        }
    }
}

main().catch(console.error);
