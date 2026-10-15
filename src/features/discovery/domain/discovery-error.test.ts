import { AppError } from '../../../lib/app-error';
import {
  DiscoveryError,
  discoveryErrorMessage,
  isSourceRefusal,
} from './discovery-error';

describe('discovery errors', () => {
  it('shows translated messages and hides raw technical ones', () => {
    expect(discoveryErrorMessage(new DiscoveryError('SOURCE_TIMEOUT'))).toBe(
      '读取书源超时，请打开书源窗口检查页面后重试。',
    );
    expect(discoveryErrorMessage(new AppError('DUPLICATE_BOOK'))).toBe(
      '这本书已经在书架中了。',
    );
    for (const error of [
      new TypeError("Cannot read properties of null (reading 'body')"),
      'SOURCE_UNKNOWN_NATIVE_STRING',
      undefined,
    ])
      expect(discoveryErrorMessage(error)).toBe(
        '获取过程中出现意外错误，请重试。',
      );
  });

  it('classifies refusals that must stop a task', () => {
    for (const code of [
      'SOURCE_ACCESS_DENIED',
      'SOURCE_RATE_LIMITED',
      'SOURCE_COOLING_DOWN',
    ] as const)
      expect(isSourceRefusal(new DiscoveryError(code))).toBe(true);
    expect(isSourceRefusal(new DiscoveryError('SOURCE_TIMEOUT'))).toBe(false);
    expect(isSourceRefusal(new Error('403'))).toBe(false);
  });
});
