import { createLazyFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, useContext } from "react";
import { ArrowLeft, Trash2, Users } from "lucide-react";
import { groupService } from "../services/group.service";
import { appContext } from "../AppContext";

export const Route = createLazyFileRoute("/group-info/$groupId")({
  component: GroupInfoPage,
});

interface GroupMember {
  publickey: string;
  name?: string;
  icon?: string;
  isMe?: boolean;
}

function GroupInfoPage() {
  const { groupId } = Route.useParams();
  const navigate = useNavigate();
  const { myPublicKey } = useContext(appContext);

  const [groupName, setGroupName] = useState<string>("Group");
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  useEffect(() => {
    const fetchGroupDetails = async () => {
      try {
        setLoading(true);
        const info = await groupService.getGroupInfo(groupId);
        if (info) {
          setGroupName((info as any).NAME || "Group");
        }

        const rawMembers = await groupService.getGroupMembers(groupId);

        const mappedMembers = rawMembers.map((m: any) => {
          // Handle properties that might be upper or lowercase depending on DB return
          const pubkey = m.PUBLICKEY || m.publickey;
          const username = m.USERNAME || m.username || "Unknown Member";

          return {
            publickey: pubkey,
            name: username,
            isMe: (pubkey || "").toLowerCase() === (myPublicKey || "").toLowerCase()
          };
        });

        setMembers(mappedMembers);

      } catch (err) {
        console.error("Failed to load group info:", err);
      } finally {
        setLoading(false);
      }
    };

    if (groupId) {
      fetchGroupDetails();
    }
  }, [groupId, myPublicKey]);

  const handleExitGroup = async () => {
    try {
      await groupService.deleteGroup(groupId);
      navigate({ to: '/' });
    } catch (err) {
      console.error("Failed to delete group:", err);
      alert("Failed to exit group");
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col transition-colors">
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

      <div className="flex-1 w-full max-w-2xl mx-auto p-4 space-y-6">

        {/* GROUP HEADER CARD */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 shadow-sm border border-gray-100 dark:border-gray-700 flex flex-col items-center">
          <div className="w-24 h-24 bg-primary-500 rounded-full flex items-center justify-center text-white text-4xl font-bold mb-4 shadow-lg shadow-primary-500/30">
            {groupName.charAt(0).toUpperCase()}
          </div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-1">{groupName}</h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm">{members.length} members</p>
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
        <div className="bg-white dark:bg-gray-800 rounded-2xl overflow-hidden shadow-sm border border-gray-100 dark:border-gray-700">
          <div className="p-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Users size={18} className="text-gray-500" />
              <span className="font-semibold text-gray-900 dark:text-white">Members</span>
            </div>
            <span className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 px-2 py-1 rounded-full">
              {members.length}
            </span>
          </div>

          <div className="divide-y divide-gray-100 dark:divide-gray-700">
            {loading ? (
              <div className="p-8 text-center text-gray-500">Loading members...</div>
            ) : (
              members.map((member, i) => (
                <button
                  key={member.publickey || i}
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
                  <div className="w-10 h-10 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-gray-600 dark:text-gray-300 font-medium text-sm group-hover:bg-gray-300 dark:group-hover:bg-gray-600 transition-colors">
                    {member.isMe ? 'You' : (member.name ? member.name.charAt(0).toUpperCase() : '?')}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                      {member.isMe ? 'You' : (member.name || "Unknown Member")}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 truncate font-mono">
                      {member.publickey}
                    </p>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
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

    </div>
  );
}
