import { MDS } from "@minima-global/mds";

const PERSONAL_CONTACTS_KEY = 'privacy_personal_contacts';

/**
 * Service for managing personal contacts
 * Personal contacts are stored in keypair storage and used for privacy settings
 */
export const personalContactsService = {
    /**
     * Get the list of personal contact public keys
     */
    async getPersonalContacts(): Promise<string[]> {
        try {
            const result = await MDS.keypair.get(PERSONAL_CONTACTS_KEY);
            if (result?.status && result.value) {
                return JSON.parse(result.value);
            }
            return [];
        } catch (err) {
            console.error('[PersonalContacts] Error getting personal contacts:', err);
            return [];
        }
    },

    /**
     * Check if a contact is marked as personal
     */
    async isPersonalContact(publickey: string): Promise<boolean> {
        const personalContacts = await this.getPersonalContacts();
        return personalContacts.includes(publickey);
    },

    /**
     * Add a contact to personal contacts list
     */
    async addPersonalContact(publickey: string): Promise<boolean> {
        try {
            const personalContacts = await this.getPersonalContacts();

            // Don't add if already exists
            if (personalContacts.includes(publickey)) {
                return true;
            }

            personalContacts.push(publickey);
            await MDS.keypair.set(PERSONAL_CONTACTS_KEY, JSON.stringify(personalContacts));

            console.log('[PersonalContacts] Added personal contact:', publickey);
            return true;
        } catch (err) {
            console.error('[PersonalContacts] Error adding personal contact:', err);
            return false;
        }
    },

    /**
     * Remove a contact from personal contacts list
     */
    async removePersonalContact(publickey: string): Promise<boolean> {
        try {
            const personalContacts = await this.getPersonalContacts();
            const filtered = personalContacts.filter(pk => pk !== publickey);

            await MDS.keypair.set(PERSONAL_CONTACTS_KEY, JSON.stringify(filtered));

            console.log('[PersonalContacts] Removed personal contact:', publickey);
            return true;
        } catch (err) {
            console.error('[PersonalContacts] Error removing personal contact:', err);
            return false;
        }
    },

    /**
     * Toggle a contact's personal status
     */
    async togglePersonalContact(publickey: string): Promise<boolean> {
        const isPersonal = await this.isPersonalContact(publickey);

        if (isPersonal) {
            return await this.removePersonalContact(publickey);
        } else {
            return await this.addPersonalContact(publickey);
        }
    }
};
