import { Injectable, signal } from '@angular/core';
import { Peer } from 'peerjs';
import { Player } from '../board';

export type OnlineConnectionStatus =
  | 'idle'
  | 'creating-peer'
  | 'waiting-for-peer'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'error';

export interface OnlineConnectionState {
  status: OnlineConnectionStatus;
  myPeerId?: string;
  remotePeerId?: string;
  /** Authoritative side the host plays as (exchanged during handshake). */
  hostPlaysAs?: Player;
  error?: string;
}

/**
 * Connection-only wrapper around PeerJS.
 *
 * Contract:
 * - host(): creates a peer, exposes myPeerId, waits for an incoming data channel to open.
 * - join(id): creates a peer and connects to host peer id, waits for open.
 * - No game logic or message handling is implemented here.
 */
@Injectable({ providedIn: 'root' })
export class PeerConnectionService {
  readonly state = signal<OnlineConnectionState>({ status: 'idle' });

  /** Stream of JSON-ish messages received over the data channel. */
  readonly messages = signal<unknown | undefined>(undefined);

  // localStorage key for optional RTCConfiguration overrides used for debugging.
  private readonly rtcConfigOverrideKey = 'hf/rtc-config-override';

  private peer?: Peer;
  private connection?: import('peerjs').DataConnection;

  private wakeLock?: WakeLockSentinel;

  // Remember current mode for reconnect.
  private role: 'host' | 'join' | undefined;
  private lastJoinTarget?: string;

  // Manual disconnect should not trigger reconnect.
  private manualDisconnect = false;

  // Reconnect loop control.
  private reconnecting = false;
  private reconnectUntilTs = 0;
  private reconnectAttempt = 0;
  private reconnectTimer?: ReturnType<typeof setTimeout>;

  private readonly reconnectWindowMs = 60_000;

  // Toggle this to enable/disable verbose debug logging.
  // You can flip this to `false` once debugging is complete.
  private debug = true;

  // Advanced debug switches.
  // - forceRelay: if true, we force WebRTC to only use TURN (relay) candidates. If you don't have TURN configured, this will always fail.
  private forceRelay = false;

  private readonly peerOpenTimeoutMs = 15_000;
  private readonly waitIncomingTimeoutMs = 30_000;
  private readonly connectionOpenTimeoutMs = 30_000;
  private readonly handshakeTimeoutMs = 10_000;

  /** Handshake message used to exchange host side before we report `connected`. */
  private readonly handshakeType = 'hf/host-plays-as' as const;

  /** Host-only: chosen side to publish during handshake. */
  private hostPlaysAsToSend: Player = Player.CHICKEN;

