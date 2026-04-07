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
  Camera,
  Activity,
  Zap,
  Star,
  ChevronRight,
} from "lucide-react";
import { groupService } from "../services/group.service";
import { chatService } from "../services/chat.service";
import { appContext } from "../AppContext";
import { MDS } from "@minima-global/mds";
import { GroupTabs, GroupTab } from "../components/group/GroupTabs";
import {
  getPublicListingsCount,
  LISTINGS_PUBLIC_LIMIT,
} from "../services/listings.service";

export const Route = createLazyFileRoute("/group-info/$groupId")({
  component: GroupInfoPage,
});

interface GroupMember {
  publickey: string;
  name?: string;
  avatar?: string;
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
  const [isPublic, setIsPublic] = useState(false);
  const [publicCount, setPublicCount] = useState(0);
  const [publicError, setPublicError] = useState("");

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
      icon?: string;
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

  const decodeStoredAvatar = (avatar?: string | null) => {
    if (!avatar || avatar === "0x00") return "";

    const candidates = [avatar];
    try {
      candidates.unshift(decodeURIComponent(avatar));
    } catch {
      // ignore invalid URI sequences and try raw value
    }

    return (
      candidates.find(
        (candidate) =>
          candidate &&
          candidate.startsWith("data:image") &&
          !candidate.includes("/0x00"),
      ) || ""
    );
  };

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
        setIsPublic(
          parseBool((info as any).IS_PUBLIC ?? (info as any).is_public),
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
          avatar: decodeStoredAvatar(m.AVATAR || m.avatar),
        };
      });

      // Deduplicate by normalized public key (DB may return same member with 0X and 0x casing)
      const seen = new Set<string>();
      const dedupedMembers = mappedMembers.filter((m) => {
        const normalized = (m.publickey || "").toLowerCase();
        if (seen.has(normalized)) return false;
        seen.add(normalized);
        return true;
      });

      // Sort: Creator > Admin > Member
      dedupedMembers.sort((a, b) => {
        const rolePriority = { creator: 0, admin: 1, member: 2 };
        return (rolePriority[a.role] ?? 2) - (rolePriority[b.role] ?? 2);
      });

      setMembers(dedupedMembers);

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

      const count = await getPublicListingsCount();
      setPublicCount(count);
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

  const handleTogglePublicListing = async () => {
    try {
      const newValue = !isPublic;
      if (newValue) {
        const count = await getPublicListingsCount();
        setPublicCount(count);
        if (count >= LISTINGS_PUBLIC_LIMIT) {
          setPublicError(
            `You already have ${LISTINGS_PUBLIC_LIMIT} public listings. Remove one before adding another.`,
          );
          return;
        }
      }
      await groupService.updateGroupPublic(groupId, newValue);
      setIsPublic(newValue);
      const updatedCount = await getPublicListingsCount();
      setPublicCount(updatedCount);
      setPublicError("");
    } catch (err) {
      console.error("Failed to update public listing:", err);
      alert("Failed to update public listing");
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
          icon: decodeStoredAvatar(chat.avatar),
        }));

      const allContacts = [
        ...raw.map((c: any) => ({
          publickey: c.publickey,
          name: c.extradata?.name || c.currentaddress || c.publickey,
          currentaddress: c.currentaddress || c.publickey,
          type: "contact" as const,
          icon: decodeStoredAvatar(c.extradata?.icon),
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
    <div className="h-full overflow-y-auto bg-gray-50 dark:bg-gray-900 flex flex-col transition-colors selection:bg-primary-500/30">
      {/* ELITE STICKY HEADER */}
      <div className="sticky top-0 z-[100] bg-white/70 dark:bg-gray-950/60 backdrop-blur-2xl border-b border-white/10 px-6 py-4 flex items-center justify-between shadow-xl shadow-black/5">
        <button
          onClick={() => {
            if (search.returnTo) {
              navigate({ to: search.returnTo });
            } else {
              navigate({ to: `/groups/${groupId}` });
            }
          }}
          className="p-3 bg-gray-100 dark:bg-white/5 hover:bg-gray-200 dark:hover:bg-white/10 rounded-2xl transition-all active:scale-90 text-gray-700 dark:text-white border border-white/5"
        >
          <ArrowLeft size={18} strokeWidth={3} />
        </button>
        <div className="flex flex-col items-center min-w-0 px-4">
          <span className="text-[10px] font-black text-gray-400 uppercase tracking-[0.4em] mb-0.5">Community Registry</span>
          <h1 className="text-xs font-black text-gray-900 dark:text-white truncate uppercase tracking-tight">
            {groupName}
          </h1>
        </div>
        <div className="w-12 h-12 flex items-center justify-center">
            <Info size={18} className="text-gray-300 opacity-20" />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* ELITE HERO SECTION - COMMON */}
        <div className="relative pt-16 pb-12 px-6 sm:px-12 bg-white dark:bg-gray-900 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-b from-primary-500/5 to-transparent pointer-events-none"></div>
          <div className="max-w-xl mx-auto flex flex-col items-center">
            <input
              type="file"
              ref={fileInputRef}
              className="hidden"
              accept="image/*"
              onChange={handleAvatarFileSelect}
            />

            <div className="relative group/avatar mb-10">
              <div className="absolute inset-0 bg-primary-500/20 blur-[60px] rounded-full scale-125 opacity-30 group-hover/avatar:opacity-60 transition-opacity"></div>
              <div className="relative">
                <div className="absolute -inset-2 bg-gradient-to-tr from-primary-500 to-indigo-600 rounded-[3.5rem] blur opacity-20 group-hover/avatar:opacity-40 transition-opacity duration-700"></div>
                <div
                  className={`w-36 h-36 sm:w-44 sm:h-44 rounded-[3rem] flex items-center justify-center text-white text-5xl font-black shadow-[0_30px_70px_rgba(0,0,0,0.4)] dark:shadow-[0_30px_70px_rgba(0,0,0,0.6)] border-2 border-white/20 dark:border-white/10 relative z-10 transition-transform duration-700 group-hover/avatar:scale-[1.02] overflow-hidden ${!avatar ? "bg-gradient-to-br from-primary-500 to-primary-700" : "bg-gray-200 dark:bg-gray-800"}`}
                >
                  {avatar ? (
                    <img
                      src={avatar}
                      alt={groupName}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <span className="drop-shadow-2xl">{groupName.charAt(0).toUpperCase()}</span>
                  )}
                </div>

                {(isCreator || myRole === "admin") && (
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={savingAvatar}
                    className="absolute -bottom-2 -right-2 w-12 h-12 bg-white dark:bg-gray-900 flex items-center justify-center text-primary-500 rounded-2xl shadow-2xl border-2 border-white dark:border-gray-800 z-20 hover:scale-110 active:scale-95 transition-all shadow-primary-500/10"
                  >
                    {savingAvatar ? (
                      <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary-500"></div>
                    ) : (
                      <Camera size={20} strokeWidth={3} />
                    )}
                  </button>
                )}
              </div>
            </div>

            {isEditingName ? (
              <div className="flex flex-col items-center gap-4 w-full max-w-sm animate-in zoom-in-95 duration-200">
                <div className="relative w-full">
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
                    className="w-full bg-white dark:bg-white/5 border-2 border-primary-500 rounded-[1.5rem] px-6 py-4 text-gray-900 dark:text-white text-center font-black text-xl focus:outline-none shadow-xl shadow-primary-500/10 uppercase tracking-widest"
                    disabled={savingName}
                  />
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3 group/name px-4 mb-4">
                <h1 className="text-4xl sm:text-5xl font-black text-gray-900 dark:text-white text-center break-all uppercase tracking-tighter leading-none">
                  {groupName}
                </h1>

                <div className="flex items-center gap-3">
                  <div className="px-4 py-1.5 bg-primary-500/10 rounded-full border border-primary-500/20">
                    <span className="text-[10px] font-black text-primary-500 uppercase tracking-widest">Protocol Channel</span>
                  </div>

                  {(isCreator || myRole === "admin") && (
                    <button
                      onClick={() => {
                        setNewName(groupName);
                        setIsEditingName(true);
                      }}
                      className="p-2 text-gray-300 hover:text-primary-500 transition-colors"
                      title="Rename Group"
                    >
                      <Edit2 size={16} strokeWidth={3} />
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* DESCRIPTION */}
            <div className="w-full mb-2">
              {isEditingDesc ? (
                <div className="w-full flex flex-col items-center animate-in zoom-in-95 duration-200">
                  <div className="relative w-full max-w-md">
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
                      className="w-full bg-white dark:bg-white/5 border-2 border-primary-500 rounded-[2rem] px-8 py-6 text-sm text-center text-gray-700 dark:text-gray-300 focus:outline-none resize-none shadow-xl shadow-primary-500/5 font-bold"
                      rows={3}
                      placeholder="Mission statement..."
                      disabled={savingDesc}
                    />
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center group/desc px-6">
                  {description ? (
                    <div className="relative">
                      <p className="text-gray-500 dark:text-gray-400 text-sm font-bold leading-relaxed text-center max-w-md break-words opacity-80 italic">
                        "{description}"
                      </p>
                      {(isCreator || myRole === "admin") && (
                        <button
                          onClick={() => {
                            setNewDesc(description);
                            setIsEditingDesc(true);
                          }}
                          className="absolute -right-8 top-0 p-2 text-gray-300 hover:text-primary-500 opacity-0 group-hover/desc:opacity-100 transition-all"
                        >
                          <Edit2 size={14} strokeWidth={3} />
                        </button>
                      )}
                    </div>
                  ) : (isCreator || myRole === "admin") ? (
                    <button
                      onClick={() => {
                        setNewDesc(description);
                        setIsEditingDesc(true);
                      }}
                      className="text-[10px] font-black text-gray-400 hover:text-primary-500 uppercase tracking-widest transition-colors py-2 border-b border-dashed border-gray-300 dark:border-gray-700"
                    >
                      Add Mission Manifest
                    </button>
                  ) : null}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* TABS NAVIGATION - CENTERED ELITE */}
        <div className="flex justify-center -mt-8 relative z-[50]">
          <GroupTabs activeTab={activeTab} onTabChange={setActiveTab} />
        </div>

        <div className="w-full max-w-2xl mx-auto p-6 sm:p-10 pb-32 space-y-12">
        {activeTab === "profile" && (
          <div className="space-y-12 animate-in fade-in slide-in-from-bottom-6 duration-700">

            {/* ELITE ANALYTICS CARDS */}
            <div className="bg-white/70 dark:bg-gray-900/40 backdrop-blur-md rounded-[3rem] p-10 border border-white/20 dark:border-white/5 shadow-xl shadow-black/5">
              <div className="flex items-center gap-4 mb-8">
                <div className="w-12 h-12 bg-primary-500/10 rounded-2xl flex items-center justify-center text-primary-500">
                  <Activity size={22} strokeWidth={3} />
                </div>
                <div className="flex flex-col">
                  <span className="text-[10px] font-black text-gray-400 uppercase tracking-[0.4em] mb-0.5">Activity Ledger</span>
                  <h3 className="text-sm font-black text-gray-900 dark:text-white uppercase tracking-tight">Group Analytics</h3>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4">
                <div className="flex items-center justify-between p-6 bg-gray-50/50 dark:bg-white/5 rounded-[2.5rem] border border-white/5 group hover:border-primary-500/20 transition-all">
                  <div className="flex items-center gap-5">
                    <div className="w-14 h-14 bg-blue-500/10 rounded-2xl flex items-center justify-center text-blue-500 group-hover:scale-110 transition-transform">
                      <MessageSquare size={24} strokeWidth={3} />
                    </div>
                    <div className="flex flex-col">
                      <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Message Volume</span>
                      <span className="text-sm font-black text-gray-900 dark:text-gray-200 uppercase">Communcation</span>
                    </div>
                  </div>
                  <div className="text-right flex flex-col">
                    <span className="text-2xl font-black text-gray-900 dark:text-white tracking-tighter">
                      {stats.total}
                    </span>
                    <span className="text-[9px] font-black text-gray-500 uppercase tracking-widest italic">{stats.mine} Mine</span>
                  </div>
                </div>

                <div className="flex items-center justify-between p-6 bg-gray-50/50 dark:bg-white/5 rounded-[2.5rem] border border-white/5 group hover:border-indigo-500/20 transition-all">
                  <div className="flex items-center gap-5">
                    <div className="w-14 h-14 bg-indigo-500/10 rounded-2xl flex items-center justify-center text-indigo-500 group-hover:scale-110 transition-transform">
                      <Users size={24} strokeWidth={3} />
                    </div>
                    <div className="flex flex-col">
                      <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Member Registry</span>
                      <span className="text-sm font-black text-gray-900 dark:text-gray-200 uppercase">Population</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="text-2xl font-black text-gray-900 dark:text-white tracking-tighter">
                      {members.length}
                    </span>
                  </div>
                </div>

                {stats.firstDate > 0 && (
                  <div className="flex items-center justify-between p-6 bg-gray-50/50 dark:bg-white/5 rounded-[2.5rem] border border-white/5 opacity-60">
                    <div className="flex items-center gap-5">
                      <div className="w-14 h-14 bg-orange-500/10 rounded-2xl flex items-center justify-center text-orange-500">
                        <Zap size={24} strokeWidth={3} />
                      </div>
                      <div className="flex flex-col">
                        <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Genesis Block</span>
                        <span className="text-sm font-black text-gray-900 dark:text-gray-200 uppercase">Established</span>
                      </div>
                    </div>
                    <span className="text-xs font-black text-gray-500 uppercase tracking-tighter">
                      {new Date(stats.firstDate).toLocaleDateString([], { month: 'short', year: 'numeric' })}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* TECHNICAL DATA */}
            <div className="bg-white/70 dark:bg-gray-900/40 backdrop-blur-md rounded-[3rem] p-10 border border-white/20 dark:border-white/5 shadow-xl shadow-black/5">
              <div className="flex items-center gap-4 mb-8">
                <div className="w-12 h-12 bg-primary-500/10 rounded-2xl flex items-center justify-center text-primary-500">
                  <Database size={22} strokeWidth={3} />
                </div>
                <div className="flex flex-col">
                  <span className="text-[10px] font-black text-gray-400 uppercase tracking-[0.4em] mb-0.5">Specifications</span>
                  <h3 className="text-sm font-black text-gray-900 dark:text-white uppercase tracking-tight">Technical Data</h3>
                </div>
              </div>

              <div className="space-y-6">
                <div className="group relative">
                  <p className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] mb-2 px-2">
                    Group ID / Registry Address
                  </p>
                  <div className="flex items-center justify-between p-6 bg-gray-50/50 dark:bg-white/5 rounded-[2.5rem] border border-white/5 group hover:border-primary-500/20 transition-all">
                    <p className="text-xs font-black text-gray-800 dark:text-gray-200 break-all pr-12 font-mono">
                      {groupId}
                    </p>
                    <button
                      onClick={() => copyToClipboard(groupId || "", "groupid")}
                      className="absolute right-6 top-1/2 -translate-y-1/2 p-3 bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-2xl text-gray-400 hover:text-primary-500 opacity-0 group-hover:opacity-100 transition-all shadow-lg"
                    >
                      {copiedField === "groupid" ? (
                        <Check size={16} className="text-green-500" />
                      ) : (
                        <Copy size={16} />
                      )}
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between p-6 bg-gray-50/50 dark:bg-white/5 rounded-[2.5rem] border border-white/5">
                  <div className="flex flex-col">
                    <p className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] mb-1">
                      Assigned Privilege
                    </p>
                    <span className="text-sm font-black text-gray-900 dark:text-white uppercase tracking-widest">{myRole}</span>
                  </div>
                  <div className="w-10 h-10 bg-primary-500/10 rounded-xl flex items-center justify-center text-primary-500">
                    <ShieldCheck size={20} strokeWidth={3} />
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === "settings" && (
          <div className="space-y-6">
            {/* VERIFIED REGISTRY: MEMBERS */}
            <div className="bg-white/70 dark:bg-gray-900/40 backdrop-blur-md rounded-[3rem] p-10 border border-white/20 dark:border-white/5 shadow-xl shadow-black/5">
              <div className="flex items-center justify-between mb-8">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-primary-500/10 rounded-2xl flex items-center justify-center text-primary-500">
                    <Users size={22} strokeWidth={3} />
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[10px] font-black text-gray-400 uppercase tracking-[0.4em] mb-0.5">Verified Registry</span>
                    <h3 className="text-sm font-black text-gray-900 dark:text-white uppercase tracking-tight">Active Members</h3>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {(isCreator || myRole === "admin") && (
                    <button
                      onClick={openAddMember}
                      className="w-10 h-10 bg-primary-500 text-white rounded-xl flex items-center justify-center hover:bg-primary-600 active:scale-95 transition-all shadow-lg shadow-primary-500/20"
                    >
                      <UserPlus size={18} strokeWidth={3} />
                    </button>
                  )}
                  <span className="h-10 px-4 bg-gray-100 dark:bg-white/5 rounded-xl flex items-center justify-center text-xs font-black text-gray-500 dark:text-gray-400 border border-white/5">
                    {members.length}
                  </span>
                </div>
              </div>

              <div className="space-y-2">
                {loading ? (
                  <div className="py-20 text-center">
                    <div className="inline-block w-8 h-8 border-4 border-primary-500/20 border-t-primary-500 rounded-full animate-spin mb-4" />
                    <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Synchronizing Registry...</p>
                  </div>
                ) : (
                  members.map((member, i) => (
                    <div
                      key={member.publickey || i}
                      className={`group relative flex items-center p-4 rounded-[2rem] transition-all hover:bg-white dark:hover:bg-white/5 border border-transparent hover:border-white/20 dark:hover:border-white/10 ${member.isMe ? "bg-primary-500/5 border-primary-500/10" : ""}`}
                    >
                      <div className="relative">
                        <div className="w-14 h-14 rounded-2xl overflow-hidden bg-gray-200 dark:bg-gray-800 border-2 border-white dark:border-gray-700 shadow-sm flex-shrink-0">
                          {member.avatar ? (
                            <img src={member.avatar} className="w-full h-full object-cover" alt="" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-xl font-black text-gray-400 dark:text-gray-600 uppercase">
                              {member.name ? member.name.charAt(0) : "?"}
                            </div>
                          )}
                        </div>
                        {member.role !== "member" && (
                          <div className={`absolute -top-1 -right-1 w-6 h-6 rounded-lg flex items-center justify-center shadow-lg border border-white dark:border-gray-800 ${member.role === "creator" ? "bg-amber-500 text-white" : "bg-blue-500 text-white"}`}>
                            {member.role === "creator" ? <Star size={12} strokeWidth={3} /> : <ShieldCheck size={12} strokeWidth={3} />}
                          </div>
                        )}
                      </div>

                      <div className="ml-5 flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-sm font-black text-gray-900 dark:text-gray-100 uppercase tracking-tight truncate">
                            {member.isMe ? "You" : member.name || "Anonymous Contact"}
                          </span>
                        </div>
                        <p className="text-[9px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest font-mono truncate">
                          {shortenKey(member.publickey)}
                        </p>
                      </div>

                      <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        {!member.isMe && member.role !== "creator" && (myRole === "creator" || myRole === "admin") && (
                          <>
                            {member.role === "member" && (isCreator || myRole === "admin") && (
                              <button
                                onClick={() => handleRoleChange(member.publickey, "admin")}
                                className="w-9 h-9 bg-blue-500/10 text-blue-500 rounded-xl flex items-center justify-center hover:bg-blue-500 hover:text-white transition-all"
                                title="Promote"
                              >
                                <ShieldCheck size={16} strokeWidth={3} />
                              </button>
                            )}
                            {member.role === "admin" && isCreator && (
                              <button
                                onClick={() => handleRoleChange(member.publickey, "member")}
                                className="w-9 h-9 bg-amber-500/10 text-amber-500 rounded-xl flex items-center justify-center hover:bg-amber-500 hover:text-white transition-all"
                                title="Demote"
                              >
                                <ShieldAlert size={16} strokeWidth={3} />
                              </button>
                            )}
                            {(isCreator || (myRole === "admin" && member.role === "member")) && (
                              <button
                                onClick={() => handleRemoveMember(member.publickey)}
                                className="w-9 h-9 bg-red-500/10 text-red-500 rounded-xl flex items-center justify-center hover:bg-red-500 hover:text-white transition-all"
                                title="Expel"
                              >
                                <UserX size={16} strokeWidth={3} />
                              </button>
                            )}
                          </>
                        )}
                        {!member.isMe && (
                          <button
                            onClick={() => navigate({ to: `/contact-info/${member.publickey}`, search: { returnTo: `/group-info/${groupId}` } })}
                            className="w-9 h-9 bg-gray-500/10 text-gray-500 rounded-xl flex items-center justify-center hover:bg-gray-500 hover:text-white transition-all"
                          >
                            <ChevronRight size={16} strokeWidth={3} />
                          </button>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* ACTION LEDGER: BANNED & REQUESTS */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* BANNED MEMBERS */}
              <div className="bg-white/70 dark:bg-gray-900/40 backdrop-blur-md rounded-[3rem] p-10 border border-red-500/20 dark:border-red-500/10 shadow-xl shadow-red-500/5">
                <div className="flex items-center justify-between mb-8">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-red-500/10 rounded-2xl flex items-center justify-center text-red-500 font-black">
                      <ShieldOff size={22} strokeWidth={3} />
                    </div>
                    <div className="flex flex-col">
                      <span className="text-[10px] font-black text-red-400 uppercase tracking-[0.4em] mb-0.5">Restriction List</span>
                      <h3 className="text-sm font-black text-gray-900 dark:text-white uppercase tracking-tight">Expelled Users</h3>
                    </div>
                  </div>
                  <span className="h-10 px-4 bg-red-500/10 rounded-xl flex items-center justify-center text-xs font-black text-red-500 border border-red-500/10">
                    {bannedMembers.length}
                  </span>
                </div>

                <div className="space-y-3">
                  {bannedMembers.length === 0 ? (
                    <div className="py-8 text-center bg-gray-50/50 dark:bg-white/5 rounded-[2.5rem] border border-dashed border-gray-200 dark:border-white/10">
                      <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest italic">Clear Ledger</p>
                    </div>
                  ) : (
                    bannedMembers.map((banned) => (
                      <div key={banned.publickey} className="flex items-center p-4 bg-gray-50/50 dark:bg-white/5 rounded-[2rem] border border-white/5">
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-black text-gray-900 dark:text-white uppercase tracking-tight truncate mb-0.5">
                            {banned.username || shortenKey(banned.publickey)}
                          </p>
                          <p className="text-[8px] font-black text-gray-400 uppercase tracking-widest">
                            Blacklisted {new Date(banned.banned_at).toLocaleDateString()}
                          </p>
                        </div>
                        <button
                          onClick={() => handleUnban(banned.publickey)}
                          className="px-4 py-2 bg-green-500 text-white text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-green-600 transition-all shadow-lg shadow-green-500/20"
                        >
                          Pardon
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* JOIN REQUESTS */}
              <div className="bg-white/70 dark:bg-gray-900/40 backdrop-blur-md rounded-[3rem] p-10 border border-blue-500/20 dark:border-blue-500/10 shadow-xl shadow-blue-500/5">
                <div className="flex items-center justify-between mb-8">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-blue-500/10 rounded-2xl flex items-center justify-center text-blue-500">
                      <UserPlus size={22} strokeWidth={3} />
                    </div>
                    <div className="flex flex-col">
                      <span className="text-[10px] font-black text-blue-400 uppercase tracking-[0.4em] mb-0.5">Inbound Terminal</span>
                      <h3 className="text-sm font-black text-gray-900 dark:text-white uppercase tracking-tight">Pending Access</h3>
                    </div>
                  </div>
                  <span className="h-10 px-4 bg-blue-500/10 rounded-xl flex items-center justify-center text-xs font-black text-blue-500 border border-blue-500/10">
                    {joinRequests.length}
                  </span>
                </div>

                <div className="space-y-3">
                  {(isCreator || myRole === "admin") && joinRequests.length === 0 ? (
                    <div className="py-8 text-center bg-gray-50/50 dark:bg-white/5 rounded-[2.5rem] border border-dashed border-gray-200 dark:border-white/10">
                      <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest italic">No Pending Access</p>
                    </div>
                  ) : (
                    joinRequests.map((req) => (
                      <div key={req.id} className="flex items-center p-4 bg-gray-50/50 dark:bg-white/5 rounded-[2rem] border border-white/5">
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-black text-gray-900 dark:text-white uppercase tracking-tight truncate mb-0.5">
                            {req.username || shortenKey(req.publickey)}
                          </p>
                          <p className="text-[8px] font-black text-gray-400 uppercase tracking-widest font-mono">
                            {shortenKey(req.publickey)}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleResolveJoinRequest(req, "approved")}
                            className="w-10 h-10 bg-green-500 text-white rounded-xl flex items-center justify-center hover:bg-green-600 transition-all shadow-lg shadow-green-500/20"
                          >
                            <Check size={18} strokeWidth={3} />
                          </button>
                          <button
                            onClick={() => handleResolveJoinRequest(req, "denied")}
                            className="w-10 h-10 bg-red-500 text-white rounded-xl flex items-center justify-center hover:bg-red-600 transition-all shadow-lg shadow-red-500/20"
                          >
                            <X size={18} strokeWidth={3} />
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            {/* ACCESS PROTOCOLS: INVITE & PERMISSIONS */}
            {(isCreator || myRole === "admin") && (
              <div className="bg-white/70 dark:bg-gray-900/40 backdrop-blur-md rounded-[3rem] p-10 border border-white/20 dark:border-white/5 shadow-xl shadow-black/5">
                <div className="flex items-center gap-4 mb-10">
                  <div className="w-12 h-12 bg-primary-500/10 rounded-2xl flex items-center justify-center text-primary-500">
                    <ShieldCheck size={22} strokeWidth={3} />
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[10px] font-black text-gray-400 uppercase tracking-[0.4em] mb-0.5">Control Panel</span>
                    <h3 className="text-sm font-black text-gray-900 dark:text-white uppercase tracking-tight">Access Protocols</h3>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Public listing toggle */}
                    {/* Global discovery toggle */}
                    <div className="group flex items-center justify-between p-8 bg-white/40 dark:bg-black/5 rounded-[2.5rem] border border-white/10 hover:border-primary-500/20 hover:shadow-xl transition-all duration-500">
                      <div className="flex flex-col min-w-0 pr-6">
                        <span className="text-[11px] font-black text-gray-900 dark:text-white uppercase tracking-[0.2em] mb-1">Global Discovery</span>
                        <span className="text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase leading-relaxed max-w-[200px] opacity-70">Broadcast channel via gossip network</span>
                      </div>
                      <button
                        onClick={handleTogglePublicListing}
                        className={`relative inline-flex h-9 w-16 flex-shrink-0 items-center rounded-2xl transition-all duration-500 ease-in-out border-2 overflow-hidden ${isPublic ? "bg-primary-500 border-primary-400 shadow-[0_0_25px_rgba(59,130,246,0.5)]" : "bg-black/10 dark:bg-white/5 border-white/5"}`}
                      >
                        <div className={`absolute inset-0 bg-gradient-to-tr from-white/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity`} />
                        <span className={`inline-block h-6 w-6 transform rounded-xl bg-white shadow-[0_4px_12px_rgba(0,0,0,0.2)] transition-all duration-500 ease-in-out ${isPublic ? "translate-x-9" : "translate-x-1"}`} />
                      </button>
                    </div>

                    {/* Auto-approve toggle */}
                    <div className="group flex items-center justify-between p-8 bg-white/40 dark:bg-black/5 rounded-[2.5rem] border border-white/10 hover:border-primary-500/20 hover:shadow-xl transition-all duration-500">
                      <div className="flex flex-col min-w-0 pr-6">
                        <span className="text-[11px] font-black text-gray-900 dark:text-white uppercase tracking-[0.2em] mb-1">Autonomous Approval</span>
                        <span className="text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase leading-relaxed max-w-[200px] opacity-70">Manifest links grant instant access</span>
                      </div>
                      <button
                        onClick={handleToggleAutoApprove}
                        className={`relative inline-flex h-9 w-16 flex-shrink-0 items-center rounded-2xl transition-all duration-500 ease-in-out border-2 overflow-hidden ${autoApprove ? "bg-primary-500 border-primary-400 shadow-[0_0_25px_rgba(59,130,246,0.5)]" : "bg-black/10 dark:bg-white/5 border-white/5"}`}
                      >
                        <div className={`absolute inset-0 bg-gradient-to-tr from-white/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity`} />
                        <span className={`inline-block h-6 w-6 transform rounded-xl bg-white shadow-[0_4px_12px_rgba(0,0,0,0.2)] transition-all duration-500 ease-in-out ${autoApprove ? "translate-x-9" : "translate-x-1"}`} />
                      </button>
                    </div>
                  </div>

                  {publicError && <p className="text-[9px] font-black text-red-500 uppercase tracking-widest px-4">{publicError}</p>}
                  <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest px-4">Global Discovery Utilization: {publicCount} / {LISTINGS_PUBLIC_LIMIT}</p>

                  <div className="mt-8 pt-8 border-t border-white/5 space-y-6">
                    <p className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] px-2">Access Token / Invite Manifest</p>
                    {inviteLink ? (
                      <div className="space-y-4">
                        <div className="relative group/link p-8 bg-gray-50/50 dark:bg-white/10 rounded-[2.5rem] border border-white/10 font-mono text-xs font-black text-primary-500 break-all select-all">
                          {inviteLink}
                          <button
                            onClick={() => copyToClipboard(inviteLink, "inviteLink")}
                            className="absolute right-6 top-1/2 -translate-y-1/2 w-12 h-12 bg-white dark:bg-gray-800 rounded-2xl flex items-center justify-center text-gray-400 hover:text-primary-500 opacity-0 group-hover/link:opacity-100 transition-all shadow-xl"
                          >
                            {copiedField === "inviteLink" ? <Check size={18} strokeWidth={3} className="text-green-500" /> : <Copy size={18} strokeWidth={3} />}
                          </button>
                        </div>
                        <p className="text-[9px] font-black text-gray-500 uppercase tracking-widest text-center italic">Protocol warning: single-use tokens recommended for high-security registries.</p>
                      </div>
                    ) : (
                      <button
                        onClick={handleGenerateInvite}
                        disabled={generatingLink}
                        className="w-full flex items-center justify-center gap-4 py-8 bg-primary-500 text-white rounded-[2.5rem] font-black uppercase tracking-[0.3em] hover:bg-primary-600 active:scale-[0.98] transition-all shadow-2xl shadow-primary-500/20 disabled:opacity-50"
                      >
                        {generatingLink ? "Generating Manifesto..." : <><Copy size={20} strokeWidth={3} /> Generate Access Manifest</>}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* EXIT TERMINAL */}
            <div className="bg-white/70 dark:bg-gray-900/40 backdrop-blur-md rounded-[3rem] p-2 border border-red-500/10 shadow-xl overflow-hidden group">
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="w-full h-24 flex items-center justify-between px-10 text-red-500 hover:bg-red-500 hover:text-white transition-all rounded-[2.5rem] group"
              >
                <div className="flex items-center gap-6">
                  <div className="w-12 h-12 bg-red-500/10 rounded-2xl flex items-center justify-center group-hover:bg-red-400 transition-colors">
                    <Trash2 size={24} strokeWidth={3} />
                  </div>
                  <div className="flex flex-col text-left">
                    <span className="text-[10px] font-black uppercase tracking-[0.4em] opacity-60">Session Management</span>
                    <span className="text-sm font-black uppercase tracking-tight">Expunge Registry Connection</span>
                  </div>
                </div>
                <ChevronRight size={24} strokeWidth={3} className="opacity-0 group-hover:opacity-100 -translate-x-4 group-hover:translate-x-0 transition-all font-black" />
              </button>
            </div>
          </div>
        )}

        {/* ELITE EXIT CONFIRMATION */}
        {showDeleteConfirm && (
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-[100] p-6 animate-in fade-in duration-300">
            <div className="bg-white dark:bg-gray-900 rounded-[3rem] shadow-2xl p-10 border border-white/20 dark:border-white/10 max-w-sm w-full animate-in zoom-in-95 duration-300">
              <div className="w-16 h-16 bg-red-500/10 rounded-2xl flex items-center justify-center text-red-500 mb-6 mx-auto">
                <Trash2 size={32} strokeWidth={3} />
              </div>
              <h3 className="text-lg font-black text-gray-900 dark:text-white mb-2 text-center uppercase tracking-tight">Expunge Connection?</h3>
              <p className="text-xs font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest text-center mb-8 leading-relaxed">Incoming data streams will be terminated. This action is recorded and permanent.</p>
              <div className="grid grid-cols-2 gap-4">
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  className="py-4 bg-gray-100 dark:bg-white/5 text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest rounded-2xl hover:bg-gray-200 dark:hover:bg-white/10 transition-all"
                >
                  Abort
                </button>
                <button
                  onClick={() => {
                    setShowDeleteConfirm(false);
                    handleExitGroup();
                  }}
                  className="py-4 bg-red-500 text-white text-[10px] font-black uppercase tracking-widest rounded-2xl hover:bg-red-600 transition-all shadow-lg shadow-red-500/20"
                >
                  Expunge
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ELITE ADD MEMBER MODAL */}
        {showAddMember && (
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-end sm:items-center justify-center z-[100] p-6 animate-in fade-in duration-300">
            <div className="bg-white dark:bg-gray-900 rounded-t-[3rem] sm:rounded-[4rem] shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col border border-white/20 dark:border-white/10 animate-in slide-in-from-bottom-10 sm:zoom-in-95 duration-500">
              {/* Modal header */}
              <div className="p-10 pb-6 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-primary-500/10 rounded-2xl flex items-center justify-center text-primary-500">
                    <UserPlus size={22} strokeWidth={3} />
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[10px] font-black text-gray-400 uppercase tracking-[0.4em] mb-0.5">Authorization Flow</span>
                    <h3 className="text-lg font-black text-gray-900 dark:text-white uppercase tracking-tight">Expand Registry</h3>
                  </div>
                </div>
                <button
                  onClick={() => setShowAddMember(false)}
                  className="w-12 h-12 bg-gray-100 dark:bg-white/5 rounded-2xl flex items-center justify-center text-gray-400 hover:text-gray-900 dark:hover:text-white transition-all hover:rotate-90"
                >
                  <X size={20} strokeWidth={3} />
                </button>
              </div>

              {/* Enhanced Search & Filter */}
              <div className="px-10 space-y-6 mb-6">
                <div className="flex gap-2">
                  {(["all", "contacts", "community"] as const).map((tab) => (
                    <button
                      key={tab}
                      onClick={() => setAddMemberTab(tab)}
                      className={`h-10 px-6 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${addMemberTab === tab
                          ? "bg-primary-500 text-white shadow-lg shadow-primary-500/20"
                          : "bg-gray-100 dark:bg-white/5 text-gray-400 dark:text-gray-500 hover:bg-gray-200 dark:hover:bg-white/10"
                        }`}
                    >
                      {tab}
                    </button>
                  ))}
                </div>

                <div className="relative group">
                  <Search
                    size={18}
                    strokeWidth={3}
                    className="absolute left-6 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-primary-500 transition-colors"
                  />
                  <input
                    type="text"
                    value={addMemberSearch}
                    onChange={(e) => setAddMemberSearch(e.target.value)}
                    placeholder="Search Global Index..."
                    className="w-full pl-16 pr-6 h-16 bg-gray-50/50 dark:bg-white/5 border border-white/5 rounded-[2rem] text-sm font-black text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:border-primary-500/50 focus:ring-4 focus:ring-primary-500/10 transition-all uppercase tracking-widest"
                    autoFocus
                  />
                </div>
              </div>

              {/* Registry Results list */}
              <div className="overflow-y-auto flex-1 px-10 pb-10 space-y-2 custom-scrollbar">
                {addableContacts.length === 0 ? (
                  <div className="py-20 text-center bg-gray-50/50 dark:bg-white/5 rounded-[3rem] border border-dashed border-gray-200 dark:border-white/10">
                    <p className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] italic">No compatible profiles discovered</p>
                  </div>
                ) : (
                  addableContacts
                    .filter((c) => {
                      const matchesSearch = c.name.toLowerCase().includes(addMemberSearch.toLowerCase());
                      if (!matchesSearch) return false;
                      if (addMemberTab === "contacts") return c.type === "contact";
                      if (addMemberTab === "community") return c.type === "community";
                      return true;
                    })
                    .map((contact) => (
                      <div
                        key={contact.publickey}
                        className="group flex items-center p-4 bg-gray-50/50 dark:bg-white/5 rounded-[2rem] border border-transparent hover:border-primary-500/20 hover:bg-white dark:hover:bg-white/10 transition-all"
                      >
                        <div className="w-14 h-14 rounded-2xl overflow-hidden bg-gray-200 dark:bg-gray-800 border-2 border-white dark:border-gray-700 shadow-sm flex-shrink-0 group-hover:scale-105 transition-transform">
                          {contact.icon ? (
                            <img src={contact.icon} className="w-full h-full object-cover" alt="" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-xl font-black text-gray-400 dark:text-gray-600 uppercase">
                              {contact.name.charAt(0)}
                            </div>
                          )}
                        </div>

                        <div className="ml-5 flex-1 min-w-0">
                          <p className="text-sm font-black text-gray-900 dark:text-gray-100 uppercase tracking-tight truncate mb-0.5">
                            {contact.name}
                          </p>
                          <div className="flex items-center gap-2">
                            <span className="text-[8px] font-black text-primary-500 uppercase tracking-widest">{contact.type}</span>
                            <span className="w-1 h-1 bg-gray-300 dark:bg-gray-700 rounded-full" />
                            <p className="text-[8px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest font-mono truncate">
                              {shortenKey(contact.publickey)}
                            </p>
                          </div>
                        </div>

                        <button
                          onClick={() => handleAddMember(contact)}
                          disabled={addingMember === contact.publickey}
                          className="px-6 py-3 bg-primary-500 text-white text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-primary-600 active:scale-95 transition-all shadow-lg shadow-primary-500/20 disabled:opacity-50"
                        >
                          {addingMember === contact.publickey ? "Transmitting..." : "Authorize"}
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
    </div>
  );
}
