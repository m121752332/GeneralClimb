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
import { type Progress, markSynced, readProgress, writeProgress } from './Progress';
import type { StorageLike } from './Settings';

export type AuthState = 'off' | 'loading' | 'guest' | 'signedIn' | 'error';

export interface CloudUser {
    uid: string;
    name: string;
    /** Shown in the account panel only; never written to Firestore (ADR-09). */
    email: string;
}

const SDK_PARTS = ['app', 'auth', 'firestore'] as const;
const SDK_TIMEOUT_MS = 8000;
const SUMMITS = 'summits';

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

    private fb: Fb = null;
    private ready: Promise<void> | null = null;
    private listeners = new Set<() => void>();
    private syncing: Promise<number> | null = null;

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
                    this.user = u ? { uid: u.uid, name: cloudName(u.displayName), email: u.email ?? '' } : null;
                    this.state = u ? 'signedIn' : 'guest';
                    if (!u) {
                        this.cloudCount = null;
                        this.lastSyncMs = null;
                    }
                    this.emit();
                    if (first) {
                        first = false;
                        resolve();
                    }
                });
            });
        } catch (err) {
            console.warn('[Auth] Firebase unavailable, playing as guest', err);
            this.state = 'error';
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
            return t('cloud.welcome', { name: cloudName(cred?.user?.displayName) });
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
        const db = fb.firestore();
        const ref = db.collection(SUMMITS).doc(user.uid);
        try {
            const local: Progress = readProgress(storage);
            const result = await db.runTransaction(async (tx: Fb) => {
                const cloud = this.toDoc(await tx.get(ref));
                const plan = planSummitSync(local, cloud, user.name, Date.now(), this.minSummitSec);
                if (plan.write?.rename) {
                    tx.update(ref, { name: plan.write.name });
                } else if (plan.write) {
                    tx.set(ref, {
                        name: plan.write.name,
                        count: plan.write.count,
                        updatedAt: fb.firestore.FieldValue.serverTimestamp(),
                    });
                }
                return { add: plan.add, count: plan.write?.count ?? cloud?.count ?? 0 };
            });
            if (result.add > 0) writeProgress(storage, markSynced(readProgress(storage), result.add));
            this.cloudCount = result.count;
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
}

let instance: AuthService | null = null;

export function auth(): AuthService {
    if (!instance) instance = new AuthService();
    return instance;
}
