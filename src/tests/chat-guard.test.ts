import { describe, expect, it } from 'vitest';
import { verifyChatOutput } from '../core/chat-guard.js';

describe('chat guard', () => {
  it('flags placeholder links as suspicious', () => {
    const result = verifyChatOutput(
      "C'est fait. Telecharge le PDF ici: https://example.com/fichier.pdf",
      {
        enabled: true,
        mode: 'annotate',
        annotateThreshold: 35,
        blockThreshold: 85,
        placeholderDomains: ['example.com'],
        riskySuccessPhrases: ["c'est fait", 'telecharge le pdf'],
      }
    );

    expect(result.suspicious).toBe(true);
    expect(result.issues.some((issue) => issue.code === 'placeholder_url')).toBe(true);
  });

  it('flags confident success with no evidence', () => {
    const result = verifyChatOutput(
      "C'est fait. Le PDF est pret et stocke dans le bucket.",
      {
        enabled: true,
        mode: 'annotate',
        annotateThreshold: 35,
        blockThreshold: 85,
        placeholderDomains: ['example.com'],
        riskySuccessPhrases: ["c'est fait", 'pdf est pret', 'stocke dans le bucket'],
      }
    );

    expect(result.suspicious).toBe(true);
    expect(result.issues.some((issue) => issue.code === 'success_without_evidence')).toBe(true);
  });

  it('keeps a structured answer clean when evidence is present', () => {
    const result = verifyChatOutput(
      "C'est fait. Fichier: expose.pdf. DownloadUrl: https://api.funesterie.pro/api/public/resources/42/download?token=abc",
      {
        enabled: true,
        mode: 'annotate',
        annotateThreshold: 35,
        blockThreshold: 85,
        placeholderDomains: ['example.com'],
        riskySuccessPhrases: ["c'est fait", 'download your file'],
      }
    );

    expect(result.suspicious).toBe(false);
    expect(result.issues.length).toBe(0);
  });
});
