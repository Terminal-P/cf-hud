/**
 * Document Picture-in-Picture support for the web build.
 *
 * The whole React root node is moved into a floating always-on-top browser
 * window (and back when the window closes). Styles are cloned into the new
 * document because a PiP window is a separate Document.
 *
 * The API is not in TypeScript's DOM lib yet, so its shape is declared here.
 */

export interface DocumentPictureInPictureOptions {
  width?: number;
  height?: number;
  disallowReturnToOpener?: boolean;
  preferInitialWindowPlacement?: boolean;
}

interface DocumentPictureInPictureApi {
  readonly window: Window | null;
  requestWindow(options?: DocumentPictureInPictureOptions): Promise<Window>;
}

declare global {
  interface Window {
    documentPictureInPicture?: DocumentPictureInPictureApi;
  }
}

export type PipTheme = 'dark' | 'light';

interface PipSession {
  window: Window;
  root: HTMLElement;
  placeholder: HTMLElement;
  onClose: () => void;
  closed: boolean;
}

let session: PipSession | null = null;

export function isPiPSupported(): boolean {
  if (typeof window === 'undefined') return false;
  const api = window.documentPictureInPicture;
  return Boolean(api && typeof api.requestWindow === 'function');
}

export function isPiPOpen(): boolean {
  return session !== null;
}

function copyStyles(source: Document, target: Document): void {
  const nodes = source.querySelectorAll<HTMLStyleElement | HTMLLinkElement>(
    'style, link[rel="stylesheet"]',
  );
  nodes.forEach((node) => {
    target.head.append(node.cloneNode(true));
  });
}

function createPlaceholder(title: string, hint: string): HTMLElement {
  const placeholder = document.createElement('div');
  placeholder.className = 'pip-placeholder';
  placeholder.setAttribute('role', 'status');

  const logo = document.createElement('div');
  logo.className = 'pip-placeholder-logo';
  logo.textContent = 'CF';

  const card = document.createElement('div');
  card.className = 'pip-placeholder-card';

  const heading = document.createElement('strong');
  heading.textContent = title;

  const paragraph = document.createElement('p');
  paragraph.textContent = hint;

  card.append(heading, paragraph);
  placeholder.append(logo, card);
  document.body.append(placeholder);
  return placeholder;
}

interface OpenPiPOptions {
  theme: PipTheme;
  placeholderTitle: string;
  placeholderHint: string;
  onClose: () => void;
}

/** Move the React root into a PiP window. Resolves true when it opened. */
export async function openPiP(options: OpenPiPOptions): Promise<boolean> {
  if (session) {
    session.window.focus();
    return true;
  }
  if (!isPiPSupported()) return false;

  const root = document.getElementById('root');
  if (!root) return false;

  const api = window.documentPictureInPicture;
  if (!api) return false;

  try {
    const pipWindow = await api.requestWindow({
      width: 380,
      height: 720,
      disallowReturnToOpener: true,
      preferInitialWindowPlacement: false,
    });
    const pipDocument = pipWindow.document;

    copyStyles(document, pipDocument);
    pipDocument.documentElement.dataset.shell = 'pip';
    pipDocument.documentElement.dataset.theme = options.theme;
    pipDocument.documentElement.lang = document.documentElement.lang;
    pipDocument.title = document.title;
    pipDocument.body.className = document.body.className;
    pipDocument.body.classList.add('pip-body');

    // Moving the node adopts it into the PiP document; React keeps rendering.
    pipDocument.body.append(root);

    const placeholder = createPlaceholder(options.placeholderTitle, options.placeholderHint);
    const active: PipSession = {
      window: pipWindow,
      root,
      placeholder,
      onClose: options.onClose,
      closed: false,
    };
    session = active;

    const handleClose = () => {
      if (active.closed) return;
      active.closed = true;
      if (session === active) session = null;
      try {
        document.body.append(root);
      } catch {
        // The opener document may be gone; nothing sensible to restore.
      }
      placeholder.remove();
      active.onClose();
    };

    pipWindow.addEventListener('pagehide', handleClose, { once: true });
    return true;
  } catch {
    return false;
  }
}

/** Close the PiP window (the root is restored by the `pagehide` handler). */
export function closePiP(): void {
  session?.window.close();
}

/** Keep the PiP document's theme tokens in sync with the app theme. */
export function syncPiPTheme(theme: PipTheme): void {
  if (!session) return;
  session.window.document.documentElement.dataset.theme = theme;
}
