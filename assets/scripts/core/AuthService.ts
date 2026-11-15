/**
 * Google sign-in (Firebase Auth) and the cloud summit count / leaderboard (Firestore), ADR-09.
 * No `cc`: it only needs the browser's `document`. One instance per page (`auth()`), shared by
 * Boot, Home and Climb.
 *
 * Guests are never blocked: if FIREBASE_CONFIG is null, the SDK cannot load (offline, blocked)
 * or a call fails, the game keeps running on local progress and the error is only logged.
 * Only uid, name and counts are stored, never the e-mail address (ADR-09).
 */
import { type LeaderRow, type SummitDoc, cloudName, parseSummitDoc, planSummitSync, rankRows } from './CloudSummit';
import { FIREBASE_CONFIG, FIREBASE_SDK_VERSION } from './FirebaseConfig';
import { t } from './I18n';
import { type NameError, readCachedProfile, renameWaitSec, validatePlayerName, writeCachedProfile } from './PlayerName';
import { type Progress, markSynced, readProgress, writeProgress } from './Progress';
import { type RankedTimeRow, type TimeRow, bestRunToUpload, fasterRun, parseRunMs, rankTimes } from './RunTime';
import type { StorageLike } from './Settings';

export type AuthState = 'off' | 'loading' | 'guest' | 'signedIn' | 'error';

export interface CloudUser {
    uid: string;
    /** The player's own name (players/{uid}) if set, otherwise from the Google display name. */
    name: string;
    /** Shown in the account panel only; never written to Firestore (ADR-09). */
    email: string;
}

const SDK_PARTS = ['app', 'auth', 'firestore'] as const;
const SDK_TIMEOUT_MS = 8000;
const SUMMITS = 'summits';
const PLAYERS = 'players';

export interface RenameResult {
    ok: boolean;
    /** Text for the panel: the error, or 「名稱已更新」. */
    text: string;
}

/** NameError -> panel text. */
export function nameErrorText(error: NameError): string {
    if (error === 'empty') return t('rename.errEmpty');
    if (error === 'chars') return t('rename.errChars');
    return t('rename.errLength');
}

function browserStorage(): StorageLike | null {
    try {
        return (globalThis as { localStorage?: StorageLike }).localStorage ?? null;
    } catch {
        return null;
    }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type Fb = any;

function loadScript(src: string, timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
        const doc = (globalThis as { document?: Document }).document;
        if (!doc) {
            reject(new Error('no document'));
            return;
        }
        const el = doc.createElement('script');
        const timer = setTimeout(() => reject(new Error(`timeout: ${src}`)), timeoutMs);
        el.src = src;
        el.async = false;
        el.onload = (): void => { clearTimeout(timer); resolve(); };
        el.onerror = (): void => { clearTimeout(timer); reject(new Error(`failed: ${src}`)); };
        doc.head.appendChild(el);
    });
}

/** Firebase error → short Chinese text for a toast. */
export function authErrorText(err: unknown): string {
    const code = (err as { code?: string } | null)?.code ?? '';
    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return t('cloud.cancelled');
    if (code === 'auth/popup-blocked') return t('cloud.popupBlocked');
    if (code === 'auth/unauthorized-domain') return t('cloud.unauthorizedDomain');
    if (code === 'auth/network-request-failed') return t('cloud.network');
    return t('cloud.signInFailed');
}

export class AuthService {
    state: AuthState = FIREBASE_CONFIG ? 'loading' : 'off';
    user: CloudUser | null = null;
    /** The signed-in player's cloud summit count, once read. */
    cloudCount: number | null = null;
    /** Device time of the last successful sync, for 「已同步・1 分鐘前」. */
    lastSyncMs: number | null = null;
    /** levels.json cloud.minSummitSec, set by Boot once the config is loaded. */
    minSummitSec = 300;
    /** levels.json cloud.renameCooldownSec, set by Boot once the config is loaded. */
    renameCooldownSec = 30;
    /** Device time of the last name change (cooldown), from the cache or Firestore. */
    lastRenameMs: number | null = null;
    /** The signed-in player's cloud fastest full run (ms), once read; null = none. */
    cloudBestRunMs: number | null = null;
    /** levels.json cloud.minRunSec, set by Boot once the config is loaded. */
    minRunSec = 420;

