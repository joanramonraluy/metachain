import { createFileRoute } from '@tanstack/react-router';
import { useState, useEffect } from 'react';
import { MDS } from '@minima-global/mds';
import { useAppContext } from '../../AppContext';
import { Shield, Check } from 'lucide-react';

export const Route = createFileRoute('/settings/privacy')({
  component: RouteComponent,
});

type VisibilityLevel = 'public' | 'contacts' | 'personal';

function RouteComponent() {
  const { writeMode } = useAppContext();
  const [level2Visibility, setLevel2Visibility] = useState<VisibilityLevel>('public');
  const [level3Visibility, setLevel3Visibility] = useState<VisibilityLevel>('personal');
  const [allowNonContactChats, setAllowNonContactChats] = useState(true);
  const [personalContacts, _setPersonalContacts] = useState<string[]>([]); // Placeholder for now
  const [_loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const loadSettings = async () => {
      setLoading(true);
      try {
        // Load from Keypair (Source of Truth)
        const l2 = await MDS.keypair.get('profile_privacy_level_2');
        if (l2 && l2.status && l2.value) setLevel2Visibility(l2.value as VisibilityLevel);

        const l3 = await MDS.keypair.get('profile_privacy_level_3');
        if (l3 && l3.status && l3.value) setLevel3Visibility(l3.value as VisibilityLevel);

        const chats = await MDS.keypair.get('profile_chat_permission_allow_all');
        if (chats && chats.status) {
          setAllowNonContactChats(chats.value === "true");
        }
      } catch (e) {
        console.error("Failed to load privacy settings", e);
      } finally {
        setLoading(false);
      }
    };

    const loadContacts = async () => {
      try {
        const raw = await MDS.keypair.get('privacy_personal_contacts');
        if (raw && raw.status && raw.value) {
          const list = JSON.parse(raw.value);
          if (Array.isArray(list)) _setPersonalContacts(list);
        }
      } catch (e) {
        console.error("Failed to load personal contacts", e);
      }
    }

    loadSettings();
    loadContacts();
  }, []);

  const handleSavePrivacySettings = async (l2?: VisibilityLevel, l3?: VisibilityLevel) => {
    setSaving(true);
    try {
      if (l2) {
        await MDS.keypair.set('profile_privacy_level_2', l2);
        // Sync to SQL
        const sql = `UPDATE MY_PROFILE SET privacy_l2 = '${l2}' WHERE id = 1`;
        // @ts-ignore
        MDS.sql(sql);
      }
      if (l3) {
        await MDS.keypair.set('profile_privacy_level_3', l3);
        // Sync to SQL
        const sql = `UPDATE MY_PROFILE SET privacy_l3 = '${l3}' WHERE id = 1`;
        // @ts-ignore
        MDS.sql(sql);
      }
    } catch (e) {
      console.error("Failed to save privacy settings", e);
    } finally {
      setSaving(false);
    }
  };

  const handleToggleChatPermission = async () => {
    const newValue = !allowNonContactChats;
    setAllowNonContactChats(newValue);
    setSaving(true);
    try {
      await MDS.keypair.set('profile_chat_permission_allow_all', newValue ? "true" : "false");
      const sql = `UPDATE MY_PROFILE SET allow_non_contact_chats = ${newValue} WHERE id = 1`;
      // @ts-ignore
      await MDS.sql(sql);
    } catch (e) {
      console.error("Failed to save chat permission", e);
      setAllowNonContactChats(!newValue); // Revert on error
    } finally {
      setSaving(false);
    }
  };


  return (
    <div className="max-w-4xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden transition-colors">
        <div className="p-6 border-b border-gray-100 dark:border-gray-700 flex items-center gap-3">
          <Shield className="text-purple-500" />
          <h2 className="text-xl font-semibold text-gray-800 dark:text-white">Privacy Settings</h2>
        </div>

        <div className="p-6 space-y-8">
          {/* Introduction */}
          <div className="bg-primary-50 dark:bg-primary-900/20 border border-primary-200 dark:border-primary-800/50 rounded-lg p-4">
            <p className="text-sm text-primary-800 dark:text-primary-200">
              <strong>Control who can see your information.</strong> Choose visibility settings for each level of your profile data.
            </p>
          </div>

          {/* Level 2 Visibility */}
          <div>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-semibold text-gray-800 dark:text-white">Level 2 - Semi-Private</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">Location, Website, Social Links</p>
              </div>
              <span className="px-3 py-1 bg-purple-100 text-purple-700 text-xs font-semibold rounded-full">Level 2</span>
            </div>

            <div className="space-y-3">
              <RadioOption
                label="Public Discovery"
                description="Anyone who discovers you via P2P"
                value="public"
                currentValue={level2Visibility}
                onChange={(val) => { setLevel2Visibility(val); handleSavePrivacySettings(val, undefined); }}
                benefits={["Discovered users", "Chat participants or Maxima contacts", "Personal contacts"]}
                color="blue"
              />
              <RadioOption
                label="Chat Access"
                description="Anyone with chat access to you"
                value="contacts"
                currentValue={level2Visibility}
                onChange={(val) => { setLevel2Visibility(val); handleSavePrivacySettings(val, undefined); }}
                benefits={["Chat participants or Maxima contacts", "Personal contacts"]}
                denied={["Discovered users"]}
                color="blue"
              />
              <RadioOption
                label="Personal Contacts Only"
                description={`Only contacts you mark as personal (${personalContacts.length} selected)`}
                value="personal"
                currentValue={level2Visibility}
                onChange={(val) => { setLevel2Visibility(val); handleSavePrivacySettings(val, undefined); }}
                benefits={["Personal contacts"]}
                denied={["Discovered users", "Chat participants or Maxima contacts"]}
                color="blue"
              />
            </div>
          </div>

          {/* Level 3 Visibility */}
          <div className="pt-6 border-t border-gray-200 dark:border-gray-700">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-semibold text-gray-800 dark:text-white">Level 3 - Private</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">Email, Phone</p>
              </div>
              <span className="px-3 py-1 bg-amber-100 text-amber-700 text-xs font-semibold rounded-full">Level 3</span>
            </div>

            <div className="space-y-3">
              <RadioOption
                label="Public Discovery"
                description="Anyone who discovers you via P2P"
                value="public"
                currentValue={level3Visibility}
                onChange={(val) => { setLevel3Visibility(val); handleSavePrivacySettings(undefined, val); }}
                benefits={["Discovered users", "Chat participants or Maxima contacts", "Personal contacts"]}
                color="amber" // Visual hint
              />
              <RadioOption
                label="Chat Access"
                description="Anyone with chat access to you"
                value="contacts"
                currentValue={level3Visibility}
                onChange={(val) => { setLevel3Visibility(val); handleSavePrivacySettings(undefined, val); }}
                benefits={["Chat participants or Maxima contacts", "Personal contacts"]}
                denied={["Discovered users"]}
                color="amber"
              />
              <RadioOption
                label="Personal Contacts Only"
                description={`Only contacts you mark as personal (${personalContacts.length} selected)`}
                value="personal"
                currentValue={level3Visibility}
                onChange={(val) => { setLevel3Visibility(val); handleSavePrivacySettings(undefined, val); }}
                benefits={["Personal contacts"]}
                denied={["Discovered users", "Chat participants or Maxima contacts"]}
                color="amber"
              />
            </div>
          </div>

          {/* Chat Permissions */}
          <div className="pt-6 border-t border-gray-200 dark:border-gray-700">
            <div className="flex items-center justify-between mb-4">
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-gray-800 dark:text-white">Chat Permissions</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                  Control who can start chats with you
                </p>
              </div>
            </div>

            <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg border border-gray-200 dark:border-gray-700">
              <div className="flex-1">
                <div className="font-medium text-gray-900 dark:text-white">Allow Direct Messages from Anyone</div>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                  {allowNonContactChats
                    ? 'Users can message you immediately without approval'
                    : 'Users must send a request and be approved'}
                </p>
              </div>
              <button
                onClick={handleToggleChatPermission}
                disabled={saving}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 ${saving ? 'opacity-50 cursor-not-allowed' : ''
                  } ${allowNonContactChats ? 'bg-primary-600' : 'bg-gray-200 dark:bg-gray-600'}`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${allowNonContactChats ? 'translate-x-6' : 'translate-x-1'
                    }`}
                />
              </button>
            </div>
          </div>

          {/* Application Mode */}
          <div className="pt-6 border-t border-gray-200 dark:border-gray-700">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-semibold text-gray-800 dark:text-white">Application Mode</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">MiniDapp permissions for transactions</p>
              </div>
            </div>

            <div className={`flex items-center gap-3 p-4 rounded-xl mb-4 ${writeMode ? 'bg-green-50 dark:bg-green-900/20 border border-green-100 dark:border-green-900/50' : 'bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-100 dark:border-yellow-900/50'}`}>
              <div className={`p-2 rounded-full ${writeMode ? 'bg-green-100 text-green-600' : 'bg-yellow-100 text-yellow-600'}`}>
                <Check size={20} />
              </div>
              <div>
                <h4 className={`font-semibold ${writeMode ? 'text-green-900 dark:text-green-100' : 'text-yellow-900 dark:text-yellow-100'}`}>
                  {writeMode ? 'Write Mode Enabled' : 'Read Only Mode'}
                </h4>
                <p className={`text-sm ${writeMode ? 'text-green-700 dark:text-green-300' : 'text-yellow-700 dark:text-yellow-300'}`}>
                  {writeMode
                    ? 'This MiniDapp has permission to sign transactions and write to the chain.'
                    : 'This MiniDapp is in Read Only mode. You cannot perform write operations.'}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Reusable Radio Component to reduce clutter
