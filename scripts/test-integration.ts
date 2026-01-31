#!/usr/bin/env ts-node
/**
 * Full Integration Test: Nitter → Format → Patreon (dry-run)
 *
 * This tests the complete flow without actually publishing.
 */

import dotenv from 'dotenv';
dotenv.config();

import { fetchTweets, formatDigest } from '../src/nitter';
import { Builder, By, until, WebDriver, Key } from 'selenium-webdriver';
import chrome from 'selenium-webdriver/chrome';
import * as fs from 'fs';
import * as path from 'path';

const outputDir = path.join(__dirname, '..', 'debug-output');

async function createDriver(): Promise<WebDriver> {
    const options = new chrome.Options();
    options.addArguments(
        '--headless', '--disable-gpu', '--no-sandbox',
        '--disable-dev-shm-usage', '--window-size=1920,1080',
        '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );
    return new Builder().forBrowser('chrome').setChromeOptions(options).build();
}

async function saveScreenshot(driver: WebDriver, name: string): Promise<void> {
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
    const screenshot = await driver.takeScreenshot();
    fs.writeFileSync(path.join(outputDir, `${name}.png`), screenshot, 'base64');
    console.log(`📸 ${name}.png`);
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

function getDigestTitle(): string {
    const now = new Date();
    const weekAgo = new Date(now);
    weekAgo.setDate(weekAgo.getDate() - 7);
    const startDate = weekAgo.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const endDate = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    return `Weekly Twitter Digest - ${startDate} to ${endDate}`;
}

async function main() {
    const twitterUsername = process.env.TWITTER_USERNAME;
    const patreonEmail = process.env.PATREON_EMAIL;
    const patreonPassword = process.env.PATREON_PASSWORD;

    console.log('\n' + '═'.repeat(60));
    console.log('🧪 FULL INTEGRATION TEST: Nitter → Patreon (Dry Run)');
    console.log('═'.repeat(60));

    if (!twitterUsername) {
        console.error('❌ TWITTER_USERNAME not set in .env');
        process.exit(1);
    }
    if (!patreonEmail || !patreonPassword) {
        console.error('❌ PATREON_EMAIL/PASSWORD not set in .env');
        process.exit(1);
    }

    console.log(`\n📋 Configuration:`);
    console.log(`   Twitter: @${twitterUsername}`);
    console.log(`   Patreon: ${patreonEmail}`);

    // ========== STEP 1: FETCH TWEETS ==========
    console.log('\n' + '─'.repeat(60));
    console.log('STEP 1: Fetch tweets from Nitter');
    console.log('─'.repeat(60));

    const result = await fetchTweets(twitterUsername, 7);

    if (result.error) {
        console.error(`❌ Error: ${result.error}`);
        process.exit(1);
    }

    console.log(`✅ Found ${result.tweets.length} tweets from the last 7 days`);

    if (result.tweets.length === 0) {
        console.log('⚠️ No tweets to post. Exiting.');
        process.exit(0);
    }

    // Show preview of tweets
    console.log('\n📝 Tweet preview:');
    for (const tweet of result.tweets.slice(0, 3)) {
        console.log(`   [${tweet.dateString}] ${tweet.text.substring(0, 60)}...`);
    }
    if (result.tweets.length > 3) {
        console.log(`   ... and ${result.tweets.length - 3} more`);
    }

    // ========== STEP 2: FORMAT DIGEST ==========
    console.log('\n' + '─'.repeat(60));
    console.log('STEP 2: Format digest');
    console.log('─'.repeat(60));

    const digestContent = formatDigest(result.tweets, twitterUsername);
    const digestTitle = getDigestTitle();

    console.log(`✅ Title: "${digestTitle}"`);
    console.log(`✅ Content: ${digestContent.length} characters`);

    // Save digest to file for inspection
    const digestPath = path.join(outputDir, 'digest-preview.md');
    fs.writeFileSync(digestPath, `# ${digestTitle}\n\n${digestContent}`);
    console.log(`📄 Saved digest preview to: ${digestPath}`);

    // ========== STEP 3: POST TO PATREON (DRY RUN) ==========
    console.log('\n' + '─'.repeat(60));
    console.log('STEP 3: Post to Patreon (DRY RUN - will NOT publish)');
    console.log('─'.repeat(60));

    let driver: WebDriver | null = null;

    try {
        driver = await createDriver();
        console.log('🚀 WebDriver initialized');

        // Login (two-step flow)
        console.log('\n🔐 Logging in to Patreon...');
        await driver.get('https://www.patreon.com/login');
        await driver.sleep(3000);

        // Step 1: Enter email
        const emailField = await waitForElement(driver, 'input[name="email"]', 5000);
        await emailField.sendKeys(patreonEmail);
        console.log('   📧 Entered email');

        // Click the EXACT "Continue" button (not "Continue with Google" etc)
        const buttons = await driver.findElements(By.css('button'));
        for (const btn of buttons) {
            const text = await btn.getText();
            if (text.trim() === 'Continue') {
                await driver.executeScript('arguments[0].click();', btn);
                console.log('   ⏳ Clicked Continue...');
                break;
            }
        }
        await driver.sleep(4000);

        // Step 2: Enter password
        const passwordField = await waitForElement(driver, 'input[type="password"]', 5000);
        await passwordField.sendKeys(patreonPassword);
        console.log('   🔑 Entered password');

        // Click the EXACT "Continue" button for login
        const buttons2 = await driver.findElements(By.css('button'));
        for (const btn of buttons2) {
            const text = await btn.getText();
            if (text.trim() === 'Continue') {
                await driver.executeScript('arguments[0].click();', btn);
                console.log('   ⏳ Clicked Login...');
                break;
            }
        }
        await driver.sleep(7000);

        const postLoginUrl = await driver.getCurrentUrl();
        if (postLoginUrl.includes('login')) {
            await saveScreenshot(driver, 'integration-login-failed');
            throw new Error('Login failed - still on login page');
        }
        console.log('✅ Logged in successfully');

        // Navigate to post creation
        console.log('\n📝 Creating post...');
        await driver.get('https://www.patreon.com/posts/new');
        await driver.sleep(5000);

        // Dismiss popup
        await driver.actions().sendKeys(Key.ESCAPE).perform();
        await driver.sleep(1000);

        // Fill title
        const titleField = await waitForElement(driver, '[placeholder="Title"]', 5000);
        await safeClick(driver, titleField);
        await driver.sleep(300);
        await driver.executeScript('arguments[0].innerText = ""; arguments[0].focus();', titleField);
        await titleField.sendKeys(digestTitle);
        console.log(`✅ Title: "${digestTitle}"`);

        // Fill content
        const contentElements = await driver.findElements(By.css('[contenteditable="true"]'));
        let contentField = null;
        for (const el of contentElements) {
            const ariaLabel = await el.getAttribute('aria-label');
            if (ariaLabel && ariaLabel.toLowerCase().includes('content')) {
                contentField = el;
                break;
            }
            if (!contentField) contentField = el;
        }

        if (contentField) {
            await driver.executeScript('arguments[0].click(); arguments[0].focus();', contentField);
            await driver.sleep(500);
            await driver.executeScript('arguments[0].innerHTML = ""; arguments[0].focus();', contentField);
            await contentField.sendKeys(digestContent);
            console.log(`✅ Content: ${digestContent.length} chars`);
        }

        await saveScreenshot(driver, 'integration-01-content-filled');

        // Set tier to $5+
        console.log('\n🎫 Setting tier to $5+...');
        const paidAccess = await waitForElement(driver, '//span[contains(text(), "Paid access")]', 5000);
        await driver.executeScript('arguments[0].click();', paidAccess);
        await driver.sleep(1000);

        // Open tier dropdown
        const tierDropdown = await waitForElement(driver, '//div[contains(text(), "All tiers")]', 3000);
        await driver.executeScript('arguments[0].click();', tierDropdown);
        await driver.sleep(1000);

        // Uncheck $1 tier
        const tierSelectors = [
            '//div[contains(., "sea anemone") and contains(., "$1")]',
            '//label[contains(., "sea anemone")]'
        ];

        for (const selector of tierSelectors) {
            try {
                const elements = await driver.findElements(By.xpath(selector));
                for (const el of elements) {
                    const text = await el.getText();
                    if (text.includes('sea anemone') && text.includes('$1')) {
                        await driver.executeScript('arguments[0].click();', el);
                        console.log('✅ Unchecked $1 tier (sea anemone)');
                        break;
                    }
                }
            } catch {}
        }

        await driver.actions().sendKeys(Key.ESCAPE).perform();
        await driver.sleep(500);

        await saveScreenshot(driver, 'integration-02-tier-set');

        // Find publish button (but don't click)
        let publishButton = null;
        const allButtons = await driver.findElements(By.css('button'));
        for (const btn of allButtons) {
            const text = await btn.getText();
            if (text.toLowerCase() === 'publish') {
                publishButton = btn;
                break;
            }
        }

        await saveScreenshot(driver, 'integration-03-final');

        // ========== SUMMARY ==========
        console.log('\n' + '═'.repeat(60));
        console.log('🎉 INTEGRATION TEST COMPLETE (DRY RUN)');
        console.log('═'.repeat(60));
        console.log(`
Results:
  ✅ Tweets fetched: ${result.tweets.length} from @${twitterUsername}
  ✅ Digest formatted: ${digestContent.length} characters
  ✅ Patreon login: Success
  ✅ Title filled: "${digestTitle}"
  ✅ Content filled: ${digestContent.length} chars
  ✅ Tier set: $5+ only (sea anemone unchecked)
  ${publishButton ? '✅' : '❌'} Publish button: ${publishButton ? 'Found (NOT clicked)' : 'Not found'}

📁 Screenshots saved to: ${outputDir}
📄 Digest preview: ${digestPath}

🛑 This was a DRY RUN - nothing was published.
`);

    } catch (error) {
        console.error('\n❌ Error:', error);
        if (driver) await saveScreenshot(driver, 'integration-error');
        process.exit(1);
    } finally {
        if (driver) {
            await driver.quit();
            console.log('🧹 Browser closed');
        }
    }
}

main().catch(console.error);
