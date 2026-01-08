
import { minimaService } from "./minima.service";

/**
 * Service for managing personal contacts
 * Personal contacts are stored in SQL table PERSONAL_CONTACTS (Migrated from keypair)
 * used for privacy settings.
 */
export const personalContactsService = {
    /**
     * Get the list of personal contact public keys
     */
    async getPersonalContacts(): Promise<string[]> {
        try {
            // First check SQL
            const sql = "SELECT * FROM PERSONAL_CONTACTS";
            const result = await minimaService.runSQL(sql);

            if (result && result.rows) {
                return result.rows.map((r: any) => r.PUBLICKEY);
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
        try {
            const sql = `SELECT * FROM PERSONAL_CONTACTS WHERE publickey='${publickey}'`;
            const result = await minimaService.runSQL(sql);
            return result && result.rows && result.rows.length > 0;
        } catch (e) {
            console.error("Error checking personal contact", e);
            return false;
        }
    },

    /**
     * Add a contact to personal contacts list
     */
    async addPersonalContact(publickey: string): Promise<boolean> {
        try {
            // Insert into SQL
            const cleanKey = publickey.replace(/'/g, "''");
            const sql = `INSERT IGNORE INTO PERSONAL_CONTACTS (publickey, created_at) VALUES ('${cleanKey}', ${Date.now()})`;

            await minimaService.runSQL(sql);

            console.log('[PersonalContacts] Added personal contact (SQL):', publickey);

            // Legacy cleanup (optional): Try to clear keypair so we don't have stale data?
            // Leaving it alone is safer.

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
            const cleanKey = publickey.replace(/'/g, "''");
            const sql = `DELETE FROM PERSONAL_CONTACTS WHERE publickey='${cleanKey}'`;

            await minimaService.runSQL(sql);

            console.log('[PersonalContacts] Removed personal contact (SQL):', publickey);
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
