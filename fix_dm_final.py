import sys

def fix_dm_final(file_path):
    with open(file_path, 'r') as f:
        content = f.read()

    # Split the file exactly at the RENDER block
    render_marker = "RENDER"
    idx = content.rfind(render_marker)
    # find the next "return ("
    idx = content.find("return (", idx)
    
    if idx == -1:
        print("Error: return not found after RENDER marker")
        return

    # find the whitespace before return
    idx = content.rfind("\n", 0, idx)

    body_before = content[:idx+1]

    new_return = """  return (
    <div className="flex-1 w-full flex flex-col bg-[#f8fafc] dark:bg-gray-950 min-h-0 relative overflow-hidden">
      {/* ELITE STICKY HEADER */}
      <div className="sticky top-0 z-[70] w-full pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] pt-[env(safe-area-inset-top)] backdrop-blur-xl bg-white/70 dark:bg-gray-900/60 border-b border-white/20 dark:border-white/5 shadow-2xl shadow-black/5 transition-all duration-500">
        <div className="max-w-screen-xl mx-auto px-6 h-28 flex items-center gap-6">
          {/* Elite Back Navigation */}
          <button
            onClick={() => navigate({ to: "/" })}
            className="group relative w-14 h-14 flex items-center justify-center bg-gray-100 dark:bg-white/5 rounded-2xl hover:bg-primary-500 hover:text-white transition-all duration-500 active:scale-95 shadow-inner"
          >
            <div className="absolute inset-0 bg-primary-500 rounded-2xl opacity-0 group-hover:opacity-100 blur-xl transition-opacity duration-500" />
            <ArrowLeft size={24} strokeWidth={3} className="relative z-10" />
          </button>

          {/* Elite Identity Registry */}
          <div
            className="flex-1 flex items-center gap-5 cursor-pointer group/id"
            onClick={() => navigate({ to: `/contact-info/${address}` })}
          >
            <div className="relative">
              {contact?.extradata?.icon ? (
                <img src={contact.extradata.icon} className="w-16 h-16 rounded-[1.5rem] object-cover border-2 border-white dark:border-gray-800 shadow-xl group-hover/id:scale-105 transition-transform duration-500" alt="" />
              ) : (
                <div className="w-16 h-16 rounded-[1.5rem] bg-gradient-to-br from-primary-500 to-indigo-600 flex items-center justify-center text-white text-xl font-black shadow-xl group-hover/id:scale-105 transition-transform duration-500">
                  {(contact?.extradata?.name || address).substring(0, 1).toUpperCase()}
                </div>
              )}
              <div className={`absolute -bottom-1 -right-1 w-6 h-6 rounded-full border-4 border-white dark:border-gray-900 shadow-sm animate-pulse
                ${appStatus === 'installed' ? 'bg-emerald-500' : 'bg-amber-500'}
              `} />
            </div>
            <div className="flex flex-col min-w-0">
              <div className="flex items-center gap-3">
                <span className="text-xl font-black text-gray-900 dark:text-white uppercase tracking-tight truncate">
                  {contact?.extradata?.name || "Syncing Profile..."}
                </span>
                {isFavorite && <Star size={16} className="text-amber-500 fill-amber-500" />}
              </div>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-primary-500 animate-ping" />
                <span className="text-[10px] font-black text-primary-500/80 uppercase tracking-[0.3em]">
                  {isSyncing ? "Syncing Grid..." : appStatus === 'installed' ? "Signal Active" : appStatus === 'checking' ? "Scanning..." : appStatus === 'not_found' ? "Link Standby" : "Link Standby"}
                </span>
              </div>
            </div>
          </div>

          {/* Elite Header Actions */}
          <div className="flex gap-4 relative pr-4">
            <button
              onClick={() => setShowMenu(!showMenu)}
              className={`w-14 h-14 flex items-center justify-center rounded-2xl transition-all duration-500 ${showMenu ? "bg-primary-500 text-white shadow-lg shadow-primary-500/30" : "bg-gray-100 dark:bg-white/5 text-gray-500 hover:text-primary-500 shadow-inner"}`}
            >
              <MoreVertical size={24} strokeWidth={3} />
            </button>

            {showMenu && (
              <div className="absolute top-20 right-0 w-[260px] backdrop-blur-2xl bg-white/95 dark:bg-gray-900/95 rounded-[2.5rem] shadow-[0_20px_50px_rgba(0,0,0,0.2)] border border-white/20 dark:border-white/5 py-4 overflow-hidden z-[100] animate-in slide-in-from-top-4 fade-in duration-500">
                <div className="px-8 py-4 mb-2 border-b border-gray-100 dark:border-white/5">
                  <span className="text-[10px] font-black text-gray-400 uppercase tracking-[0.4em]">Grid Registry</span>
                </div>

                {[
                  { label: "Peer Profile", icon: Info, action: () => navigate({ to: `/contact-info/${address}` }), color: "text-blue-500", bg: "bg-blue-500/10", fill: false },
                  { label: "Registry Settings", icon: Settings, action: () => navigate({ to: `/contact-info/${address}`, search: { returnTo: `/chat/${address}`, tab: "privacy" } }), color: "text-primary-500", bg: "bg-primary-500/10", fill: false },
                  { label: isFavorite ? "Dismiss Star" : "Star Registry", icon: Star, action: handleToggleFavorite, color: "text-amber-500", bg: "bg-amber-500/10", fill: isFavorite },
                  { label: isArchived ? "Restore Vault" : "Archive Vault", icon: Archive, action: handleToggleArchive, color: "text-orange-500", bg: "bg-orange-500/10", fill: isArchived },
                ].map((item, idx) => (
                  <button
                    key={idx}
                    className="w-full flex items-center justify-between px-8 py-5 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors group/item"
                    onClick={() => { setShowMenu(false); item.action(); }}
                  >
                    <div className="flex items-center gap-4 text-left">
                      <div className={`w-11 h-11 ${item.bg} ${item.color} rounded-xl flex items-center justify-center group-hover/item:scale-110 transition-transform duration-500 shadow-sm flex-shrink-0`}>
                        <item.icon size={20} strokeWidth={3} fill={item.fill ? "currentColor" : "none"} />
                      </div>
                      <span className="text-[11px] font-black text-gray-700 dark:text-gray-200 uppercase tracking-widest leading-tight">{item.label}</span>
                    </div>
                    <ChevronRight size={16} className="text-gray-300 dark:text-gray-600 opacity-0 group-hover/item:opacity-100 transition-all -translate-x-2 group-hover:translate-x-0" />
                  </button>
                ))}

                <div className="mt-2 pt-2 border-t border-gray-100 dark:border-white/5">
                  <button
                    className="w-full flex items-center gap-4 px-8 py-5 text-red-500 hover:bg-red-500/10 transition-colors group/del"
                    onClick={() => { setShowMenu(false); setShowDeleteConfirm(true); }}
                  >
                    <div className="w-11 h-11 bg-red-500/10 rounded-xl flex items-center justify-center group-hover/del:bg-red-500 group-hover/del:text-white transition-all duration-500 flex-shrink-0">
                      <Trash2 size={20} strokeWidth={3} />
                    </div>
                    <span className="text-[11px] font-black uppercase tracking-widest text-left leading-tight">Expunge Registry</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* REGISTRY SCROLL VIEW */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto flex flex-col px-4 pt-6 pb-32 relative transition-colors"
      >
        {/* Pattern Overlays */}
        {chatBackground === "dots" && (
          <div className="fixed inset-0 pointer-events-none opacity-[0.03] dark:opacity-[0.05]" 
               style={{ backgroundImage: "radial-gradient(circle at 2px 2px, currentColor 1px, transparent 0)", backgroundSize: "24px 24px" }} />
        )}
        {chatBackground === "grid" && (
          <div className="fixed inset-0 pointer-events-none opacity-[0.02] dark:opacity-[0.04]" 
               style={{ backgroundImage: "linear-gradient(currentColor 1px, transparent 1px), linear-gradient(90deg, currentColor 1px, transparent 1px)", backgroundSize: "40px 40px" }} />
        )}
        {chatBackground === "diagonal" && (
          <div className="fixed inset-0 pointer-events-none opacity-[0.02] dark:opacity-[0.04]" 
               style={{ backgroundImage: "repeating-linear-gradient(45deg, currentColor, currentColor 1px, transparent 1px, transparent 10px)", backgroundSize: "14px 14px" }} />
        )}
        {chatBackground === "soft-gradient" && (
          <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-primary-500/[0.03] via-transparent to-primary-500/[0.08] dark:from-primary-500/[0.08] dark:via-transparent dark:to-primary-500/[0.03]" />
            <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] rounded-full bg-primary-500/[0.06] blur-[120px] animate-pulse" />
            <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] rounded-full bg-primary-500/[0.06] blur-[120px] animate-pulse" style={{ animationDelay: '2s' }} />
          </div>
        )}

        {/* Elite Forward Success Banner */}
        {showForwardSuccess && (
          <div className="sticky top-4 z-40 mx-4 pointer-events-none mb-6">
            <div className="bg-emerald-500/90 dark:bg-emerald-900/60 backdrop-blur-2xl border border-white/20 dark:border-emerald-500/20 rounded-[2rem] shadow-[0_10px_40px_rgba(16,185,129,0.2)] p-6 animate-in fade-in slide-in-from-top-4 duration-500 flex items-center gap-6 pointer-events-auto">
              <div className="w-14 h-14 bg-white/20 dark:bg-emerald-500/20 rounded-2xl flex items-center justify-center shadow-inner">
                <CheckCircle2 size={28} className="text-white dark:text-emerald-400 animate-bounce" />
              </div>
              <div className="flex-1">
                <p className="text-[11px] font-black text-white/60 dark:text-emerald-400/60 uppercase tracking-[0.3em]">Network confirmed</p>
                <p className="text-lg font-black text-white dark:text-emerald-100 uppercase tracking-tight leading-none mt-1">Message Forwarded</p>
              </div>
            </div>
          </div>
        )}

        {/* Elite Contact Request Banner */}
        {(contactRequest || blockReason === "incoming_restricted") && (
          <div className="sticky top-4 z-40 mx-4 mb-8">
            <div className="bg-white/90 dark:bg-gray-900/90 backdrop-blur-3xl border border-white/20 dark:border-white/5 rounded-[3rem] shadow-[0_30px_70px_rgba(0,0,0,0.2)] p-8 animate-in fade-in slide-in-from-top-6 duration-700 ring-1 ring-black/5 dark:ring-white/5">
              <div className="flex flex-col md:flex-row gap-8">
                <div className="w-20 h-20 bg-primary-500/10 rounded-[1.75rem] flex items-center justify-center text-primary-500 shadow-inner group-hover:scale-110 transition-transform duration-700 flex-shrink-0">
                  <ShieldCheck size={40} strokeWidth={2.5} />
                </div>
                
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-3 mb-2">
                    <span className="text-[10px] font-black text-primary-500 uppercase tracking-[0.4em] bg-primary-500/10 px-3 py-1 rounded-full">Grid handshake</span>
                    <span className="text-[10px] font-black text-gray-400 uppercase tracking-[0.4em]">{(contactRequest as any)?.type === "maxima" ? "Maxima layer" : "Chat protocol"}</span>
                  </div>
                  
                  <h3 className="text-2xl font-black text-gray-900 dark:text-white uppercase tracking-tight leading-none mb-3">
                    {contact?.extradata?.name || contactRequest?.FROM_NAME || "Peer Registry"}
                  </h3>
                  
                  <p className="text-sm text-gray-500 dark:text-gray-400 font-medium leading-relaxed max-w-md">
                    {(contactRequest as any)?.type === "maxima"
                      ? "A new peer is requesting Maxima contact authorization to establish a secure synchronization tunnel."
                      : "Establishing a direct communication channel. Authorization is required to verify the grid identity."}
                  </p>
                </div>

                <div className="flex flex-col gap-3 justify-center min-w-[200px]">
                  <button
                    onClick={async () => {
                      if ((contactRequest as any)?.type === "maxima" || (!contactRequest && blockReason === "incoming_restricted")) {
                        if (contact?.publickey) {
                          try {
                            setContactRequest(null);
                            setBlockReason("none");
                            const validPk = contact.publickey.replace(/'/g, "''");
                            const now = Date.now();
                            await minimaService.runSQL(`UPDATE MAXIMA_CONTACT_REQUESTS SET status='accepted', updated_at=${now} WHERE UPPER(from_publickey)=UPPER('${validPk}') AND status='pending'`);
                            await minimaService.runSQL(`INSERT INTO CHAT_MESSAGES(roomname, publickey, username, type, message, filedata, state, amount, date, sender_seq, original_timestamp) VALUES('', UPPER('${validPk}'), 'System', 'system', 'Maxima contact accepted', '', 'sent', 0, ${now}, NULL, ${now})`);
                            minimaService.acceptMaximaContactRequest(contact.publickey, contact.currentaddress || "", { skipMessageInsert: true })
                                         .then(() => { if (typeof loadMessagesFromDB !== 'undefined') loadMessagesFromDB(); })
                                         .catch(() => {});
                            if (typeof checkPending !== 'undefined') checkPending();
                            if (typeof loadMessagesFromDB !== 'undefined') loadMessagesFromDB();
                          } catch (e) { console.error(e); }
                        }
                      } else { if (typeof handleAcceptRequest !== 'undefined') handleAcceptRequest(); }
                    }}
                    disabled={processingRequest}
                    className="w-full py-5 bg-primary-500 hover:bg-primary-600 text-white rounded-[1.5rem] font-black text-xs uppercase tracking-[0.3em] shadow-xl shadow-primary-500/30 transition-all active:scale-95 disabled:opacity-50"
                  >
                    {processingRequest ? "Synchronizing..." : "Accept Handshake"}
                  </button>
                  <div className="flex gap-3">
                    <button
                      onClick={() => { if (typeof handleDeclineRequest !== 'undefined') handleDeclineRequest(); }}
                      disabled={processingRequest}
                      className="flex-1 py-4 bg-gray-100 dark:bg-white/5 hover:bg-red-500/10 hover:text-red-500 text-gray-500 dark:text-gray-400 rounded-2xl font-black text-[10px] uppercase tracking-widest transition-all active:scale-95 disabled:opacity-50"
                    >
                      Dismiss
                    </button>
                    <button
                      onClick={() => { setContactRequest(null); setBlockReason("none"); }}
                      className="flex-1 py-4 bg-gray-100 dark:bg-white/5 text-gray-400 rounded-2xl font-black text-[10px] uppercase tracking-widest transition-all active:scale-95"
                    >
                      Ignore
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Pending Outgoing Request Banner */}
        {isPendingOutgoing && !contactRequest && (
          <div className="sticky top-4 z-20 mx-4 mb-4">
             <div className="bg-primary-500/10 backdrop-blur-xl border border-primary-500/20 rounded-[2rem] p-6 flex items-center gap-6">
                <div className="w-12 h-12 bg-primary-500 text-white rounded-xl flex items-center justify-center shadow-lg shadow-primary-500/20">
                   <Zap size={24} className="animate-pulse" />
                </div>
                <div>
                   <p className="text-[10px] font-black text-primary-500 uppercase tracking-widest">Handshake pending</p>
                   <p className="text-sm font-bold text-gray-900 dark:text-white">Waiting for recipient to authorize synchronization.</p>
                </div>
             </div>
          </div>
        )}

        {/* Empty State Registry Security */}
        {messages.length === 0 && (
          <div className="flex-1 flex items-center justify-center py-20">
             <div className="bg-white dark:bg-gray-900/50 backdrop-blur-xl rounded-[2.5rem] border border-gray-100 dark:border-white/5 p-10 max-w-sm text-center shadow-2xl relative overflow-hidden group">
                <div className="absolute inset-0 bg-gradient-to-b from-primary-500/[0.02] to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-700" />
                <div className="w-24 h-24 bg-primary-500/10 rounded-[2rem] flex items-center justify-center text-primary-500 mb-8 mx-auto shadow-inner group-hover:scale-110 transition-transform duration-700">
                  <ShieldCheck size={48} strokeWidth={2.5} />
                </div>
                <h3 className="text-2xl font-black text-gray-900 dark:text-white uppercase tracking-tight mb-4 leading-none">Security Grid Active</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 font-medium leading-relaxed">Signal history is end-to-end encrypted on the Minima Layer. Absolute privacy is maintained within this peer vault.</p>
             </div>
          </div>
        )}

        {/* Message Registry Map Loop */}
        {messages.filter(m => m.status !== 'zombie').map((msg, i, arr) => {
          const currentDate = new Date(msg.timestamp || 0).toDateString();
          const prevDate = i > 0 ? new Date(arr[i-1].timestamp || 0).toDateString() : null;
          const showDate = currentDate !== prevDate;
          const isFirstInGroup = i === 0 || arr[i-1].fromMe !== msg.fromMe || arr[i-1].isSystem || showDate;
          const isLastInGroup = i === arr.length - 1 || arr[i+1].fromMe !== msg.fromMe || arr[i+1].isSystem || (i < arr.length - 1 && new Date(arr[i+1].timestamp || 0).toDateString() !== currentDate);

          return (
            <div key={`${msg.timestamp}-${i}`} className="flex flex-col w-full relative mb-1">
              {showDate && msg.timestamp && (
                <div className="flex justify-center my-8 sticky top-4 z-10">
                   <span className="text-[10px] font-black text-gray-400 dark:text-gray-500 bg-gray-50 dark:bg-gray-900/80 backdrop-blur-md px-4 py-2 rounded-full border border-gray-100 dark:border-white/5 uppercase tracking-[0.3em] shadow-sm">
                      {new Date(msg.timestamp).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}
                   </span>
                </div>
              )}
              {msg.isSystem ? (
                <div className="flex justify-center my-6 px-12">
                   <span className={`text-[10px] font-black px-4 py-2 rounded-full uppercase tracking-widest ${msg.text?.toLowerCase().includes('accepted') ? 'text-emerald-500 bg-emerald-500/10' : msg.text?.toLowerCase().includes('declined') ? 'text-red-500 bg-red-500/10' : 'text-gray-400 bg-gray-100 dark:bg-white/5'}`}>
                      {msg.text}
                   </span>
                </div>
              ) : (
                <MessageBubble
                  fromMe={msg.fromMe}
                  text={msg.text}
                  charm={msg.charm}
                  amount={msg.amount}
                  timestamp={msg.timestamp}
                  status={msg.status}
                  tokenAmount={msg.tokenAmount}
                  type={msg.type}
                  filedata={msg.filedata}
                  senderName={msg.fromMe ? userName || 'You' : contact?.extradata?.name || 'Peer'}
                  senderImage={msg.fromMe ? userAvatar : contact?.extradata?.icon}
                  forwarded={msg.forwarded}
                  currentChatId={address}
                  showName={isFirstInGroup}
                  showAvatar={isLastInGroup}
                  replyTo={msg.replyTo}
                  deleted={msg.deleted}
                  onDelete={msg.fromMe && !msg.deleted && msg.customid ? () => handleDeleteMessage(msg.customid!) : undefined}
                  onReply={blockReason === 'none' && !isBlocked && !blockedByThem ? () => {
                     setReplyingTo({ customid: msg.customid || '', text: msg.text || (msg.type === 'image' ? 'Image' : ''), senderName: msg.fromMe ? userName || 'You' : contact?.extradata?.name || 'Peer', type: msg.type || 'text' });
                     setTimeout(() => inputRef.current?.focus(), 50);
                  } : undefined}
                />
              )}
            </div>
          );
        })}

        <div ref={messagesEndRef} className="h-4" />
      </div>

      {/* ELITE REPLY BANNER */}
      {replyingTo && (
        <div className="absolute bottom-32 left-8 right-8 z-30 bg-white/80 dark:bg-gray-900/80 backdrop-blur-2xl rounded-3xl border border-white/20 dark:border-white/5 p-5 animate-in fade-in slide-in-from-bottom-4 duration-500 shadow-2xl">
          <div className="flex items-center gap-4">
            <div className="w-1 h-10 bg-primary-500 rounded-full" />
            <div className="flex-1 min-w-0">
              <p className="text-[9px] font-black text-primary-500 uppercase tracking-[0.3em]">Replying to {replyingTo.senderName}</p>
              <p className="text-[13px] font-black text-gray-700 dark:text-gray-200 truncate mt-1 tracking-tight">{replyingTo.text}</p>
            </div>
            <button onClick={() => setReplyingTo(null)} className="w-10 h-10 flex items-center justify-center bg-gray-100 dark:bg-white/5 rounded-xl text-gray-400 hover:text-red-500 transition-colors">
              <X size={18} strokeWidth={3} />
            </button>
          </div>
        </div>
      )}

      {/* ELITE INPUT HUB */}
      <footer className="sticky bottom-0 z-[60] px-4 pb-4 md:px-8 md:pb-8 bg-transparent pointer-events-none">
        <div className="max-w-screen-xl mx-auto pointer-events-auto">
          <div className="backdrop-blur-3xl bg-white/80 dark:bg-gray-900/80 rounded-[3rem] p-3 shadow-[0_20px_50px_rgba(0,0,0,0.2)] border border-white/20 dark:border-white/5 flex items-end gap-3 ring-1 ring-black/5 dark:ring-white/5">
            <div className="flex-1 flex flex-col min-w-0 bg-gray-100/50 dark:bg-white/5 rounded-[2.5rem] border border-white/10 dark:border-white/5 overflow-hidden focus-within:ring-2 focus-within:ring-primary-500/30 transition-all duration-500">
              <textarea
                ref={inputRef as any}
                rows={1}
                value={input}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    if (typeof handleSendMessage !== 'undefined') handleSendMessage();
                  }
                }}
                onChange={(e) => {
                  setInput(e.target.value);
                  e.target.style.height = "auto";
                  e.target.style.height = `${Math.min(e.target.scrollHeight, 180)}px`;
                }}
                placeholder={isBlocked || blockedByThem ? "Protocol Restricted" : "Broadcast Message..."}
                disabled={isBlocked || blockedByThem}
                className="w-full bg-transparent px-8 py-5 text-[15px] font-bold text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-600 focus:outline-none resize-none min-h-[64px]"
              />
              <div className="flex items-center justify-between px-6 pb-4">
                <div className="flex items-center gap-3">
                  <div className="flex gap-1.5 p-1.5 bg-gray-100 dark:bg-white/5 rounded-2xl">
                    <button
                      className={`w-11 h-11 flex items-center justify-center rounded-xl transition-all duration-500 ${showEmojiPicker ? "bg-primary-500 text-white shadow-lg shadow-primary-500/30" : "text-gray-400 hover:bg-white dark:hover:bg-white/10"}`}
                      onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                    >
                      <Radio size={20} className={showEmojiPicker ? "animate-pulse" : ""} />
                    </button>
                    <button
                      className="w-11 h-11 flex items-center justify-center rounded-xl text-gray-400 hover:bg-white dark:hover:bg-white/10 transition-all duration-500"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <Paperclip size={20} />
                    </button>
                    <button
                      className="w-11 h-11 flex items-center justify-center rounded-xl text-gray-400 hover:bg-white dark:hover:bg-white/10 transition-all duration-500"
                      onClick={() => setShowTransferSelector(true)}
                    >
                      <Wallet size={20} />
                    </button>
                  </div>
                  <div className="h-6 w-px bg-gray-200 dark:bg-white/10" />
                  <span className="text-[10px] font-black text-gray-300 dark:text-gray-600 uppercase tracking-[0.2em]">{input.length > 0 ? `${input.length} Chars` : "Brm.Sync"}</span>
                </div>
              </div>
            </div>

            <button
              onClick={() => { if (typeof handleSendMessage !== 'undefined') handleSendMessage(); }}
              disabled={!input.trim() || isSendingRef.current || isBlocked || blockedByThem}
              className={`w-[68px] h-[68px] flex items-center justify-center rounded-[2.25rem] transition-all duration-700 shadow-2xl relative group overflow-hidden ${input.trim() ? "bg-primary-500 text-white scale-100 rotate-0 shadow-primary-500/30" : "bg-gray-100 dark:bg-white/5 text-gray-300 scale-90 -rotate-12 opacity-50 cursor-not-allowed"}`}
            >
              <div className="absolute inset-0 bg-gradient-to-tr from-white/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-700" />
              <Zap size={28} strokeWidth={2.5} className="relative z-10 group-active:scale-90 transition-transform duration-500" />
            </button>
          </div>
        </div>
      </footer>

      {/* Modals & Dialogs */}
      {showTransferSelector && (
        <TransferSelector onSend={handleTransfer} onCancel={() => setShowTransferSelector(false)} />
      )}
      
      {showInviteDialog && (
        <InviteDialog
          isOpen={showInviteDialog}
          onClose={() => setShowInviteDialog(false)}
          onConfirm={handleSendInvite}
          isSending={inviteSending}
        />
      )}

      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-[110] p-8 animate-in fade-in duration-300">
          <div className="bg-white dark:bg-gray-900 rounded-[3rem] max-w-sm w-full p-10 shadow-2xl border border-white/10">
            <div className="w-20 h-20 bg-red-500/10 rounded-[2rem] flex items-center justify-center text-red-500 mb-8 mx-auto">
              <Trash2 size={40} strokeWidth={2.5} />
            </div>
            <h3 className="text-2xl font-black text-gray-900 dark:text-white uppercase tracking-tight text-center mb-4">Expunge Ledger?</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 text-center leading-relaxed mb-10 font-medium">This will permanently wipe all signal history with this peer from your local grid. This operation is irreversible.</p>
            <div className="flex flex-col gap-4">
              <button onClick={handleDeleteChat} className="w-full py-5 bg-red-500 hover:bg-red-600 text-white rounded-2xl font-black text-xs uppercase tracking-[0.3em] transition-all shadow-xl shadow-red-500/20">Confirm Expunge</button>
              <button onClick={() => setShowDeleteConfirm(false)} className="w-full py-5 bg-gray-100 dark:bg-white/5 text-gray-500 dark:text-gray-400 rounded-2xl font-black text-xs uppercase tracking-[0.3em] hover:bg-gray-200 transition-all">Abort</button>
            </div>
          </div>
        </div>
      )}

      {/* Hidden inputs & picker containers */}
      <input type="file" ref={fileInputRef} accept="image/*" className="hidden" onChange={handleImageSelect} />
      
      {/* EMOJI PICKER - Render outside fixed footer to avoid clipping */}
      <div
        ref={emojiPickerRef}
        className={`fixed bottom-24 left-8 z-[120] transition-all duration-300 ${!showEmojiPicker ? "opacity-0 scale-95 pointer-events-none translate-y-4" : "opacity-100 scale-100 translate-y-0"}`}
      >
        <div className="shadow-2xl rounded-[2.5rem] overflow-hidden border border-white/20">
          <Suspense fallback={<div className="h-[400px] w-[320px] bg-white/10 backdrop-blur-3xl animate-pulse" />}>
            <EmojiPicker
              onEmojiClick={onEmojiClick}
              theme={mode === "dark" ? "dark" : "light" as any}
              width={320}
              height={400}
              skinTonesDisabled
              searchDisabled
              previewConfig={{ showPreview: false }}
            />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
"""

    with open(file_path, 'w') as f:
        f.write(body_before + new_return + "\n")
    print("Done writing to file")

if __name__ == "__main__":
    fix_dm_final(sys.argv[1])
