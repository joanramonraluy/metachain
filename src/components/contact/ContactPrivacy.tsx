import React from 'react';
import { UserCheck } from 'lucide-react';

interface ContactPrivacyProps {
    isPersonalContact: boolean;
    togglingPersonal: boolean;
    onTogglePersonal: () => void;
}

const ContactPrivacy: React.FC<ContactPrivacyProps> = ({
    isPersonalContact,
    togglingPersonal,
    onTogglePersonal,
}) => {
    return (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden mt-4">
            <div className="p-4 border-b border-gray-100 bg-gray-50/50">
                <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider">Privacy & Permissions</h3>
            </div>
            <div className="p-4">
                <div className="flex items-center justify-between">
                    <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                            <UserCheck size={18} className="text-blue-600" />
                            <span className="text-sm font-medium text-gray-900">Personal Contact</span>
                        </div>
                        <p className="text-xs text-gray-500">
                            Personal contacts can see your private information (Level 3)
                        </p>
                    </div>
                    <button
                        onClick={onTogglePersonal}
                        disabled={togglingPersonal}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 ${isPersonalContact ? 'bg-blue-600' : 'bg-gray-200'
                            }`}
                    >
                        <span
                            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${isPersonalContact ? 'translate-x-6' : 'translate-x-1'
                                }`}
                        />
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ContactPrivacy;
