import fs from 'fs';
import { Builder, By, until, WebDriver } from 'selenium-webdriver';
import chrome from 'selenium-webdriver/chrome';

const IPA_READER_URL = 'http://ipa-reader.com';
const IPA_VOICE = 'Cristiano'; // Portuguese voice for eldritch sound

/**
 * Lugso orthography to IPA mapping
 * Lugso uses ASCII-friendly orthography that maps 1:1 to IPA
 */
const LUGSO_IPA_MAP: Record<string, string> = {
    'a': 'ʌ',
    'e': 'ʌ',
    'o': 'ʌ',
    'b': 'β',
    'p': 'ɸ',
    't': 'θ',
    'd': 'ð',
    '5': 'ʃ',
    '3': 'ʒ',
    'l': 'ɮ',
    'x': 'x',
    'g': 'ɣ',
    'h': 'χ',
    'y': 'j',
    'r': 'ɻ',
    "'": 'ʔ',
    '\u0323': ''
};

/**
 * Convert Lugso orthography to IPA
 */
export function lugsoToIPA(text: string): string {
    return text
        .toLowerCase()
        .split(' ')
        .map(word => {
            const chars = word.split('');
            let result = '';
            let firstVowel = false;

            for (const char of chars) {
                let ipaChar = LUGSO_IPA_MAP[char] ?? char;

                // Lugso stress rule: only first syllable is stressed
                // Convert all ʌ after the first vowel into ə
                if (firstVowel && ipaChar === 'ʌ') {
                    ipaChar = 'ə';
                }
                if (/[uiʌ]/.test(ipaChar)) {
                    firstVowel = true;
                }

                result += ipaChar;
            }
            return result;
        })
        .join(' ');
}

/**
 * Create a headless Chrome browser instance
 */
async function createBrowser(): Promise<WebDriver> {
    const options = new chrome.Options();
    options.addArguments('--headless');
    options.addArguments('--no-sandbox');
    options.addArguments('--disable-dev-shm-usage');
    options.addArguments('--disable-gpu');

    return new Builder()
        .forBrowser('chrome')
        .setChromeOptions(options)
        .build();
}

/**
 * Synthesize speech from IPA text using ipa-reader.com via browser automation
 * Returns the path to the generated audio file
 */
export async function synthesizeIPA(
    text: string,
    userId: string,
    mode: 'tokipona' | 'lugso'
): Promise<string> {
    const timestamp = Date.now();
    const filename = `ipa_speech_${userId}_${timestamp}.mp3`;

    // Convert to IPA if Lugso (toki pona is already IPA-like)
    const ipaText = mode === 'lugso' ? lugsoToIPA(text) : text;

    console.log(`🎤 Synthesizing IPA speech via ipa-reader.com for ${mode} (${text.length} chars)`);
    console.log(`   IPA: ${ipaText.substring(0, 100)}${ipaText.length > 100 ? '...' : ''}`);

    let driver: WebDriver | null = null;

    try {
        driver = await createBrowser();

        // Navigate to IPA Reader
        await driver.get(IPA_READER_URL);

        // Wait for the page to load and find the text input
        const textInput = await driver.wait(
            until.elementLocated(By.css('#ipa-text')),
            10000
        );

        // Clear and enter the IPA text
        await textInput.clear();
        await textInput.sendKeys(ipaText);

        // Select the voice
        const voiceSelect = await driver.findElement(By.css('#polly-voice'));
        const options = await voiceSelect.findElements(By.css('option'));

        for (const option of options) {
            const optionText = await option.getText();
            if (optionText.startsWith(IPA_VOICE)) {
                await option.click();
                break;
            }
        }

        // Find and click the speak button
        const speakButton = await driver.findElement(By.css('button#submit'));
        await speakButton.click();

        // Wait for the audio element to appear in div.audio
        const audioElement = await driver.wait(
            until.elementLocated(By.css('div.audio audio, div.audio source')),
            30000 // Give it up to 30 seconds for synthesis
        );

        // Wait a bit for the audio to be fully loaded
        await driver.sleep(1000);

        // Get the audio source URL
        let audioUrl = await audioElement.getAttribute('src');

        // If it's a source element, get from parent audio or the source itself
        if (!audioUrl) {
            const sourceElement = await driver.findElement(By.css('div.audio audio source'));
            audioUrl = await sourceElement.getAttribute('src');
        }

        if (!audioUrl) {
            // Try getting it from the audio element directly
            const audio = await driver.findElement(By.css('div.audio audio'));
            audioUrl = await audio.getAttribute('src');
        }

        if (!audioUrl) {
            throw new Error('Could not find audio URL from ipa-reader.com');
        }

        console.log(`   Audio URL: ${audioUrl.substring(0, 100)}...`);

        // Download the audio through the browser to preserve session/cookies
        const base64Audio = await driver.executeAsyncScript(`
            const callback = arguments[arguments.length - 1];
            fetch('${audioUrl}')
                .then(response => response.blob())
                .then(blob => {
                    const reader = new FileReader();
                    reader.onloadend = () => callback(reader.result);
                    reader.readAsDataURL(blob);
                })
                .catch(err => callback('ERROR:' + err.message));
        `) as string;

        if (base64Audio.startsWith('ERROR:')) {
            throw new Error(`Failed to download audio in browser: ${base64Audio}`);
        }

        // Strip the data URL prefix (e.g., "data:audio/mpeg;base64,")
        const base64Data = base64Audio.split(',')[1];
        const audioBuffer = Buffer.from(base64Data, 'base64');
        await fs.promises.writeFile(filename, audioBuffer);

        console.log(`✅ IPA speech synthesized successfully via ipa-reader.com: ${filename}`);
        return filename;

    } catch (error) {
        console.error('❌ Error synthesizing IPA speech via ipa-reader.com:', error);
        throw error;
    } finally {
        if (driver) {
            await driver.quit();
        }
    }
}
