import { localSecretScanner } from '../core/scanner.js';
export async function loadSecretScanner() {
    try {
        const external = await import('@funeste38/spyder/decoders/secrets');
        if (external && typeof external.scanFileForSecrets === 'function') {
            return { scanFileForSecrets: external.scanFileForSecrets };
        }
    }
    catch {
        // ignore
    }
    return localSecretScanner;
}