  /**
   * Host a connection.
   * @param hostPlaysAs which side the host will play (authoritative; exchanged before reporting `connected`).
   */
  async host(hostPlaysAs: Player = Player.CHICKEN): Promise<void> {
    this.hostPlaysAsToSend = hostPlaysAs;

    this.manualDisconnect = false;
    this.clearReconnectLoop();
    this.role = 'host';
    this.lastJoinTarget = undefined;

    this.resetInternal();
    this.setState({ status: 'creating-peer' });

    const peer = this.createPeer();
    this.peer = peer;

    await this.acquireWakeLock();

    if (this.debug) console.debug('[PeerConn] host(): created peer instance');

    try {
      const myId = await this.withTimeout(this.waitForPeerOpen(peer), this.peerOpenTimeoutMs, 'Timed out creating peer.');
      this.setState({ status: 'waiting-for-peer', myPeerId: myId, hostPlaysAs });

      if (this.debug) console.debug('[PeerConn] host(): peer opened with id', myId);

      // Wait for remote connection.
      const conn = await this.withTimeout(
        new Promise<import('peerjs').DataConnection>((resolve, reject) => {
          const onError = (err: unknown) => reject(err);
          peer.once('error', onError);
          peer.once('connection', c => {
            peer.off('error', onError);
            resolve(c);
          });
        }),
        this.waitIncomingTimeoutMs,
        'Timed out waiting for your friend to join.'
      );

      this.connection = conn;
      this.attachDataHandlers(conn);

      if (this.debug) {
        console.debug('[PeerConn] host(): incoming data connection from', conn.peer, 'labels:', conn.metadata);
        this.attachPeerConnectionDebug(conn);
      }

      this.attachConnectionDropHandlers(conn);

      this.setState({
        status: 'connecting',
        myPeerId: myId,
        remotePeerId: conn.peer,
        hostPlaysAs,
      });

      await this.withTimeout(
        this.waitForConnectionOpen(conn),
        this.connectionOpenTimeoutMs,
        'Timed out while negotiating the WebRTC connection (ICE). This usually means your network blocks direct peer-to-peer; you may need a TURN server.'
      );

      // Exchange handshake info BEFORE we call this "connected".
      this.sendHandshakeHostPlaysAs(conn, hostPlaysAs);

      this.setState({
        status: 'connected',
        myPeerId: myId,
        remotePeerId: conn.peer,
        hostPlaysAs,
      });

      if (this.debug) console.debug('[PeerConn] host(): connected to', conn.peer);
    } catch (err) {
      const message = this.formatPeerError(err);
      const prev = this.state();
      this.setState({ ...prev, status: 'error', error: message });
      if (this.debug) console.warn('[PeerConn] host(): error ->', message, err);
      throw err;
    } finally {
      // Wake lock is only needed while we are actively attempting to connect/reconnect.
      if (!this.reconnecting) await this.releaseWakeLock();
    }
  }

  async join(remotePeerId: string): Promise<void> {
    const target = (remotePeerId ?? '').trim();
    if (!target) {
      this.setState({ status: 'error', error: 'Please enter a host id.' });
      return;
    }

    this.manualDisconnect = false;
    this.clearReconnectLoop();
    this.role = 'join';
    this.lastJoinTarget = target;

    this.resetInternal();
    this.setState({ status: 'creating-peer' });

    const peer = this.createPeer();
    this.peer = peer;

    await this.acquireWakeLock();

    if (this.debug) console.debug('[PeerConn] join(): created peer instance, will connect to', target);

    try {
      const myId = await this.withTimeout(this.waitForPeerOpen(peer), this.peerOpenTimeoutMs, 'Timed out creating peer.');

      this.setState({ status: 'connecting', myPeerId: myId, remotePeerId: target });

      if (this.debug) console.debug('[PeerConn] join(): peer opened with id', myId);

      const conn = peer.connect(target, { reliable: true });
      this.connection = conn;
      this.attachDataHandlers(conn);

      if (this.debug) {
        console.debug('[PeerConn] join(): initiated connection to', target);
        this.attachPeerConnectionDebug(conn);
      }

      this.attachConnectionDropHandlers(conn);

      await this.withTimeout(
        this.waitForConnectionOpen(conn),
        this.connectionOpenTimeoutMs,
        'Timed out while negotiating the WebRTC connection (ICE). This usually means your network blocks direct peer-to-peer; you may need a TURN server.'
      );

      // Wait for handshake info before we call this "connected".
      const hostPlaysAs = await this.withTimeout(
        this.waitForHandshakeHostPlaysAs(conn),
        this.handshakeTimeoutMs,
        'Timed out waiting for the host to send game settings.'
      );

      this.setState({ status: 'connected', myPeerId: myId, remotePeerId: target, hostPlaysAs });

      if (this.debug) console.debug('[PeerConn] join(): connected to', target, 'hostPlaysAs:', hostPlaysAs);
    } catch (err) {
      const message = this.formatPeerError(err);
      const prev = this.state();
      this.setState({ ...prev, status: 'error', error: message });
      if (this.debug) console.warn('[PeerConn] join(): error ->', message, err);
      throw err;
    } finally {
      if (!this.reconnecting) await this.releaseWakeLock();
    }
  }