function RadioOption({ label, description, value, currentValue, onChange, benefits, denied }: {
  label: string, description: string, value: VisibilityLevel, currentValue: VisibilityLevel,
  onChange: (val: VisibilityLevel) => void, benefits?: string[], denied?: string[], color?: string
}) {
  const isSelected = currentValue === value;
  const borderClass = isSelected ? 'border-primary-500 ring-1 ring-primary-500' : 'border-gray-200 dark:border-gray-700';

  return (
    <label className={`flex items-start gap-3 p-4 border rounded-lg cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors ${borderClass} bg-white dark:bg-gray-800`}>
      <input
        type="radio"
        name={`radio-${label}`} // unique name group not strictly needed if controlled but good for access
        value={value}
        checked={isSelected}
        onChange={() => onChange(value)}
        className="mt-1 text-primary-600 focus:ring-primary-500 border-gray-300"
      />
      <div className="flex-1">
        <div className="font-medium text-gray-900 dark:text-white">{label}</div>
        <div className="text-sm text-gray-500 dark:text-gray-400 mt-1">{description}</div>
        <div className="text-xs text-gray-400 mt-2 space-y-0.5">
          {denied?.map((d, i) => (
            <div key={i} className="text-gray-300 dark:text-gray-500 line-through">✗ {d}</div>
          ))}
          {benefits?.map((b, i) => (
            <div key={i} className="text-green-600 dark:text-green-400">✓ {b}</div>
          ))}
        </div>
      </div>
    </label>
  );
}
