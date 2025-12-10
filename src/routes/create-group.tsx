// src/routes/create-group.tsx

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useContext, useEffect, useState } from "react";
import { appContext } from "../AppContext";
import { groupService } from "../services/group.service";
import { MDS } from "@minima-global/mds";
import { ArrowLeft, Check } from "lucide-react";

export const Route = createFileRoute("/create-group")({
  component: CreateGroupPage,
});

interface Contact {
  publickey: string;
  currentaddress: string;
  extradata?: {
    name?: string;
    icon?: string;
  };
}

function CreateGroupPage() {
  const { myPublicKey, userName } = useContext(appContext);
  const [groupName, setGroupName] = useState("");
  const [description, setDescription] = useState("");
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [selectedContacts, setSelectedContacts] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    const loadContacts = async () => {
      try {
        const res = await MDS.cmd.maxcontacts();
        const contactsList: Contact[] = (res as any)?.response?.contacts || [];
        setContacts(contactsList);
      } catch (err) {
        console.error("❌ [CreateGroup] Error loading contacts:", err);
      }
    };

    loadContacts();
  }, []);

  const toggleContact = (publickey: string) => {
    const newSelected = new Set(selectedContacts);
    if (newSelected.has(publickey)) {
      newSelected.delete(publickey);
    } else {
      newSelected.add(publickey);
    }
    setSelectedContacts(newSelected);
  };

  const handleCreateGroup = async () => {
    if (!groupName.trim() || selectedContacts.size === 0 || !myPublicKey || !userName) {
      alert("Please enter a group name and select at least one member");
      return;
    }

    setCreating(true);
    try {
      const groupId = await groupService.createGroup(
        groupName,
        description,
        Array.from(selectedContacts),
        myPublicKey,
        userName
      );

      console.log("✅ [CreateGroup] Group created:", groupId);
      navigate({ to: "/" });
    } catch (err) {
      console.error("❌ [CreateGroup] Error creating group:", err);
      alert("Failed to create group. Please try again.");
    } finally {
      setCreating(false);
    }
  };

  const filteredContacts = contacts.filter(c =>
    (c.extradata?.name || c.currentaddress)
      .toLowerCase()
      .includes(searchQuery.toLowerCase())
  );

  const defaultAvatar = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23cbd5e1'%3E%3Cpath d='M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z'/%3E%3C/svg%3E";

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      <div className="bg-[#0088cc] text-white p-4 flex items-center gap-3 shadow-sm">
        <button
          onClick={() => navigate({ to: "/" })}
          className="p-2 hover:bg-white/10 rounded-full transition-colors"
        >
          <ArrowLeft size={24} />
        </button>
        <h1 className="text-xl font-bold">Create Group</h1>
      </div>

      <div className="flex-1 overflow-y-auto p-4 pb-20">
        <div className="max-w-2xl mx-auto space-y-6">
          <div className="bg-white rounded-lg shadow-sm p-4 space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Group Name *
              </label>
              <input
                type="text"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                placeholder="Enter group name"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0088cc] text-gray-900 bg-white placeholder-gray-400"
                maxLength={50}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Description (optional)
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Enter group description"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0088cc] text-gray-900 bg-white placeholder-gray-400 resize-none"
                rows={3}
                maxLength={200}
              />
            </div>
          </div>

          {/* Create Button */}
          <div className="bg-white rounded-lg shadow-sm p-4">
            <button
              onClick={handleCreateGroup}
              disabled={!groupName.trim() || selectedContacts.size === 0 || creating}
              className="w-full py-3 bg-[#0088cc] text-white rounded-lg font-medium hover:bg-[#0077b5] transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed shadow-md"
            >
              {creating ? "Creating..." : selectedContacts.size > 0 ? `Create Group with ${selectedContacts.size} ${selectedContacts.size === 1 ? "member" : "members"}` : "Select members to continue"}
            </button>
          </div>

          <div className="bg-white rounded-lg shadow-sm p-4">
            <h2 className="text-lg font-semibold text-gray-900 mb-3">
              Add Members ({selectedContacts.size} selected)
            </h2>

            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search contacts..."
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0088cc] text-gray-900 bg-white placeholder-gray-400 mb-4"
            />

            <div className="space-y-2 max-h-96 overflow-y-auto">
              {filteredContacts.length === 0 ? (
                <p className="text-gray-500 text-center py-8">No contacts found</p>
              ) : (
                filteredContacts.map((contact) => {
                  const isSelected = selectedContacts.has(contact.publickey);
                  const avatar = contact.extradata?.icon
                    ? decodeURIComponent(contact.extradata.icon)
                    : defaultAvatar;

                  return (
                    <div
                      key={contact.publickey}
                      onClick={() => toggleContact(contact.publickey)}
                      className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors ${isSelected
                        ? "bg-blue-50 border-2 border-[#0088cc]"
                        : "bg-gray-50 border-2 border-transparent hover:bg-gray-100"
                        }`}
                    >
                      <img
                        src={avatar.startsWith("data:image") ? avatar : defaultAvatar}
                        alt={contact.extradata?.name || "Contact"}
                        className="w-10 h-10 rounded-full object-cover"
                        onError={(e: any) => {
                          e.target.src = defaultAvatar;
                        }}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-gray-900 truncate">
                          {contact.extradata?.name || contact.currentaddress}
                        </p>
                      </div>
                      {isSelected && (
                        <div className="w-6 h-6 bg-[#0088cc] rounded-full flex items-center justify-center">
                          <Check size={16} className="text-white" />
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
