import { createFileRoute } from "@tanstack/react-router";
import { useContext, useEffect, useState } from "react";
import { MDS } from "@minima-global/mds";
import { appContext } from "../AppContext";
import { User, ChevronDown, ChevronUp, Copy, Check, Edit2, Globe, Palette, Shield, AlertTriangle, RefreshCw, Info } from "lucide-react";

export const Route = createFileRoute("/settings")({
  component: Settings,
});

const defaultAvatar = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23cbd5e1'%3E%3Cpath d='M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z'/%3E%3C/svg%3E";

function Settings() {
  const { loaded, updateUserProfile, writeMode, refreshWriteMode } = useContext(appContext);


  // Profile State
  const [userName, setUserName] = useState("User");
  const [userAvatar, setUserAvatar] = useState(defaultAvatar);
  const [maximaAddress, setMaximaAddress] = useState("");
  const [minimaAddress, setMinimaAddress] = useState("");
  const [expandedAddress, setExpandedAddress] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [editNameValue, setEditNameValue] = useState("");
  const [showAvatarDialog, setShowAvatarDialog] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState("");
  const [avatarFileSize, setAvatarFileSize] = useState(0);

  // Community & Discovery State
  const [staticMLSServer, setStaticMLSServer] = useState("");
  const [hasStaticMLS, setHasStaticMLS] = useState(false);
  const [hasPermanentAddress, setHasPermanentAddress] = useState(false);
  const [permanentAddress, setPermanentAddress] = useState("");
  const [profileVisible, setProfileVisible] = useState(true);
  const [configuringMLS, setConfiguringMLS] = useState(false);
  const [enablingPermanent, setEnablingPermanent] = useState(false);
  const [p2pIdentity, setP2pIdentity] = useState("");

  // L1 Profile State Tracking
  const [l1Name, setL1Name] = useState("");
  const [originalL1Name, setOriginalL1Name] = useState("");
  const [originalProfileDescription, setOriginalProfileDescription] = useState("");
  const [originalProfileVisible, setOriginalProfileVisible] = useState(true);
  const [showReadModeWarning, setShowReadModeWarning] = useState(false);

  // Extended Profile Fields
  const [profileDescription, setProfileDescription] = useState("");
  const [profileLocation, setProfileLocation] = useState("");
  const [profileWebsite, setProfileWebsite] = useState("");
  const [profileBio, setProfileBio] = useState("");
  const [showLocation, setShowLocation] = useState(true);
  const [showWebsite, setShowWebsite] = useState(true);
  const [showBio, setShowBio] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);

  // Network Status State
  const [networkStatus, setNetworkStatus] = useState<any>(null);
  const [networkLoading, setNetworkLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<number>(Date.now());

  useEffect(() => {
    if (!loaded) return;

    const fetchProfile = async () => {
      try {
        // Fetch Maxima Info (Name, Icon, Maxima Address)
        const infoRes = await MDS.cmd.maxima({ params: { action: "info" } });
        const info = (infoRes.response as any) || {};

        if (info) {
          const name = info.name || "User";
          setUserName(name);
          if (info.icon) {
            const decodedIcon = decodeURIComponent(info.icon);
            // Check if it's a valid data URL, and not a URL ending in /0x00 (no photo)
            if (decodedIcon.startsWith("data:image") && !decodedIcon.includes("/0x00")) {
              setUserAvatar(decodedIcon);
            } else {
              setUserAvatar(defaultAvatar);
            }
          }
          setMaximaAddress(info.contact || "");
        }

        // Fetch Minima Address (for receiving tokens)
        const newAddr = await MDS.cmd.getaddress();
        if ((newAddr.response as any)?.miniaddress) {
          setMinimaAddress((newAddr.response as any).miniaddress);
        }

      } catch (err) {
        console.error("Error fetching profile:", err);
      }
    };

    fetchProfile();
    fetchProfile();

    // Fetch network status
    fetchNetworkStatus();

    // Fetch community status
    fetchCommunityStatus();

    // Refresh write mode status using checkmode (doesn't create pending)
    console.log("🔄 [Settings] Calling refreshWriteMode...");
    refreshWriteMode();
  }, [loaded, refreshWriteMode]);

  // Handle hash-based scrolling
  useEffect(() => {
    const handleHashChange = async () => {
      const hash = window.location.hash;
      console.log('🔍 [Settings] Hash detected:', hash);

      if (hash === '#community-discovery') {
        // Increased delay to ensure the DOM and state are fully rendered
        setTimeout(async () => {
          console.log('⏰ [Settings] Timeout triggered, checking element...');
          const element = document.querySelector(hash);

          if (element) {
            console.log('✅ [Settings] Element found, scrolling...');
            element.scrollIntoView({ behavior: 'smooth', block: 'start' });

            // Check if Static MLS is configured to decide if we should expand the section
            try {
              console.log('🔍 [Settings] Checking Static MLS status...');
              const maximaInfo = await MDS.cmd.maxima();
              const info = (maximaInfo.response as any) || {};

              console.log('📊 [Settings] Static MLS status:', info.staticmls);

              // If no Static MLS configured, expand the section
              if (!info.staticmls) {
                console.log('🔓 [Settings] Expanding Static MLS section...');
                setExpandedAddress('staticMLS');
              } else {
                console.log('✅ [Settings] Static MLS already configured, keeping section collapsed');
              }
            } catch (err) {
              console.error('❌ [Settings] Error checking Static MLS:', err);
              // On error, expand the section to be safe
              console.log('🔓 [Settings] Expanding section due to error...');
              setExpandedAddress('staticMLS');
            }

            // Clear the hash after processing to prevent re-triggering on page refresh
            setTimeout(() => {
              console.log('🧹 [Settings] Clearing hash from URL...');
              window.history.replaceState(null, '', window.location.pathname);
            }, 500);
          } else {
            console.warn('⚠️ [Settings] Element not found for hash:', hash);
          }
        }, 300); // Increased from 100ms to 300ms
      }
    };

    // Check hash on mount
    handleHashChange();

    // Listen for hash changes
    window.addEventListener('hashchange', handleHashChange);

    return () => {
      window.removeEventListener('hashchange', handleHashChange);
    };
  }, []);

  const fetchCommunityStatus = async () => {
    try {
      const maximaInfo = await MDS.cmd.maxima();
      const info = (maximaInfo.response as any) || {};

      // Store P2P identity for MLS server section
      setP2pIdentity(info.p2pidentity || "");

      // Check if Static MLS is configured
      setHasStaticMLS(info.staticmls || false);

      if (info.staticmls && info.mls) {
        setStaticMLSServer(info.mls);

        // Build permanent MAX# address
        const maxAddress = `MAX#${info.publickey}#${info.mls}`;
        setPermanentAddress(maxAddress);

        // Check if permanent address is enabled (we assume it's enabled if staticmls is true)
        // In a real implementation, you'd verify this with maxextra or another check
        setHasPermanentAddress(true);

        // Load existing profile from blockchain
        await fetchCommunityProfile();
      }
    } catch (err) {
      console.error("Error fetching community status:", err);
    }
  };

  const fetchCommunityProfile = async () => {
    try {
      const { DiscoveryService } = await import('../services/discovery.service');
      const profiles = await DiscoveryService.getProfiles();
      const myProfile = profiles.find(p => p.isMyProfile);

      if (myProfile) {
        // Load extended data if available
        if (myProfile.extraData) {
          setProfileLocation(myProfile.extraData.location || "");
          setProfileWebsite(myProfile.extraData.website || "");
          setProfileBio(myProfile.extraData.bio || "");
        }

        const name = myProfile.username || "";
        const desc = myProfile.description || "";
        const visible = myProfile.visible !== false;

        setL1Name(name);
        setProfileDescription(desc);
        setProfileVisible(visible);

        // Set original values for dirty checking
        setOriginalL1Name(name);
        setOriginalProfileDescription(desc);
        setOriginalProfileVisible(visible);
      }
    }

    catch (err) {
      console.error("Error fetching community profile:", err);
    }
  };

  const executeL1Update = async () => {
    try {
      setSavingProfile(true);
      const { DiscoveryService } = await import('../services/discovery.service');

      // Update L1 Profile
      await DiscoveryService.updateL1Profile(
        l1Name,
        profileDescription,
        profileVisible
      );

      setOriginalL1Name(l1Name);
      setOriginalProfileDescription(profileDescription);
      setOriginalProfileVisible(profileVisible);

      console.log("✅ [Settings] L1 Profile updated successfully");
      alert("✅ L1 Profile updated successfully!");
    } catch (err) {
      console.error("❌ [Settings] Error updating L1 profile:", err);
      alert("Failed to update L1 profile: " + (err as Error).message);
    } finally {
      setSavingProfile(false);
      setShowReadModeWarning(false);
    }
  };

  const handleUpdateL1Profile = async () => {
    console.log("🖱️ [Settings] Update L1 Profile clicked. WriteMode:", writeMode);
    if (!hasPermanentAddress) {
      alert("⚠️ Please enable permanent address first");
      return;
    }

    if (!writeMode) {
      setShowReadModeWarning(true);
      return;
    }

    await executeL1Update();
  };

  const handleUpdateExtendedProfile = async () => {
    if (!hasPermanentAddress) {
      alert("⚠️ Please enable permanent address first");
      return;
    }

    setSavingProfile(true);
    try {
      console.log("💾 [Settings] Updating Extended profile...");
      const { DiscoveryService } = await import('../services/discovery.service');

      // Build extraData based on visibility toggles
      const extraData: any = {};
      if (showLocation && profileLocation.trim()) {
        extraData.location = profileLocation.trim();
      }
      if (showWebsite && profileWebsite.trim()) {
        extraData.website = profileWebsite.trim();
      }
      if (showBio && profileBio.trim()) {
        extraData.bio = profileBio.trim();
      }

      await DiscoveryService.updateExtendedProfile(
        Object.keys(extraData).length > 0 ? extraData : undefined
      );

      console.log("✅ [Settings] Extended Profile updated successfully");
      alert("✅ Extended Profile updated successfully!");
    } catch (err) {
      console.error("❌ [Settings] Error updating extended profile:", err);
      alert("Failed to update extended profile: " + (err as Error).message);
    } finally {
      setSavingProfile(false);
    }
  };

  const handleConfigureStaticMLS = async () => {
    if (!staticMLSServer.trim()) {
      alert("Please enter a Static MLS server address");
      return;
    }

    setConfiguringMLS(true);
    try {
      const cmd = `maxextra action:staticmls host:${staticMLSServer.trim()}`;
      const response = await new Promise<any>((resolve, reject) => {
        MDS.executeRaw(cmd, (res: any) => {
          if (res.status) {
            resolve(res);
          } else {
            reject(new Error(res.error || 'Failed to configure Static MLS'));
          }
        });
      });

      console.log("✅ [Settings] Static MLS configured:", response);
      await fetchCommunityStatus(); // Refresh status
      alert("✅ Static MLS configured successfully!");
    } catch (err) {
      console.error("❌ [Settings] Error configuring Static MLS:", err);
      alert("Failed to configure Static MLS: " + (err as Error).message);
    } finally {
      setConfiguringMLS(false);
    }
  };

  const handleEnablePermanentAddress = async () => {
    if (!hasStaticMLS) {
      alert("⚠️ Please configure Static MLS first");
      return;
    }

    setEnablingPermanent(true);
    try {
      const maximaInfo = await MDS.cmd.maxima();
      const publickey = (maximaInfo.response as any)?.publickey;

      if (!publickey) {
        throw new Error("Unable to get public key");
      }

      const cmd = `maxextra action:addpermanent publickey:${publickey}`;
      const response = await new Promise<any>((resolve, reject) => {
        MDS.executeRaw(cmd, (res: any) => {
          if (res.status) {
            resolve(res);
          } else {
            reject(new Error(res.error || 'Failed to enable permanent address'));
          }
        });
      });

      console.log("✅ [Settings] Permanent address enabled:", response);
      await fetchCommunityStatus(); // Refresh status
      alert("✅ Permanent MAX# address enabled!\n\nYou can now join the Community Discovery.");
    } catch (err) {
      console.error("❌ [Settings] Error enabling permanent address:", err);
      alert("Failed to enable permanent address: " + (err as Error).message);
    } finally {
      setEnablingPermanent(false);
    }
  };

  const fetchNetworkStatus = async () => {
    try {
      setNetworkLoading(true);
      const statusRes = await MDS.cmd.status();
      setNetworkStatus(statusRes.response);
      setLastUpdated(Date.now());
    } catch (err) {
      console.error("Error fetching network status:", err);
    } finally {
      setNetworkLoading(false);
    }
  };



  const handleEditName = async () => {
    console.log("[Settings] Opening edit dialog");
    setEditNameValue(userName);
    setShowEditDialog(true);
  };

  const handleSaveName = async () => {
    console.log("[Settings] Saving name:", editNameValue);
    if (editNameValue && editNameValue.trim() !== "") {
      try {
        console.log("[Settings] Attempting to set name to:", editNameValue.trim());

        // Use modern MDS API
        const response = await MDS.cmd.maxima({
          params: {
            action: "setname",
            name: editNameValue.trim()
          } as any
        });

        console.log("[Settings] MDS response:", response);

        if (response && (response as any).status === false) {
          throw new Error((response as any).error || "Failed to set name");
        }

        console.log("[Settings] Name set successfully, updating state");
        setUserName(editNameValue.trim());
        // Update global context to sync with Header and SideMenu
        updateUserProfile(editNameValue.trim(), userAvatar);
        setShowEditDialog(false);
      } catch (err) {
        console.error("[Settings] Error setting name:", err);
        alert("Failed to update name: " + (err as Error).message);
      }
    }
  };

  const handleEditAvatar = () => {
    setAvatarUrl(userAvatar);
    setAvatarFileSize(0);
    setShowAvatarDialog(true);
  };

  const compressImage = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let width = img.width;
          let height = img.height;

          // Resize if too large (max 800x800)
          const maxSize = 800;
          if (width > maxSize || height > maxSize) {
            if (width > height) {
              height = (height / width) * maxSize;
              width = maxSize;
            } else {
              width = (width / height) * maxSize;
              height = maxSize;
            }
          }

          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx?.drawImage(img, 0, 0, width, height);

          // Compress to JPEG with quality 0.8
          const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.8);
          resolve(compressedDataUrl);
        };
        img.onerror = reject;
        img.src = e.target?.result as string;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const handleSaveAvatar = async () => {
    console.log("[Settings] Saving avatar, file size:", avatarFileSize);

    if (avatarUrl && avatarUrl.trim() !== "") {
      try {
        const encodedIcon = encodeURIComponent(avatarUrl.trim());
        console.log("[Settings] Encoded icon length:", encodedIcon.length);
        console.log("[Settings] Attempting to set avatar...");

        // Use modern MDS API
        const response = await MDS.cmd.maxima({
          params: {
            action: "seticon",
            icon: encodedIcon
          } as any
        });

        console.log("[Settings] MDS full response:", JSON.stringify(response, null, 2));
        console.log("[Settings] Response status:", (response as any)?.status);
        console.log("[Settings] Response error:", (response as any)?.error);

        if (!response || (response as any).status === false) {
          const errorMsg = (response as any)?.error || "Failed to set avatar - no response";
          console.error("[Settings] Error:", errorMsg);
          throw new Error(errorMsg);
        }

        console.log("[Settings] Avatar set successfully, updating state");
        setUserAvatar(avatarUrl.trim());
        // Update global context to sync with Header and SideMenu
        updateUserProfile(userName, avatarUrl.trim());
        setShowAvatarDialog(false);
      } catch (err) {
        console.error("[Settings] Error setting avatar:", err);
        alert("Failed to update avatar: " + (err as Error).message);
      }
    }
  };

  const copyToClipboard = (text: string, fieldId: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(fieldId);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const toggleAddress = (id: string) => {
    setExpandedAddress(expandedAddress === id ? null : id);
  };

  return (
    <>
      {/* Read Mode Warning Modal */}
      {showReadModeWarning && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-xl w-96 max-w-full mx-4">
            <div className="flex items-center gap-3 mb-4 text-yellow-600 dark:text-yellow-500">
              <AlertTriangle size={24} />
              <h3 className="text-xl font-bold text-gray-900 dark:text-white">Read Mode Active</h3>
            </div>

            <p className="text-gray-600 dark:text-gray-300 mb-6 leading-relaxed">
              This action will create a <strong>PENDING transaction</strong>.
              <br /><br />
              You will need to go to the <strong>Minima app</strong> to approve it manually.
            </p>

            <div className="flex justify-end space-x-3">
              <button
                onClick={() => setShowReadModeWarning(false)}
                className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={executeL1Update}
                className="px-4 py-2 bg-yellow-500 hover:bg-yellow-600 text-white rounded-md transition-colors font-medium"
              >
                Proceed & Create Pending
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Name Dialog */}
      {showEditDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-xl w-96 max-w-full mx-4">
            <h3 className="text-xl font-bold mb-4 text-gray-900 dark:text-white">Edit Display Name</h3>

            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Display Name</label>
              <input
                type="text"
                value={editNameValue}
                onChange={(e) => setEditNameValue(e.target.value)}
                className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:outline-none"
                placeholder="Enter your name"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveName();
                  if (e.key === 'Escape') setShowEditDialog(false);
                }}
              />
            </div>

            <div className="flex justify-end space-x-3">
              <button
                onClick={() => setShowEditDialog(false)}
                className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveName}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors font-medium"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Avatar Dialog */}
      {showAvatarDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-xl w-96 max-w-full mx-4">
            <h3 className="text-xl font-bold mb-4 text-gray-900 dark:text-white">Edit Avatar</h3>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Select Image</label>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">Choose an image from your device (will be compressed to 800x800)</p>
              <input
                type="file"
                accept="image/*"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    setAvatarFileSize(file.size);
                    try {
                      const compressedUrl = await compressImage(file);
                      setAvatarUrl(compressedUrl);
                    } catch (err) {
                      console.error("Error compressing image:", err);
                    }
                  }
                }}
                className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 dark:file:bg-blue-900/30 dark:file:text-blue-300"
              />
            </div>

            {avatarUrl && (
              <div className="mb-4 flex justify-center">
                <img src={avatarUrl} alt="Preview" className="w-24 h-24 rounded-full object-cover border-2 border-gray-200 dark:border-gray-600" onError={(e) => (e.target as HTMLImageElement).style.display = 'none'} />
              </div>
            )}

            <div className="flex justify-end space-x-3">
              <button
                onClick={() => setShowAvatarDialog(false)}
                className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveAvatar}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors font-medium"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}



      <div className="h-full overflow-y-auto bg-gray-50">
        <div className="max-w-4xl mx-auto p-4 md:p-8 min-h-full">

          <div className="grid gap-6">

            {/* PROFILE SECTION */}
            <section className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
              <div className="p-6 border-b border-gray-100 flex items-center gap-3">
                <User className="text-blue-500" />
                <h2 className="text-xl font-semibold text-gray-800">Profile</h2>
              </div>

              {/* User Info - Full Width */}
              <div className="p-6 border-b border-gray-100 flex items-center gap-4">
                <div className="relative">
                  <img
                    src={userAvatar}
                    alt="Avatar"
                    className="w-16 h-16 rounded-full object-cover border-4 border-gray-100"
                    onError={(e) => (e.target as HTMLImageElement).src = defaultAvatar}
                  />
                  <button
                    onClick={handleEditAvatar}
                    className="absolute -bottom-1 -right-1 p-1.5 bg-blue-600 text-white rounded-full hover:bg-blue-700 transition-colors shadow-lg"
                    title="Change Avatar"
                  >
                    <Edit2 size={12} />
                  </button>
                </div>
                <div className="flex-1 flex items-center gap-2">
                  <h3 className="text-lg font-bold text-gray-900">{userName}</h3>
                  <button
                    onClick={handleEditName}
                    className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-full transition-colors"
                    title="Edit Maxima Name"
                  >
                    <Edit2 size={14} />
                  </button>
                </div>
                <p className="text-sm text-gray-500">Visible to your contacts</p>
              </div>


              {/* Extended Profile Information */}
              {hasPermanentAddress && (
                <div className="border-b border-gray-100">


                  {/* Extended Profile Section */}
                  <div className="px-6 py-4 bg-gray-50/50 border-b border-gray-100">
                    <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider">Extended Profile</h3>
                  </div>

                  <div className="p-6 space-y-5">
                    <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-800 flex items-start gap-2">
                      <Info size={16} className="mt-0.5 flex-shrink-0" />
                      <p>Updates here are free! Data is stored locally and shared via Maxima.</p>
                    </div>

                    {/* Location */}
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <label className="text-sm font-medium text-gray-700">Location</label>
                        <label className="relative inline-flex items-center cursor-pointer">
                          <input
                            type="checkbox"
                            checked={showLocation}
                            onChange={(e) => setShowLocation(e.target.checked)}
                            className="sr-only peer"
                          />
                          <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                          <span className="ml-3 text-xs text-gray-600">Show in profile</span>
                        </label>
                      </div>
                      <input
                        type="text"
                        value={profileLocation}
                        onChange={(e) => setProfileLocation(e.target.value)}
                        placeholder="e.g., Barcelona, Spain"
                        className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none text-sm text-gray-700 bg-white"
                      />
                    </div>

                    {/* Website */}
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <label className="text-sm font-medium text-gray-700">Website</label>
                        <label className="relative inline-flex items-center cursor-pointer">
                          <input
                            type="checkbox"
                            checked={showWebsite}
                            onChange={(e) => setShowWebsite(e.target.checked)}
                            className="sr-only peer"
                          />
                          <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                          <span className="ml-3 text-xs text-gray-600">Show in profile</span>
                        </label>
                      </div>
                      <input
                        type="url"
                        value={profileWebsite}
                        onChange={(e) => setProfileWebsite(e.target.value)}
                        placeholder="https://example.com"
                        className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none text-sm text-gray-700 bg-white"
                      />
                    </div>

                    {/* Bio */}
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <label className="text-sm font-medium text-gray-700">Bio</label>
                        <label className="relative inline-flex items-center cursor-pointer">
                          <input
                            type="checkbox"
                            checked={showBio}
                            onChange={(e) => setShowBio(e.target.checked)}
                            className="sr-only peer"
                          />
                          <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                          <span className="ml-3 text-xs text-gray-600">Show in profile</span>
                        </label>
                      </div>
                      <textarea
                        value={profileBio}
                        onChange={(e) => setProfileBio(e.target.value)}
                        placeholder="Tell the community about yourself..."
                        rows={3}
                        className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none text-sm resize-none text-gray-700 bg-white"
                      />
                    </div>

                    {/* Save Button */}
                    <button
                      onClick={handleUpdateExtendedProfile}
                      disabled={savingProfile}
                      className="w-full py-2.5 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                      {savingProfile ? (
                        <>
                          <RefreshCw size={18} className="animate-spin" />
                          Saving...
                        </>
                      ) : (
                        <>
                          <Check size={18} />
                          Update Extended Profile
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}

              {/* Maxima Address - Full Width */}
              <div className="border-b border-gray-100">
                <button
                  onClick={() => toggleAddress('maxima')}
                  className="w-full flex items-center justify-between p-6 hover:bg-gray-50 transition-colors text-left"
                >
                  <span className="font-medium text-gray-700">My Maxima Address</span>
                  {expandedAddress === 'maxima' ? <ChevronUp size={20} className="text-gray-500" /> : <ChevronDown size={20} className="text-gray-500" />}
                </button>

                {expandedAddress === 'maxima' && (
                  <div className="px-6 pb-6 pt-0">
                    <p className="text-xs font-mono text-gray-600 break-all mb-3 bg-gray-50 p-3 rounded border border-gray-100">
                      {maximaAddress || "Loading..."}
                    </p>
                    <button
                      onClick={() => copyToClipboard(maximaAddress, 'maxima')}
                      className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${copiedField === 'maxima' ? 'bg-green-100 text-green-700' : 'bg-blue-50 text-blue-600 hover:bg-blue-100'}`}
                    >
                      {copiedField === 'maxima' ? <Check size={16} /> : <Copy size={16} />}
                      {copiedField === 'maxima' ? 'Copied!' : 'Copy Address'}
                    </button>
                  </div>
                )}
              </div>

              {/* Minima Address - Full Width */}
              <div>
                <button
                  onClick={() => toggleAddress('minima')}
                  className="w-full flex items-center justify-between p-6 hover:bg-gray-50 transition-colors text-left"
                >
                  <span className="font-medium text-gray-700">My Minima Address</span>
                  {expandedAddress === 'minima' ? <ChevronUp size={20} className="text-gray-500" /> : <ChevronDown size={20} className="text-gray-500" />}
                </button>

                {expandedAddress === 'minima' && (
                  <div className="px-6 pb-6 pt-0">
                    <p className="text-xs font-mono text-gray-600 break-all mb-3 bg-gray-50 p-3 rounded border border-gray-100">
                      {minimaAddress || "Loading..."}
                    </p>
                    <button
                      onClick={() => copyToClipboard(minimaAddress, 'minima')}
                      className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${copiedField === 'minima' ? 'bg-green-100 text-green-700' : 'bg-blue-50 text-blue-600 hover:bg-blue-100'}`}
                    >
                      {copiedField === 'minima' ? <Check size={16} /> : <Copy size={16} />}
                      {copiedField === 'minima' ? 'Copied!' : 'Copy Address'}
                    </button>
                  </div>
                )}
              </div>
            </section>

            {/* APPLICATION MODE SECTION */}
            <section className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
              <div className="p-6 border-b border-gray-100 flex items-center gap-3">
                <Shield className={writeMode ? "text-green-500" : "text-yellow-500"} />
                <h2 className="text-xl font-semibold text-gray-800">Application Mode</h2>
              </div>
              <div className="p-6">
                <div className={`flex items-center gap-3 p-4 rounded-xl mb-4 ${writeMode ? 'bg-green-50 border border-green-100' : 'bg-yellow-50 border border-yellow-100'}`}>
                  {writeMode ? (
                    <div className="p-2 bg-green-100 rounded-full text-green-600">
                      <Check size={20} />
                    </div>
                  ) : (
                    <div className="p-2 bg-yellow-100 rounded-full text-yellow-600">
                      <AlertTriangle size={20} />
                    </div>
                  )}
                  <div>
                    <h3 className={`font-semibold ${writeMode ? 'text-green-800' : 'text-yellow-800'}`}>
                      {writeMode ? 'Write Mode Active' : 'Read Mode Active'}
                    </h3>
                    <p className={`text-sm ${writeMode ? 'text-green-600' : 'text-yellow-600'}`}>
                      {writeMode
                        ? 'CharmChain has full permission to send messages and tokens.'
                        : 'CharmChain needs your approval for every transaction.'}
                    </p>
                  </div>
                </div>

                {!writeMode && (
                  <div className="space-y-4">
                    <p className="text-gray-600 text-sm leading-relaxed">
                      To enable <strong>Write Mode</strong> and avoid repeated approval requests:
                    </p>
                    <ol className="list-decimal list-inside text-sm text-gray-600 space-y-2 pl-2">
                      <li>Go to <strong>Minima</strong> main screen</li>
                      <li>Open <strong>MiniDapps</strong></li>
                      <li>Find <strong>CharmChain</strong></li>
                      <li>Click the <strong>lock icon</strong> / permissions</li>
                      <li>Select <strong>Write Mode</strong></li>
                    </ol>

                    <button
                      onClick={async () => {
                        console.log("🔄 [Settings] Manual refresh button clicked");
                        await refreshWriteMode();
                      }}
                      className="w-full mt-2 py-2.5 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 transition-colors flex items-center justify-center gap-2"
                    >
                      <RefreshCw size={18} />
                      Check Permissions Again
                    </button>
                  </div>
                )}
              </div>
            </section>

            {/* COMMUNITY & DISCOVERY SECTION */}
            <section id="community-discovery" className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden scroll-mt-4">
              <div className="p-6 border-b border-gray-100 flex items-center gap-3">
                <Globe className="text-blue-500" />
                <h2 className="text-xl font-semibold text-gray-800">Community & Discovery</h2>
              </div>


              <div className="p-6 space-y-6">
                {/* L1 Profile Section */}
                {hasPermanentAddress && (
                  <div className="border border-gray-200 rounded-lg overflow-hidden">
                    <div className="px-6 py-4 bg-gray-50/50 border-b border-gray-200">
                      <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider">L1 Profile (Blockchain)</h3>
                    </div>
                    <div className="p-6 space-y-5">
                      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-sm text-yellow-800 flex items-start gap-2">
                        <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
                        <p>Updating this section creates a transaction on the blockchain and costs a small fee.</p>
                      </div>

                      {/* Display Name */}
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Display Name</label>
                        <input
                          type="text"
                          value={l1Name}
                          onChange={(e) => setL1Name(e.target.value)}
                          placeholder="Your public display name"
                          className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all bg-white text-gray-700"
                        />
                        <p className="text-xs text-gray-500 mt-1">This name is stored on the blockchain and visible to everyone.</p>
                      </div>

                      {/* Description */}
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Description (Tagline)</label>
                        <input
                          type="text"
                          value={profileDescription}
                          onChange={(e) => setProfileDescription(e.target.value)}
                          placeholder="Short description or tagline..."
                          className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none text-sm text-gray-700 bg-white"
                        />
                      </div>

                      {/* Visibility Toggle */}
                      <div className="flex items-center justify-between p-4 rounded-lg border bg-gray-50 border-gray-200">
                        <div>
                          <p className="font-medium text-gray-800 text-sm">
                            {profileVisible ? 'Visible in Community' : 'Hidden from Community'}
                          </p>
                          <p className="text-xs text-gray-600 mt-1">
                            {profileVisible
                              ? 'Other users can discover and contact you'
                              : 'You are hidden from Community Discovery'}
                          </p>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer">
                          <input
                            type="checkbox"
                            checked={profileVisible}
                            onChange={(e) => setProfileVisible(e.target.checked)}
                            className="sr-only peer"
                          />
                          <div className="w-11 h-6 bg-gray-300 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                        </label>
                      </div>

                      <button
                        onClick={handleUpdateL1Profile}
                        disabled={savingProfile || (
                          l1Name === originalL1Name &&
                          profileDescription === originalProfileDescription &&
                          profileVisible === originalProfileVisible
                        )}
                        className="w-full py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                      >
                        {savingProfile ? (
                          <>
                            <RefreshCw size={18} className="animate-spin" />
                            Updating L1...
                          </>
                        ) : (
                          <>
                            <Check size={18} />
                            Update L1 Profile
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                )}

                {/* MLS Server (for Development) */}
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Info className="text-blue-600" size={20} />
                    <h3 className="text-lg font-semibold text-blue-900">Use This Node as MLS Server</h3>
                  </div>
                  <p className="text-sm text-blue-800 mb-3">
                    For development/testing, other nodes can use this node as their Static MLS server.
                  </p>

                  {p2pIdentity ? (
                    <>
                      <div className="bg-white rounded border border-blue-200 p-3 mb-3">
                        <p className="text-xs text-blue-600 mb-1 font-semibold">Your P2P Identity:</p>
                        <p className="text-xs font-mono text-gray-800 break-all">{p2pIdentity}</p>
                      </div>
                      <button
                        onClick={() => copyToClipboard(p2pIdentity, 'p2p')}
                        className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${copiedField === 'p2p' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700 hover:bg-blue-200 border border-blue-300'}`}
                      >
                        {copiedField === 'p2p' ? <Check size={16} /> : <Copy size={16} />}
                        {copiedField === 'p2p' ? 'Copied!' : 'Copy P2P Identity'}
                      </button>
                      <p className="text-xs text-blue-700 mt-3">
                        💡 <strong>Note:</strong> Other nodes can paste this address in "Static MLS Server" below to use this node as their MLS.
                      </p>
                    </>
                  ) : (
                    <p className="text-sm text-blue-700">Loading P2P identity...</p>
                  )}
                </div>

                {/* Static MLS Configuration */}
                {/* Static MLS Configuration */}
                <div className="border-b border-gray-100">
                  <button
                    onClick={() => toggleAddress('staticMLS')}
                    className="w-full flex items-center justify-between p-6 hover:bg-gray-50 transition-colors text-left"
                  >
                    <div className="flex items-center gap-2">
                      <h3 className="text-lg font-semibold text-gray-800">Static MLS Server</h3>
                      {hasStaticMLS && <Check className="text-green-500" size={20} />}
                    </div>
                    {expandedAddress === 'staticMLS' ? <ChevronUp size={20} className="text-gray-500" /> : <ChevronDown size={20} className="text-gray-500" />}
                  </button>

                  {expandedAddress === 'staticMLS' && (
                    <div className="px-6 pb-6 pt-0">
                      <p className="text-sm text-gray-600 mb-4">
                        Configure a permanent Maxima Lookup Service to enable a permanent MAX# address for Community Discovery.
                      </p>

                      {hasStaticMLS ? (
                        <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-4">
                          <div className="flex items-center gap-2 mb-2">
                            <Check className="text-green-600" size={20} />
                            <span className="font-semibold text-green-800">Static MLS Configured</span>
                          </div>
                          <p className="text-xs text-gray-600 font-mono break-all mt-2">
                            {staticMLSServer}
                          </p>
                        </div>
                      ) : (
                        <>
                          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-4">
                            <div className="flex items-center gap-2">
                              <AlertTriangle className="text-yellow-600" size={20} />
                              <span className="font-semibold text-yellow-800">Static MLS Not Configured</span>
                            </div>
                            <p className="text-sm text-yellow-700 mt-2">
                              Enter your Static MLS server address below to enable Community Discovery.
                            </p>
                          </div>

                          <div className="space-y-3">
                            <input
                              type="text"
                              value={staticMLSServer}
                              onChange={(e) => setStaticMLSServer(e.target.value)}
                              placeholder="MxG...@IP:PORT"
                              className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none font-mono text-sm"
                            />
                            <button
                              onClick={handleConfigureStaticMLS}
                              disabled={configuringMLS || !staticMLSServer.trim()}
                              className="w-full py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                            >
                              {configuringMLS ? (
                                <>
                                  <RefreshCw size={18} className="animate-spin" />
                                  Configuring...
                                </>
                              ) : (
                                <>
                                  <Check size={18} />
                                  Configure Static MLS
                                </>
                              )}
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>

                {/* Permanent Address */}
                {/* Permanent Address */}
                <div className="border-b border-gray-100">
                  <button
                    onClick={() => toggleAddress('permanentAddress')}
                    className="w-full flex items-center justify-between p-6 hover:bg-gray-50 transition-colors text-left"
                  >
                    <div className="flex items-center gap-2">
                      <h3 className="text-lg font-semibold text-gray-800">Permanent MAX# Address</h3>
                      {hasPermanentAddress && <Check className="text-green-500" size={20} />}
                    </div>
                    {expandedAddress === 'permanentAddress' ? <ChevronUp size={20} className="text-gray-500" /> : <ChevronDown size={20} className="text-gray-500" />}
                  </button>

                  {expandedAddress === 'permanentAddress' && (
                    <div className="px-6 pb-6 pt-0">
                      <p className="text-sm text-gray-600 mb-4">
                        Enable a permanent address that never changes, allowing others to contact you even if you're not a contact.
                      </p>

                      {hasPermanentAddress ? (
                        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                          <div className="flex items-center gap-2 mb-3">
                            <Check className="text-green-600" size={20} />
                            <span className="font-semibold text-green-800">Permanent Address Active</span>
                          </div>
                          <div className="bg-white rounded border border-green-200 p-3">
                            <p className="text-xs text-gray-500 mb-1">Your MAX# Address:</p>
                            <p className="text-xs font-mono text-gray-800 break-all">{permanentAddress}</p>
                          </div>
                          <button
                            onClick={() => copyToClipboard(permanentAddress, 'permanent')}
                            className={`mt-3 flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${copiedField === 'permanent' ? 'bg-green-100 text-green-700' : 'bg-green-50 text-green-700 hover:bg-green-100 border border-green-200'}`}
                          >
                            {copiedField === 'permanent' ? <Check size={16} /> : <Copy size={16} />}
                            {copiedField === 'permanent' ? 'Copied!' : 'Copy MAX# Address'}
                          </button>
                        </div>
                      ) : (
                        <div>
                          {hasStaticMLS ? (
                            <button
                              onClick={handleEnablePermanentAddress}
                              disabled={enablingPermanent}
                              className="w-full py-2.5 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                            >
                              {enablingPermanent ? (
                                <>
                                  <RefreshCw size={18} className="animate-spin" />
                                  Enabling...
                                </>
                              ) : (
                                <>
                                  <Check size={18} />
                                  Enable Permanent Address
                                </>
                              )}
                            </button>
                          ) : (
                            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 text-center">
                              <AlertTriangle className="text-gray-400 mx-auto mb-2" size={24} />
                              <p className="text-sm text-gray-600">
                                Configure Static MLS first to enable permanent address
                              </p>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>


              </div>
            </section>

            {/* APPEARANCE SECTION (Placeholder) */}
            <section className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden opacity-60">
              <div className="p-6 border-b border-gray-100 flex items-center gap-3">
                <Palette className="text-purple-500" />
                <h2 className="text-xl font-semibold text-gray-800">Appearance</h2>
              </div>
              <div className="p-6">
                <p className="text-gray-500">Theme customization coming soon.</p>
              </div>
            </section>

            {/* NETWORK SECTION */}
            <section id="network" className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
              <div className="p-6 border-b border-gray-100 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Globe className="text-green-500" />
                  <h2 className="text-xl font-semibold text-gray-800">Network</h2>
                </div>
                <button
                  onClick={fetchNetworkStatus}
                  disabled={networkLoading}
                  className="p-2 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors disabled:opacity-50"
                  title="Refresh network status"
                >
                  <RefreshCw size={18} className={networkLoading ? "animate-spin" : ""} />
                </button>
              </div>
              <div className="p-6">
                {networkLoading && !networkStatus ? (
                  <div className="flex items-center justify-center py-8">
                    <RefreshCw size={24} className="animate-spin text-gray-400" />
                  </div>
                ) : networkStatus ? (
                  <>
                    {/* Health Status Badge */}
                    <div className={`flex items-center gap-3 p-4 rounded-xl mb-6 ${networkStatus.network?.connected > 3
                      ? 'bg-green-50 border border-green-100'
                      : networkStatus.network?.connected > 0
                        ? 'bg-yellow-50 border border-yellow-100'
                        : 'bg-red-50 border border-red-100'
                      }`}>
                      <div className={`p-2 rounded-full ${networkStatus.network?.connected > 3
                        ? 'bg-green-100 text-green-600'
                        : networkStatus.network?.connected > 0
                          ? 'bg-yellow-100 text-yellow-600'
                          : 'bg-red-100 text-red-600'
                        }`}>
                        <Check size={20} />
                      </div>
                      <div>
                        <h3 className={`font-semibold ${networkStatus.network?.connected > 3
                          ? 'text-green-800'
                          : networkStatus.network?.connected > 0
                            ? 'text-yellow-800'
                            : 'text-red-800'
                          }`}>
                          {networkStatus.network?.connected > 3
                            ? 'Network running smoothly'
                            : networkStatus.network?.connected > 0
                              ? 'Limited connection'
                              : 'No connection'}
                        </h3>
                        <p className={`text-sm ${networkStatus.network?.connected > 3
                          ? 'text-green-600'
                          : networkStatus.network?.connected > 0
                            ? 'text-yellow-600'
                            : 'text-red-600'
                          }`}>
                          {networkStatus.network?.connected > 3
                            ? 'Connected to Minima network'
                            : networkStatus.network?.connected > 0
                              ? 'Few active connections'
                              : 'No active connections'}
                        </p>
                      </div>
                    </div>

                    {/* Network Metrics */}
                    <div className="space-y-4">
                      {/* Connections */}
                      <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                        <div className="flex items-center gap-3">
                          <div className="p-2 bg-blue-100 rounded-lg text-blue-600">
                            <Globe size={18} />
                          </div>
                          <span className="font-medium text-gray-700">Connections</span>
                        </div>
                        <span className="text-lg font-bold text-gray-900">
                          {networkStatus.network?.connected || 0} nodes
                        </span>
                      </div>

                      {/* Current Block */}
                      <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                        <div className="flex items-center gap-3">
                          <div className="p-2 bg-purple-100 rounded-lg text-purple-600">
                            <span className="text-sm font-bold">⛓️</span>
                          </div>
                          <span className="font-medium text-gray-700">Current Block</span>
                        </div>
                        <span className="text-lg font-bold text-gray-900">
                          #{networkStatus.chain?.block?.toLocaleString() || 0}
                        </span>
                      </div>

                      {/* Last Block Time */}
                      <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                        <div className="flex items-center gap-3">
                          <div className="p-2 bg-orange-100 rounded-lg text-orange-600">
                            <span className="text-sm font-bold">🕐</span>
                          </div>
                          <span className="font-medium text-gray-700">Last Update</span>
                        </div>
                        <span className="text-sm font-semibold text-gray-700">
                          {networkStatus.chain?.time || 'N/A'}
                        </span>
                      </div>

                      {/* Minima Version */}
                      <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                        <div className="flex items-center gap-3">
                          <div className="p-2 bg-gray-200 rounded-lg text-gray-600">
                            <Info size={18} />
                          </div>
                          <span className="font-medium text-gray-700">Version</span>
                        </div>
                        <span className="text-sm font-semibold text-gray-700">
                          Minima {networkStatus.version || 'N/A'}
                        </span>
                      </div>
                    </div>

                    {/* Last Updated Timestamp */}
                    <div className="mt-6 text-center text-xs text-gray-500">
                      Updated {Math.floor((Date.now() - lastUpdated) / 1000)} seconds ago
                    </div>
                  </>
                ) : (
                  <p className="text-gray-500 text-center py-4">Unable to load network data</p>
                )}
              </div>
            </section>

          </div>
        </div >
      </div >
    </>
  );
}
