import React from 'react';
import { UserPlus, UserCheck } from 'lucide-react';

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
    onSendMaximaRequest
}) => {
    return (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden transition-colors">
            <div className="p-4 border-b border-gray-100 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-900/50">
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 uppercase tracking-wider">Connection Status</h3>
            </div>
            <div className="p-4">
                {!isMaximaContact ? (
                    /* Show different actions based on user's chat permissions */
                    <div className="space-y-3">
                        <div className="flex items-center gap-2 mb-2">
                            <UserPlus size={18} className="text-primary-600" />
                            <span className="text-sm font-medium text-gray-900 dark:text-white">Actions</span>
                        </div>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                            {userAllowsNonContactChats
                                ? "This user accepts messages from anyone."
                                : (hasChatHistory || requestStatus === 'accepted')
                                    ? "This user restricts new chats, but you have an existing conversation."
                                    : "This user only accepts chats from contacts. Send a chat request first."}
                        </p>

                        {/* Incoming Maxima Contact Request - ALWAYS VISIBLE */}
                        {maximaIncomingRequest && (
                            <div className="space-y-2 mb-4">
                                <button
                                    disabled={true}
                                    className="w-full px-4 py-2 bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400 border border-purple-200 dark:border-purple-800 rounded-lg font-medium flex items-center justify-center gap-2 cursor-default"
                                >
                                    <div className="animate-spin h-4 w-4 border-2 border-current border-t-transparent rounded-full" />
                                    Maxima Contact Request Received
                                </button>
                                <button
                                    onClick={onNavigateChat}
                                    className="w-full px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors font-medium"
                                >
                                    View Request in Chat
                                </button>
                            </div>
                        )}

                        {/* Consolidated Action Logic */}
                        {(userAllowsNonContactChats || requestStatus === 'accepted' || hasChatHistory || maximaIncomingRequest) ? (
                            /* Case 1: Chat is Enabled (Open or Accepted or History or Incoming Request) */
                            <>
                                <button
                                    onClick={onNavigateChat}
                                    className="w-full px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors font-medium flex items-center justify-center gap-2"
                                >
                                    <span className="transform rotate-[-45deg]">➤</span>
                                    Send Message
                                </button>

                                {/* Secondary Status / Actions */}
                                {requestStatus === 'accepted' ? (
                                    <>
                                        <button
                                            disabled={true}
                                            className="w-full px-4 py-2 bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 border border-green-200 dark:border-green-800 rounded-lg font-medium flex items-center justify-center gap-2 cursor-default"
                                        >
                                            <UserCheck size={18} />
                                            Chat Request Accepted
                                        </button>

                                        {/* Add to Maxima Contacts (only if accepted) */}
                                        {maximaRequestPending ? (
                                            <div className="space-y-2 mt-4">
                                                <button
                                                    disabled={true}
                                                    className="w-full px-4 py-2 bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400 border border-purple-200 dark:border-purple-800 rounded-lg font-medium flex items-center justify-center gap-2 cursor-default"
                                                >
                                                    <div className="animate-spin h-4 w-4 border-2 border-current border-t-transparent rounded-full" />
                                                    Maxima Request Pending
                                                </button>
                                                <button
                                                    onClick={onCancelMaximaRequest}
                                                    disabled={sendingMaximaRequest}
                                                    className="w-full px-4 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors font-medium text-sm"
                                                >
                                                    {sendingMaximaRequest ? "Cancelling..." : "Cancel Maxima Request"}
                                                </button>
                                            </div>
                                        ) : (
                                            !maximaIncomingRequest && (
                                                <button
                                                    onClick={onSendMaximaRequest}
                                                    disabled={sendingMaximaRequest}
                                                    className={`w-full px-4 py-2 mt-4 rounded-lg transition-colors font-medium flex items-center justify-center gap-2 ${sendingMaximaRequest
                                                        ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                                                        : 'bg-purple-600 text-white hover:bg-purple-700'
                                                        }`}
                                                >
                                                    <UserPlus size={18} />
                                                    {sendingMaximaRequest ? "Sending..." : "Request Maxima Contact"}
                                                </button>
                                            )
                                        )}
                                    </>
                                ) : requestStatus === 'pending' ? (
                                    <div className="space-y-2">
                                        <button
                                            disabled={true}
                                            className="w-full px-4 py-2 bg-yellow-50 dark:bg-yellow-900/20 text-yellow-600 dark:text-yellow-400 border border-yellow-200 dark:border-yellow-800 rounded-lg font-medium flex items-center justify-center gap-2 cursor-default"
                                        >
                                            <div className="animate-spin h-4 w-4 border-2 border-current border-t-transparent rounded-full" />
                                            Request Pending
                                        </button>
                                        <button
                                            onClick={onCancelRequest}
                                            disabled={addingContact}
                                            className="w-full px-4 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-600 disabled:bg-gray-50 dark:disabled:bg-gray-800 disabled:text-gray-400 disabled:cursor-not-allowed transition-colors font-medium flex items-center justify-center gap-2"
                                        >
                                            {addingContact ? "Cancelling..." : "Cancel Request"}
                                        </button>
                                    </div>
                                ) : (
                                    /* If open to chats but not a contact/request, show Maxima Contact Request option */
                                    !maximaRequestPending && (
                                        <button
                                            onClick={onSendMaximaRequest}
                                            disabled={sendingMaximaRequest}
                                            className={`w-full px-4 py-2 rounded-lg transition-colors font-medium flex items-center justify-center gap-2 ${sendingMaximaRequest
                                                ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                                                : 'bg-purple-600 text-white hover:bg-purple-700'
                                                }`}
                                        >
                                            <UserPlus size={18} />
                                            {sendingMaximaRequest ? "Sending..." : "Request Maxima Contact"}
                                        </button>
                                    )
                                )}
                            </>
                        ) : (
                            /* Case 2: Chat is Closed/Restricted AND No History/Acceptance */
                            <>
                                {requestStatus === 'pending' ? (
                                    <div className="space-y-2">
                                        <button
                                            disabled={true}
                                            className="w-full px-4 py-2 bg-yellow-50 text-yellow-600 border border-yellow-200 rounded-lg font-medium flex items-center justify-center gap-2 cursor-default"
                                        >
                                            <div className="animate-spin h-4 w-4 border-2 border-current border-t-transparent rounded-full" />
                                            Request Pending
                                        </button>
                                        <button
                                            onClick={onCancelRequest}
                                            disabled={addingContact}
                                            className="w-full px-4 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-600 disabled:bg-gray-50 dark:disabled:bg-gray-800 disabled:text-gray-400 disabled:cursor-not-allowed transition-colors font-medium flex items-center justify-center gap-2"
                                        >
                                            {addingContact ? "Cancelling..." : "Cancel Request"}
                                        </button>
                                    </div>
                                ) : (
                                    <>
                                        <button
                                            onClick={onSendContactRequest}
                                            disabled={addingContact}
                                            className="w-full px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:bg-primary-300 disabled:cursor-not-allowed transition-colors font-medium flex items-center justify-center gap-2"
                                        >
                                            <UserPlus size={18} />
                                            {addingContact ? "Sending..." : "Send Chat Request"}
                                        </button>
                                    </>
                                )}

                                {/* Disabled Message Indicator */}
                                <button
                                    disabled={true}
                                    className="w-full px-4 py-2 mt-2 rounded-lg font-medium flex items-center justify-center gap-2 transition-colors bg-gray-200 dark:bg-gray-700 text-gray-400 dark:text-gray-500 cursor-not-allowed"
                                    title="This user only accepts chats from contacts"
                                >
                                    <span className="transform rotate-[-45deg]">➤</span>
                                    Send Message (Disabled)
                                </button>
                            </>
                        )}
                    </div>
                ) : (
                    <div className="space-y-3">
                        <div className="flex items-center gap-2 mb-2">
                            <UserCheck size={18} className="text-green-600 dark:text-green-400" />
                            <span className="text-sm font-medium text-gray-900 dark:text-white">Connected</span>
                        </div>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                            You are connected with this user on Maxima.
                        </p>
                        <button
                            onClick={onNavigateChat}
                            className="w-full px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors font-medium flex items-center justify-center gap-2"
                        >
                            <span className="transform rotate-[-45deg]">➤</span>
                            Send Message
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

export default ContactActions;