  /** Useful for a cancel/back action. */
  disconnect(): void {
    if (this.debug) console.debug('[PeerConn] disconnect(): closing');

    this.manualDisconnect = true;
    this.clearReconnectLoop();

    try {
      this.connection?.close();
    } catch {
      // ignore
    }

    try {
      this.peer?.destroy();
    } catch {
      // ignore
    }

    this.resetInternal();
    void this.releaseWakeLock();

    this.messages.set(undefined);
    this.setState({ status: 'idle' });
  }

  private setState(next: OnlineConnectionState) {
    this.state.set(next);
  }

  private resetInternal() {
    this.connection = undefined;
    // Clear last received message so a new game doesn't process stale data.
    this.messages.set(undefined);
    if (this.peer) {
      try {
        this.peer.destroy();
      } catch {
        // ignore
      }
    }
    this.peer = undefined;
  }

  private clearReconnectLoop() {
    this.reconnecting = false;
    this.reconnectUntilTs = 0;
    this.reconnectAttempt = 0;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
  }

  private attachConnectionDropHandlers(conn: import('peerjs').DataConnection) {
    // Avoid stacking listeners if we re-use a connection reference.
    conn.off('close');
    conn.off('error');

    conn.on('close', () => {
      if (this.debug) console.warn('[PeerConn] conn.close (opened connection)');
      this.startReconnect('Connection closed.');
    });

    conn.on('error', (e: unknown) => {
      if (this.debug) console.warn('[PeerConn] conn.error (opened connection)', e);
      this.startReconnect(this.formatPeerError(e));
    });
  }

  private attachDataHandlers(conn: import('peerjs').DataConnection) {
    // Avoid stacking listeners.
    try {
      conn.off('data');
    } catch {
      // ignore
    }

    conn.on('data', (data: unknown) => {
      // Store last message; Play consumes it as a signal.
      this.messages.set(data);
    });
  }

  private startReconnect(reason: string) {
    if (this.manualDisconnect) return;

    // Any previous message is now stale.
    this.messages.set(undefined);

    const prev = this.state();
    // Only attempt reconnect if we were in an active state.
    if (prev.status !== 'connected' && prev.status !== 'connecting' && prev.status !== 'waiting-for-peer' && prev.status !== 'reconnecting') {
      return;
    }

    // Can't reconnect a host in a way that preserves the same myPeerId if the peer is destroyed.
    // We still try, but if the peer ID changes, the remote side won't find us without re-sharing the new id.

    if (!this.reconnecting) {
      this.reconnecting = true;
      this.reconnectUntilTs = Date.now() + this.reconnectWindowMs;
      this.reconnectAttempt = 0;
    }

    this.setState({ ...prev, status: 'reconnecting', error: reason });
    void this.acquireWakeLock();

    // Kick off loop (idempotent).
    void this.reconnectLoop();
  }

