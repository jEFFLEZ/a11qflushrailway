import { logger } from '../utils/logger.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

const DEFAULT_LLM_GUARD_CONFIG = {
  enabled: true,
  mode: 'annotate',
  annotateThreshold: 35,
  blockThreshold: 85,
  placeholderDomains: [
    'example.com',
    'example.org',
    'example.net',
    'dummy',
    'localhost',
    '127.0.0.1',
  ],
  riskySuccessPhrases: [
    "c'est fait",
    'c est fait',
    'email envoye',
    'mail envoye',
    'pdf est pret',
    'pdf pret',
    'image est prete',
    'image prete',
    'stocke dans le bucket',
    'lien temporaire',
    'created successfully',
    'email sent',
    'stored successfully',
    'download your file',
  ],
};

export async function repairLlmGuard() {
  logger.info('PICCOLO: vérification du garde-fou LLM...');
  const qflushDir = path.join(process.cwd(), '.qflush');
  const guardPath = path.join(qflushDir, 'llm-guard.json');
  if (!fs.existsSync(qflushDir)) {
    fs.mkdirSync(qflushDir, { recursive: true });
  }

  let current: any = {};
  if (fs.existsSync(guardPath)) {
    try {
      current = JSON.parse(fs.readFileSync(guardPath, 'utf8'));
    } catch {
      current = {};
    }
  }

  const next = {
    ...DEFAULT_LLM_GUARD_CONFIG,
    ...(current && typeof current === 'object' ? current : {}),
  };

  if (JSON.stringify(current) !== JSON.stringify(next)) {
    fs.writeFileSync(guardPath, JSON.stringify(next, null, 2), 'utf8');
    logger.info('PICCOLO: .qflush/llm-guard.json initialisé/corrigé');
  }
}
