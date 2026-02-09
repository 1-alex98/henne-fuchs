import { Component, effect, inject, signal } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Player } from '../board';
import { GameSettingsService } from '../game-settings.service';
import { PeerConnectionService } from '../peer/peer-connection.service';
import { ToastService } from '../../shared/toast/toast.service';

type SelectStep =
  | 'mode'
  | 'side'
  | 'difficulty'
  | 'online'
  | 'online-host-side'
  | 'online-host'
  | 'online-join';

@Component({
  selector: 'app-select-mode',
  imports: [FormsModule],
  templateUrl: './select-mode.html',
  styleUrl: './select-mode.css',
})
export class SelectMode {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly settings = inject(GameSettingsService);
  protected readonly peerConnection = inject(PeerConnectionService);
  private readonly toast = inject(ToastService);

  protected readonly Player = Player;

  step = signal<SelectStep>('mode');
  /** Default the side selection to chickens (more common). */
  selectedSide = signal<Player>(Player.CHICKEN);
  difficulty = signal<number>(1);

  /** Join flow input. */
  joinCode = signal<string>('');

  /** Online host's chosen side (stored before creating a peer id). */
  onlineHostSide = signal<Player>(Player.CHICKEN);

  constructor() {
    // Deep-link support: /play/select?code=<hostId>
    // If a code is provided, jump directly to the online join step and prefill the input.
    const initialCode = (this.route.snapshot.queryParamMap.get('code') ?? '').trim();
    if (initialCode) {
      this.joinCode.set(initialCode);
      this.step.set('online-join');
    }

    effect(() => {
      const s = this.peerConnection.state();
      if (s.status === 'connected') {
        const role = this.step() === 'online-host' ? 'host' : 'join';

        const hostPlaysAs = s.hostPlaysAs ?? this.onlineHostSide();

        this.settings.setTwoPlayersOnline({ role, hostPlaysAs });
        void this.router.navigateByUrl('/play/game');
      }
    });
  }

  chooseTwoPlayers() {
    this.settings.setTwoPlayers();
    void this.router.navigateByUrl('/play/game');
  }

  chooseTwoPlayersOnline() {
    this.step.set('online');
  }

  chooseOnePlayer() {
    this.step.set('side');
  }

  setSide(side: Player) {
    this.selectedSide.set(side);
  }

  startOnePlayer() {
    this.settings.setOnePlayer(this.selectedSide(), this.difficulty());
    void this.router.navigateByUrl('/play/game');
  }

  back() {
    // If we are in an online step, close any pending connection attempt.
    if (this.step().startsWith('online')) {
      this.peerConnection.disconnect();
    }
    this.step.set('mode');
  }

  protected chooseDifficulty(player: Player) {
    this.selectedSide.set(player);
    this.step.set('difficulty');
  }

  chooseOnlineHost() {
    // Host chooses side first (before creating/copying a peer id).
    this.step.set('online-host-side');
  }

  chooseOnlineHostSide(side: Player) {
    this.onlineHostSide.set(side);
    this.step.set('online-host');
    void this.peerConnection.host(side);
  }

  chooseOnlineJoin() {
    this.step.set('online-join');
  }

  connectOnlineJoin() {
    void this.peerConnection.join(this.joinCode());
  }

  async copyHostCode() {
    const code = this.peerConnection.state().myPeerId;
    if (!code) return;

    if (!navigator.clipboard?.writeText) {
      this.toast.show('Clipboard is not available in this browser.', { variant: 'warning' });
      return;
    }

    try {
      await navigator.clipboard.writeText(code);
      this.toast.show('Code copied to clipboard.', { variant: 'success', durationMs: 2500 });
    } catch {
      // Clipboard is best-effort; still inform the user.
      this.toast.show('Could not copy. Please copy the code manually.', { variant: 'warning' });
    }
  }

  protected async shareLink() {
    const code = this.peerConnection.state().myPeerId;
    if (!code) return;

    const url = new URL(window.location.href);
    url.searchParams.set('code', code);
    const urlString = url.toString();

    // Prefer native share sheet on supported mobile browsers.
    // Falls back to copying the link to clipboard.
    const sharePayload: ShareData = {
      title: 'Henne & Fuchs',
      text: 'Join my game:',
      url: urlString,
    };

    const navAny = navigator as Navigator & {
      share?: (data?: ShareData) => Promise<void>;
      canShare?: (data?: ShareData) => boolean;
    };

    const canNativeShare =
      typeof navAny.share === 'function' &&
      // canShare is optional; if it exists, respect it.
      (typeof navAny.canShare !== 'function' || navAny.canShare(sharePayload));

    if (canNativeShare) {
      try {
        await navAny.share!(sharePayload);
        // Some platforms don't show anything after successful share; a small confirmation helps.
        this.toast.show('Link shared.', { variant: 'success', durationMs: 2500 });
        return;
      } catch (e: unknown) {
        // User cancel should be silent (or at most informational).
        const name = (e as { name?: string } | null)?.name;
        if (name === 'AbortError') {
          return;
        }
        // Otherwise we fall back to clipboard below.
      }
    }

    if (!navigator.clipboard?.writeText) {
      this.toast.show('Sharing is not available in this browser.', {
        variant: 'warning',
      });
      return;
    }

    try {
      await navigator.clipboard.writeText(urlString);
      this.toast.show('Link copied to clipboard.', { variant: 'success', durationMs: 2500 });
    } catch {
      // Clipboard is best-effort; still inform the user.
      this.toast.show('Could not copy. Please copy the link manually.', { variant: 'warning' });
    }
  }
}