    private fb: Fb = null;
    private ready: Promise<void> | null = null;
    private listeners = new Set<() => void>();
    private syncing: Promise<number> | null = null;
    /** Reading players/{uid} for the signed-in user; sync waits for it so it never renames back. */
    private profileLoad: Promise<void> = Promise.resolve();
    /** True once players/{uid} was read (or found missing); false while offline. */
    private profileKnown = false;
    private renaming = false;

    get configured(): boolean {
        return FIREBASE_CONFIG !== null;
    }

    /** Called on every state / user / count change; returns an unsubscribe function. */
    onChange(cb: () => void): () => void {
        this.listeners.add(cb);
        return () => this.listeners.delete(cb);
    }

    private emit(): void {
        for (const cb of this.listeners) {
            try { cb(); } catch (err) { console.error(err); }
        }
    }

    /** Boot's 「載入帳號」 stage: loads the SDK and waits for the saved sign-in. Never rejects. */
    init(): Promise<void> {
        if (!this.ready) this.ready = this.doInit();
        return this.ready;
    }

    private async doInit(): Promise<void> {
        if (!FIREBASE_CONFIG) return;
        try {
            for (const part of SDK_PARTS) {
                await loadScript(`https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/firebase-${part}-compat.js`, SDK_TIMEOUT_MS);
            }
            const fb = (globalThis as { firebase?: Fb }).firebase;
            if (!fb) throw new Error('firebase global missing');
            if (!fb.apps.length) fb.initializeApp(FIREBASE_CONFIG);
            this.fb = fb;
            await new Promise<void>((resolve) => {
                let first = true;
                fb.auth().onAuthStateChanged((u: Fb) => {
                    // The cached own name shows at once; players/{uid} then confirms or updates it.
                    const cached = u ? readCachedProfile(browserStorage(), u.uid) : null;
                    this.user = u ? { uid: u.uid, name: cached?.name ?? cloudName(u.displayName), email: u.email ?? '' } : null;
                    this.state = u ? 'signedIn' : 'guest';
                    this.lastRenameMs = cached?.renamedAtMs ?? null;
                    this.profileKnown = false;
                    if (!u) {
                        this.cloudCount = null;
                        this.cloudBestRunMs = null;
                        this.lastSyncMs = null;
                    }
                    this.profileLoad = u ? this.loadProfile(u.uid) : Promise.resolve();
                    this.emit();
                    if (first) {
                        first = false;
                        // Boot waits for the name too, so Home and the climb tag show it straight away.
                        void this.profileLoad.then(() => resolve());
                    }
                });
            });
        } catch (err) {
            console.warn('[Auth] Firebase unavailable, playing as guest', err);
            this.state = 'error';
            this.emit();
        }
    }

    /** Reads players/{uid}; a saved own name replaces the Google name. Never rejects. */
    private async loadProfile(uid: string): Promise<void> {
        try {
            const snap = await this.fb.firestore().collection(PLAYERS).doc(uid).get();
            if (this.user?.uid !== uid) return;
            this.profileKnown = true;
            if (!snap.exists) return;
            const check = validatePlayerName(String(snap.get('name') ?? ''));
            if (!check.ok) return;
            const ts = snap.get('nameUpdatedAt');
            const at = ts && typeof ts.toMillis === 'function' ? Math.min(ts.toMillis(), Date.now()) : null;
            this.user = { ...this.user, name: check.name };
            this.lastRenameMs = at ?? this.lastRenameMs;
            writeCachedProfile(browserStorage(), { uid, name: check.name, renamedAtMs: this.lastRenameMs });
            this.emit();
        } catch (err) {
            console.warn('[Auth] profile read failed', err);
        }
    }

    /** Seconds before the player may rename again. */
    renameWait(): number {
        return renameWaitSec(this.lastRenameMs, Date.now(), this.renameCooldownSec);
    }

    get isRenaming(): boolean {
        return this.renaming;
    }

