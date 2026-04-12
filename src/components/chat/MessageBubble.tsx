// src/components/chat/MessageBubble.tsx

import Lottie from "lottie-react";
import { motion, AnimatePresence } from "framer-motion";
import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Forward, Copy, Check, Reply, Trash2 } from "lucide-react";
import ForwardModal from "./ForwardModal";

// Dynamic import of all .json files
const charmModules = import.meta.glob('../../assets/animations/*.json', { eager: true });

interface MessageBubbleProps {
  fromMe: boolean;
  text?: string | null;
  charm?: { id: string } | null;
  amount?: number | null;
  // Ensure timestamp is treated as number (it comes from DB as number)
  timestamp?: number;
  status?: 'pending' | 'sent' | 'delivered' | 'read' | 'failed' | 'zombie' | 'confirmed' | 'received';
  tokenAmount?: { amount: string; tokenName: string };
  senderName?: string;
  senderImage?: string; // Base64 or URL
  onAvatarClick?: () => void;
  type?: string;        // Added type to detect images
  filedata?: string;    // Added filedata to hold the base64 string
  forwarded?: boolean;
  currentChatId?: string;
  showName?: boolean;
  showAvatar?: boolean;
  replyTo?: { customid: string; text: string; senderName: string; type: string } | null;
  onReply?: () => void;
  deleted?: boolean;
  onDelete?: () => void;
}

// Flying money emoji component
const FlyingMoney = ({ delay = 0 }: { delay?: number }) => {
  const randomX = Math.random() * 100 - 50;
  const randomRotate = Math.random() * 360;

  return (
    <motion.div
      initial={{ y: 0, x: 0, opacity: 1, scale: 1, rotate: 0 }}
      animate={{
        y: -150,
        x: randomX,
        opacity: 0,
        scale: 0.5,
        rotate: randomRotate
      }}
      transition={{
        duration: 1.5,
        delay,
        ease: "easeOut"
      }}
      className="absolute text-2xl pointer-events-none"
      style={{ left: '50%', top: '50%' }}
    >
      💸
    </motion.div>
  );
};

// Confetti particle component
const ConfettiParticle = ({ delay = 0, color }: { delay?: number; color: string }) => {
  const randomX = (Math.random() - 0.5) * 200;
  const randomY = -100 - Math.random() * 100;
  const randomRotate = Math.random() * 720;

  return (
    <motion.div
      initial={{ y: 0, x: 0, opacity: 1, scale: 1, rotate: 0 }}
      animate={{
        y: randomY,
        x: randomX,
        opacity: 0,
        scale: 0,
        rotate: randomRotate
      }}
      transition={{
        duration: 1.2,
        delay,
        ease: "easeOut"
      }}
      className="absolute w-2 h-2 rounded-full pointer-events-none"
      style={{ left: '50%', top: '50%', backgroundColor: color }}
    />
  );
};

const defaultAvatar = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23cbd5e1'%3E%3Cpath d='M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z'/%3E%3C/svg%3E";

