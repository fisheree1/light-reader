import type {
  FileDialogAdapter,
  SelectedBookFile,
} from './file-dialog-adapter';
import type { WebSelectedBookSourceRegistry } from '../../storage/web-book-file-storage';

type InputFactory = () => HTMLInputElement;

export class WebFileDialogAdapter implements FileDialogAdapter {
  private readonly createInput: InputFactory;
  private readonly sourceRegistry: WebSelectedBookSourceRegistry;

  constructor(
    sourceRegistry: WebSelectedBookSourceRegistry,
    createInput: InputFactory = () => document.createElement('input'),
  ) {
    this.createInput = createInput;
    this.sourceRegistry = sourceRegistry;
  }

  async selectBooks(): Promise<SelectedBookFile[] | null> {
    const files = await this.select('.epub,.pdf', true);
    return files.length > 0 ? this.sourceRegistry.register(files) : null;
  }

  async selectBook(): Promise<SelectedBookFile | null> {
    const files = await this.select('.epub,.pdf', false);
    const selected = files.at(0);
    return selected
      ? (this.sourceRegistry.register([selected]).at(0) ?? null)
      : null;
  }

  async selectEpub(): Promise<SelectedBookFile | null> {
    const files = await this.select('.epub', false);
    const selected = files.at(0);
    return selected
      ? (this.sourceRegistry.register([selected]).at(0) ?? null)
      : null;
  }

  private select(accept: string, multiple: boolean): Promise<File[]> {
    return new Promise((resolve) => {
      const input = this.createInput();
      input.type = 'file';
      input.accept = accept;
      input.multiple = multiple;
      input.tabIndex = -1;
      input.setAttribute('aria-hidden', 'true');
      input.style.position = 'fixed';
      input.style.opacity = '0';
      input.style.pointerEvents = 'none';

      let settled = false;
      let cancelTimer: ReturnType<typeof setTimeout> | null = null;
      const handleWindowFocus = () => {
        cancelTimer = setTimeout(() => {
          if ((input.files?.length ?? 0) === 0) finish([]);
        }, 300);
      };
      const finish = (files: File[]) => {
        if (settled) return;
        settled = true;
        if (cancelTimer) clearTimeout(cancelTimer);
        window.removeEventListener('focus', handleWindowFocus);
        input.remove();
        resolve(files);
      };
      input.addEventListener(
        'change',
        () => {
          finish(Array.from(input.files ?? []));
        },
        { once: true },
      );
      input.addEventListener(
        'cancel',
        () => {
          finish([]);
        },
        { once: true },
      );
      window.addEventListener('focus', handleWindowFocus, { once: true });
      document.body.append(input);
      input.click();
    });
  }
}