    /**
     * Saves a new player name to players/{uid} and, if the player is on the leaderboard, to their
     * own summits/{uid} name (count and time untouched). Local state only changes on success.
     */
    async rename(raw: string): Promise<RenameResult> {
        const fb = this.fb;
        const user = this.user;
        if (!fb || !user) return { ok: false, text: t('cloud.notSignedIn') };
        if (this.renaming) return { ok: false, text: t('rename.saving') };
        const check = validatePlayerName(raw);
        if (!check.ok) return { ok: false, text: nameErrorText(check.error) };
        if (check.name === user.name) return { ok: true, text: t('rename.unchanged') };
        const wait = this.renameWait();
        if (wait > 0) return { ok: false, text: t('rename.tooSoon', { n: wait }) };
        this.renaming = true;
        this.emit();
        try {
            const db = fb.firestore();
            const summitRef = db.collection(SUMMITS).doc(user.uid);
            await db.runTransaction(async (tx: Fb) => {
                const summit = await tx.get(summitRef);
                tx.set(db.collection(PLAYERS).doc(user.uid), {
                    name: check.name,
                    nameUpdatedAt: fb.firestore.FieldValue.serverTimestamp(),
                });
                if (summit.exists && summit.get('name') !== check.name) tx.update(summitRef, { name: check.name });
            });
            const now = Date.now();
            if (this.user?.uid === user.uid) this.user = { ...this.user, name: check.name };
            this.lastRenameMs = now;
            this.profileKnown = true;
            writeCachedProfile(browserStorage(), { uid: user.uid, name: check.name, renamedAtMs: now });
            return { ok: true, text: t('rename.done') };
        } catch (err) {
            console.warn('[Auth] rename failed', err);
            const code = (err as { code?: string } | null)?.code ?? '';
            if (code === 'unavailable' || code === 'deadline-exceeded') return { ok: false, text: t('cloud.network') };
            // The rules refuse a rename inside the cooldown (e.g. another device just renamed).
            if (code === 'permission-denied') return { ok: false, text: t('rename.retryLater') };
            return { ok: false, text: t('rename.failed') };
        } finally {
            this.renaming = false;
            this.emit();
        }
    }

    /**
     * Must run straight from a click (signInWithPopup, ADR-09: never redirect), so Boot loads
     * the SDK beforehand. Resolves with a toast text.
     */
    async signIn(): Promise<string> {
        if (!this.fb) return this.configured ? t('cloud.offline') : t('cloud.off');
        try {
            const provider = new this.fb.auth.GoogleAuthProvider();
            provider.setCustomParameters({ prompt: 'select_account' });
            const cred = await this.fb.auth().signInWithPopup(provider);
            await this.profileLoad;
            return t('cloud.welcome', { name: this.user?.name ?? cloudName(cred?.user?.displayName) });
        } catch (err) {
            console.warn('[Auth] sign-in failed', err);
            return authErrorText(err);
        }
    }

    async signOut(): Promise<void> {
        if (!this.fb) return;
        await this.fb.auth().signOut();
    }

    private toDoc(snap: Fb): SummitDoc | null {
        if (!snap?.exists) return null;
        const ts = snap.get('updatedAt');
        return parseSummitDoc(snap.data(), ts && typeof ts.toMillis === 'function' ? ts.toMillis() : null);
    }

    /**
     * Adds this device's unsynced summits to the signed-in player's cloud count (as many as the
     * security rules allow right now) and refreshes `cloudCount`. Resolves with the number added.
     */
    syncSummits(storage: StorageLike | null): Promise<number> {
        if (this.syncing) return this.syncing;
        const run = this.doSync(storage).then((added) => {
            this.syncing = null;
            return added;
        });
        this.syncing = run;
        return run;
    }

