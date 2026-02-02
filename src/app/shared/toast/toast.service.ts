import { Injectable, signal } from '@angular/core';

export type ToastVariant = 'info' | 'warning' | 'success' | 'error';

export interface ToastState {
  message: string;
  variant: ToastVariant;
  visible: boolean;
}

@Injectable({ providedIn: 'root' })
export class ToastService {
  private readonly _state = signal<ToastState>({
    message: '',
    variant: 'info',
    visible: false,
  });

  readonly state = this._state.asReadonly();

  private hideTimer: number | undefined;

  show(message: string, opts?: { variant?: ToastVariant; durationMs?: number }) {
    const variant = opts?.variant ?? 'info';
    const durationMs = opts?.durationMs ?? 10000;

    if (this.hideTimer != undefined) {
      window.clearTimeout(this.hideTimer);
      this.hideTimer = undefined;
    }

    this._state.set({ message, variant, visible: true });

    // Auto-hide after a short time.
    this.hideTimer = window.setTimeout(() => this.hide(), durationMs);
  }

  hide() {
    if (this.hideTimer != undefined) {
      window.clearTimeout(this.hideTimer);
      this.hideTimer = undefined;
    }
    this._state.update((s) => ({ ...s, visible: false }));
  }
}