  private async reconnectLoop(): Promise<void> {
    if (!this.reconnecting) return;
    if (this.manualDisconnect) {
      this.clearReconnectLoop();
      return;
    }

    if (Date.now() > this.reconnectUntilTs) {
      const prev = this.state();
      this.setState({ ...prev, status: 'error', error: prev.error ?? 'Reconnect timed out.' });
      this.clearReconnectLoop();
      await this.releaseWakeLock();
      return;
    }

    // Already connected? Stop.
    if (this.state().status === 'connected') {
      this.clearReconnectLoop();
      await this.releaseWakeLock();
      return;
    }

    this.reconnectAttempt += 1;

    // Backoff: 250ms, 500ms, 1s, 2s, 4s, 6s ... with jitter, capped.
    const base = Math.min(6000, 250 * Math.pow(2, Math.min(5, this.reconnectAttempt - 1)));
    const jitter = Math.floor(Math.random() * 250);
    const delayMs = base + jitter;

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = undefined;
      try {
        await this.tryReconnectOnce();
      } catch (e) {
        if (this.debug) console.warn('[PeerConn] reconnect attempt failed', e);
      } finally {
        // Loop again until success/deadline.
        void this.reconnectLoop();
      }
    }, delayMs);
  }

  private async tryReconnectOnce(): Promise<void> {
    if (this.manualDisconnect) return;

    const current = this.state();
    const myPeerId = current.myPeerId;

    // Clean connection reference.
    try {
      this.connection?.close();
    } catch {
      // ignore
    }
    this.connection = undefined;
    this.messages.set(undefined);

    // Prefer reusing Peer if possible.
    if (!this.peer || (this.peer as any).destroyed) {
      this.peer = this.createPeer();
    } else {
      // If we lost broker connection, PeerJS can sometimes reconnect while keeping peer id.
      try {
        const anyPeer = this.peer as any;
        if (anyPeer.disconnected && typeof anyPeer.reconnect === 'function') {
          anyPeer.reconnect();
        }
      } catch {
        // ignore
      }
    }

    const peer = this.peer!;

    // Wait for peer to be open again.
    const openedId = await this.withTimeout(this.waitForPeerOpen(peer), this.peerOpenTimeoutMs, 'Timed out recreating peer.');

    // Preserve stored myPeerId if we can; otherwise update it.
    const effectiveMyId = myPeerId ?? openedId;

    if (this.role === 'join') {
      const target = this.lastJoinTarget || current.remotePeerId;
      if (!target) throw new Error('Missing remote peer id to reconnect to.');

      this.setState({ status: 'reconnecting', myPeerId: effectiveMyId, remotePeerId: target, error: current.error, hostPlaysAs: current.hostPlaysAs });

      const conn = peer.connect(target, { reliable: true });
      this.connection = conn;
      this.attachDataHandlers(conn);
      if (this.debug) this.attachPeerConnectionDebug(conn);
      this.attachConnectionDropHandlers(conn);

      await this.withTimeout(this.waitForConnectionOpen(conn), this.connectionOpenTimeoutMs, 'Timed out reconnecting.');

      const hostPlaysAs = await this.withTimeout(
        this.waitForHandshakeHostPlaysAs(conn),
        this.handshakeTimeoutMs,
        'Timed out waiting for the host to send game settings.'
      );

      this.setState({ status: 'connected', myPeerId: effectiveMyId, remotePeerId: target, hostPlaysAs });
      this.clearReconnectLoop();
      await this.releaseWakeLock();
      return;
    }

    if (this.role === 'host') {
      // Update myPeerId if it changed (UI can show new id).
      const hostPlaysAs = current.hostPlaysAs ?? this.hostPlaysAsToSend;
      this.setState({ status: 'reconnecting', myPeerId: openedId, remotePeerId: current.remotePeerId, error: current.error, hostPlaysAs });

      const conn = await this.withTimeout(
        new Promise<import('peerjs').DataConnection>((resolve, reject) => {
          const onError = (err: unknown) => reject(err);
          peer.once('error', onError);
          peer.once('connection', (c: import('peerjs').DataConnection) => {
            peer.off('error', onError);
            resolve(c);
          });
        }),
        // Keep this reasonably short so we can retry within the 60s window.
        10_000,
        'Waiting for peer to rejoin.'
      );

      this.connection = conn;
      this.attachDataHandlers(conn);
      if (this.debug) this.attachPeerConnectionDebug(conn);
      this.attachConnectionDropHandlers(conn);

      this.setState({ status: 'reconnecting', myPeerId: openedId, remotePeerId: conn.peer, error: current.error, hostPlaysAs });
      await this.withTimeout(this.waitForConnectionOpen(conn), this.connectionOpenTimeoutMs, 'Timed out reconnecting.');

      // Re-send handshake after reconnect.
      this.sendHandshakeHostPlaysAs(conn, hostPlaysAs);

      this.setState({ status: 'connected', myPeerId: openedId, remotePeerId: conn.peer, hostPlaysAs });
      this.clearReconnectLoop();
      await this.releaseWakeLock();
      return;
    }

    throw new Error('Unknown connection role; cannot reconnect.');
  }

  private sendHandshakeHostPlaysAs(conn: import('peerjs').DataConnection, hostPlaysAs: Player) {
    try {
      conn.send({ type: this.handshakeType, hostPlaysAs } as any);
    } catch {
      // best-effort
    }
  }

  private waitForHandshakeHostPlaysAs(conn: import('peerjs').DataConnection): Promise<Player> {
    return new Promise<Player>((resolve, reject) => {
      const onData = (data: unknown) => {
        if (!data || typeof data !== 'object') return;
        const any = data as any;
        if (any.type !== this.handshakeType) return;
        const v = any.hostPlaysAs;
        if (typeof v !== 'number') {
          reject(new Error('Invalid handshake payload.'));
          return;
        }
        cleanup();
        resolve(v as Player);
      };

      const onClose = () => {
        cleanup();
        reject(new Error('Connection closed before handshake completed.'));
      };

      const onError = (err: unknown) => {
        cleanup();
        reject(err);
      };

      const cleanup = () => {
        try {
          conn.off('data', onData);
          conn.off('close', onClose);
          conn.off('error', onError);
        } catch {
          // ignore
        }
      };

      conn.on('data', onData);
      conn.once('close', onClose);
      conn.once('error', onError);
    });
  }

  private createPeer(): Peer {
    const rtcConfig = this.getRtcConfigurationOverride();

    const peer = rtcConfig
      ? new Peer({ config: rtcConfig })
      : new Peer();

    if (this.debug) {
      try {
        console.debug(
          '[PeerConn] createPeer(): rtcConfig override',
          rtcConfig ?? '(none; using PeerJS defaults)'
        );
      } catch {
        // ignore
      }
    }

    peer.on('open', id => {
      if (this.debug) console.debug('[PeerConn] peer.open ->', id);
    });

    peer.on('error', err => {
      const message = this.formatPeerError(err);
      // During reconnect we don't want to permanently land in error; we keep trying.
      if (this.reconnecting && !this.manualDisconnect) {
        this.setState({ ...this.state(), status: 'reconnecting', error: message });
        this.startReconnect(message);
      } else {
        this.setState({ ...this.state(), status: 'error', error: message });
        void this.releaseWakeLock();
      }
      if (this.debug) console.warn('[PeerConn] peer.error ->', message, err);
    });

    peer.on('disconnected', () => {
      if (this.debug) console.warn('[PeerConn] peer.disconnected');
      this.startReconnect('Disconnected.');
    });

    peer.on('close', () => {
      if (this.debug) console.warn('[PeerConn] peer.close');
      this.startReconnect('Connection closed.');
    });

    return peer;
  }

  private waitForPeerOpen(peer: Peer): Promise<string> {
    return new Promise((resolve, reject) => {
      const onOpen = (id: string) => {
        cleanup();
        resolve(id);
      };
      const onError = (err: unknown) => {
        cleanup();
        reject(err);
      };
      const cleanup = () => {
        peer.off('open', onOpen);
        peer.off('error', onError);
      };

      peer.once('open', onOpen);
      peer.once('error', onError);
    });
  }

  private waitForConnectionOpen(conn: import('peerjs').DataConnection): Promise<void> {
    if (this.debug) {
      conn.on('close', () => console.debug('[PeerConn] conn.close'));
      conn.on('error', (e: unknown) => console.debug('[PeerConn] conn.error', e));
    }

    return new Promise<void>((resolve, reject) => {
      const onOpen = () => {
        cleanup();
        resolve();
      };
      const onError = (err: unknown) => {
        cleanup();
        reject(err);
      };
      const onClose = () => {
        cleanup();
        reject(new Error('Connection closed before opening.'));
      };

      const cleanup = () => {
        conn.off('open', onOpen);
        conn.off('error', onError);
        conn.off('close', onClose);
      };

      conn.once('open', onOpen);
      conn.once('error', onError);
      conn.once('close', onClose);
    }).catch(err => {
      const message = this.formatPeerError(err);
      // Don't force error during reconnect; keep status.
      if (this.reconnecting && !this.manualDisconnect) {
        this.setState({ ...this.state(), status: 'reconnecting', error: message });
      } else {
        this.setState({ ...this.state(), status: 'error', error: message });
        void this.releaseWakeLock();
      }
      if (this.debug) console.warn('[PeerConn] waitForConnectionOpen ->', message, err);
      throw err;
    });
  }

  private attachPeerConnectionDebug(conn: import('peerjs').DataConnection) {
    if (!this.debug) return;

    try {
      const pc = (conn as any).peerConnection as RTCPeerConnection | undefined;
      if (!pc) {
        console.debug(
          '[PeerConn] attachPeerConnectionDebug: no underlying RTCPeerConnection available on this DataConnection (peerjs build may not expose it)'
        );
        return;
      }

      if (this.forceRelay) {
        try {
          // This is supported in modern browsers.
          pc.setConfiguration({ ...pc.getConfiguration(), iceTransportPolicy: 'relay' });
          console.debug('[PeerConn] forceRelay enabled: set iceTransportPolicy=relay');
        } catch (e) {
          console.warn('[PeerConn] forceRelay enabled but could not set iceTransportPolicy=relay', e);
        }
      }

      console.debug('[PeerConn] RTCPeerConnection.getConfiguration() ->', pc.getConfiguration());

      pc.addEventListener('icecandidate', (e: RTCPeerConnectionIceEvent) => {
        if (e.candidate) {
          // Log the raw candidate string; this includes "typ host/srflx/relay".
          console.debug('[PeerConn][pc] icecandidate.candidate ->', e.candidate.candidate);
          console.debug('[PeerConn][pc] icecandidate (structured) ->', {
            type: (e.candidate as any).type,
            protocol: (e.candidate as any).protocol,
            address: (e.candidate as any).address,
            port: (e.candidate as any).port,
          });
        } else {
          console.debug('[PeerConn][pc] icecandidate: null (end of candidates)');
        }
      });

      const dumpSelectedCandidatePair = async (label: string) => {
        try {
          const stats = await pc.getStats();
          let selectedPair: any;
          let local: any;
          let remote: any;

          stats.forEach(report => {
            if (report.type === 'transport' && (report as any).selectedCandidatePairId) {
              selectedPair = stats.get((report as any).selectedCandidatePairId);
            }
          });

          if (selectedPair) {
            local = stats.get((selectedPair as any).localCandidateId);
            remote = stats.get((selectedPair as any).remoteCandidateId);
          }

          console.debug('[PeerConn][pc][stats]', label, {
            iceConnectionState: pc.iceConnectionState,
            connectionState: (pc as any).connectionState,
            selectedPair: selectedPair
              ? {
                  state: (selectedPair as any).state,
                  currentRoundTripTime: (selectedPair as any).currentRoundTripTime,
                  availableOutgoingBitrate: (selectedPair as any).availableOutgoingBitrate,
                  localCandidateType: local?.candidateType,
                  localProtocol: local?.protocol,
                  localAddress: local?.address,
                  localPort: local?.port,
                  remoteCandidateType: remote?.candidateType,
                  remoteProtocol: remote?.protocol,
                  remoteAddress: remote?.address,
                  remotePort: remote?.port,
                }
              : '(no selected candidate pair yet)',
          });
        } catch (e) {
          console.debug('[PeerConn][pc][stats] failed', label, e);
        }
      };

      pc.addEventListener('iceconnectionstatechange', () => {
        console.debug('[PeerConn][pc] iceConnectionState ->', pc.iceConnectionState);
        void dumpSelectedCandidatePair('iceconnectionstatechange');
      });

      pc.addEventListener('connectionstatechange', () => {
        console.debug('[PeerConn][pc] connectionState ->', (pc as any).connectionState ?? 'n/a');
        void dumpSelectedCandidatePair('connectionstatechange');
      });

      // Also dump once soon after listeners attach.
      void dumpSelectedCandidatePair('attached');

      pc.addEventListener('signalingstatechange', () => {
        console.debug('[PeerConn][pc] signalingState ->', pc.signalingState);
      });

      pc.addEventListener('icegatheringstatechange', () => {
        console.debug('[PeerConn][pc] iceGatheringState ->', pc.iceGatheringState);
      });

      // Log current transceivers / senders/receivers for extra context if available.
      try {
        console.debug('[PeerConn][pc] currentLocalDescription ->', pc.localDescription?.type, 'size:', pc.localDescription ? JSON.stringify(pc.localDescription).length : 0);
        console.debug('[PeerConn][pc] currentRemoteDescription ->', pc.remoteDescription?.type, 'size:', pc.remoteDescription ? JSON.stringify(pc.remoteDescription).length : 0);
      } catch {
        // ignore JSON issues
      }
    } catch (e) {
      console.warn('[PeerConn] attachPeerConnectionDebug: failed to attach debug listeners', e);
    }
  }

  private getRtcConfigurationOverride(): RTCConfiguration | undefined {
    try {
      const raw = localStorage.getItem(this.rtcConfigOverrideKey);
      if (!raw) return undefined;
      const parsed = JSON.parse(raw) as RTCConfiguration;
      // Very light validation.
      if (!parsed || typeof parsed !== 'object') return undefined;
      return parsed;
    } catch {
      return undefined;
    }
  }

  private withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
    });

    // Ensure the timer is cleared regardless of which promise wins.
    return Promise.race([promise, timeout]).finally(() => {
      if (timeoutId) clearTimeout(timeoutId);
    }) as Promise<T>;
  }

  private formatPeerError(err: unknown): string {
    if (!err) return 'Unknown error.';
    if (typeof err === 'string') return err;

    const anyErr = err as { type?: string; message?: string; name?: string };
    const base = anyErr.message || anyErr.type || anyErr.name || 'Unknown error.';

    if (/ice failed/i.test(base) || /turn server/i.test(base)) {
      return `${base} (Hint: if you’re not using a TURN server, add one. If you are, verify it supports turns: on port 443 and the credentials are correct.)`;
    }

    return base;
  }

  private async acquireWakeLock(): Promise<void> {
    try {
      // Not available on all browsers.
      if (!('wakeLock' in navigator)) return;

      // Release previous lock if any.
      await this.releaseWakeLock();

      this.wakeLock = await (navigator as any).wakeLock.request('screen');

      // If the tab gets hidden, the lock may be released automatically.
      this.wakeLock?.addEventListener('release', () => {
        this.wakeLock = undefined;
      });
    } catch {
      // Wake Lock is best-effort.
    }
  }

  private async releaseWakeLock(): Promise<void> {
    try {
      await this.wakeLock?.release();
    } catch {
      // ignore
    } finally {
      this.wakeLock = undefined;
    }
  }

  /**
   * Send an arbitrary JSON-serializable message over the data channel.
   * Returns true if the message was handed to PeerJS, false if not connected.
   */
  send(message: unknown): boolean {
    const s = this.state();
    if (s.status !== 'connected') return false;
    const conn = this.connection;
    if (!conn || !conn.open) return false;

    try {
      conn.send(message as any);
      return true;
    } catch {
      return false;
    }
  }
}
