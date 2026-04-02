import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  useContext,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import { appContext } from "../AppContext";
import { channelService } from "../services/channel.service";
import { chatService } from "../services/chat.service";
import { MDS } from "@minima-global/mds";
import { ArrowLeft, Check, Radio, Camera } from "lucide-react";
import { compressImage } from "../utils/image";
import {
  getPublicListingsCount,
  LISTINGS_PUBLIC_LIMIT,
} from "../services/listings.service";

export const Route = createFileRoute("/create-channel")({
  component: CreateChannelPage,
});

const defaultAvatar =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23cbd5e1'%3E%3Cpath d='M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z'/%3E%3C/svg%3E";

interface Person {
  publickey: string;
  currentaddress: string;
  type: "contact" | "community";
  extradata?: { name?: string; icon?: string };
}

function CreateChannelPage() {
  const { myPublicKey, userName } = useContext(appContext);
  const [channelName, setChannelName] = useState("");
  const [description, setDescription] = useState("");
  const [people, setPeople] = useState<Person[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [avatar, setAvatar] = useState("");
  const [processingAvatar, setProcessingAvatar] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState<"all" | "contacts" | "community">(
    "all",
  );
  const [isPublic, setIsPublic] = useState(false);
  const [publicCount, setPublicCount] = useState(0);
  const [publicError, setPublicError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  // -------------------------------------------------------------------------
  // Load contacts + community (same pattern as create-group)
  // -------------------------------------------------------------------------
  useEffect(() => {
    const load = async () => {
      try {
        // 1. Maxima contacts
        const res = await MDS.cmd.maxcontacts();
        const rawContacts = (res as any)?.response?.contacts || [];
        const contactsList: Person[] = rawContacts.map((c: any) => ({
          ...c,
          type: "contact" as const,
        }));

        // 2. Recent chats (non-contacts / community)
        const chats = await chatService.getRecentChats();
        const contactKeys = new Set(contactsList.map((c) => c.publickey));
        const communityPeople: Person[] = chats
          .filter((chat) => chat.publickey && !contactKeys.has(chat.publickey))
          .map((chat) => ({
            publickey: chat.publickey,
            currentaddress: chat.currentaddress || chat.publickey,
            type: "community" as const,
            extradata: { name: chat.roomname, icon: chat.avatar },
          }));

        setPeople([...contactsList, ...communityPeople]);
      } catch (err) {
        console.error("❌ [CreateChannel] Error loading people:", err);
      }
    };
    load();
  }, []);

  useEffect(() => {
    const loadPublicCount = async () => {
      const count = await getPublicListingsCount();
      setPublicCount(count);
    };
    loadPublicCount();
  }, []);

  const toggle = (pk: string) => {
    const next = new Set(selected);
    next.has(pk) ? next.delete(pk) : next.add(pk);
    setSelected(next);
  };

  const handleAvatarFileSelect = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }

    if (!file.type.startsWith("image/")) {
      alert("Please select a valid image.");
      return;
    }

    try {
      setProcessingAvatar(true);
      const compressedBase64 = await compressImage(file, 600, 600, 0.75);
      setAvatar(compressedBase64);
    } catch (err) {
      console.error("❌ [CreateChannel] Avatar processing failed:", err);
      alert("Failed to process the image. Please try another one.");
    } finally {
      setProcessingAvatar(false);
    }
  };

  const handleCreate = async () => {
    if (!channelName.trim() || !myPublicKey || !userName) {
      alert("Please enter a channel name");
      return;
    }
    setCreating(true);
    try {
      const latestCount = await getPublicListingsCount();
      if (isPublic && latestCount >= LISTINGS_PUBLIC_LIMIT) {
        setPublicError(
          `You already have ${LISTINGS_PUBLIC_LIMIT} public listings. Remove one before adding another.`,
        );
        setCreating(false);
        return;
      }

      const channelId = await channelService.createChannel(
        channelName,
        description,
        myPublicKey,
        userName,
        isPublic,
        avatar,
      );

      // Invite selected subscribers
      for (const pk of selected) {
        try {
          const person = people.find((p) => p.publickey === pk);
          const name = person?.extradata?.name || person?.currentaddress || pk;
          await channelService.inviteSubscriber(
            channelId,
            pk,
            name,
            myPublicKey,
            userName,
          );
        } catch (inviteErr) {
          console.error("⚠️ [CreateChannel] Failed to invite", pk, inviteErr);
        }
      }

      navigate({ to: "/" });
    } catch (err) {
      console.error("❌ [CreateChannel] Error:", err);
      alert("Failed to create channel. Please try again.");
    } finally {
      setCreating(false);
    }
  };

  const filtered = people.filter((p) => {
    const matchesSearch = (p.extradata?.name || p.currentaddress)
      .toLowerCase()
      .includes(searchQuery.toLowerCase());
    if (!matchesSearch) return false;
    if (activeTab === "contacts") return p.type === "contact";
    if (activeTab === "community") return p.type === "community";
    return true;
  });

  return (
    <div className="h-full flex flex-col bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <div className="bg-primary-600 dark:bg-gray-800 text-white p-4 flex items-center gap-3 shadow-sm border-b dark:border-gray-700">
        <button
          onClick={() => navigate({ to: "/" })}
          className="p-2 hover:bg-white/10 dark:hover:bg-gray-700 rounded-full transition-colors"
        >
          <ArrowLeft size={24} />
        </button>
        <Radio size={20} className="opacity-80" />
        <h1 className="text-xl font-bold">Create Channel</h1>
      </div>

      <div className="flex-1 overflow-y-auto p-4 pb-20">
        <div className="max-w-2xl mx-auto space-y-6">
          {/* Info banner */}
          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4 text-sm text-blue-700 dark:text-blue-300">
            <p className="font-semibold mb-1">📢 What is a Channel?</p>
            <p>
              Channels are broadcast spaces. Only you (the admin) can publish
              messages. Subscribers can read but not reply.
            </p>
          </div>

          {/* Channel details */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-4 space-y-4">
            <div className="flex flex-col items-center gap-3">
              <input
                type="file"
                ref={fileInputRef}
                className="hidden"
                accept="image/*"
                onChange={handleAvatarFileSelect}
              />

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={processingAvatar}
                className="relative group/avatar"
              >
                <div className="w-24 h-24 rounded-full overflow-hidden bg-gray-100 dark:bg-gray-700 shadow-md flex items-center justify-center">
                  {avatar ? (
                    <img
                      src={avatar}
                      alt={channelName || "Channel avatar"}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <Radio
                      size={32}
                      className="text-sky-600 dark:text-sky-400"
                    />
                  )}
                </div>
                <div className="absolute inset-0 rounded-full bg-black/35 text-white flex items-center justify-center opacity-0 group-hover/avatar:opacity-100 transition-opacity">
                  {processingAvatar ? (
                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-white"></div>
                  ) : (
                    <Camera size={22} />
                  )}
                </div>
              </button>

              <div className="text-center">
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  Channel Image
                </p>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={processingAvatar}
                  className="text-xs text-sky-600 dark:text-sky-400 hover:underline disabled:opacity-50"
                >
                  {avatar ? "Change image" : "Upload image"}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Channel Name *
              </label>
              <input
                type="text"
                value={channelName}
                onChange={(e) => setChannelName(e.target.value)}
                placeholder="e.g. Announcements, News, Updates..."
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 text-gray-900 dark:text-white bg-white dark:bg-gray-700 placeholder-gray-400 dark:placeholder-gray-500"
                maxLength={50}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Description (optional)
              </label>
              <div className="relative">
                <textarea
                  value={description}
                  onChange={(e) => {
                    if (e.target.value.length <= 255)
                      setDescription(e.target.value);
                  }}
                  placeholder="What is this channel about?"
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 text-gray-900 dark:text-white bg-white dark:bg-gray-700 placeholder-gray-400 dark:placeholder-gray-500 resize-none pr-12"
                  rows={3}
                  maxLength={255}
                />
                <span
                  className={`absolute bottom-2 right-2 text-[10px] font-medium ${description.length >= 240 ? "text-red-500" : "text-gray-400"}`}
                >
                  {description.length}/255
                </span>
              </div>
            </div>

            <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-900/50 rounded-xl border border-gray-100 dark:border-gray-700">
              <div className="flex flex-col">
                <span className="text-sm font-semibold text-gray-900 dark:text-white">
                  Public Listing
                </span>
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  Make this channel discoverable via gossip
                </span>
              </div>
              <button
                onClick={async () => {
                  if (!isPublic) {
                    const count = await getPublicListingsCount();
                    setPublicCount(count);
                    if (count >= LISTINGS_PUBLIC_LIMIT) {
                      setPublicError(
                        `You already have ${LISTINGS_PUBLIC_LIMIT} public listings. Remove one before adding another.`,
                      );
                      return;
                    }
                  }
                  setPublicError("");
                  setIsPublic(!isPublic);
                }}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
                  isPublic ? "bg-primary-600" : "bg-gray-300 dark:bg-gray-600"
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    isPublic ? "translate-x-6" : "translate-x-1"
                  }`}
                />
              </button>
            </div>
            {publicError && (
              <div className="text-xs text-red-600 dark:text-red-400">
                {publicError}
              </div>
            )}
            <div className="text-xs text-gray-500 dark:text-gray-400">
              Public listings used: {publicCount}/{LISTINGS_PUBLIC_LIMIT}
            </div>
          </div>

          {/* Create button */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-4">
            <button
              onClick={handleCreate}
              disabled={!channelName.trim() || selected.size === 0 || creating}
              className="w-full py-3 bg-primary-600 text-white rounded-lg font-medium hover:bg-primary-700 transition-colors disabled:bg-gray-300 disabled:text-gray-100 disabled:cursor-not-allowed dark:disabled:bg-gray-700 dark:disabled:text-gray-400 shadow-md"
            >
              {creating
                ? "Creating..."
                : selected.size > 0
                  ? `Create Channel with ${selected.size} subscriber${selected.size !== 1 ? "s" : ""}`
                  : "Select subscribers to continue"}
            </button>
          </div>

          {/* Subscribers selector */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-4">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">
              Add Subscribers ({selected.size} selected)
            </h2>

            {/* Tabs */}
            <div className="flex gap-2 mb-4 border-b border-gray-200 dark:border-gray-700">
              {(["all", "contacts", "community"] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`pb-2 px-3 text-sm font-medium capitalize transition-colors relative ${
                    activeTab === tab
                      ? "text-sky-600 dark:text-sky-400 border-b-2 border-sky-600 dark:border-sky-400 -mb-px"
                      : "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>

            {/* Search */}
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search..."
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 text-gray-900 dark:text-white bg-white dark:bg-gray-700 placeholder-gray-400 dark:placeholder-gray-500 mb-4"
            />

            <div className="space-y-2 max-h-96 overflow-y-auto">
              {filtered.length === 0 ? (
                <p className="text-gray-500 dark:text-gray-400 text-center py-8">
                  No people found
                </p>
              ) : (
                filtered.map((person) => {
                  const isSelected = selected.has(person.publickey);
                  const avatar = person.extradata?.icon
                    ? decodeURIComponent(person.extradata.icon)
                    : defaultAvatar;
                  const name = person.extradata?.name || person.currentaddress;

                  return (
                    <div
                      key={person.publickey}
                      onClick={() => toggle(person.publickey)}
                      className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors ${
                        isSelected
                          ? "bg-sky-50 dark:bg-sky-900/30 border-2 border-sky-500 dark:border-sky-500"
                          : "bg-gray-50 dark:bg-gray-700/50 border-2 border-transparent hover:bg-gray-100 dark:hover:bg-gray-600"
                      }`}
                    >
                      <img
                        src={
                          avatar.startsWith("data:image")
                            ? avatar
                            : defaultAvatar
                        }
                        alt={name}
                        className="w-10 h-10 rounded-full object-cover"
                        onError={(e: any) => {
                          e.target.src = defaultAvatar;
                        }}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-gray-900 dark:text-white truncate">
                          {name}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          {person.type === "contact" ? "Contact" : "Community"}
                        </p>
                      </div>
                      {isSelected && (
                        <div className="w-6 h-6 bg-sky-600 rounded-full flex items-center justify-center flex-shrink-0">
                          <Check size={14} className="text-white" />
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
