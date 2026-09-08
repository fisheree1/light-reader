export interface SensitiveContentWarning {
  kind: 'credential' | 'email' | 'financial' | 'phone' | 'private-key';
  label: string;
}

const detectors: {
  kind: SensitiveContentWarning['kind'];
  label: string;
  pattern: RegExp;
}[] = [
  {
    kind: 'private-key',
    label: '疑似私钥',
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
  },
  {
    kind: 'credential',
    label: '疑似访问令牌或 API Key',
    pattern: /(?:sk-|ghp_|github_pat_|api[_ -]?key\s*[:=])\S{12,}/iu,
  },
  {
    kind: 'email',
    label: '疑似邮箱地址',
    pattern: /\b[^\s@]+@[^\s@]+\.[^\s@]+\b/u,
  },
  {
    kind: 'phone',
    label: '疑似电话号码',
    pattern: /(?:\+?\d[\d -]{8,}\d)/u,
  },
  {
    kind: 'financial',
    label: '疑似银行卡或财务编号',
    pattern: /\b(?:\d[ -]?){13,19}\b/u,
  },
];

export function detectSensitiveContent(
  value: string,
): SensitiveContentWarning[] {
  return detectors
    .filter((detector) => detector.pattern.test(value))
    .map(({ kind, label }) => ({ kind, label }));
}
