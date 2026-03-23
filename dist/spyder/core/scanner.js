import * as fs from 'fs/promises';
import * as path from 'path';
export const localSecretScanner = {
    async scanFileForSecrets(filePath) {
        const content = await fs.readFile(filePath, 'utf8').catch(() => null);
        if (!content)
            return [];
        const findings = [];
        const lines = content.split(/\r?\n/);
        const rules = [
            { name: 'api_key', regex: /(api[_-]?key|token|secret)\s*[:=]\s*['"][A-Za-z0-9_\-]{16,}/i },
            { name: 'aws_key', regex: /AKIA[0-9A-Z]{16}/ },
            { name: 'private_block', regex: /-----BEGIN (RSA )?PRIVATE KEY-----/ },
        ];
        lines.forEach((line, i) => {
            for (const r of rules) {
                const m = r.regex.exec(line);
                if (m) {
                    findings.push({
                        file: path.resolve(filePath),
                        line: i + 1,
                        rule: r.name,
                        match: m[0].slice(0, 200),
                        severity: 'high',
                    });
                }
            }
        });
        return findings;
    }
};
