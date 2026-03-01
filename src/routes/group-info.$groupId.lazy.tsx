import { createLazyFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, useContext, useCallback } from "react";
import { ArrowLeft, Trash2, Users, Edit2, Check, X, ShieldOff, UserPlus, Search } from "lucide-react";
import { groupService } from "../services/group.service";
import { chatService } from "../services/chat.service";
import { appContext } from "../AppContext";
import { MDS } from "@minima-global/mds";

export const Route = createLazyFileRoute("/group-info/$groupId")({
  component: GroupInfoPage,
});

import { MoreVertical } from "lucide-react";

interface GroupMember {
  publickey: string;
  name?: string;
  icon?: string;
  isMe?: boolean;
  role?: 'creator' | 'admin' | 'member';
}

const shortenKey = (key: string) => {
  if (!key) return "";
  return `${key.substring(0, 8)}...${key.substring(key.length - 8)}`;
};

function GroupInfoPage() {
  const { groupId } = Route.useParams();
  const navigate = useNavigate();
  const { myPublicKey, userName } = useContext(appContext);

  const [groupName, setGroupName] = useState<string>("Group");
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const [isCreator, setIsCreator] = useState(false);
  const [myRole, setMyRole] = useState<'creator' | 'admin' | 'member'>('member');

  const [isEditingName, setIsEditingName] = useState(false);
  const [newName, setNewName] = useState("");
  const [savingName, setSavingName] = useState(false);

  const [description, setDescription] = useState("");
  const [isEditingDesc, setIsEditingDesc] = useState(false);
  const [newDesc, setNewDesc] = useState("");
  const [savingDesc, setSavingDesc] = useState(false);

  // New state for contextual menu Actions on a member
  const [activeMenuPubkey, setActiveMenuPubkey] = useState<string | null>(null);
  const [bannedMembers, setBannedMembers] = useState<Array<{ publickey: string; username: string; banned_by: string; banned_at: number }>>([]);

  // Add Member modal state
  const [showAddMember, setShowAddMember] = useState(false);
  const [addableContacts, setAddableContacts] = useState<Array<{ publickey: string; name: string; currentaddress: string; type: 'contact' | 'community' }>>([]);
  const [addMemberSearch, setAddMemberSearch] = useState("");
  const [addingMember, setAddingMember] = useState<string | null>(null);
  const [addMemberTab, setAddMemberTab] = useState<'all' | 'contacts' | 'community'>('all');

  const fetchGroupDetails = useCallback(async () => {
    try {
      setLoading(true);
      const info = await groupService.getGroupInfo(groupId);
      if (info) {
        setGroupName((info as any).NAME || (info as any).name || "Group");
        setDescription((info as any).DESCRIPTION || (info as any).description || "");
        const creator = (info as any).CREATOR_PUBLICKEY || (info as any).creator_publickey;
        setIsCreator((creator || "").toLowerCase() === (myPublicKey || "").toLowerCase());
      }

      const rawMembers = await groupService.getGroupMembers(groupId);

      const mappedMembers = rawMembers.map((m: any) => {
        // Handle properties that might be upper or lowercase depending on DB return
        const pubkey = m.PUBLICKEY || m.publickey;
        const username = m.RESOLVED_NAME || m.resolved_name || m.USERNAME || m.username || "Unknown Member";
        const role = (m.ROLE || m.role || "member").toLowerCase();

        const isMe = (pubkey || "").toLowerCase() === (myPublicKey || "").toLowerCase();

        if (isMe) {
          setMyRole(role as any);
        }

        return {
          publickey: pubkey,
          name: username,
          isMe: isMe,
          role: role
        };
      });

      setMembers(mappedMembers);

      // Fetch banned members if creator
      const bans = await groupService.getGroupBans(groupId);
      setBannedMembers(bans.map((b: any) => ({
        publickey: b.PUBLICKEY || b.publickey,
        username: b.RESOLVED_NAME || b.resolved_name || b.USERNAME || b.username || "Unknown",
        banned_by: b.BANNED_BY || b.banned_by,
        banned_at: Number(b.BANNED_AT || b.banned_at)
      })));

    } catch (err) {
      console.error("Failed to load group info:", err);
    } finally {
      setLoading(false);
    }
  }, [groupId, myPublicKey]);

  useEffect(() => {
    if (groupId) {
      fetchGroupDetails();
    }
  }, [groupId, fetchGroupDetails]);

  const handleExitGroup = async () => {
    try {
      // Notify other members that we are leaving
      await groupService.leaveGroup(groupId, myPublicKey || "", userName || "Unknown");
      // Clean up local group data
      await groupService.deleteGroup(groupId);
      navigate({ to: '/' });
    } catch (err) {
      console.error("Failed to exit group:", err);
      // Wait a moment for UX
      setTimeout(() => alert("Failed to exit group"), 100);
    }
  };

  const handleSaveName = async () => {
    if (!newName.trim() || newName.trim() === groupName) {
      setIsEditingName(false);
      return;
    }

    setSavingName(true);
    try {
      await groupService.updateGroupDetails(groupId, newName.trim(), null, myPublicKey || "");
      setGroupName(newName.trim());
      setIsEditingName(false);
    } catch (err) {
      console.error("Failed to rename group:", err);
      // alert("Failed to rename group"); // Silenced alert on blur for better UX
      setNewName(groupName); // revert on fail
    } finally {
      setSavingName(false);
    }
  };

  const handleSaveDesc = async () => {
    if (newDesc.trim() === description) {
      setIsEditingDesc(false);
      return;
    }

    setSavingDesc(true);
    try {
      await groupService.updateGroupDetails(groupId, null, newDesc.trim(), myPublicKey || "");
      setDescription(newDesc.trim());
      setIsEditingDesc(false);
    } catch (err) {
      console.error("Failed to update description:", err);
      setNewDesc(description); // revert on fail
    } finally {
      setSavingDesc(false);
    }
  };

  // Listen for solo events when other members update the name or roles
  useEffect(() => {
    const handleGroupUpdate = (e: any) => {
      if (e.detail && e.detail.groupId === groupId && e.detail.type === "group_update") {
        if (e.detail.name !== undefined) {
          setGroupName(e.detail.name);
        }
        if (e.detail.description !== undefined) {
          setDescription(e.detail.description);
        }
        // If it's a role update or general refresh, re-fetch group details
        // to get the latest members list!
        if (groupId) {
          fetchGroupDetails();
        }
      }
    };
    window.addEventListener("GROUP_UPDATE", handleGroupUpdate);
    return () => window.removeEventListener("GROUP_UPDATE", handleGroupUpdate);
  }, [groupId]);

  const handleRoleChange = async (targetPubkey: string, newRole: 'admin' | 'member') => {
    try {
      setActiveMenuPubkey(null);
      await groupService.updateMemberRole(groupId, targetPubkey, newRole, myPublicKey || "");
      // Re-fetch members to reflect changes immediately
      fetchGroupDetails();
    } catch (err) {
      console.error("Failed to update role:", err);
      alert("Failed to update member role");
    }
  };

  const handleRemoveMember = async (targetPubkey: string) => {
    try {
      setActiveMenuPubkey(null);
      await groupService.removeMember(groupId, targetPubkey, myPublicKey || "", userName || "Unknown");
      // Re-fetch members to reflect changes immediately
      fetchGroupDetails();
    } catch (err) {
      console.error("Failed to remove member:", err);
      alert("Failed to remove member");
    }
  };

  const handleUnban = async (targetPubkey: string) => {
    try {
      await groupService.unbanMember(groupId, targetPubkey);
      fetchGroupDetails();
    } catch (err) {
      console.error("Failed to unban member:", err);
    }
  };

  const openAddMember = async () => {
    try {
      // Load Maxima contacts
      const res = await MDS.cmd.maxcontacts();
      const raw = (res as any)?.response?.contacts || [];

      // Also load community contacts from recent chats
      const chats = await chatService.getRecentChats();
      const contactKeys = new Set(raw.map((c: any) => c.publickey));
      const communityContacts = chats
        .filter((chat: any) => chat.publickey && !contactKeys.has(chat.publickey))
        .map((chat: any) => ({
          publickey: chat.publickey,
          name: chat.roomname || chat.publickey,
          currentaddress: chat.currentaddress || chat.publickey,
          type: 'community' as const
        }));

      const allContacts = [
        ...raw.map((c: any) => ({
          publickey: c.publickey,
          name: c.extradata?.name || c.currentaddress || c.publickey,
          currentaddress: c.currentaddress || c.publickey,
          type: 'contact' as const
        })),
        ...communityContacts
      ];

      // Filter out existing members and banned users
      const existingKeys = new Set(members.map(m => m.publickey.toLowerCase()));
      const bannedKeys = new Set(bannedMembers.map(b => b.publickey.toLowerCase()));

      const filtered = allContacts.filter(c =>
        !existingKeys.has(c.publickey.toLowerCase()) &&
        !bannedKeys.has(c.publickey.toLowerCase())
      );

      setAddableContacts(filtered);
      setAddMemberSearch("");
      setAddMemberTab("all");
      setShowAddMember(true);
    } catch (err) {
      console.error("Failed to load contacts for add member:", err);
    }
  };

  const handleAddMember = async (contact: { publickey: string; name: string; currentaddress: string }) => {
    setAddingMember(contact.publickey);
    try {
      await groupService.addMember(groupId, contact.publickey, contact.name, myPublicKey || "", userName || "Unknown");
      setShowAddMember(false);
      fetchGroupDetails();
    } catch (err: any) {
      console.error("Failed to add member:", err);
      alert(err.message || "Failed to add member");
    } finally {
      setAddingMember(null);
    }
  };

  return (
    <div className="h-full overflow-y-auto bg-gray-50 dark:bg-gray-900 flex flex-col transition-colors">
      {/* HEADER */}
      <div className="sticky top-0 z-10 bg-white/80 dark:bg-gray-800/80 backdrop-blur-md border-b border-gray-200 dark:border-gray-700 px-4 py-3 flex items-center gap-3">
        <button
          onClick={() => navigate({ to: `/groups/${groupId}` })}
          className="p-2 -ml-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full transition-colors text-gray-700 dark:text-gray-200"
        >
          <ArrowLeft size={20} />
        </button>
        <span className="font-semibold text-lg text-gray-900 dark:text-white">Group Info</span>
      </div>

      <div className="flex-1 w-full max-w-2xl mx-auto p-4 pb-32 space-y-6">

        {/* GROUP HEADER CARD */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 shadow-sm border border-gray-100 dark:border-gray-700 flex flex-col items-center relative">
          <div className="w-24 h-24 bg-primary-500 rounded-full flex items-center justify-center text-white text-4xl font-bold mb-4 shadow-lg shadow-primary-500/30">
            {groupName.charAt(0).toUpperCase()}
          </div>

          {isEditingName ? (
            <div className="flex items-center gap-2 mb-2 w-full max-w-xs">
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                autoFocus
                onBlur={handleSaveName}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveName();
                  if (e.key === 'Escape') { setNewName(groupName); setIsEditingName(false); }
                }}
                className="flex-1 bg-gray-50 dark:bg-gray-900 border border-primary-500 rounded-lg px-3 py-1.5 text-gray-900 dark:text-white text-center font-semibold focus:outline-none"
                disabled={savingName}
              />
              <button
                onClick={handleSaveName}
                disabled={savingName}
                className="p-1.5 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors disabled:opacity-50"
              >
                <Check size={18} />
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-center gap-2 mb-1 w-full relative group/name">
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white text-center break-all px-8">{groupName}</h1>
              {(isCreator || myRole === 'admin') && (
                <button
                  onClick={() => { setNewName(groupName); setIsEditingName(true); }}
                  className="absolute right-0 p-1.5 text-gray-400 opacity-0 group-hover/name:opacity-100 hover:text-primary-500 hover:bg-primary-50 dark:hover:bg-primary-900/30 rounded-full transition-all"
                  title="Rename Group"
                >
                  <Edit2 size={16} />
                </button>
              )}
            </div>
          )}

          {/* DESCRIPTION */}
          {isEditingDesc ? (
            <div className="w-full mt-3 mb-4 flex flex-col items-end gap-2">
              <textarea
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                autoFocus
                onBlur={handleSaveDesc}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') { setNewDesc(description); setIsEditingDesc(false); }
                }}
                className="w-full bg-gray-50 dark:bg-gray-900 border border-primary-500 rounded-lg px-3 py-2 text-sm text-gray-700 dark:text-gray-300 focus:outline-none resize-none"
                rows={3}
                placeholder="Add a group description..."
                disabled={savingDesc}
              />
            </div>
          ) : (
            <div className={`mt-3 mb-4 w-full relative group/desc flex items-start ${description ? "justify-center text-center" : "justify-center"}`}>
              {description ? (
                <p className="text-gray-600 dark:text-gray-300 text-sm italic px-8 whitespace-pre-wrap text-center max-w-sm">
                  {description}
                </p>
              ) : (isCreator || myRole === 'admin') ? (
                <p className="text-gray-400 dark:text-gray-500 text-sm italic cursor-pointer hover:text-primary-500 transition-colors"
                  onClick={() => { setNewDesc(description); setIsEditingDesc(true); }}>
                  Add a description...
                </p>
              ) : null}

              {description && (isCreator || myRole === 'admin') && (
                <button
                  onClick={() => { setNewDesc(description); setIsEditingDesc(true); }}
                  className="absolute right-0 top-0 p-1.5 text-gray-400 opacity-0 group-hover/desc:opacity-100 hover:text-primary-500 hover:bg-primary-50 dark:hover:bg-primary-900/30 rounded-full transition-all"
                  title="Edit Description"
                >
                  <Edit2 size={14} />
                </button>
              )}
            </div>
          )}

          <p className="text-gray-500 dark:text-gray-400 text-sm mt-3">{members.length} members</p>
        </div>

        {/* ACTIONS */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl overflow-hidden shadow-sm border border-gray-100 dark:border-gray-700">
          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="w-full flex items-center gap-3 p-4 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors text-left font-medium"
          >
            <div className="w-10 h-10 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
              <Trash2 size={20} />
            </div>
            Exit Group
          </button>
        </div>

        {/* MEMBERS LIST */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700">
          <div className="p-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Users size={18} className="text-gray-500" />
              <span className="font-semibold text-gray-900 dark:text-white">Members</span>
            </div>
            <div className="flex items-center gap-2">
              {(isCreator || myRole === 'admin') && (
                <button
                  onClick={openAddMember}
                  className="flex items-center gap-1.5 text-xs font-semibold text-primary-600 dark:text-primary-400 bg-primary-50 dark:bg-primary-900/30 hover:bg-primary-100 dark:hover:bg-primary-900/50 px-3 py-1.5 rounded-full transition-colors"
                >
                  <UserPlus size={13} />
                  Add
                </button>
              )}
              <span className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 px-2 py-1 rounded-full">
                {members.length}
              </span>
            </div>
          </div>

          <div className="divide-y divide-gray-100 dark:divide-gray-700">
            {loading ? (
              <div className="p-8 text-center text-gray-500">Loading members...</div>
            ) : (
              members.map((member, i) => (
                <div key={member.publickey || i} className={`relative ${activeMenuPubkey === member.publickey ? 'z-30' : 'z-0'}`}>
                  <button
                    onClick={() => {
                      if (!member.isMe) {
                        navigate({
                          to: `/contact-info/${member.publickey}`,
                          search: { returnTo: `/group-info/${groupId}` }
                        });
                      }
                    }}
                    className={`w-full p-4 flex items-center gap-3 transition-all text-left group
                                  ${member.isMe
                        ? 'bg-primary-50/50 dark:bg-primary-900/10 cursor-default'
                        : 'hover:bg-gray-100 dark:hover:bg-gray-700/50 cursor-pointer active:scale-[0.99]'
                      }`}
                  >
                    <div className="w-10 h-10 rounded-full bg-gray-200 dark:bg-gray-700 flex-shrink-0 flex items-center justify-center text-gray-600 dark:text-gray-300 font-medium text-sm group-hover:bg-gray-300 dark:group-hover:bg-gray-600 transition-colors">
                      {member.isMe ? 'You' : (member.name && member.name !== "Unknown Member" && member.name !== "Unknown" ? member.name.charAt(0).toUpperCase() : '?')}
                    </div>
                    <div className="flex-1 min-w-0 pr-10">
                      <div>
                        <p className="text-sm font-medium text-gray-900 dark:text-white truncate flex items-center gap-2">
                          {member.isMe ? 'You' : (member.name && member.name !== "Unknown Member" && member.name !== "Unknown" ? member.name : shortenKey(member.publickey))}
                          {member.role === 'creator' && (
                            <span className="text-[10px] font-bold bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-400 px-1.5 py-0.5 rounded-md uppercase tracking-wide flex-shrink-0">Creator</span>
                          )}
                          {member.role === 'admin' && (
                            <span className="text-[10px] font-bold bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-400 px-1.5 py-0.5 rounded-md uppercase tracking-wide flex-shrink-0">Admin</span>
                          )}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-400 truncate font-mono">
                          {shortenKey(member.publickey)}
                        </p>
                      </div>
                    </div>
                  </button>

                  {/* Context Menu for Admins/Creators to manage roles */}
                  {!member.isMe && member.role !== 'creator' && (myRole === 'creator' || myRole === 'admin') && (
                    <div className="absolute right-4 top-1/2 -translate-y-1/2">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveMenuPubkey(activeMenuPubkey === member.publickey ? null : member.publickey);
                        }}
                        className="p-2 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-full transition-colors"
                      >
                        <MoreVertical size={18} />
                      </button>
                      {activeMenuPubkey === member.publickey && (
                        <div className="absolute right-0 mt-2 w-48 bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 z-20 py-1"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {member.role === 'member' && (isCreator || myRole === 'admin') && (
                            <button
                              onClick={() => handleRoleChange(member.publickey, 'admin')}
                              className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
                            >
                              Promote to Admin
                            </button>
                          )}
                          {member.role === 'admin' && isCreator && (
                            <button
                              onClick={() => handleRoleChange(member.publickey, 'member')}
                              className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
                            >
                              Demote to Member
                            </button>
                          )}
                          {/* Remove option: admins can remove members, creator can remove anyone */}
                          {(isCreator || (myRole === 'admin' && member.role === 'member')) && (
                            <button
                              onClick={() => handleRemoveMember(member.publickey)}
                              className="w-full text-left px-4 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 border-t border-gray-100 dark:border-gray-700 mt-1"
                            >
                              Remove from Group
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        {/* BANNED MEMBERS — visible to Creator and Admins */}
        {(isCreator || myRole === 'admin') && bannedMembers.length > 0 && (
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-red-100 dark:border-red-900/50">
            <div className="p-4 border-b border-red-100 dark:border-red-900/50 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldOff size={18} className="text-red-500" />
                <span className="font-semibold text-red-600 dark:text-red-400">Banned Members</span>
              </div>
              <span className="text-xs bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400 px-2 py-1 rounded-full">
                {bannedMembers.length}
              </span>
            </div>
            <div className="divide-y divide-red-50 dark:divide-red-900/20">
              {bannedMembers.map((banned) => (
                <div key={banned.publickey} className="p-4 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-red-100 dark:bg-red-900/30 flex-shrink-0 flex items-center justify-center text-red-500">
                    <ShieldOff size={16} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                      {banned.username && banned.username !== "Unknown" ? banned.username : shortenKey(banned.publickey)}
                    </p>
                    <p className="text-xs text-gray-400 dark:text-gray-500">
                      Banned {new Date(banned.banned_at).toLocaleDateString()}
                    </p>
                  </div>
                  <button
                    onClick={() => handleUnban(banned.publickey)}
                    className="flex-shrink-0 text-xs px-3 py-1.5 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded-full font-medium hover:bg-green-200 dark:hover:bg-green-900/50 transition-colors"
                  >
                    Unban
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* EXIT CONFIRMATION DIALOG */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-sm w-full p-6 animate-in zoom-in-95 fade-in duration-200 border border-gray-200 dark:border-gray-700">
            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">Exit Group?</h3>
            <p className="text-gray-600 dark:text-gray-300 mb-6">
              Are you sure you want to exit this group? You will no longer receive new messages.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors font-medium"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setShowDeleteConfirm(false);
                  handleExitGroup();
                }}
                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium"
              >
                Exit
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ADD MEMBER MODAL */}
      {showAddMember && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-md max-h-[85vh] flex flex-col border border-gray-200 dark:border-gray-700">
            {/* Header */}
            <div className="p-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between flex-shrink-0">
              <div className="flex items-center gap-2">
                <UserPlus size={18} className="text-primary-500" />
                <span className="font-semibold text-gray-900 dark:text-white">Add Member</span>
              </div>
              <button
                onClick={() => setShowAddMember(false)}
                className="p-1.5 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            {/* Tabs */}
            <div className="px-3">
              <div className="flex gap-2 mb-2 border-b border-gray-200 dark:border-gray-700">
                {(['all', 'contacts', 'community'] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setAddMemberTab(tab)}
                    className={`pb-2 px-3 text-sm font-medium capitalize transition-colors relative ${addMemberTab === tab
                      ? "text-primary-600 border-b-2 border-primary-600 -mb-px"
                      : "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                      }`}
                  >
                    {tab}
                  </button>
                ))}
              </div>
            </div>

            {/* Search */}
            <div className="p-3 flex-shrink-0 pt-1">
              <div className="relative">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  value={addMemberSearch}
                  onChange={(e) => setAddMemberSearch(e.target.value)}
                  placeholder="Search contacts..."
                  className="w-full pl-9 pr-4 py-2 text-sm bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500"
                  autoFocus
                />
              </div>
            </div>

            {/* Contact list */}
            <div className="overflow-y-auto flex-1 px-2 pb-4">
              {addableContacts.length === 0 ? (
                <p className="text-center text-gray-400 py-12 text-sm">No contacts available to add</p>
              ) : (
                addableContacts
                  .filter(c => {
                    const matchesSearch = c.name.toLowerCase().includes(addMemberSearch.toLowerCase());
                    if (!matchesSearch) return false;
                    if (addMemberTab === 'contacts') return c.type === 'contact';
                    if (addMemberTab === 'community') return c.type === 'community';
                    return true;
                  })
                  .map(contact => (
                    <button
                      key={contact.publickey}
                      onClick={() => handleAddMember(contact)}
                      disabled={addingMember === contact.publickey}
                      className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors text-left disabled:opacity-50"
                    >
                      <div className="w-10 h-10 rounded-full bg-primary-100 dark:bg-primary-900/30 flex-shrink-0 flex items-center justify-center text-primary-600 dark:text-primary-400 font-semibold text-sm">
                        {contact.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{contact.name}</p>
                        <p className="text-xs text-gray-400 font-mono truncate">{shortenKey(contact.publickey)}</p>
                      </div>
                      {addingMember === contact.publickey && (
                        <span className="text-xs text-primary-500">Adding...</span>
                      )}
                    </button>
                  ))
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
