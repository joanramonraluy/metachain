
import { Send, X, Zap } from "lucide-react";

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
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-[110] p-6 animate-in fade-in duration-500">
            <div className="bg-white/90 dark:bg-gray-950/80 backdrop-blur-3xl border border-white/20 dark:border-white/5 rounded-[3rem] shadow-[0_40px_100px_rgba(0,0,0,0.3)] w-full max-w-sm p-3 overflow-hidden animate-in zoom-in-95 duration-500">
                {/* Elite Modal Header */}
                <div className="p-8 pb-4 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                       <div className="w-14 h-14 bg-primary-500/10 rounded-[1.25rem] flex items-center justify-center text-primary-500 shadow-inner">
                          <Send size={28} strokeWidth={2.5} />
                       </div>
                       <div className="flex flex-col">
                          <span className="text-[9px] font-black text-primary-500 uppercase tracking-[0.4em] mb-1">Grid Invitation</span>
                          <h3 className="text-xl font-black text-gray-900 dark:text-white uppercase tracking-tight leading-none">Connect</h3>
                       </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="w-12 h-12 flex items-center justify-center bg-gray-100 dark:bg-white/5 text-gray-400 hover:text-red-500 rounded-[1.25rem] transition-all duration-300 active:scale-90"
                        disabled={isSending}
                    >
                        <X size={20} strokeWidth={3} />
                    </button>
                </div>

                <div className="p-8 pt-4">
                    <div className="mb-8 space-y-4">
                        <div className="flex items-center gap-3 mb-2 px-2">
                           <div className="w-2 h-2 rounded-full bg-primary-500 animate-pulse" />
                           <span className="text-[10px] font-black text-gray-400 uppercase tracking-[0.3em]">Identity Verification</span>
                        </div>
                        <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed font-medium">
                            It looks like <span className="text-primary-500 font-black">@{contactName}</span> hasn't discovered the MetaChain Grid yet.
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed italic border-l-2 border-primary-500/30 pl-4 py-2 bg-gray-50 dark:bg-white/2 rounded-r-xl">
                            "Hey! Let's connect on MetaChain for private messaging and value transfers."
                        </p>
                    </div>

                    <div className="flex flex-col gap-3">
                        <button
                            onClick={onSend}
                            disabled={isSending}
                            className={`w-full py-5 rounded-[1.75rem] font-black text-xs uppercase tracking-[0.3em] transition-all duration-500 shadow-2xl relative overflow-hidden active:scale-95 ${isSending
                                ? "bg-gray-100 dark:bg-white/5 text-gray-300 dark:text-gray-600 cursor-not-allowed"
                                : "bg-primary-500 text-white shadow-primary-500/30 hover:scale-[1.02]"
                                }`}
                        >
                            <div className="absolute inset-0 bg-gradient-to-tr from-white/20 to-transparent opacity-0 hover:opacity-100 transition-opacity duration-700" />
                            <div className="flex items-center justify-center gap-3 relative z-10">
                                {isSending ? (
                                    <div className="w-5 h-5 border-4 border-white/30 border-t-white rounded-full animate-spin"></div>
                                ) : (
                                    <Zap size={18} strokeWidth={3} />
                                )}
                                <span>{isSending ? "Syncing..." : "Transmit Invite"}</span>
                            </div>
                        </button>

                        <button
                            onClick={onClose}
                            disabled={isSending}
                            className="w-full py-4 bg-transparent text-gray-400 hover:text-gray-900 dark:hover:text-white rounded-2xl font-black text-[10px] uppercase tracking-widest transition-all active:scale-95 disabled:opacity-50"
                        >
                            Abort Invitation
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
