import React from 'react';
import { UserPlus, UserCheck, MessageCircle, ShieldAlert, ShieldCheck, XCircle, Loader2, Send, Zap } from 'lucide-react';

interface ContactActionsProps {
    isMaximaContact: boolean;
    userAllowsNonContactChats: boolean;
    maximaIncomingRequest: boolean;
    requestStatus: string | null;
    hasChatHistory: boolean;
    maximaRequestPending: boolean;
    sendingMaximaRequest: boolean;
    addingContact: boolean;
    onNavigateChat: () => void;
    onCancelRequest: () => void;
    onSendContactRequest: () => void;
    onCancelMaximaRequest: () => void;
    onSendMaximaRequest: () => void;
    onPing?: () => void;
    isBlocked: boolean;
    onToggleBlock: () => void;
    onRemoveContact?: () => void;
    removingContact?: boolean;
    isCheckingProfile?: boolean;
    mode?: 'all' | 'connection' | 'privacy';
}

const ContactActions: React.FC<ContactActionsProps> = ({
    isMaximaContact,
    userAllowsNonContactChats,
    maximaIncomingRequest,
    requestStatus,
    hasChatHistory,
    maximaRequestPending,
    sendingMaximaRequest,
    addingContact,
    onNavigateChat,
    onCancelRequest,
    onSendContactRequest,
    onCancelMaximaRequest,
    onSendMaximaRequest,
    onPing,
    isBlocked,
    onToggleBlock,
    onRemoveContact,
    removingContact = false,
    isCheckingProfile = false,
    mode = 'all'
}) => {
    if (isCheckingProfile) {
        return (
            <div className="bg-white dark:bg-gray-900 rounded-[2rem] border border-gray-100 dark:border-gray-800/50 p-8 flex flex-col items-center justify-center text-center animate-pulse">
                <Loader2 className="w-8 h-8 text-primary-500 animate-spin mb-4" />
                <p className="text-xs font-black uppercase tracking-widest text-gray-500">Verifying Permissions...</p>
            </div>
        );
    }

    const ActionButton = ({ onClick, disabled, variant = 'primary', children, icon: Icon }: any) => {
        const variants: any = {
            primary: "bg-primary-500 text-white hover:bg-primary-600 shadow-xl shadow-primary-500/20",
            secondary: "bg-gray-100 dark:bg-white/10 text-gray-900 dark:text-white hover:bg-gray-200 dark:hover:bg-white/20 border border-white/5",
            danger: "bg-rose-500/10 text-rose-500 hover:bg-rose-500 hover:text-white border border-rose-500/20",
            success: "bg-emerald-500/10 text-emerald-500 border border-emerald-500/20",
            purple: "bg-indigo-600 text-white hover:bg-indigo-700 shadow-xl shadow-indigo-500/20 shadow-indigo-500/30",
            teal: "bg-teal-500/10 text-teal-600 dark:text-teal-400 border border-teal-500/20 hover:bg-teal-500 hover:text-white",
        };

        return (
            <button
                onClick={onClick}
                disabled={disabled}
                className={`
                    w-full px-6 py-5 rounded-[1.5rem] font-black text-[10px] sm:text-[11px] uppercase tracking-[0.1em] sm:tracking-[0.15em]
                    flex items-center justify-center gap-3 transition-all active:scale-95 disabled:opacity-50 disabled:active:scale-100
                    ${variants[variant]}
                `}
            >
                {Icon && <Icon size={16} className={disabled && (variant === 'secondary' || variant === 'danger') ? 'animate-spin' : ''} strokeWidth={3} />}
                {children}
            </button>
        );
    };

    return (
        <div className="space-y-8">
            {/* PRIVACY & BLOCK SECTION */}
            {(mode === 'all' || mode === 'privacy') && (
                <div className="bg-white/70 dark:bg-gray-900/40 backdrop-blur-md rounded-[3rem] border border-white/20 dark:border-white/5 p-10 shadow-lg shadow-black/5">
                    <div className="flex items-center gap-4 mb-6">
                        <div className="w-12 h-12 rounded-2xl bg-gray-100 dark:bg-white/5 flex items-center justify-center text-gray-400">
                          <ShieldAlert size={22} />
                        </div>
                        <div className="flex flex-col">
                           <span className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] mb-0.5">Control Center</span>
                           <h3 className="text-sm font-black text-gray-900 dark:text-white uppercase tracking-tight">Privacy Protocol</h3>
                        </div>
                    </div>
                    
                    <p className="text-xs text-gray-500 font-medium mb-8 px-1 leading-relaxed opacity-70">
                      Blocking prevents all incoming communications. Maxima nodes will stop announcing folder updates to this peer.
                    </p>

                    <ActionButton 
                      onClick={onToggleBlock} 
                      variant={isBlocked ? 'secondary' : 'danger'} 
                      icon={isBlocked ? ShieldCheck : XCircle}
                    >
                        {isBlocked ? "Unblock Node" : "Block Node"}
                    </ActionButton>
                    
                    {isBlocked && (
                        <div className="mt-6 p-4 bg-rose-500/5 rounded-2xl border border-rose-500/10 animate-in fade-in slide-in-from-top-2">
                           <p className="text-[10px] font-black text-rose-500/70 text-center uppercase tracking-widest italic">Communication currently restricted</p>
                        </div>
                    )}
                </div>
            )}

            {/* CONNECTION SECTION */}
            {(mode === 'all' || mode === 'connection') && (
                <div className="bg-white/70 dark:bg-gray-900/40 backdrop-blur-md rounded-[3rem] border border-white/20 dark:border-white/5 overflow-hidden p-10 shadow-lg shadow-black/5">
                    <div className="flex items-center gap-4 mb-8">
                        <div className="w-12 h-12 rounded-2xl bg-primary-500/10 flex items-center justify-center text-primary-500">
                          <MessageCircle size={22} />
                        </div>
                        <div className="flex flex-col">
                           <span className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] mb-0.5">Network Sync</span>
                           <h3 className="text-sm font-black text-gray-900 dark:text-white uppercase tracking-tight">Messaging Bridge</h3>
                        </div>
                    </div>

                    <div className="space-y-6">
                        {!isMaximaContact ? (
                            <div className="space-y-6">
                                <p className="text-xs text-gray-500 dark:text-gray-400 font-medium leading-relaxed px-1 opacity-70">
                                    {userAllowsNonContactChats
                                        ? "This identity is announcing an open-gate policy (Discovery Level 1)."
                                        : (hasChatHistory || requestStatus === 'accepted')
                                            ? "Access granted. Conversation line is technically active."
                                            : "This identity requires a handshake before accepting session data."}
                                </p>

                                {maximaIncomingRequest && (
                                    <div className="p-6 bg-indigo-500/5 border border-indigo-500/10 rounded-[2rem] space-y-4 shadow-xl shadow-indigo-500/5 animate-pulse">
                                        <div className="flex items-center gap-3 text-indigo-500">
                                          <Loader2 size={16} className="animate-spin" />
                                           <span className="text-[10px] font-black uppercase tracking-[0.2em]">Handshake Pending</span>
                                        </div>
                                        <ActionButton onClick={onNavigateChat} variant="purple" icon={MessageCircle}>
                                            Resolve in Chat
                                        </ActionButton>
                                    </div>
                                )}

                                {(userAllowsNonContactChats || ((requestStatus === 'accepted' || hasChatHistory || maximaIncomingRequest) && requestStatus !== 'declined')) ? (
                                    <div className="space-y-4">
                                        <ActionButton onClick={onNavigateChat} icon={Send}>
                                            Open Secure Tunnel
                                        </ActionButton>

                                        {requestStatus === 'accepted' ? (
                                            <div className="space-y-4 pt-2">
                                                <ActionButton disabled variant="success" icon={UserCheck}>
                                                    Handshake Verified
                                                </ActionButton>

                                                {maximaRequestPending ? (
                                                    <div className="space-y-3">
                                                        <ActionButton disabled variant="secondary" icon={Loader2}>
                                                            Sync Requested...
                                                        </ActionButton>
                                                         <button onClick={onCancelMaximaRequest} className="w-full text-[10px] font-black uppercase text-rose-500/60 hover:text-rose-500 tracking-[0.15em] py-2 transition-colors">
                                                            {sendingMaximaRequest ? "Finalizing..." : "Cancel Protocol"}
                                                        </button>
                                                    </div>
                                                ) : !maximaIncomingRequest && (
                                                    <ActionButton onClick={onSendMaximaRequest} disabled={sendingMaximaRequest} variant="purple" icon={UserPlus}>
                                                        {sendingMaximaRequest ? "Sending..." : "Upgrade to Maxima Contact"}
                                                    </ActionButton>
                                                )}
                                            </div>
                                        ) : requestStatus === 'pending' ? (
                                            <div className="space-y-3 pt-2">
                                                <ActionButton disabled variant="secondary" icon={Loader2}>
                                                    Request Relaying...
                                                </ActionButton>
                                                <button onClick={onCancelRequest} className="w-full text-[10px] font-black uppercase text-rose-500/60 hover:text-rose-500 tracking-[0.2em] py-2 transition-colors">
                                                    Abort Sync
                                                </button>
                                            </div>
                                        ) : (
                                            !maximaRequestPending && (
                                              <div className="pt-2">
                                                <ActionButton onClick={onSendMaximaRequest} disabled={sendingMaximaRequest} variant="purple" icon={UserPlus}>
                                                    {sendingMaximaRequest ? "Transmitting..." : "Connect via Maxima"}
                                                </ActionButton>
                                              </div>
                                            )
                                        )}
                                    </div>
                                ) : (
                                    <div className="space-y-4">
                                        {requestStatus === 'pending' ? (
                                            <div className="space-y-3">
                                                <ActionButton disabled variant="secondary" icon={Loader2}>
                                                    Identity Verification...
                                                </ActionButton>
                                                <button onClick={onCancelRequest} className="w-full text-[10px] font-black uppercase text-rose-500/60 hover:text-rose-500 tracking-[0.2em] py-2 transition-colors">
                                                    Cancel Request
                                                </button>
                                            </div>
                                        ) : (
                                            <ActionButton onClick={onSendContactRequest} disabled={addingContact} icon={UserPlus}>
                                                {addingContact ? "Sending..." : "Initiate Handshake"}
                                            </ActionButton>
                                        )}
                                        <div className="p-4 rounded-2xl bg-gray-50/50 dark:bg-black/20 border border-dashed border-gray-200 dark:border-white/5 text-center">
                                           <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest opacity-60">Handshake protocol required</span>
                                        </div>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="space-y-6">
                                    <ActionButton onClick={onNavigateChat} icon={Send}>
                                        Join Secure Channel
                                    </ActionButton>

                                    {onPing && (
                                        <ActionButton onClick={onPing} variant="teal" icon={Zap}>
                                            Verify Connection
                                        </ActionButton>
                                    )}
                                    
                                    {onRemoveContact && mode === 'all' && (
                                        <div className="pt-4 border-t border-white/5">
                                            <button
                                                onClick={onRemoveContact}
                                                disabled={removingContact}
                                                 className="w-full py-4 px-6 rounded-2xl text-[9px] sm:text-[10px] font-black uppercase tracking-[0.15em] sm:tracking-[0.2em] text-gray-400 hover:text-rose-500 transition-all border border-transparent hover:border-rose-500/20 bg-black/5 hover:bg-rose-500/5 group"
                                            >
                                                {removingContact ? "Cleaning Registry..." : "Sever Connection"}
                                            </button>
                                        </div>
                                    )}
                                </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default ContactActions;
