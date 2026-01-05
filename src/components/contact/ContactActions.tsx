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
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="p-4 border-b border-gray-100 bg-gray-50/50">
                <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider">Connection Status</h3>
            </div>
            <div className="p-4">
                {!isMaximaContact ? (
                    /* Show different actions based on user's chat permissions */
                    <div className="space-y-3">
                        <div className="flex items-center gap-2 mb-2">
                            <UserPlus size={18} className="text-blue-600" />
                            <span className="text-sm font-medium text-gray-900">Actions</span>
                        </div>
                        <p className="text-xs text-gray-500 mb-3">
                            {userAllowsNonContactChats
                                ? "This user accepts messages from anyone."
                                : "This user only accepts chats from contacts. Send a chat request first."}
                        </p>

                        {/* Incoming Maxima Contact Request - ALWAYS VISIBLE */}
                        {maximaIncomingRequest && (
                            <div className="space-y-2 mb-4">
                                <button
                                    disabled={true}
                                    className="w-full px-4 py-2 bg-purple-50 text-purple-600 border border-purple-200 rounded-lg font-medium flex items-center justify-center gap-2 cursor-default"
                                >
                                    <div className="animate-spin h-4 w-4 border-2 border-current border-t-transparent rounded-full" />
                                    Maxima Contact Request Received
                                </button>
                                <button
                                    onClick={onNavigateChat}
                                    className="w-full px-4 py-2 bg-white border border-purple-200 text-purple-600 rounded-lg hover:bg-purple-50 transition-colors font-medium"
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
                                    className="w-full px-4 py-2 bg-white border border-blue-200 text-blue-600 rounded-lg hover:bg-blue-50 transition-colors font-medium flex items-center justify-center gap-2"
                                >
                                    <span className="transform rotate-[-45deg]">➤</span>
                                    Send Message
                                </button>

                                {/* Secondary Status / Actions */}
                                {requestStatus === 'accepted' ? (
                                    <>
                                        <button
                                            disabled={true}
                                            className="w-full px-4 py-2 bg-green-50 text-green-600 border border-green-200 rounded-lg font-medium flex items-center justify-center gap-2 cursor-default"
                                        >
                                            <UserCheck size={18} />
                                            Chat Request Accepted
                                        </button>

                                        {/* Add to Maxima Contacts (only if accepted) */}
                                        {maximaRequestPending ? (
                                            <div className="space-y-2 mt-4">
                                                <button
                                                    disabled={true}
                                                    className="w-full px-4 py-2 bg-purple-50 text-purple-600 border border-purple-200 rounded-lg font-medium flex items-center justify-center gap-2 cursor-default"
                                                >
                                                    <div className="animate-spin h-4 w-4 border-2 border-current border-t-transparent rounded-full" />
                                                    Maxima Request Pending
                                                </button>
                                                <button
                                                    onClick={onCancelMaximaRequest}
                                                    disabled={sendingMaximaRequest}
                                                    className="w-full px-4 py-2 bg-white border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50 transition-colors font-medium text-sm"
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
                                                        ? 'bg-gray-50 border border-gray-200 text-gray-400 cursor-not-allowed'
                                                        : 'bg-white border border-purple-200 text-purple-600 hover:bg-purple-50'
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
                                            className="w-full px-4 py-2 bg-yellow-50 text-yellow-600 border border-yellow-200 rounded-lg font-medium flex items-center justify-center gap-2 cursor-default"
                                        >
                                            <div className="animate-spin h-4 w-4 border-2 border-current border-t-transparent rounded-full" />
                                            Request Pending
                                        </button>
                                        <button
                                            onClick={onCancelRequest}
                                            disabled={addingContact}
                                            className="w-full px-4 py-2 bg-white border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50 disabled:bg-gray-50 disabled:text-gray-400 disabled:cursor-not-allowed transition-colors font-medium flex items-center justify-center gap-2"
                                        >
                                            {addingContact ? "Cancelling..." : "Cancel Request"}
                                        </button>
                                    </div>
                                ) : (
                                    /* If open to chats but not a contact/request, show Add option if not already added */
                                    <button
                                        onClick={onSendContactRequest}
                                        disabled={addingContact}
                                        className="w-full px-4 py-2 bg-white border border-blue-200 text-blue-600 rounded-lg hover:bg-blue-50 disabled:bg-blue-50 disabled:text-blue-300 disabled:cursor-not-allowed transition-colors font-medium flex items-center justify-center gap-2"
                                    >
                                        <UserPlus size={18} />
                                        {addingContact ? "Sending..." : "Add to Contacts"}
                                    </button>
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
                                            className="w-full px-4 py-2 bg-white border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50 disabled:bg-gray-50 disabled:text-gray-400 disabled:cursor-not-allowed transition-colors font-medium flex items-center justify-center gap-2"
                                        >
                                            {addingContact ? "Cancelling..." : "Cancel Request"}
                                        </button>
                                    </div>
                                ) : (
                                    <>
                                        <button
                                            onClick={onSendContactRequest}
                                            disabled={addingContact}
                                            className="w-full px-4 py-2 bg-white border border-blue-200 text-blue-600 rounded-lg hover:bg-blue-50 disabled:bg-blue-50 disabled:text-blue-300 disabled:cursor-not-allowed transition-colors font-medium flex items-center justify-center gap-2"
                                        >
                                            <UserPlus size={18} />
                                            {addingContact ? "Sending..." : "Send Chat Request"}
                                        </button>
                                    </>
                                )}

                                {/* Disabled Message Indicator */}
                                <button
                                    disabled={true}
                                    className="w-full px-4 py-2 mt-2 rounded-lg font-medium flex items-center justify-center gap-2 transition-colors bg-white border border-gray-200 text-gray-400 cursor-not-allowed"
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
                            <UserCheck size={18} className="text-green-600" />
                            <span className="text-sm font-medium text-gray-900">Connected</span>
                        </div>
                        <p className="text-xs text-gray-500 mb-3">
                            You are connected with this user on Maxima.
                        </p>
                        <button
                            onClick={onNavigateChat}
                            className="w-full px-4 py-2 bg-white border border-blue-200 text-blue-600 rounded-lg hover:bg-blue-50 transition-colors font-medium flex items-center justify-center gap-2"
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
