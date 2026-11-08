const EVENTS = ['loadstart', 'loadedmetadata', 'durationchange', 'loadeddata', 'canplay', 'canplaythrough', 'play', 'playing', 'pause', 'ended', 'timeupdate', 'seeking', 'seeked', 'ratechange', 'volumechange', 'waiting', 'stalled', 'error'];
export class AuthoredMediaController {
    media;
    emit;
    options;
    audio;
    active = '';
    generation = 0;
    playVersion = 0;
    disposed = false;
    capability = null;
    loading = null;
    abort = new AbortController();
    recovered = false;
    intendedPlaying = false;
    recovery = null;
    pendingSeek = null;
    constructor(media, emit, options = {}) {
        this.media = media;
        this.emit = emit;
        this.options = options;
        this.audio = (options.createAudio ?? (() => new Audio()))();
        this.audio.preload = 'auto';
        for (const event of EVENTS)
            this.audio.addEventListener(event, () => { if (this.disposed || !this.active)
                return; if (event === 'loadedmetadata' && this.pendingSeek !== null)
                this.seek(this.pendingSeek); if (event === 'error' && this.capability && (!this.recovered || this.capability.expiresAt <= (this.options.now ?? Date.now)())) {
                void this.recover().catch(() => this.emit({ event: 'error', snapshot: this.snapshot() }));
                return;
            } if (event === 'ended')
                this.intendedPlaying = false; this.emit({ event, snapshot: this.snapshot() }); });
    }
    snapshot() { return { mediaId: this.active, currentTime: this.pendingSeek ?? (this.audio.currentTime || 0), duration: Number.isFinite(this.audio.duration) ? this.audio.duration : (this.media.find(m => m.id === this.active)?.duration ?? 0), paused: this.audio.paused, ended: this.audio.ended, readyState: this.audio.readyState, playbackRate: this.audio.playbackRate, volume: this.audio.volume, error: this.audio.error?.code ?? null }; }
    seek(time) { this.pendingSeek = time; try {
        this.audio.currentTime = time;
        if (this.audio.readyState > 0)
            this.pendingSeek = null;
    }
    catch { /* Safari may need metadata before applying the saved resume position. */ } }
    async select(id, renew = false) {
        const item = this.media.find(m => m.id === id);
        if (!item || this.disposed)
            throw new Error('Invalid media');
        if (this.active === id && !renew && this.loading)
            return this.loading;
        if (this.active === id && !renew && this.capability && this.capability.expiresAt > (this.options.now ?? Date.now)() + 10_000)
            return;
        if (this.active !== id || renew) {
            this.abort.abort();
            this.abort = new AbortController();
            this.generation++;
            if (this.active !== id) {
                this.playVersion++;
                this.intendedPlaying = false;
                this.recovered = false;
                this.pendingSeek = null;
            }
            this.audio.pause();
            this.audio.removeAttribute('src');
            this.audio.load();
            this.capability = null;
            this.loading = null;
            this.active = id;
        }
        const generation = this.generation, signal = this.abort.signal;
        this.loading = (async () => {
            const response = await (this.options.fetch ?? fetch)(item.url + (item.url.includes('?') ? '&' : '?') + 'capability=1', { cache: 'no-store', credentials: 'same-origin', signal });
            if (!response.ok)
                throw new Error('Media authorization failed');
            const capability = await response.json();
            if (this.disposed || signal.aborted || generation !== this.generation)
                return;
            const url = new URL(capability.url, window.location.origin);
            if (typeof capability.url !== 'string' || !capability.url || typeof capability.key !== 'string' || !['https:', 'http:'].includes(url.protocol) || !Number.isFinite(capability.expiresAt) || capability.expiresAt <= (this.options.now ?? Date.now)())
                throw new Error('Invalid media capability');
            const playable = this.options.resolveMediaUrl ? await this.options.resolveMediaUrl(item.url,url.href,signal) : url.href;
            if (this.disposed || signal.aborted || generation !== this.generation)
                return;
            this.capability = capability;
            this.audio.src = playable;
            this.audio.load();
        })().finally(() => { if (generation === this.generation)
            this.loading = null; });
        return this.loading;
    }
    recover() {
        if (this.recovery)
            return this.recovery;
        if (this.recovered && (!this.capability || this.capability.expiresAt > (this.options.now ?? Date.now)()))
            return Promise.reject(new Error('Media recovery failed'));
        this.recovered = true;
        const id = this.active, time = this.pendingSeek ?? this.audio.currentTime, rate = this.audio.playbackRate, volume = this.audio.volume, playVersion = this.playVersion;
        this.recovery = (async () => { await this.select(id, true); if (this.disposed || this.active !== id)
            return; this.seek(time); this.audio.playbackRate = rate; this.audio.volume = volume; if (this.intendedPlaying && playVersion === this.playVersion)
            await this.audio.play(); this.emit({ event: 'state', snapshot: this.snapshot() }); })().finally(() => { this.recovery = null; });
        return this.recovery;
    }
    /** Called only after the original hub's painted acknowledgement. */
    prepare() { if (this.media[0])
        void this.select(this.media[0].id).catch(() => this.emit({ event: 'error', snapshot: this.snapshot() })); }
    async command(command) {
        if (this.disposed || !this.media.some(m => m.id === command.mediaId) || !['load', 'play', 'pause', 'seek', 'rate', 'volume'].includes(command.action) || command.requestId !== undefined && (!Number.isSafeInteger(command.requestId) || command.requestId < 1))
            return;
        let playVersion = this.playVersion;
        try {
            if (command.action === 'pause') {
                this.playVersion++;
                this.intendedPlaying = false;
                if (this.active === command.mediaId)
                    this.audio.pause();
                return;
            }
            if (this.active !== command.mediaId || !this.capability || this.loading) {
                const selected = this.select(command.mediaId);
                playVersion = this.playVersion;
                await selected;
            }
            else if (this.capability.expiresAt <= (this.options.now ?? Date.now)() + 10_000) {
                const time = this.pendingSeek ?? this.audio.currentTime, rate = this.audio.playbackRate, volume = this.audio.volume;
                await this.select(command.mediaId, true);
                this.seek(time);
                this.audio.playbackRate = rate;
                this.audio.volume = volume;
            }
            if (this.disposed || this.active !== command.mediaId)
                throw new DOMException('Media changed', 'AbortError');
            if (command.action === 'load')
                return;
            if (command.action === 'seek') {
                if (Number.isFinite(command.value) && command.value >= 0)
                    this.seek(command.value);
            }
            else if (command.action === 'rate') {
                if (Number.isFinite(command.value) && command.value >= 0.25 && command.value <= 4)
                    this.audio.playbackRate = command.value;
            }
            else if (command.action === 'volume') {
                if (Number.isFinite(command.value) && command.value >= 0 && command.value <= 1)
                    this.audio.volume = command.value;
            }
            else if (command.action === 'play') {
                if (playVersion !== this.playVersion)
                    throw new DOMException('Playback cancelled', 'AbortError');
                this.intendedPlaying = true;
                try {
                    await this.audio.play();
                }
                catch (error) {
                    // A single renewal can recover an expired transport capability. Autoplay
                    // denials are returned unchanged so the original Start audio control works.
                    if (error?.name === 'NotAllowedError' || this.recovered)
                        throw error;
                    await this.recover();
                }
                if (playVersion !== this.playVersion) {
                    if (this.active === command.mediaId)
                        this.audio.pause();
                    throw new DOMException('Playback cancelled', 'AbortError');
                }
            }
            this.emit({ event: 'state', snapshot: this.snapshot() });
            if (command.requestId)
                this.emit({ requestId: command.requestId, ok: true, snapshot: this.snapshot() });
        }
        catch (error) {
            if (!this.disposed && command.requestId)
                this.emit({ requestId: command.requestId, ok: false, error: ['NotAllowedError', 'AbortError'].includes(error?.name) ? error.name : 'NotSupportedError', snapshot: this.snapshot() });
        }
    }
    dispose() { this.disposed = true; this.generation++; this.abort.abort(); this.audio.pause(); this.audio.removeAttribute('src'); this.audio.load(); this.capability = null; this.loading = null; }
}
