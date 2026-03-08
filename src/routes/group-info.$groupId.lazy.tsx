import { createLazyFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, useContext, useCallback, useRef } from "react";
import {
  ArrowLeft,
  Trash2,
  Users,
  Edit2,
  Check,
  X,
  ShieldOff,
  UserPlus,
  Search,
  Copy,
  ShieldCheck,
  ShieldAlert,
  UserX,
  Database,
  Info,
  MessageSquare,
  History,
  Camera,
} from "lucide-react";
import { groupService } from "../services/group.service";
import { chatService } from "../services/chat.service";
import { appContext } from "../AppContext";
import { MDS } from "@minima-global/mds";
import { GroupTabs, GroupTab } from "../components/group/GroupTabs";

export const Route = createLazyFileRoute("/group-info/$groupId")({
  component: GroupInfoPage,
});

interface GroupMember {
  publickey: string;
  name?: string;
  icon?: string;
  isMe?: boolean;
  role?: "creator" | "admin" | "member";
}

const shortenKey = (key: string) => {
  if (!key) return "";
  return `${key.substring(0, 8)}...${key.substring(key.length - 8)}`;
};

function GroupInfoPage() {
  const { groupId } = Route.useParams();
  const search: any = Route.useSearch();
  const navigate = useNavigate();
  const { myPublicKey, userName } = useContext(appContext);

  const [activeTab, setActiveTab] = useState<GroupTab>(
    search.tab === "settings" ? "settings" : "profile",
  );
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const [groupName, setGroupName] = useState<string>("Group");
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [autoApprove, setAutoApprove] = useState(false);

  const [isCreator, setIsCreator] = useState(false);
  const [myRole, setMyRole] = useState<"creator" | "admin" | "member">(
    "member",
  );

  const [isEditingName, setIsEditingName] = useState(false);
  const [newName, setNewName] = useState("");
  const [savingName, setSavingName] = useState(false);

  const [description, setDescription] = useState("");
  const [isEditingDesc, setIsEditingDesc] = useState(false);
  const [newDesc, setNewDesc] = useState("");
  const [savingDesc, setSavingDesc] = useState(false);
  const [avatar, setAvatar] = useState<string | null>(null);
  const [savingAvatar, setSavingAvatar] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // New state for contextual menu Actions on a member
  const [activeMenuPubkey, setActiveMenuPubkey] = useState<string | null>(null);
  const [bannedMembers, setBannedMembers] = useState<
    Array<{
      publickey: string;
      username: string;
      banned_by: string;
      banned_at: number;
    }>
  >([]);

  // Add Member modal state
  const [showAddMember, setShowAddMember] = useState(false);
  const [addableContacts, setAddableContacts] = useState<
    Array<{
      publickey: string;
      name: string;
      currentaddress: string;
      type: "contact" | "community";
    }>
  >([]);
  const [addMemberSearch, setAddMemberSearch] = useState("");
  const [addingMember, setAddingMember] = useState<string | null>(null);
  const [addMemberTab, setAddMemberTab] = useState<
    "all" | "contacts" | "community"
  >("all");

  // Join Requests state
  const [joinRequests, setJoinRequests] = useState<any[]>([]);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [generatingLink, setGeneratingLink] = useState(false);

  const [stats, setStats] = useState({
    total: 0,
    mine: 0,
    firstDate: 0,
  });

  const parseBool = (value: any): boolean =>
    value === true ||
    value === 1 ||
    String(value).toUpperCase() === "TRUE" ||
    String(value) === "1";

  const fetchGroupDetails = useCallback(async () => {
    try {
      setLoading(true);
      const info = await groupService.getGroupInfo(groupId);
      if (info) {
        setGroupName((info as any).NAME || (info as any).name || "Group");
        setDescription(
          (info as any).DESCRIPTION || (info as any).description || "",
        );
        setAvatar((info as any).AVATAR || (info as any).avatar || null);
        setAutoApprove(
          parseBool((info as any).AUTO_APPROVE ?? (info as any).auto_approve),
        );
        const creator =
          (info as any).CREATOR_PUBLICKEY || (info as any).creator_publickey;
        setIsCreator(
          (creator || "").toLowerCase() === (myPublicKey || "").toLowerCase(),
        );
      }

      const rawMembers = await groupService.getGroupMembers(groupId);

      const mappedMembers = rawMembers.map((m: any) => {
        // Handle properties that might be upper or lowercase depending on DB return
        const pubkey = m.PUBLICKEY || m.publickey;
        const username =
          m.RESOLVED_NAME ||
          m.resolved_name ||
          m.USERNAME ||
          m.username ||
          "Unknown Member";
        const role = (m.ROLE || m.role || "member").toLowerCase();

        const isMe =
          (pubkey || "").toLowerCase() === (myPublicKey || "").toLowerCase();

        if (isMe) {
          setMyRole(role as any);
        }

        return {
          publickey: pubkey,
          name: username,
          isMe: isMe,
          role: role as "creator" | "admin" | "member",
        };
      });

      // Sort: Creator > Admin > Member
      mappedMembers.sort((a, b) => {
        const rolePriority = { creator: 0, admin: 1, member: 2 };
        return (rolePriority[a.role] ?? 2) - (rolePriority[b.role] ?? 2);
      });

      setMembers(mappedMembers);

      // Fetch banned members if creator
      const bans = await groupService.getGroupBans(groupId);
      setBannedMembers(
        bans.map((b: any) => ({
          publickey: b.PUBLICKEY || b.publickey,
          username:
            b.RESOLVED_NAME ||
            b.resolved_name ||
            b.USERNAME ||
            b.username ||
            "Unknown",
          banned_by: b.BANNED_BY || b.banned_by,
          banned_at: Number(b.BANNED_AT || b.banned_at),
        })),
      );

      // Fetch pending join requests if creator or admin
      const requests = await groupService.getPendingJoinRequests(groupId);
      setJoinRequests(
        requests.map((r: any) => ({
          id: r.ID || r.id,
          publickey: r.PUBLICKEY || r.publickey,
          username: r.USERNAME || r.username,
          address: r.ADDRESS || r.address,
          status: r.STATUS || r.status,
          timestamp: Number(r.TIMESTAMP || r.timestamp),
        })),
      );

      // Fetch messages for statistics
      const allMsgs = await groupService.getGroupMessages(groupId);

      // Calculate stats
      const mine = allMsgs.filter((m: any) => {
        const sender = (
          m.SENDER_PUBLICKEY ||
          m.sender_publickey ||
          ""
        ).toLowerCase();
        const me = (myPublicKey || "").toLowerCase();
        return sender === me;
      }).length;
      setStats({
        total: allMsgs.length,
        mine,
        firstDate:
          allMsgs.length > 0
            ? Number(allMsgs[0].date)
            : Number(
                (info as any).CREATED_DATE || (info as any).created_date || 0,
              ),
      });
    } catch (err) {
      console.error("Failed to load group info:", err);
    } finally {
      setLoading(false);
    }
  }, [groupId, myPublicKey]);

  const copyToClipboard = (text: string, fieldId: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedField(fieldId);
      setTimeout(() => setCopiedField(null), 2000);
    });
  };

  useEffect(() => {
    if (groupId) {
      fetchGroupDetails();
    }
  }, [groupId, fetchGroupDetails]);

  const handleExitGroup = async () => {
    try {
      // Notify other members that we are leaving
      await groupService.leaveGroup(
        groupId,
        myPublicKey || "",
        userName || "Unknown",
      );
      // Clean up local group data
      await groupService.deleteGroup(groupId);
      navigate({ to: "/" });
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
      await groupService.updateGroupDetails(
        groupId,
        newName.trim(),
        null,
        null,
        myPublicKey || "",
      );
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
      await groupService.updateGroupDetails(
        groupId,
        null,
        newDesc.trim(),
        null,
        myPublicKey || "",
      );
      setDescription(newDesc.trim());
      setIsEditingDesc(false);
    } catch (err) {
      console.error("Failed to update description:", err);
      setNewDesc(description); // revert on fail
    } finally {
      setSavingDesc(false);
    }
  };

  const handleAvatarFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      const base64 = event.target?.result as string;
      if (base64) {
        handleSaveAvatar(base64);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSaveAvatar = async (base64: string) => {
    setSavingAvatar(true);
    try {
      await groupService.updateGroupDetails(
        groupId,
        null,
        null,
        base64,
        myPublicKey || "",
      );
      setAvatar(base64);
    } catch (err) {
      console.error("Failed to update avatar:", err);
      alert("Failed to update avatar");
    } finally {
      setSavingAvatar(false);
    }
  };

  // Listen for solo events when other members update the name or roles
  useEffect(() => {
    const handleGroupUpdate = (e: any) => {
      if (
        e.detail &&
        e.detail.groupId === groupId &&
        e.detail.type === "group_update"
      ) {
        let hasDirectFieldUpdate = false;
        if (e.detail.name !== undefined) {
          setGroupName(e.detail.name);
          hasDirectFieldUpdate = true;
        }
        if (e.detail.description !== undefined) {
          setDescription(e.detail.description);
          hasDirectFieldUpdate = true;
        }
        if (e.detail.avatar !== undefined) {
          setAvatar(e.detail.avatar);
          hasDirectFieldUpdate = true;
        }
        if (e.detail.auto_approve !== undefined) {
          setAutoApprove(parseBool(e.detail.auto_approve));
          hasDirectFieldUpdate = true;
        }
        // Re-fetch only for generic updates without explicit fields.
        // This avoids overriding fresh switch updates with stale DB reads.
        if (groupId && !hasDirectFieldUpdate) {
          fetchGroupDetails();
        }
      }
    };
    window.addEventListener("GROUP_UPDATE", handleGroupUpdate);
    return () => window.removeEventListener("GROUP_UPDATE", handleGroupUpdate);
  }, [groupId, fetchGroupDetails]);

  const handleRoleChange = async (
    targetPubkey: string,
    newRole: "admin" | "member",
  ) => {
    try {
      setActiveMenuPubkey(null);
      await groupService.updateMemberRole(
        groupId,
        targetPubkey,
        newRole,
        myPublicKey || "",
      );
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
      await groupService.removeMember(
        groupId,
        targetPubkey,
        myPublicKey || "",
        userName || "Unknown",
      );
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

  const handleGenerateInvite = async () => {
    try {
      setGeneratingLink(true);
      const link = await groupService.generateInviteCode(groupId, groupName);
      setInviteLink(link);
    } catch (err) {
      console.error("Failed to generate invite:", err);
      alert("Failed to generate invite link");
    } finally {
      setGeneratingLink(false);
    }
  };

  const handleToggleAutoApprove = async () => {
    try {
      const newValue = !autoApprove;
      await groupService.updateGroupAutoApprove(
        groupId,
        newValue,
        myPublicKey || "",
      );
      setAutoApprove(newValue);
    } catch (err) {
      console.error("Failed to toggle auto-approve:", err);
      alert("Failed to update auto-approval setting");
    }
  };

  const handleResolveJoinRequest = async (
    request: any,
    status: "approved" | "denied",
  ) => {
    try {
      const targetPubkey = request.PUBLICKEY || request.publickey;
      const targetName = request.USERNAME || request.username || "Unknown User";

      if (status === "approved") {
        const isCurrentlyMember = members.some(
          (m: any) => m.publickey === targetPubkey,
        );
        if (!isCurrentlyMember) {
          await groupService.addMember(
            groupId,
            targetPubkey,
            targetName,
            myPublicKey || "",
            userName || "Unknown",
          );
        }
      }
      await groupService.resolveJoinRequest(groupId, targetPubkey, status);
      fetchGroupDetails();
    } catch (err) {
      console.error("Failed to resolve join request:", err);
      alert("Failed to resolve join request");
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
        .filter(
          (chat: any) => chat.publickey && !contactKeys.has(chat.publickey),
        )
        .map((chat: any) => ({
          publickey: chat.publickey,
          name: chat.roomname || chat.publickey,
          currentaddress: chat.currentaddress || chat.publickey,
          type: "community" as const,
        }));

      const allContacts = [
        ...raw.map((c: any) => ({
          publickey: c.publickey,
          name: c.extradata?.name || c.currentaddress || c.publickey,
          currentaddress: c.currentaddress || c.publickey,
          type: "contact" as const,
        })),
        ...communityContacts,
      ];

      // Filter out existing members and banned users
      const existingKeys = new Set(
        members.map((m) => m.publickey.toLowerCase()),
      );
      const bannedKeys = new Set(
        bannedMembers.map((b) => b.publickey.toLowerCase()),
      );

      const filtered = allContacts.filter(
        (c) =>
          !existingKeys.has(c.publickey.toLowerCase()) &&
          !bannedKeys.has(c.publickey.toLowerCase()),
      );

      setAddableContacts(filtered);
      setAddMemberSearch("");
      setAddMemberTab("all");
      setShowAddMember(true);
    } catch (err) {
      console.error("Failed to load contacts for add member:", err);
    }
  };

  const handleAddMember = async (contact: {
    publickey: string;
    name: string;
    currentaddress: string;
  }) => {
    setAddingMember(contact.publickey);
    try {
      await groupService.addMember(
        groupId,
        contact.publickey,
        contact.name,
        myPublicKey || "",
        userName || "Unknown",
      );
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
          onClick={() => {
            if (search.returnTo) {
              navigate({ to: search.returnTo });
            } else {
              navigate({ to: `/groups/${groupId}` });
            }
          }}
          className="p-2 -ml-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full transition-colors text-gray-700 dark:text-gray-200"
        >
          <ArrowLeft size={20} />
        </button>
        <div className="flex flex-col min-w-0">
          <h1 className="text-lg font-semibold text-gray-800 dark:text-white truncate leading-tight">
            {groupName}
          </h1>
          <span className="text-xs text-gray-500 dark:text-gray-400 truncate">
            Group Info
          </span>
        </div>
      </div>

      {/* Tab Navigation */}
      <GroupTabs activeTab={activeTab} onTabChange={setActiveTab} />

      <div className="flex-1 w-full max-w-2xl mx-auto p-4 pb-32 space-y-6">
        {activeTab === "profile" && (
          <div className="space-y-6">
            {/* GROUP HEADER CARD */}
            <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 shadow-sm border border-gray-100 dark:border-gray-700 flex flex-col items-center relative">
              <input
                type="file"
                ref={fileInputRef}
                className="hidden"
                accept="image/*"
                onChange={handleAvatarFileSelect}
              />

              <div className="relative group/avatar mb-4">
                <div
                  className={`w-24 h-24 rounded-full flex items-center justify-center text-white text-4xl font-bold shadow-lg overflow-hidden ${!avatar ? "bg-primary-500 shadow-primary-500/30" : "bg-gray-200 dark:bg-gray-700"}`}
                >
                  {avatar ? (
                    <img
                      src={avatar}
                      alt={groupName}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    groupName.charAt(0).toUpperCase()
                  )}
                </div>

                {(isCreator || myRole === "admin") && (
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={savingAvatar}
                    className="absolute inset-0 flex items-center justify-center bg-black/40 text-white rounded-full opacity-0 group-hover/avatar:opacity-100 transition-opacity"
                  >
                    {savingAvatar ? (
                      <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-white"></div>
                    ) : (
                      <Camera size={24} />
                    )}
                  </button>
                )}
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
                      if (e.key === "Enter") handleSaveName();
                      if (e.key === "Escape") {
                        setNewName(groupName);
                        setIsEditingName(false);
                      }
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
                  <h1 className="text-2xl font-bold text-gray-900 dark:text-white text-center break-all px-8">
                    {groupName}
                  </h1>
                  {(isCreator || myRole === "admin") && (
                    <button
                      onClick={() => {
                        setNewName(groupName);
                        setIsEditingName(true);
                      }}
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
                  <div className="relative w-full">
                    <textarea
                      value={newDesc}
                      onChange={(e) => {
                        if (e.target.value.length <= 255) {
                          setNewDesc(e.target.value);
                        }
                      }}
                      autoFocus
                      onBlur={handleSaveDesc}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") {
                          setNewDesc(description);
                          setIsEditingDesc(false);
                        }
                      }}
                      className="w-full bg-gray-50 dark:bg-gray-900 border border-primary-500 rounded-lg px-3 py-2 text-sm text-gray-700 dark:text-gray-300 focus:outline-none resize-none pr-12"
                      rows={3}
                      placeholder="Add a group description..."
                      disabled={savingDesc}
                    />
                    <span
                      className={`absolute bottom-2 right-2 text-[10px] font-medium ${newDesc.length >= 240 ? "text-red-500" : "text-gray-400"}`}
                    >
                      {newDesc.length}/255
                    </span>
                  </div>
                </div>
              ) : (
                <div
                  className={`mt-3 mb-4 w-full relative group/desc flex items-start ${description ? "justify-center text-center" : "justify-center"}`}
                >
                  {description ? (
                    <p className="text-gray-600 dark:text-gray-300 text-sm italic px-8 whitespace-pre-wrap text-center max-w-sm break-words">
                      {description}
                    </p>
                  ) : isCreator || myRole === "admin" ? (
                    <p
                      className="text-gray-400 dark:text-gray-500 text-sm italic cursor-pointer hover:text-primary-500 transition-colors"
                      onClick={() => {
                        setNewDesc(description);
                        setIsEditingDesc(true);
                      }}
                    >
                      Add a description...
                    </p>
                  ) : null}

                  {description && (isCreator || myRole === "admin") && (
                    <button
                      onClick={() => {
                        setNewDesc(description);
                        setIsEditingDesc(true);
                      }}
                      className="absolute right-0 top-0 p-1.5 text-gray-400 opacity-0 group-hover/desc:opacity-100 hover:text-primary-500 hover:bg-primary-50 dark:hover:bg-primary-900/30 rounded-full transition-all"
                      title="Edit Description"
                    >
                      <Edit2 size={14} />
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* CHAT STATISTICS */}
            <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 shadow-sm border border-gray-100 dark:border-gray-700 space-y-4">
              <div className="flex items-center gap-2 mb-2">
                <Info size={18} className="text-primary-500" />
                <h3 className="font-semibold text-gray-900 dark:text-white">
                  Chat Statistics
                </h3>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-900/50 rounded-xl">
                  <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center text-blue-600 dark:text-blue-400">
                    <MessageSquare size={20} />
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 font-medium">
                      Messages
                    </p>
                    <p className="text-sm font-bold text-gray-900 dark:text-white">
                      {stats.total} total ({stats.mine} mine)
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-900/50 rounded-xl">
                  <div className="w-10 h-10 bg-orange-100 dark:bg-orange-900/30 rounded-full flex items-center justify-center text-orange-600 dark:text-orange-400">
                    <History size={20} />
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 font-medium">
                      History
                    </p>
                    <p className="text-sm font-bold text-gray-900 dark:text-white">
                      Since{" "}
                      {stats.firstDate
                        ? new Date(stats.firstDate).toLocaleDateString()
                        : "N/A"}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* TECHNICAL DATA */}
            <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 shadow-sm border border-gray-100 dark:border-gray-700 space-y-4">
              <div className="flex items-center gap-2 mb-2">
                <Database size={18} className="text-primary-500" />
                <h3 className="font-semibold text-gray-900 dark:text-white">
                  Technical Data
                </h3>
              </div>

              <div className="space-y-3">
                <div className="group relative">
                  <p className="text-xs text-gray-500 dark:text-gray-400 font-medium mb-1">
                    Group ID (Public Key)
                  </p>
                  <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-900/50 rounded-xl border border-transparent hover:border-primary-200 dark:hover:border-primary-900/50 transition-all">
                    <p className="text-xs font-mono text-gray-800 dark:text-gray-200 break-all pr-8">
                      {groupId}
                    </p>
                    <button
                      onClick={() => copyToClipboard(groupId || "", "groupid")}
                      className="absolute right-3 top-1/2 -translate-y-1/2 p-2 bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-lg text-gray-400 hover:text-primary-500 opacity-0 group-hover:opacity-100 transition-all shadow-sm"
                    >
                      {copiedField === "groupid" ? (
                        <Check size={14} className="text-green-500" />
                      ) : (
                        <Copy size={14} />
                      )}
                    </button>
                  </div>
                </div>

                <div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 font-medium mb-1">
                    My Role
                  </p>
                  <div className="inline-flex items-center px-3 py-1 bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 rounded-full text-xs font-mono font-bold uppercase tracking-wider">
                    {myRole}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === "settings" && (
          <div className="space-y-6">
            {/* MEMBERS LIST */}
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700">
              <div className="p-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Users size={18} className="text-gray-500" />
                  <span className="font-semibold text-gray-900 dark:text-white">
                    Members
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {(isCreator || myRole === "admin") && (
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
                  <div className="p-8 text-center text-gray-500">
                    Loading members...
                  </div>
                ) : (
                  members.map((member, i) => (
                    <div
                      key={member.publickey || i}
                      className={`relative flex items-center ${activeMenuPubkey === member.publickey ? "z-30" : "z-0"} ${member.isMe ? "bg-primary-50/50 dark:bg-primary-900/10" : "hover:bg-gray-100 dark:hover:bg-gray-700/50"}`}
                    >
                      <button
                        onClick={() => {
                          if (!member.isMe) {
                            navigate({
                              to: `/contact-info/${member.publickey}`,
                              search: { returnTo: `/group-info/${groupId}` },
                            });
                          }
                        }}
                        className={`flex-1 p-4 flex items-center gap-3 transition-all text-left group min-w-0
                                  ${
                                    member.isMe
                                      ? "cursor-default"
                                      : "cursor-pointer active:scale-[0.99]"
                                  }`}
                      >
                        <div className="w-10 h-10 rounded-full bg-gray-200 dark:bg-gray-700 flex-shrink-0 flex items-center justify-center text-gray-600 dark:text-gray-300 font-medium text-sm group-hover:bg-gray-300 dark:group-hover:bg-gray-600 transition-colors">
                          {member.isMe
                            ? "You"
                            : member.name &&
                                member.name !== "Unknown Member" &&
                                member.name !== "Unknown"
                              ? member.name.charAt(0).toUpperCase()
                              : "?"}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div>
                            <p className="text-sm font-medium text-gray-900 dark:text-white truncate flex items-center gap-2">
                              {member.isMe
                                ? "You"
                                : member.name &&
                                    member.name !== "Unknown Member" &&
                                    member.name !== "Unknown"
                                  ? member.name
                                  : shortenKey(member.publickey)}
                              {member.role === "creator" && (
                                <span className="text-[10px] font-bold bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-400 px-1.5 py-0.5 rounded-md uppercase tracking-wide flex-shrink-0">
                                  Creator
                                </span>
                              )}
                              {member.role === "admin" && (
                                <span className="text-[10px] font-bold bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-400 px-1.5 py-0.5 rounded-md uppercase tracking-wide flex-shrink-0">
                                  Admin
                                </span>
                              )}
                            </p>
                            <p className="text-xs text-gray-500 dark:text-gray-400 truncate font-mono">
                              {shortenKey(member.publickey)}
                            </p>
                          </div>
                        </div>
                      </button>

                      {/* Inline Actions for Admins/Creators */}
                      {!member.isMe &&
                        member.role !== "creator" &&
                        (myRole === "creator" || myRole === "admin") && (
                          <div className="flex items-center gap-1 pr-3 flex-shrink-0">
                            {/* Role Management */}
                            {member.role === "member" &&
                              (isCreator || myRole === "admin") && (
                                <button
                                  onClick={() =>
                                    handleRoleChange(member.publickey, "admin")
                                  }
                                  className="p-1.5 text-sky-600 hover:text-sky-700 dark:hover:text-sky-400 transition-colors rounded-full hover:bg-sky-50 dark:hover:bg-sky-900/20"
                                  title="Promote to Admin"
                                >
                                  <ShieldCheck size={18} />
                                </button>
                              )}
                            {member.role === "admin" && isCreator && (
                              <button
                                onClick={() =>
                                  handleRoleChange(member.publickey, "member")
                                }
                                className="p-1.5 text-amber-600 hover:text-amber-700 dark:hover:text-amber-400 transition-colors rounded-full hover:bg-amber-50 dark:hover:bg-amber-900/20"
                                title="Demote to Member"
                              >
                                <ShieldAlert size={18} />
                              </button>
                            )}

                            {/* Remove Button */}
                            {(isCreator ||
                              (myRole === "admin" &&
                                member.role === "member")) && (
                              <button
                                onClick={() =>
                                  handleRemoveMember(member.publickey)
                                }
                                className="p-1.5 text-red-500 hover:text-red-700 dark:hover:text-red-400 transition-colors rounded-full hover:bg-red-50 dark:hover:bg-red-900/20"
                                title="Remove from Group"
                              >
                                <UserX size={18} />
                              </button>
                            )}
                          </div>
                        )}
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* BANNED MEMBERS — visible to Creator and Admins */}
            {(isCreator || myRole === "admin") && bannedMembers.length > 0 && (
              <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-red-100 dark:border-red-900/50">
                <div className="p-4 border-b border-red-100 dark:border-red-900/50 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <ShieldOff size={18} className="text-red-500" />
                    <span className="font-semibold text-red-600 dark:text-red-400">
                      Banned Members
                    </span>
                  </div>
                  <span className="text-xs bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400 px-2 py-1 rounded-full">
                    {bannedMembers.length}
                  </span>
                </div>
                <div className="divide-y divide-red-50 dark:divide-red-900/20">
                  {bannedMembers.map((banned) => (
                    <div
                      key={banned.publickey}
                      className="p-4 flex items-center gap-3"
                    >
                      <div className="w-10 h-10 rounded-full bg-red-100 dark:bg-red-900/30 flex-shrink-0 flex items-center justify-center text-red-500">
                        <ShieldOff size={16} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                          {banned.username && banned.username !== "Unknown"
                            ? banned.username
                            : shortenKey(banned.publickey)}
                        </p>
                        <p className="text-xs text-gray-400 dark:text-gray-500">
                          Banned{" "}
                          {new Date(banned.banned_at).toLocaleDateString()}
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

            {/* JOIN REQUESTS */}
            {joinRequests.length > 0 && (isCreator || myRole === "admin") && (
              <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-blue-100 dark:border-blue-900/50">
                <div className="p-4 border-b border-blue-100 dark:border-blue-900/50 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <UserPlus size={18} className="text-blue-500" />
                    <span className="font-semibold text-blue-600 dark:text-blue-400">
                      Join Requests
                    </span>
                  </div>
                  <span className="text-xs bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 px-2 py-1 rounded-full">
                    {joinRequests.length}
                  </span>
                </div>
                <div className="divide-y divide-blue-50 dark:divide-blue-900/20">
                  {joinRequests.map((req) => (
                    <div
                      key={req.id}
                      className="p-4 flex items-center justify-between gap-3"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                          {req.username || shortenKey(req.publickey)}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-400 truncate font-mono">
                          {shortenKey(req.publickey)}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <button
                          onClick={() =>
                            handleResolveJoinRequest(req, "approved")
                          }
                          className="p-1.5 bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 hover:bg-green-200 dark:hover:bg-green-900/50 rounded-lg transition-colors"
                          title="Approve"
                        >
                          <Check size={18} />
                        </button>
                        <button
                          onClick={() =>
                            handleResolveJoinRequest(req, "denied")
                          }
                          className="p-1.5 bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-900/50 rounded-lg transition-colors"
                          title="Reject"
                        >
                          <X size={18} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* GENERATE INVITE LINK & AUTO-APPROVE */}
            {(isCreator || myRole === "admin") && (
              <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Users size={18} className="text-primary-500" />
                    <span className="font-semibold text-gray-900 dark:text-white">
                      Invite Link
                    </span>
                  </div>
                </div>

                {/* Auto-approve toggle */}
                <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-900/50 rounded-xl border border-gray-100 dark:border-gray-700">
                  <div className="flex flex-col">
                    <span className="text-sm font-semibold text-gray-900 dark:text-white">
                      Automatic Approval
                    </span>
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                      Users with link join instantly
                    </span>
                  </div>
                  <button
                    onClick={handleToggleAutoApprove}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
                      autoApprove
                        ? "bg-primary-600"
                        : "bg-gray-300 dark:bg-gray-600"
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        autoApprove ? "translate-x-6" : "translate-x-1"
                      }`}
                    />
                  </button>
                </div>

                {inviteLink ? (
                  <div className="space-y-3">
                    <div className="p-3 bg-gray-50 dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-600 break-all text-sm font-mono text-gray-600 dark:text-gray-300 relative group/link">
                      {inviteLink}
                      <button
                        onClick={() =>
                          copyToClipboard(inviteLink, "inviteLink")
                        }
                        className="absolute right-2 top-2 p-1.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-md text-gray-500 hover:text-primary-500 transition-colors shadow-sm"
                        title="Copy Invite Link"
                      >
                        {copiedField === "inviteLink" ? (
                          <Check size={14} className="text-green-500" />
                        ) : (
                          <Copy size={14} />
                        )}
                      </button>
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      Share this link carefully. Anyone with this link can
                      request to join the group.
                    </p>
                  </div>
                ) : (
                  <button
                    onClick={handleGenerateInvite}
                    disabled={generatingLink}
                    className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400 font-medium rounded-lg hover:bg-primary-100 dark:hover:bg-primary-900/50 transition-colors disabled:opacity-50"
                  >
                    {generatingLink ? (
                      "Generating..."
                    ) : (
                      <>
                        <Copy size={16} />
                        Generate Invite Link
                      </>
                    )}
                  </button>
                )}
              </div>
            )}

            {/* EXIT GROUP BUTTON */}
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
          </div>
        )}

        {/* EXIT CONFIRMATION DIALOG */}
        {showDeleteConfirm && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-sm w-full p-6 animate-in zoom-in-95 fade-in duration-200 border border-gray-200 dark:border-gray-700">
              <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">
                Exit Group?
              </h3>
              <p className="text-gray-600 dark:text-gray-300 mb-6">
                Are you sure you want to exit this group? You will no longer
                receive new messages.
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
          <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-4">
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md max-h-[80vh] flex flex-col animate-in slide-in-from-bottom-4 sm:zoom-in-95 fade-in duration-200">
              {/* Modal header */}
              <div className="p-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
                <h3 className="font-bold text-gray-900 dark:text-white text-lg">
                  Add member
                </h3>
                <button
                  onClick={() => setShowAddMember(false)}
                  className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
                >
                  <X size={20} />
                </button>
              </div>

              {/* Tabs */}
              <div className="flex gap-2 px-4 pt-3 border-b border-gray-100 dark:border-gray-700">
                {(["all", "contacts", "community"] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setAddMemberTab(tab)}
                    className={`pb-2 px-2 text-sm font-medium capitalize transition-colors relative ${
                      addMemberTab === tab
                        ? "text-sky-600 dark:text-sky-400 border-b-2 border-sky-600 dark:border-sky-400 -mb-px"
                        : "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                    }`}
                  >
                    {tab}
                  </button>
                ))}
              </div>

              {/* Search */}
              <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700">
                <div className="relative">
                  <Search
                    size={16}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
                  />
                  <input
                    type="text"
                    value={addMemberSearch}
                    onChange={(e) => setAddMemberSearch(e.target.value)}
                    placeholder="Search..."
                    className="w-full pl-9 pr-4 py-2 border border-gray-200 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400"
                    autoFocus
                  />
                </div>
              </div>

              {/* People list */}
              <div className="overflow-y-auto flex-1 divide-y divide-gray-100 dark:divide-gray-700">
                {addableContacts.length === 0 ? (
                  <div className="p-10 text-center">
                    <p className="text-gray-500 dark:text-gray-400 text-sm">
                      No contacts available to add
                    </p>
                  </div>
                ) : (
                  addableContacts
                    .filter((c) => {
                      const matchesSearch = c.name
                        .toLowerCase()
                        .includes(addMemberSearch.toLowerCase());
                      if (!matchesSearch) return false;
                      if (addMemberTab === "contacts")
                        return c.type === "contact";
                      if (addMemberTab === "community")
                        return c.type === "community";
                      return true;
                    })
                    .map((contact) => (
                      <div
                        key={contact.publickey}
                        className="flex items-center gap-3 px-4 py-3"
                      >
                        <div className="w-10 h-10 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-gray-600 dark:text-gray-300 font-bold flex-shrink-0">
                          {contact.name.charAt(0).toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-gray-900 dark:text-white truncate">
                            {contact.name}
                          </p>
                          <p className="text-xs text-gray-500 dark:text-gray-400 capitalize">
                            {contact.type}
                          </p>
                        </div>
                        <button
                          onClick={() => handleAddMember(contact)}
                          disabled={addingMember === contact.publickey}
                          className="px-3 py-1.5 bg-primary-600 text-white text-sm rounded-lg hover:bg-primary-700 active:bg-primary-800 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed font-medium flex-shrink-0"
                        >
                          {addingMember === contact.publickey
                            ? "Adding..."
                            : "Add"}
                        </button>
                      </div>
                    ))
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
