/**
 * Patreon poster - Posts content to Patreon via browser automation
 */

import { Builder, By, until, WebDriver, Key } from 'selenium-webdriver';
import chrome from 'selenium-webdriver/chrome';

export interface PatreonPostResult {
    success: boolean;
    error?: string;
    postUrl?: string;
}

/**
 * Create a configured Chrome WebDriver
 */
async function createDriver(): Promise<WebDriver> {
    const options = new chrome.Options();
    options.addArguments(
        '--headless',
        '--disable-gpu',
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--disable-software-rasterizer',
        '--disable-extensions',
        '--remote-debugging-port=9224',
        '--window-size=1920,1080',
        '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    return new Builder()
        .forBrowser('chrome')
        .setChromeOptions(options)
        .build();
}

/**
 * Wait for element to be visible and return it
 */
async function waitForElement(driver: WebDriver, selector: string, timeout: number = 10000): Promise<any> {
    const locator = selector.startsWith('/') ? By.xpath(selector) : By.css(selector);
    await driver.wait(until.elementLocated(locator), timeout);
    const element = await driver.findElement(locator);
    await driver.wait(until.elementIsVisible(element), timeout);
    return element;
}

/**
 * Safe click that scrolls element into view first
 */
async function safeClick(driver: WebDriver, element: any): Promise<void> {
    await driver.executeScript('arguments[0].scrollIntoView({behavior: "smooth", block: "center"});', element);
    await driver.sleep(500);
    await element.click();
}

/**
 * Log in to Patreon (two-step flow: email -> password)
 */
async function loginToPatreon(driver: WebDriver, email: string, password: string): Promise<boolean> {
    console.log('🔐 Logging in to Patreon...');

    try {
        await driver.get('https://www.patreon.com/login');
        await driver.sleep(3000);

        // Step 1: Enter email
        const emailSelectors = [
            'input[name="email"]',
            'input[type="email"]',
            '#email'
        ];

        let emailField = null;
        for (const selector of emailSelectors) {
            try {
                emailField = await waitForElement(driver, selector, 5000);
                break;
            } catch {
                continue;
            }
        }

        if (!emailField) {
            throw new Error('Could not find email input field');
        }

        await emailField.clear();
        await emailField.sendKeys(email);
        console.log('📧 Entered email');

        // Click Continue to proceed to password page
        const continueSelectors = [
            '//button[contains(text(), "Continue")]',
            'button[type="submit"]'
        ];

        let continueButton = null;
        for (const selector of continueSelectors) {
            try {
                continueButton = await waitForElement(driver, selector, 3000);
                const text = await continueButton.getText();
                if (text.toLowerCase().includes('continue')) {
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
        }

        // Step 2: Enter password
        let passwordField = null;
        try {
            passwordField = await waitForElement(driver, 'input[type="password"]', 5000);
        } catch {
            throw new Error('Could not find password field');
        }

        await passwordField.clear();
        await passwordField.sendKeys(password);
        console.log('🔑 Entered password');

        // Click Continue/Login button
        let loginButton = null;
        for (const selector of continueSelectors) {
            try {
                loginButton = await waitForElement(driver, selector, 3000);
                break;
            } catch {
                continue;
            }
        }

        if (loginButton) {
            await safeClick(driver, loginButton);
        } else {
            await passwordField.sendKeys(Key.RETURN);
        }

        console.log('⏳ Waiting for login to complete...');
        await driver.sleep(6000);

        const currentUrl = await driver.getCurrentUrl();
        console.log(`📍 Post-login URL: ${currentUrl}`);

        if (currentUrl.includes('login')) {
            throw new Error('Login failed - still on login page');
        }

        console.log('✅ Successfully logged in to Patreon');
        return true;

    } catch (error) {
        console.error('❌ Login error:', error);
        throw error;
    }
}

/**
 * Create a new post on Patreon
 */
async function createPost(
    driver: WebDriver,
    title: string,
    content: string,
    tierPrice: number = 5
): Promise<string | null> {
    console.log('📝 Creating new Patreon post...');

    try {
        // Navigate to post creation page
        await driver.get('https://www.patreon.com/posts/new');
        await driver.sleep(5000);

        const currentUrl = await driver.getCurrentUrl();
        console.log(`📍 Post creation URL: ${currentUrl}`);

        if (currentUrl.includes('login')) {
            throw new Error('Not authenticated - redirected to login');
        }

        // Dismiss any popups/modals with Escape key
        try {
            await driver.actions().sendKeys(Key.ESCAPE).perform();
            await driver.sleep(1000);
            console.log('📍 Dismissed any popups');
        } catch {}

        // Find and fill title field
        const titleSelectors = [
            '[placeholder="Title"]',
            '[data-placeholder="Title"]',
            'h1[contenteditable="true"]'
        ];

        let titleField = null;
        for (const selector of titleSelectors) {
            try {
                titleField = await waitForElement(driver, selector, 5000);
                console.log(`✅ Found title field: ${selector}`);
                break;
            } catch {
                continue;
            }
        }

        if (titleField) {
            await safeClick(driver, titleField);
            await driver.sleep(300);

            const tagName = await titleField.getTagName();
            const isContentEditable = await titleField.getAttribute('contenteditable');

            if (tagName === 'input' || tagName === 'textarea') {
                await titleField.clear();
                await titleField.sendKeys(title);
            } else if (isContentEditable === 'true') {
                await driver.executeScript('arguments[0].innerText = ""; arguments[0].focus();', titleField);
                await titleField.sendKeys(title);
            } else {
                await titleField.sendKeys(title);
            }
            console.log(`📋 Entered title: "${title}"`);
        } else {
            console.log('⚠️ Could not find title field');
        }

        // Find and fill content editor
        const contentSelectors = [
            '[contenteditable="true"]',
            '.ProseMirror',
            '[role="textbox"]',
            'textarea'
        ];

        let contentField = null;
        for (const selector of contentSelectors) {
            try {
                const elements = await driver.findElements(By.css(selector));
                for (const el of elements) {
                    if (await el.isDisplayed()) {
                        // Make sure we get the content editor, not the title
                        const ariaLabel = await el.getAttribute('aria-label');
                        if (ariaLabel && ariaLabel.toLowerCase().includes('content')) {
                            contentField = el;
                            break;
                        }
                        // If no specific label, take the second contenteditable (first is usually title)
                        if (!contentField) {
                            contentField = el;
                        }
                    }
                }
                if (contentField) {
                    console.log(`✅ Found content field: ${selector}`);
                    break;
                }
            } catch {
                continue;
            }
        }

        if (contentField) {
            // Use JavaScript click to avoid overlay issues
            await driver.executeScript('arguments[0].click(); arguments[0].focus();', contentField);
            await driver.sleep(500);

            const tagName = await contentField.getTagName();
            if (tagName === 'textarea') {
                await contentField.clear();
                await contentField.sendKeys(content);
            } else {
                await driver.executeScript('arguments[0].innerHTML = ""; arguments[0].focus();', contentField);
                await contentField.sendKeys(content);
            }
            console.log('📝 Entered post content');
        } else {
            console.log('⚠️ Could not find content editor');
        }

        // Set paid tier access
        await setPostTier(driver, tierPrice);

        await driver.sleep(2000);

        // Find and click publish button
        const publishSelectors = [
            '//button[contains(text(), "Publish")]',
            'button[data-tag="publish-button"]',
            '[data-testid="publish-button"]'
        ];

        let publishButton = null;
        for (const selector of publishSelectors) {
            try {
                publishButton = await waitForElement(driver, selector, 5000);
                const text = await publishButton.getText();
                if (text.toLowerCase().includes('publish')) {
                    console.log(`✅ Found publish button: "${text}"`);
                    break;
                }
            } catch {
                continue;
            }
        }

        if (!publishButton) {
            // Find by searching all buttons
            const buttons = await driver.findElements(By.css('button'));
            for (const btn of buttons) {
                try {
                    const text = await btn.getText();
                    if (text.toLowerCase() === 'publish' && await btn.isDisplayed()) {
                        publishButton = btn;
                        console.log('✅ Found publish button via text search');
                        break;
                    }
                } catch {}
            }
        }

        if (!publishButton) {
            throw new Error('Could not find publish button');
        }

        await safeClick(driver, publishButton);
        console.log('🚀 Clicked publish button');

        // Wait for post to be created
        await driver.sleep(5000);

        const postUrl = await driver.getCurrentUrl();
        console.log(`📍 Post URL: ${postUrl}`);

        if (postUrl.includes('/posts/') && !postUrl.includes('/new')) {
            return postUrl;
        }

        return null;

    } catch (error) {
        console.error('❌ Error creating post:', error);
        throw error;
    }
}

/**
 * Set the access tier for a post (restricts to $5+ tiers)
 */
async function setPostTier(driver: WebDriver, tierPrice: number): Promise<void> {
    console.log(`🎫 Setting post tier to $${tierPrice}+ paid access...`);

    try {
        // Look for "Paid access" option in the settings panel
        const paidAccessSelectors = [
            '//span[contains(text(), "Paid access")]',
            '//div[contains(text(), "Paid access")]',
            '[aria-label="Paid access"]',
            'input[aria-label="Paid access"]'
        ];

        let paidOption = null;
        for (const selector of paidAccessSelectors) {
            try {
                paidOption = await waitForElement(driver, selector, 3000);
                console.log(`✅ Found paid access option`);
                break;
            } catch {
                continue;
            }
        }

        if (paidOption) {
            await driver.executeScript('arguments[0].click();', paidOption);
            await driver.sleep(1000);
            console.log('✅ Selected paid access');

            // Open the tier dropdown to select specific tiers
            try {
                // Find and click the "All tiers" dropdown
                const tierDropdownSelectors = [
                    '//div[contains(text(), "All tiers")]',
                    '//button[contains(text(), "All tiers")]',
                    '//span[contains(text(), "All tiers")]'
                ];

                let tierDropdown = null;
                for (const selector of tierDropdownSelectors) {
                    try {
                        tierDropdown = await waitForElement(driver, selector, 3000);
                        break;
                    } catch {
                        continue;
                    }
                }

                if (tierDropdown) {
                    await driver.executeScript('arguments[0].click();', tierDropdown);
                    await driver.sleep(1000);
                    console.log('✅ Opened tier dropdown');

                    // Find and uncheck tiers below $5 by clicking their row
                    // Look for divs containing tier name and price, click to toggle
                    const tierSelectors = [
                        '//label[contains(., "sea anemone")]',
                        '//div[contains(., "sea anemone") and contains(., "$1")]',
                        '//span[contains(text(), "sea anemone")]/..',
                        '//div[contains(text(), "sea anemone")]'
                    ];

                    let uncheckedTier = false;
                    for (const selector of tierSelectors) {
                        try {
                            const elements = await driver.findElements(By.xpath(selector));
                            for (const el of elements) {
                                const text = await el.getText();
                                if (text.includes('sea anemone') && text.includes('$1')) {
                                    await driver.executeScript('arguments[0].click();', el);
                                    console.log('✅ Unchecked sea anemone ($1) tier');
                                    uncheckedTier = true;
                                    await driver.sleep(500);
                                    break;
                                }
                            }
                            if (uncheckedTier) break;
                        } catch {
                            continue;
                        }
                    }

                    if (!uncheckedTier) {
                        // Fallback: try clicking just the span
                        try {
                            const span = await driver.findElement(By.xpath('//span[text()="sea anemone"]'));
                            await driver.executeScript('arguments[0].click();', span);
                            console.log('✅ Unchecked sea anemone tier (via span)');
                        } catch {
                            console.log('📍 Could not find $1 tier to uncheck');
                        }
                    }

                    // Close the dropdown
                    await driver.actions().sendKeys(Key.ESCAPE).perform();
                    await driver.sleep(500);
                }
            } catch (e) {
                console.log(`📍 Could not configure specific tiers: ${e}`);
            }
        } else {
            console.log('⚠️ Paid access option not found');
        }

    } catch (error) {
        console.log('⚠️ Error setting tier:', error);
    }
}

/**
 * Post content to Patreon
 */
export async function postToPatreon(
    title: string,
    content: string,
    tierPrice: number = 5
): Promise<PatreonPostResult> {
    const email = process.env.PATREON_EMAIL;
    const password = process.env.PATREON_PASSWORD;

    if (!email || !password) {
        return {
            success: false,
            error: 'PATREON_EMAIL and PATREON_PASSWORD must be set in .env'
        };
    }

    let driver: WebDriver | null = null;

    try {
        driver = await createDriver();
        console.log('🚀 WebDriver initialized for Patreon posting');

        // Login
        await loginToPatreon(driver, email, password);

        // Create post
        const postUrl = await createPost(driver, title, content, tierPrice);

        if (postUrl) {
            return {
                success: true,
                postUrl
            };
        } else {
            return {
                success: false,
                error: 'Post may have been created but could not confirm URL'
            };
        }

    } catch (error) {
        console.error('❌ Error posting to Patreon:', error);
        return {
            success: false,
            error: `${error}`
        };
    } finally {
        if (driver) {
            await driver.quit();
            console.log('🧹 WebDriver closed');
        }
    }
}
