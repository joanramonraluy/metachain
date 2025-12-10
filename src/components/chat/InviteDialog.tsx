
import { Send, X } from "lucide-react";

interface InviteDialogProps {
    isOpen: boolean;
    onClose: () => void;
    onSend: () => void;
    isSending: boolean;
    contactName: string;
}

export default function InviteDialog({
    isOpen,
    onClose,
    onSend,
    isSending,
    contactName,
}: InviteDialogProps) {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-xl shadow-2xl max-w-sm w-full p-6 animate-in zoom-in-95 duration-200">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-bold text-gray-900">Invite to CharmChain</h3>
                    <button
                        onClick={onClose}
                        className="text-gray-500 hover:text-gray-700 transition-colors"
                        disabled={isSending}
                    >
                        <X size={20} />
                    </button>
                </div>

                <div className="mb-6">
                    <p className="text-gray-600 mb-4">
                        It looks like <strong>{contactName}</strong> doesn't have CharmChain installed yet.
                    </p>
                    <p className="text-gray-600 mb-4">
                        Send them an invitation via Maxima (MaxSolo) to let them know about CharmChain!
                    </p>

                    <div className="bg-gray-50 p-3 rounded-lg border border-gray-200 text-sm text-gray-500 italic">
                        "Hey! I want to connect with you on CharmChain..."
                    </div>
                </div>

                <div className="flex gap-3">
                    <button
                        onClick={onClose}
                        disabled={isSending}
                        className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors font-medium disabled:opacity-50"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={onSend}
                        disabled={isSending}
                        className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                        {isSending ? (
                            <>
                                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                                Sending...
                            </>
                        ) : (
                            <>
                                <Send size={16} />
                                Send Invite
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
}