export default function MessageBubble({ fromMe, text, charm, amount, timestamp, status, tokenAmount, senderName, senderImage, onAvatarClick, type, filedata, forwarded, currentChatId, showName = true, showAvatar = true, replyTo, onReply, deleted, onDelete }: MessageBubbleProps) {
  const isCharm = !!charm;
  const isTokenTransfer = !!tokenAmount;
  const isImage = type === 'image' || (filedata && filedata.startsWith('data:image')); // Detect images
  const [showCelebration, setShowCelebration] = useState(false);
  const [prevStatus, setPrevStatus] = useState<MessageBubbleProps['status']>(status);
  const [showForwardModal, setShowForwardModal] = useState(false);
  const [forwardAsForwarded, setForwardAsForwarded] = useState(false);
  const [showActions, setShowActions] = useState(false);
  const [copied, setCopied] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left?: number; right?: number } | null>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);

  // Close actions when clicking outside both the menu portal and the bubble
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      const insideMenu = actionsRef.current?.contains(target);
      const insideBubble = bubbleRef.current?.contains(target);
      if (showActions && !insideMenu && !insideBubble) {
        setShowActions(false);
      }
    };

    if (showActions) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [showActions]);

  // Trigger celebration when status changes from pending to sent/read
  useEffect(() => {
    if (prevStatus === 'pending' && (status === 'sent' || status === 'read') && (isTokenTransfer || isCharm)) {
      setShowCelebration(true);
      setTimeout(() => setShowCelebration(false), 1500);
    }
    setPrevStatus(status);
  }, [status, isTokenTransfer, isCharm, prevStatus]);

  // Use status directly - no fake pending needed
  // For outgoing token/charm, only 'confirmed' and 'read' show CONFIRMED badge.
  // 'delivered' means recipient got the Maxima message but blockchain hasn't confirmed yet → PROCESSING.
  const currentStatus = (isTokenTransfer || isCharm) && fromMe && status === 'confirmed'
    ? 'confirmed'
    : (isTokenTransfer || isCharm) && !fromMe && (status === 'read' || status === 'confirmed')
    ? 'confirmed'
    : status;

  // Detect single-emoji messages (like Telegram/WhatsApp big emoji)
  const isSingleEmoji = (() => {
    if (!text || text.trim() !== text) return false;
    const emojiRegex = /^(\p{Emoji_Presentation}|\p{Emoji}\uFE0F)(\u200D(\p{Emoji_Presentation}|\p{Emoji}\uFE0F))*$/u;
    return emojiRegex.test(text.trim());
  })();

  let bubbleColor = "";
  let textColor = "text-gray-900 dark:text-gray-100";

  if (currentStatus === 'failed') {
    bubbleColor = "bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-900/50 shadow-sm opacity-90";
  } else if (isCharm || isTokenTransfer) {
    bubbleColor = "bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-800 dark:via-gray-700 dark:to-gray-800 border border-gray-200 dark:border-gray-600 shadow-md";
  } else if (fromMe) {
    // Premium Gradient for Me (Theme-Aware)
    bubbleColor = "bg-gradient-to-br from-primary-500 to-primary-600 shadow-md shadow-primary-500/20";
    textColor = "text-white";
  } else {
    // Glassmorphism for Them
    bubbleColor = "bg-white/80 dark:bg-gray-800/40 backdrop-blur-md border border-white/20 dark:border-gray-700/30 shadow-sm";
  }

  // Channel style treats corners differently: rounded-2xl with a specific beak
  const borderRadius = fromMe
    ? "rounded-2xl rounded-tr-none"
    : "rounded-2xl rounded-tl-none";

  const alignment = fromMe ? "justify-end" : "justify-start";
  const flexDir = fromMe ? "flex-row-reverse" : "flex-row";
  const headerAlign = fromMe ? "justify-end" : "justify-start";

  // Map charm ID to Lottie animation data
  let animationData: any = null;
  if (charm?.id) {
    const key = `../../assets/animations/${charm.id}.json`;
    animationData = (charmModules[key] as any)?.default || null;
  }

  // Pulsing animation for pending state

  // Helper to render the bubble content
  const renderBubbleContent = () => (
    <div className={`flex ${flexDir} gap-3 mb-2 max-w-full group`}>
      {/* Avatar Section */}
      {showAvatar && (
        <div
          className={`flex-shrink-0 mt-1 ${onAvatarClick ? 'cursor-pointer hover:opacity-80 transition-opacity' : ''}`}
          onClick={onAvatarClick}
        >
          <div className={`w-9 h-9 rounded-full ${fromMe ? 'bg-primary-500' : 'bg-sky-500'} flex items-center justify-center text-white text-xs font-bold shadow-lg ring-2 ring-white dark:ring-gray-800 overflow-hidden`}>
            {senderImage ? (
              <img
                src={senderImage}
                alt={senderName || "User"}
                className="w-full h-full object-cover"
                onError={(e: any) => { e.target.src = defaultAvatar; }}
              />
            ) : (
              <span>{senderName?.charAt(0).toUpperCase() || "?"}</span>
            )}
          </div>
        </div>
      )}
      {!showAvatar && <div className="w-9 flex-shrink-0" />}

      {/* Content Section */}
      <div className={`flex-1 min-w-0 flex flex-col ${fromMe ? 'items-end' : 'items-start'}`}>
        {/* Header (Name + Time) */}
        <div className={`flex items-baseline gap-2 mb-1 px-1 ${headerAlign}`}>
          {showName && !fromMe && (
            <span className="text-xs font-semibold text-sky-600 dark:text-sky-400">
              {senderName || "Unknown"}
            </span>
          )}
          {fromMe && (
            <span className="text-[10px] text-gray-400 dark:text-gray-500 order-first">
              {new Date(timestamp || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
          {showName && fromMe && (
            <span className="text-xs font-semibold text-primary-500 dark:text-primary-400">
              {senderName || "You"}
            </span>
          )}
          {!fromMe && (
            <span className="text-[10px] text-gray-400 dark:text-gray-500">
              {new Date(timestamp || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
        </div>

        {/* The Bubble */}
        <div className="relative max-w-full">
          <AnimatePresence>
            {(isTokenTransfer || isCharm) && currentStatus === 'pending' && (
              <>
                {[...Array(5)].map((_, i) => (
                  <FlyingMoney key={i} delay={i * 0.1} />
                ))}
              </>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {showCelebration && (
              <>
                {[...Array(12)].map((_, i) => (
                  <ConfettiParticle
                    key={i}
                    delay={i * 0.05}
                    color={['#10b981', '#34d399', '#6ee7b7', '#fbbf24', '#f59e0b'][i % 5]}
                  />
                ))}
              </>
            )}
          </AnimatePresence>

          <div
            ref={bubbleRef}
            onClick={() => {
              if (isTokenTransfer || isCharm) return;
              if (!showActions) {
                const rect = bubbleRef.current?.getBoundingClientRect();
                if (rect) {
                  setMenuPos({
                    top: rect.top - 8,
                    ...(fromMe
                      ? { right: window.innerWidth - rect.right }
                      : { left: rect.left }),
                  });
                }
              }
              setShowActions(!showActions);
            }}
            className={`relative ${isSingleEmoji ? 'px-1 py-1' : `px-4 py-2.5 ${bubbleColor} min-w-[80px]`} ${isSingleEmoji ? '' : borderRadius} ${textColor} transition-all duration-200 ${!isTokenTransfer ? 'cursor-pointer hover:shadow-lg active:scale-[0.98]' : ''} ${showActions ? 'ring-2 ring-primary-400 ring-opacity-50' : ''}`}
          >
            {/* Forwarded Indicator */}
            {forwarded && (
              <div className="flex items-center gap-1 mb-1 opacity-60 text-[10px] font-medium italic">
                <Forward size={10} />
                <span>Forwarded</span>
              </div>
            )}

            {/* Reply Quote Block */}
            {replyTo && (
              <div className={`flex items-stretch gap-1.5 mb-2 rounded-lg overflow-hidden ${fromMe ? 'bg-primary-50 dark:bg-primary-900/30 border-l-2 border-primary-400' : 'bg-gray-100 dark:bg-gray-700/60 border-l-2 border-gray-400 dark:border-gray-500'}`}>
                <div className="flex-1 px-2 py-1.5 min-w-0">
                  <p className={`text-[10px] font-semibold truncate ${fromMe ? 'text-primary-600 dark:text-primary-400' : 'text-gray-500 dark:text-gray-400'}`}>
                    {replyTo.senderName || 'Unknown'}
                  </p>
                  <p className="text-[11px] text-gray-600 dark:text-gray-300 truncate opacity-80">
                    {replyTo.type === 'image' ? '📷 Image' : replyTo.text || '…'}
                  </p>
                </div>
              </div>
            )}

            {/* Action overlay — rendered via portal to escape scroll container stacking context */}
            {showActions && menuPos && createPortal(
                <motion.div
                  ref={actionsRef}
                  initial={{ opacity: 0, y: 8, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  style={{
                    position: 'fixed',
                    top: menuPos.top,
                    ...(menuPos.left !== undefined ? { left: menuPos.left } : {}),
                    ...(menuPos.right !== undefined ? { right: menuPos.right } : {}),
                    transform: 'translateY(-100%)',
                    zIndex: 9999,
                  }}
                  className="flex flex-col bg-white dark:bg-gray-800 shadow-2xl rounded-2xl border border-gray-100 dark:border-gray-700 overflow-hidden whitespace-nowrap min-w-[140px]"
                >
                  <div className="flex flex-col divide-y divide-gray-100 dark:divide-gray-700">
                    {onReply && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onReply();
                          setShowActions(false);
                        }}
                        className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 text-emerald-600 dark:text-emerald-400 text-[13px] font-bold transition-all active:scale-95 text-left w-full"
                      >
                        <div className="flex items-center gap-2">
                          <Reply size={16} />
                          <span>Reply</span>
                        </div>
                      </button>
                    )}
                    {onDelete && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onDelete();
                          setShowActions(false);
                        }}
                        className="flex items-center gap-3 px-4 py-3 hover:bg-red-50 dark:hover:bg-red-900/20 text-red-600 dark:text-red-400 text-[13px] font-bold transition-all active:scale-95 text-left w-full"
                      >
                        <div className="flex items-center gap-2">
                          <Trash2 size={16} />
                          <span>Delete</span>
                        </div>
                      </button>
                    )}
                    {text && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          navigator.clipboard.writeText(text);
                          setCopied(true);
                          setTimeout(() => {
                            setCopied(false);
                            setShowActions(false);
                          }, 1500);
                        }}
                        className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 text-gray-700 dark:text-gray-300 text-[13px] font-bold transition-all active:scale-95 text-left w-full"
                      >
                        <div className="flex items-center gap-2">
                          {copied ? <Check size={16} className="text-green-500" /> : <Copy size={16} />}
                          <span>{copied ? 'Copied!' : 'Copy'}</span>
                        </div>
                      </button>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setForwardAsForwarded(false);
                        setShowForwardModal(true);
                        setShowActions(false);
                      }}
                      className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 text-primary-600 dark:text-primary-400 text-[13px] font-bold transition-all active:scale-95 text-left w-full"
                    >
                      <div className="flex items-center gap-2">
                        <Forward size={16} />
                        <span>Forward (Simple)</span>
                      </div>
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setForwardAsForwarded(true);
                        setShowForwardModal(true);
                        setShowActions(false);
                      }}
                      className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 text-sky-600 dark:text-sky-400 text-[13px] font-bold transition-all active:scale-95 text-left w-full"
                    >
                      <div className="flex items-center gap-2">
                        <Forward size={16} />
                        <span>Forward (with Tag)</span>
                      </div>
                    </button>
                  </div>
                </motion.div>,
                document.body
            )}
            {/* Unified Transfer / Charm Card */}
            {(isTokenTransfer || isCharm) && (
              <div className="flex flex-col gap-1 min-w-[200px] max-w-full p-1">
                {/* Header */}
                <div className="flex items-center justify-between border-b border-gray-100 dark:border-gray-700 pb-2 mb-1">
                  <span className="text-[10px] uppercase tracking-widest text-gray-400 dark:text-gray-500 font-bold flex items-center gap-1">
                    <span>{isCharm ? '✨' : '💸'}</span>
                    {isCharm ? 'CHARM' : 'TRANSFER'}
                  </span>
                  {fromMe && (
                    <div className="flex items-center gap-1">
                      {currentStatus === 'confirmed' ? (
                        <span className="text-[10px] font-bold text-emerald-600">CONFIRMED</span>
                      ) : currentStatus === 'failed' ? (
                        <span className="text-[10px] font-bold text-red-500">FAILED</span>
                      ) : (
                        <span className="text-[10px] font-medium text-orange-600 animate-pulse">PROCESSING</span>
                      )}
                    </div>
                  )}
                  {!fromMe && status === 'received' && (
                    <span className="text-[10px] font-medium text-blue-500 animate-pulse">RECEIVING</span>
                  )}
                  {!fromMe && (status === 'confirmed' || currentStatus === 'confirmed') && (
                    <span className="text-[10px] font-bold text-emerald-600">CONFIRMED</span>
                  )}
                </div>

                {/* Token amount */}
                {isTokenTransfer && (
                  <div className="py-2 flex items-baseline gap-1.5 justify-center">
                    <span className="text-3xl font-black text-transparent bg-clip-text bg-gradient-to-br from-cyan-600 to-blue-600 dark:from-cyan-400 dark:to-blue-400">
                      {tokenAmount!.amount}
                    </span>
                    <span className="text-sm font-bold text-gray-400 uppercase">{tokenAmount!.tokenName}</span>
                  </div>
                )}

                {/* Charm animation */}
                {isCharm && animationData && (
                  <div className="flex flex-col items-center py-2">
                    <div className="w-32 h-32">
                      <Lottie animationData={animationData} loop={true} />
                    </div>
                    {amount != null && amount > 0 && (
                      <div className="flex items-baseline gap-1.5 mt-2">
                        <span className="text-xl font-black text-transparent bg-clip-text bg-gradient-to-br from-cyan-600 to-blue-600 dark:from-cyan-400 dark:to-blue-400">
                          {amount}
                        </span>
                        <span className="text-xs font-bold text-gray-400 uppercase">Minima</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Text Content */}
            {text && (!isTokenTransfer || (isTokenTransfer && !text.includes(tokenAmount!.amount))) && (
              <p className={`${isSingleEmoji ? 'text-5xl leading-none' : `text-sm leading-relaxed whitespace-pre-wrap break-words ${isCharm || isImage ? 'mt-2' : ''}`}`}>
                {text.split(/((?:https?:\/\/|www\.)[^\s]+)/g).map((part, i) => {
                  if ((part.startsWith('http') || part.startsWith('www.')) && /^(?:https?:\/\/|www\.)[^\s]+$/.test(part)) {
                    let url = part.startsWith('http') ? part : 'https://' + part;
                    return (
                      <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="text-primary-600 dark:text-primary-400 hover:underline">
                        {part}
                      </a>
                    );
                  }
                  return part;
                })}
              </p>
            )}

            {/* Image Content */}
            {isImage && filedata && (
              <div className="mt-1 mb-1 max-w-[240px] sm:max-w-xs md:max-w-sm rounded-[10px] overflow-hidden bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 shadow-sm">
                <img
                  src={filedata}
                  alt="Attachment"
                  className="w-full h-auto object-cover hover:opacity-90 transition-opacity cursor-pointer"
                  onClick={() => window.open(filedata, '_blank')}
                  loading="lazy"
                />
              </div>
            )}

            {/* Status Footer */}
            {fromMe && (
              <div className={`flex items-center justify-end gap-1 mt-1 ${textColor === 'text-white' ? 'opacity-80' : 'opacity-60'}`}>
                <span className="text-[9px]">
                  {status === 'pending' && <span className="animate-pulse">⌛</span>}
                  {status === 'sent' && "✓"}
                  {status === 'delivered' && "✓✓"}
                  {status === 'read' && <span className={`${textColor === 'text-white' ? 'text-white font-black' : 'text-primary-500 font-bold'}`}>✓✓</span>}
                  {status === 'confirmed' && <span className={`${textColor === 'text-white' ? 'text-white font-black' : 'text-emerald-500 font-bold'}`}>✓✓</span>}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  if (deleted) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className={`flex flex-col w-full px-2 ${alignment}`}
      >
        <div className={`flex ${flexDir} gap-3 mb-2 max-w-full`}>
          {showAvatar && <div className="w-9 flex-shrink-0" />}
          {!showAvatar && <div className="w-9 flex-shrink-0" />}
          <div className={`flex-1 min-w-0 flex flex-col ${fromMe ? 'items-end' : 'items-start'}`}>
            <div className="px-4 py-2 rounded-2xl bg-gray-100 dark:bg-gray-800/50 border border-dashed border-gray-300 dark:border-gray-600 text-gray-400 dark:text-gray-500 text-sm italic">
              This message was deleted
            </div>
          </div>
        </div>
      </motion.div>
    );
  }

  if (!text && !charm && !tokenAmount && !isImage) {
    return null;
  }

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className={`flex flex-col w-full px-2 ${alignment}`}
      >
        {renderBubbleContent()}
      </motion.div>

      {showForwardModal && (
        <ForwardModal
          message={isCharm || isImage ? "" : (text || "")}
          messageType={isCharm ? "charm" : isImage ? "image" : (type || "text")}
          filedata={isCharm ? (charm?.id || "") : isImage ? (filedata || "") : ""}
          onClose={() => setShowForwardModal(false)}
          isForwarded={forwardAsForwarded}
          currentChatId={currentChatId}
        />
      )}
    </>
  );
}
