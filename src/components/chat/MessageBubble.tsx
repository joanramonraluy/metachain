// src/components/chat/MessageBubble.tsx

import Lottie from "lottie-react";
import { motion, AnimatePresence } from "framer-motion";
import { useState, useEffect } from "react";

// Dynamic import of all .json files
const charmModules = import.meta.glob('../../assets/animations/*.json', { eager: true });

interface MessageBubbleProps {
  fromMe: boolean;
  text?: string | null;
  charm?: { id: string } | null;
  amount?: number | null;
  // Ensure timestamp is treated as number (it comes from DB as number)
  timestamp?: number;
  status?: 'pending' | 'sent' | 'delivered' | 'read' | 'failed' | 'zombie' | 'confirmed';
  tokenAmount?: { amount: string; tokenName: string };
  senderName?: string;
  senderImage?: string; // Base64 or URL
  onAvatarClick?: () => void;
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

export default function MessageBubble({ fromMe, text, charm, amount, timestamp, status, tokenAmount, senderName, senderImage, onAvatarClick }: MessageBubbleProps) {
  const isCharm = !!charm;
  const isTokenTransfer = !!tokenAmount;
  const [showCelebration, setShowCelebration] = useState(false);
  const [prevStatus, setPrevStatus] = useState<MessageBubbleProps['status']>(status);

  // Trigger celebration when status changes from pending to sent/read
  useEffect(() => {
    if (prevStatus === 'pending' && (status === 'sent' || status === 'read') && (isTokenTransfer || isCharm)) {
      setShowCelebration(true);
      setTimeout(() => setShowCelebration(false), 1500);
    }
    setPrevStatus(status);
  }, [status, isTokenTransfer, isCharm, prevStatus]);

  // Use status directly - no fake pending needed
  // Enhanced status logic:
  // For tokens/charms, 'read' implies the transaction was received and viewed.
  // We treat 'read' as 'confirmed' to ensure the UI shows the green CONFIRMED badge
  // instead of falling back to the default PROCESSING state.
  const currentStatus = (isTokenTransfer || isCharm) && (status === 'read' || status === 'delivered')
    ? 'confirmed'
    : status;

  let bubbleColor = "";
  let textColor = "text-gray-900 dark:text-gray-100";

  if (currentStatus === 'failed') {
    bubbleColor = "bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-900/50 shadow-sm opacity-90";
  } else if (isCharm) {
    bubbleColor = "bg-transparent shadow-none border-none p-0 overflow-visible";
  } else if (isTokenTransfer) {
    bubbleColor = "bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-800 dark:via-gray-700 dark:to-gray-800 border border-gray-200 dark:border-gray-600 shadow-md";
  } else if (fromMe) {
    // Channel-style primary (sky-blue/primary)
    bubbleColor = "bg-white dark:bg-gray-800 border border-primary-100 dark:border-primary-900 shadow-sm";
  } else {
    // Channel-style white/dark
    bubbleColor = "bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 shadow-sm";
  }

  // Channel style treats corners differently: rounded-2xl with a specific beak
  const borderRadius = fromMe
    ? "rounded-2xl rounded-tr-sm"
    : "rounded-2xl rounded-tl-sm";

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
      <div
        className={`flex-shrink-0 mt-1 ${onAvatarClick ? 'cursor-pointer hover:opacity-80 transition-opacity' : ''}`}
        onClick={onAvatarClick}
      >
        <div className={`w-9 h-9 rounded-full ${fromMe ? 'bg-primary-500' : 'bg-sky-500'} flex items-center justify-center text-white text-xs font-bold shadow-sm overflow-hidden`}>
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

      {/* Content Section */}
      <div className={`flex-1 min-w-0 flex flex-col ${fromMe ? 'items-end' : 'items-start'}`}>
        {/* Header (Name + Time) */}
        <div className={`flex items-baseline gap-2 mb-1 px-1 ${headerAlign}`}>
          {!fromMe && (
            <span className="text-xs font-semibold text-sky-600 dark:text-sky-400">
              {senderName || "Unknown"}
            </span>
          )}
          {fromMe && (
            <span className="text-[10px] text-gray-400 dark:text-gray-500 order-first">
              {new Date(timestamp || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
          {fromMe && (
            <span className="text-xs font-semibold text-primary-600 dark:text-primary-400">
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
            {isTokenTransfer && currentStatus === 'pending' && (
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
            className={`relative px-4 py-2.5 ${borderRadius} ${bubbleColor} ${textColor} min-w-[80px] shadow-sm transition-all duration-200`}
          >
            {/* Token Transfer Content */}
            {isTokenTransfer && (
              <div className="flex flex-col gap-1 min-w-[200px] max-w-full p-1">
                <div className="flex items-center justify-between border-b border-gray-100 dark:border-gray-700 pb-2 mb-1">
                  <span className="text-[10px] uppercase tracking-widest text-gray-400 dark:text-gray-500 font-bold flex items-center gap-1">
                    <span>💸</span> TRANSFER
                  </span>
                  <div className="flex items-center gap-1">
                    {currentStatus === 'confirmed' ? (
                      <span className="text-[10px] font-bold text-emerald-600">CONFIRMED</span>
                    ) : (
                      <span className="text-[10px] font-medium text-orange-600">PROCESSING</span>
                    )}
                  </div>
                </div>
                <div className="py-2 flex items-baseline gap-1.5 justify-center">
                  <span className="text-3xl font-black text-transparent bg-clip-text bg-gradient-to-br from-cyan-600 to-blue-600 dark:from-cyan-400 dark:to-blue-400">
                    {tokenAmount.amount}
                  </span>
                  <span className="text-sm font-bold text-gray-400 uppercase">{tokenAmount.tokenName}</span>
                </div>
              </div>
            )}

            {/* Charm Content */}
            {isCharm && animationData && (
              <div className="flex flex-col items-center">
                <div className="w-32 h-32">
                  <Lottie animationData={animationData} loop={true} />
                </div>
                {amount != null && (
                  <div className="text-sm font-bold bg-white/50 dark:bg-black/20 px-3 py-1 rounded-full mt-2">
                    💎 {amount} MINIMA
                  </div>
                )}
              </div>
            )}

            {/* Text Content */}
            {text && (!isTokenTransfer || (isTokenTransfer && !text.includes(tokenAmount!.amount))) && (
              <p className={`text-sm leading-relaxed whitespace-pre-wrap break-words ${isCharm ? 'mt-2' : ''}`}>
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

            {/* Status Footer */}
            {fromMe && !isCharm && (
              <div className="flex items-center justify-end gap-1 mt-1 opacity-60">
                <span className="text-[9px]">
                  {status === 'pending' && <span className="animate-pulse">⌛</span>}
                  {status === 'sent' && "✓"}
                  {status === 'delivered' && "✓✓"}
                  {status === 'read' && <span className="text-primary-500 font-bold">✓✓</span>}
                  {status === 'confirmed' && <span className="text-emerald-500 font-bold">✓✓</span>}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={`flex flex-col w-full px-2 ${alignment}`}
    >
      {renderBubbleContent()}
    </motion.div>
  );
}
