import React, { useEffect, useState, useContext } from 'react';
import { createPortal } from 'react-dom';
import { minimaService } from '../../services/minima.service';
import { groupService } from '../../services/group.service';
import { channelService } from '../../services/channel.service';
import { appContext } from '../../AppContext';
import { Search, X, Users, Radio, User } from 'lucide-react';

interface ForwardModalProps {
    message: string;
    messageType: string;
    filedata?: string;
    onClose: () => void;
    isForwarded: boolean;
    currentChatId?: string;
}

interface Recipient {
    id: string;
    name: string;
    type: 'individual' | 'group' | 'channel';
    avatar?: string;
    lastMessageDate?: number;
}

const ForwardModal: React.FC<ForwardModalProps> = ({ message, messageType, filedata, onClose, isForwarded, currentChatId }) => {
    const { loaded, myPublicKey, userName } = useContext(appContext);
    const [searchTerm, setSearchTerm] = useState('');
    const [recipients, setRecipients] = useState<Recipient[]>([]);
    const [loading, setLoading] = useState(true);
    const [sending, setSending] = useState(false);

    useEffect(() => {
        if (!loaded || !myPublicKey) return;

        const fetchData = async () => {
            try {
                // Fetch individual chats
                const recentChats = await minimaService.getRecentChats();
                const individuals: Recipient[] = recentChats
                    .filter(c => !c.archived)
                    .map(c => ({
                        id: c.publickey,
                        name: c.roomname || 'Unknown',
                        type: 'individual',
                        avatar: c.avatar,
                        lastMessageDate: c.lastMessageDate
                    }));

                // Fetch groups
                const myGroups = await groupService.getMyGroups(myPublicKey);
                const groups: Recipient[] = myGroups
                    .filter(g => !g.archived)
                    .map(g => ({
                        id: g.group_id,
                        name: g.name,
                        type: 'group',
                        avatar: g.avatar,
                        lastMessageDate: g.created_date // Or last message date if available
                    }));

                // Fetch channels and filter for admin/creator
                const myChannels = await channelService.getMyChannels(myPublicKey);
                const channelFilters = await Promise.all(
                    myChannels.map(async (ch) => {
                        const admin = await channelService.isAdmin(ch.channel_id, myPublicKey);
                        return { ch, admin };
                    })
                );

                const channels: Recipient[] = channelFilters
                    .filter(f => f.admin && !f.ch.archived)
                    .map(f => ({
                        id: f.ch.channel_id,
                        name: f.ch.name,
                        type: 'channel',
                        avatar: f.ch.avatar,
                        lastMessageDate: f.ch.created_date
                    }));

                // Combine, filter out current chat, and sort by last action date
                const all = [...individuals, ...groups, ...channels]
                    .filter(r => r.id !== currentChatId)
                    .sort((a, b) =>
                        (b.lastMessageDate || 0) - (a.lastMessageDate || 0)
                    );

                setRecipients(all);
                setLoading(false);
            } catch (err) {
                console.error("Error fetching recipients for forward:", err);
                setLoading(false);
            }
        };

        fetchData();
    }, [loaded, myPublicKey]);

    const handleForward = async (recipient: Recipient) => {
        if (sending) return;
        setSending(true);

        try {
            if (recipient.type === 'individual') {
                await minimaService.sendMessage(
                    recipient.id,
                    userName || 'Me',
                    message,
                    messageType,
                    filedata || '',
                    0, // amount
                    undefined,
                    undefined,
                    "metachain",
                    true, // forwarded
                    undefined,
                    undefined,
                    isForwarded // forwarded indicator flag
                );
            } else if (recipient.type === 'group') {
                await groupService.sendGroupMessage(
                    recipient.id,
                    message,
                    messageType,
                    myPublicKey!,
                    userName || 'Me',
                    filedata || '',
                    isForwarded
                );
            } else if (recipient.type === 'channel') {
                await channelService.publishMessage(
                    recipient.id,
                    message,
                    messageType,
                    myPublicKey!,
                    userName || 'Me',
                    filedata || '',
                    isForwarded
                );
            }

            window.dispatchEvent(new CustomEvent('FORWARD_SUCCESS'));
            setTimeout(() => {
                onClose();
            }, 100);
        } catch (err) {
            console.error("Failed to forward message:", err);
            alert("Error: " + (err instanceof Error ? err.message : String(err)));
            setSending(false);
        }
    };

    const filteredRecipients = recipients.filter(r =>
        r.name.toLowerCase().includes(searchTerm.toLowerCase())
    );

    const defaultAvatar = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23cbd5e1'%3E%3Cpath d='M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z'/%3E%3C/svg%3E";

    return createPortal(
        <div className="fixed inset-0 bg-gray-900 bg-opacity-75 flex items-center justify-center z-[100] p-4" onClick={onClose}>
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-[480px] max-w-full overflow-hidden border border-gray-200 dark:border-gray-700 flex flex-col max-h-[80vh]" onClick={(e) => e.stopPropagation()}>
                {/* Header */}
                <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center">
                    <h3 className="text-xl font-bold text-gray-900 dark:text-white">Forward Message</h3>
                    <button onClick={onClose} className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors">
                        <X size={24} />
                    </button>
                </div>

                {/* Search */}
                <div className="p-4 bg-gray-50 dark:bg-gray-700/50">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                        <input
                            type="text"
                            placeholder="Search chats, groups..."
                            className="w-full pl-10 pr-4 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500 outline-none"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>
                </div>

                {/* List */}
                <div className="flex-1 overflow-y-auto p-2">
                    {loading ? (
                        <div className="flex flex-col items-center justify-center p-8 gap-3">
                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500"></div>
                            <span className="text-gray-500">Loading recipients...</span>
                        </div>
                    ) : filteredRecipients.length > 0 ? (
                        <div className="space-y-1">
                            {filteredRecipients.map((recipient) => (
                                <button
                                    key={`${recipient.type}-${recipient.id}`}
                                    onClick={() => handleForward(recipient)}
                                    disabled={sending}
                                    className="w-full flex items-center gap-3 p-3 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors text-left disabled:opacity-50"
                                >
                                    <div className="relative flex-shrink-0">
                                        <img
                                            src={recipient.avatar || defaultAvatar}
                                            alt={recipient.name}
                                            className="w-10 h-10 rounded-full object-cover bg-gray-200 dark:bg-gray-700"
                                        />
                                        <div className="absolute -bottom-1 -right-1 bg-white dark:bg-gray-800 rounded-full p-0.5 border border-gray-100 dark:border-gray-700">
                                            {recipient.type === 'individual' && <User size={10} className="text-gray-500" />}
                                            {recipient.type === 'group' && <Users size={10} className="text-blue-500" />}
                                            {recipient.type === 'channel' && <Radio size={10} className="text-purple-500" />}
                                        </div>
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <h4 className="font-medium text-gray-900 dark:text-white truncate">{recipient.name}</h4>
                                        <span className="text-xs text-gray-500 capitalize">{recipient.type}</span>
                                    </div>
                                </button>
                            ))}
                        </div>
                    ) : (
                        <div className="text-center p-8 text-gray-500">
                            No recipients found
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="p-4 border-t border-gray-200 dark:border-gray-700 flex justify-end">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 font-medium transition-colors"
                    >
                        Cancel
                    </button>
                </div>
            </div>
        </div>,
        document.body
    );
};

export default ForwardModal;
