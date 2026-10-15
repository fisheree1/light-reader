import { translate, type MessageKey } from '../../../i18n/i18n';
export interface SensitiveContentWarning {
  kind: 'credential' | 'email' | 'financial' | 'phone' | 'private-key';
  label: string;
}

const detectors: {
  kind: SensitiveContentWarning['kind'];
  label: MessageKey;
  pattern: RegExp;
}[] = [
  {
    kind: 'private-key',
    label: 'ai.sensitivePrivateKey',
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
  },
  {
    kind: 'credential',
    label: 'ai.sensitiveCredential',
    pattern: /(?:sk-|ghp_|github_pat_|api[_ -]?key\s*[:=])\S{12,}/iu,
  },
  {
    kind: 'email',
    label: 'ai.sensitiveEmail',
    pattern: /\b[^\s@]+@[^\s@]+\.[^\s@]+\b/u,
  },
  {
    kind: 'phone',
    label: 'ai.sensitivePhone',
    pattern: /(?:\+?\d[\d -]{8,}\d)/u,
  },
  {
    kind: 'financial',
    label: 'ai.sensitiveFinancial',
    pattern: /\b(?:\d[ -]?){13,19}\b/u,
  },
];

export function detectSensitiveContent(
  value: string,
): SensitiveContentWarning[] {
  return detectors
    .filter((detector) => detector.pattern.test(value))
    .map(({ kind, label }) => ({ kind, label: translate(label) }));
}
