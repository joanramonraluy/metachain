import { UserProfile } from './discovery.service';

const DB_NAME = 'charmchain_discovery';
const DB_VERSION = 1;
const PROFILES_STORE = 'profiles';
const USERNAME_INDEX = 'username_index';

class StorageService {
    private db: IDBDatabase | null = null;

    async init(): Promise<void> {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                this.db = request.result;
                resolve();
            };

            request.onupgradeneeded = (event) => {
                const db = (event.target as IDBOpenDBRequest).result;

                // Profiles store: keyed by pubkey
                if (!db.objectStoreNames.contains(PROFILES_STORE)) {
                    const profileStore = db.createObjectStore(PROFILES_STORE, { keyPath: 'pubkey' });
                    profileStore.createIndex('username', 'username', { unique: false });
                    profileStore.createIndex('timestamp', 'timestamp', { unique: false });
                }

                // Username index store: for fast username lookups
                if (!db.objectStoreNames.contains(USERNAME_INDEX)) {
                    db.createObjectStore(USERNAME_INDEX, { keyPath: 'username' });
                }
            };
        });
    }

    async upsertProfile(profile: UserProfile): Promise<void> {
        if (!this.db) await this.init();

        return new Promise((resolve, reject) => {
            const tx = this.db!.transaction([PROFILES_STORE, USERNAME_INDEX], 'readwrite');
            const profileStore = tx.objectStore(PROFILES_STORE);
            const usernameStore = tx.objectStore(USERNAME_INDEX);

            // Update profile
            profileStore.put(profile);

            // Update username index
            usernameStore.put({
                username: profile.username.toLowerCase(),
                pubkey: profile.pubkey
            });

            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    async upsertProfiles(profiles: UserProfile[]): Promise<void> {
        if (!this.db) await this.init();

        return new Promise((resolve, reject) => {
            const tx = this.db!.transaction([PROFILES_STORE, USERNAME_INDEX], 'readwrite');
            const profileStore = tx.objectStore(PROFILES_STORE);
            const usernameStore = tx.objectStore(USERNAME_INDEX);

            for (const profile of profiles) {
                profileStore.put(profile);
                usernameStore.put({
                    username: profile.username.toLowerCase(),
                    pubkey: profile.pubkey
                });
            }

            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    async getProfiles(): Promise<UserProfile[]> {
        if (!this.db) await this.init();

        return new Promise((resolve, reject) => {
            const tx = this.db!.transaction(PROFILES_STORE, 'readonly');
            const store = tx.objectStore(PROFILES_STORE);
            const request = store.getAll();

            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
        });
    }

    async getProfileByPubkey(pubkey: string): Promise<UserProfile | null> {
        if (!this.db) await this.init();

        return new Promise((resolve, reject) => {
            const tx = this.db!.transaction(PROFILES_STORE, 'readonly');
            const store = tx.objectStore(PROFILES_STORE);
            const request = store.get(pubkey);

            request.onsuccess = () => resolve(request.result || null);
            request.onerror = () => reject(request.error);
        });
    }

    async getProfileByUsername(username: string): Promise<UserProfile | null> {
        if (!this.db) await this.init();

        return new Promise((resolve, reject) => {
            const tx = this.db!.transaction([USERNAME_INDEX, PROFILES_STORE], 'readonly');
            const usernameStore = tx.objectStore(USERNAME_INDEX);
            const profileStore = tx.objectStore(PROFILES_STORE);

            const request = usernameStore.get(username.toLowerCase());

            request.onsuccess = () => {
                const entry = request.result;
                if (!entry) {
                    resolve(null);
                    return;
                }

                const profileRequest = profileStore.get(entry.pubkey);
                profileRequest.onsuccess = () => resolve(profileRequest.result || null);
                profileRequest.onerror = () => reject(profileRequest.error);
            };
            request.onerror = () => reject(request.error);
        });
    }

    async clearAll(): Promise<void> {
        if (!this.db) await this.init();

        return new Promise((resolve, reject) => {
            const tx = this.db!.transaction([PROFILES_STORE, USERNAME_INDEX], 'readwrite');
            const profileStore = tx.objectStore(PROFILES_STORE);
            const usernameStore = tx.objectStore(USERNAME_INDEX);

            profileStore.clear();
            usernameStore.clear();

            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    async deleteProfile(pubkey: string): Promise<void> {
        if (!this.db) await this.init();

        return new Promise((resolve, reject) => {
            const tx = this.db!.transaction([PROFILES_STORE, USERNAME_INDEX], 'readwrite');
            const profileStore = tx.objectStore(PROFILES_STORE);
            const usernameStore = tx.objectStore(USERNAME_INDEX);

            // Get profile first to find username
            const getRequest = profileStore.get(pubkey);
            getRequest.onsuccess = () => {
                const profile = getRequest.result;
                if (profile) {
                    usernameStore.delete(profile.username.toLowerCase());
                }
                profileStore.delete(pubkey);
            };

            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }
}

export const storageService = new StorageService();