    private async doSync(storage: StorageLike | null): Promise<number> {
        const fb = this.fb;
        const user = this.user;
        if (!fb || !user) return 0;
        await this.profileLoad;
        const db = fb.firestore();
        const ref = db.collection(SUMMITS).doc(user.uid);
        try {
            const local: Progress = readProgress(storage);
            const result = await db.runTransaction(async (tx: Fb) => {
                const snap = await tx.get(ref);
                const cloud = this.toDoc(snap);
                // Profile unread (offline): keep the cloud name instead of renaming it back to the Google one.
                const name = this.profileKnown ? (this.user?.name ?? user.name) : (cloud?.name ?? user.name);
                const plan = planSummitSync(local, cloud, name, Date.now(), this.minSummitSec);
                // Fastest full run: rides along with the summit write, or goes alone when only it improved.
                // The rules only let bestRunMs go down and never drop it, so the cloud value is kept on a rewrite.
                const cloudBest = cloud ? parseRunMs(snap.get('bestRunMs')) : null;
                const newBest = bestRunToUpload(local.bestRunMs, cloudBest, this.minRunSec);
                const best = fasterRun(cloudBest, newBest);
                const bestField = best === null ? {} : { bestRunMs: best };
                if (plan.write?.rename) {
                    tx.update(ref, { name: plan.write.name, ...bestField });
                } else if (plan.write) {
                    tx.set(ref, {
                        name: plan.write.name,
                        count: plan.write.count,
                        updatedAt: fb.firestore.FieldValue.serverTimestamp(),
                        ...bestField,
                    });
                } else if (cloud && newBest !== null) {
                    tx.update(ref, { bestRunMs: newBest });
                }
                return { add: plan.add, count: plan.write?.count ?? cloud?.count ?? 0, best: plan.write || cloud ? best : null };
            });
            if (result.add > 0) writeProgress(storage, markSynced(readProgress(storage), result.add));
            this.cloudCount = result.count;
            this.cloudBestRunMs = result.best;
            this.lastSyncMs = Date.now();
            this.emit();
            return result.add;
        } catch (err) {
            console.warn('[Auth] summit sync failed', err);
            return 0;
        }
    }

    /**
     * Permanently deletes the cloud summit doc and the Google sign-in for this game. Local
     * progress stays on the device as guest progress. Resolves with a toast text.
     */
    async deleteAccount(): Promise<string> {
        const fb = this.fb;
        const user = this.user;
        if (!fb || !user) return t('cloud.notSignedIn');
        try {
            const current = fb.auth().currentUser;
            // Firebase only deletes a recently signed-in user, so confirm with Google first. This is
            // the first call after the confirm button's click, so the popup is not blocked.
            await current.reauthenticateWithPopup(new fb.auth.GoogleAuthProvider());
            await fb.firestore().collection(SUMMITS).doc(user.uid).delete();
            await fb.firestore().collection(PLAYERS).doc(user.uid).delete();
            writeCachedProfile(browserStorage(), null);
            await current.delete();
            return t('cloud.deleted');
        } catch (err) {
            console.warn('[Auth] delete failed', err);
            return authErrorText(err);
        }
    }

    /** Top players by summit count. Readable by guests too. */
    async leaderboard(size: number): Promise<LeaderRow[]> {
        if (!this.fb) throw Object.assign(new Error('cloud unavailable'), { text: this.configured ? t('lb.offline') : t('lb.off') });
        const snap = await this.fb.firestore().collection(SUMMITS).orderBy('count', 'desc').limit(size).get();
        const rows: (SummitDoc & { uid: string })[] = [];
        snap.forEach((d: Fb) => {
            const doc = this.toDoc(d);
            if (doc) rows.push({ ...doc, uid: d.id });
        });
        return rankRows(rows);
    }

    /** Top players by fastest full run (fastest first). Readable by guests too. */
    async fastestRuns(size: number): Promise<RankedTimeRow[]> {
        if (!this.fb) throw Object.assign(new Error('cloud unavailable'), { text: this.configured ? t('lb.offline') : t('lb.off') });
        // Single-field ascending index (automatic); docs without bestRunMs are left out by orderBy.
        const snap = await this.fb.firestore().collection(SUMMITS).orderBy('bestRunMs', 'asc').limit(size).get();
        const rows: TimeRow[] = [];
        snap.forEach((d: Fb) => {
            const doc = this.toDoc(d);
            const ms = parseRunMs(d.get('bestRunMs'));
            if (doc && ms !== null) rows.push({ uid: d.id, name: doc.name, bestRunMs: ms });
        });
        return rankTimes(rows);
    }
}

let instance: AuthService | null = null;

export function auth(): AuthService {
    if (!instance) instance = new AuthService();
    return instance;
}
