/**
 * Firebase web app config (ADR-09). These values identify the project and may be public;
 * security comes from config/firestore.rules. Never put a service-account key here.
 *
 * Paste the `firebaseConfig` object from Firebase console → Project settings → Your apps → Web
 * (see docs/firebase-setup.md). While it is null, sign-in and the leaderboard show
 * 「尚未開放」 and everyone plays as a guest.
 */
export interface FirebaseWebConfig {
    apiKey: string;
    authDomain: string;
    projectId: string;
    appId: string;
    storageBucket?: string;
    messagingSenderId?: string;
    measurementId?: string;
}

export const FIREBASE_CONFIG: FirebaseWebConfig | null = {
    apiKey: 'AIzaSyDXeucXtlOFvsrRWnZfZyXy66K4Ra83lmw',
    authDomain: 'general-climb.firebaseapp.com',
    projectId: 'general-climb',
    storageBucket: 'general-climb.firebasestorage.app',
    messagingSenderId: '823194820757',
    appId: '1:823194820757:web:b6d3e9e4dbdf4a15c7fb9c',
};

/** Firebase JS SDK (compat build) loaded from gstatic at Boot, so the game bundle stays small. */
export const FIREBASE_SDK_VERSION = '12.4.0';
