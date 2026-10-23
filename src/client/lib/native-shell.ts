interface ShellState {
  title: string;
  subtitle: string;
  dirty: boolean;
  busy?: boolean;
  recoveryPending?: boolean;
  modalOpen?: boolean;
  hasProject: boolean;
}

declare global {
  interface Window {
    __PRD_NATIVE__?: boolean;
    webkit?: { messageHandlers?: { prdShell?: { postMessage: (state: ShellState) => void } } };
  }
}

export const isNative = window.__PRD_NATIVE__ === true;

export function postShellState(state: ShellState) {
  window.webkit?.messageHandlers?.prdShell?.postMessage(state);
}

export function readLocalPrompt(projectId: string) {
  try {
    return localStorage.getItem(`prd-genie-prompt:${projectId}`) ?? '';
  } catch {
    return '';
  }
}
