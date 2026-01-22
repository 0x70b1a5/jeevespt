import fs from 'fs';
import {
    PollyClient,
    SynthesizeSpeechCommand,
    VoiceId,
} from '@aws-sdk/client-polly';
import { fromCognitoIdentityPool } from '@aws-sdk/credential-providers';

// AWS Polly configuration using Cognito for unauthenticated access
const POLLY_REGION = process.env.AWS_POLLY_REGION || 'us-west-2';
const COGNITO_IDENTITY_POOL_ID = process.env.AWS_COGNITO_IDENTITY_POOL_ID || '';

// Voice selection - using a voice that handles IPA well
const IPA_VOICE: VoiceId = 'Cristiano'; // Portuguese voice for eldritch sound

// Lazy-initialized Polly client
let pollyClient: PollyClient | null = null;

function getPollyClient(): PollyClient {
    if (!pollyClient) {
        if (!COGNITO_IDENTITY_POOL_ID) {
            throw new Error('AWS_COGNITO_IDENTITY_POOL_ID is required for IPA speech synthesis');
        }
        pollyClient = new PollyClient({
            region: POLLY_REGION,
            credentials: fromCognitoIdentityPool({
                clientConfig: { region: POLLY_REGION },
                identityPoolId: COGNITO_IDENTITY_POOL_ID,
            }),
        });
    }
    return pollyClient;
}

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
 * Wrap IPA text in SSML phoneme tags for Polly
 */
function wrapInSSML(ipaText: string): string {
    // Remove any forward slashes (IPA convention) and wrap in phoneme tags
    const cleanIPA = ipaText.replace(/\//g, '');
    return `<speak><phoneme alphabet="ipa" ph="${cleanIPA}"></phoneme></speak>`;
}

/**
 * Synthesize speech from IPA text using Amazon Polly
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
    const ssmlText = wrapInSSML(ipaText);

    console.log(`🎤 Synthesizing IPA speech via Polly for ${mode} (${text.length} chars)`);
    console.log(`   IPA: ${ipaText.substring(0, 100)}${ipaText.length > 100 ? '...' : ''}`);

    try {
        const command = new SynthesizeSpeechCommand({
            Engine: 'standard',
            OutputFormat: 'mp3',
            SampleRate: '16000',
            Text: ssmlText,
            TextType: 'ssml',
            VoiceId: IPA_VOICE,
        });

        const response = await getPollyClient().send(command);

        if (!response.AudioStream) {
            throw new Error('No audio stream returned from Polly');
        }

        // Convert the stream to a buffer and write to file
        const chunks: Uint8Array[] = [];
        for await (const chunk of response.AudioStream as AsyncIterable<Uint8Array>) {
            chunks.push(chunk);
        }
        const audioBuffer = Buffer.concat(chunks);

        await fs.promises.writeFile(filename, audioBuffer);

        console.log(`✅ IPA speech synthesized successfully via Polly: ${filename}`);
        return filename;
    } catch (error) {
        console.error('❌ Error synthesizing IPA speech via Polly:', error);
        throw error;
    }
}
