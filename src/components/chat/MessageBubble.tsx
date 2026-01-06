// src/components/chat/MessageBubble.tsx

import Lottie from "lottie-react";
import { motion, AnimatePresence } from "framer-motion";
import { useState, useEffect } from "react";
import { safeUrl } from "../../utils/sanitization";

// Dynamic import of all .json files
const charmModules = import.meta.glob('../../assets/animations/*.json', { eager: true });

interface MessageBubbleProps {
  fromMe: boolean;
  text: string | null;
  charm: { id: string } | null;
  amount: number | null;
  timestamp?: number;
  status?: 'pending' | 'sent' | 'delivered' | 'read' | 'failed' | 'zombie';
  tokenAmount?: { amount: string; tokenName: string };
  senderName?: string;
  senderImage?: string;
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
  const [prevStatus, setPrevStatus] = useState(status);

  // Trigger celebration when status changes from pending to sent
  useEffect(() => {
    if (prevStatus === 'pending' && status === 'sent' && (isTokenTransfer || isCharm)) {
      setShowCelebration(true);
      setTimeout(() => setShowCelebration(false), 1500);
    }
    setPrevStatus(status);
  }, [status, isTokenTransfer, isCharm]);

  // Enhanced colors with gradients for token transfers
  let bubbleColor = "";

  if (status === 'failed') {
    bubbleColor = "bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-900/50 shadow-sm opacity-90 grayscale-[0.3]";
  } else if (isCharm) {
    // Collectible Style: No border, radial glow effect
    bubbleColor = "bg-radial-gradient from-purple-100/50 dark:from-purple-900/30 to-transparent shadow-none border-none p-0 overflow-visible";
  } else if (isTokenTransfer) {
    // Transaction Card Style: Light Gradient, border, shadow
    bubbleColor = "bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-800 dark:via-gray-700 dark:to-gray-800 border border-gray-200 dark:border-gray-600 shadow-md";
  } else if (fromMe) {
    bubbleColor = "bg-primary-50 dark:bg-primary-900/20 shadow-sm border border-primary-100 dark:border-primary-800/50";
  } else {
    bubbleColor = "bg-white dark:bg-gray-800 shadow-sm border border-gray-100 dark:border-gray-700";
  }

  const borderRadius = fromMe
    ? "rounded-l-lg rounded-br-lg rounded-tr-none"
    : "rounded-r-lg rounded-bl-lg rounded-tl-none";

  const alignment = fromMe ? "self-end items-end" : "self-start items-start";

  // Map charm ID to Lottie animation data
  let animationData: any = null;
  if (charm?.id) {
    const key = `../../assets/animations/${charm.id}.json`;
    animationData = (charmModules[key] as any)?.default || null;
  }

  // Pulsing animation for pending state
  const isPending = status === 'pending';

  // Helper to detect if text is ONLY emojis (up to 4) to make them JUMBO
  const isJumboEmoji = text && !isCharm && !isTokenTransfer &&
    /^[\p{Extended_Pictographic}\s]{1,12}$/u.test(text);

  // Helper to render the bubble content
  const renderBubbleContent = () => (
    <>
      <AnimatePresence>
        {isTokenTransfer && status === 'pending' && (
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
        className={`relative px-3 py-2 ${borderRadius} ${bubbleColor} dark:text-gray-100 min-w-[80px] overflow-visible`}
        style={{ position: 'relative' }}
      >
        {/* Token Transfer Badge with enhanced styling */}
        {isTokenTransfer && (
          <div className="flex flex-col gap-3 min-w-[180px] max-w-full">
            {/* Header: Icon + Label */}
            <div className="flex items-center gap-2 border-b border-gray-200 pb-2 mb-1">
              <div className="w-8 h-8 rounded-full bg-cyan-50 flex items-center justify-center text-cyan-600">
                <span className="text-lg">💸</span>
              </div>
              <div className="flex flex-col">
                <span className="text-[10px] uppercase tracking-widest text-gray-500 dark:text-gray-400 font-semibold">Transfer</span>
                <span className="text-xs text-cyan-600 dark:text-cyan-400 font-medium">
                  {status === 'pending' ? 'Processing...' : 'Confirmed'}
                </span>
              </div>
            </div>

            {/* Amount - Big Typography */}
            <div className="py-1">
              <div className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-cyan-600 to-emerald-600 tracking-tight break-all">
                {tokenAmount.amount}
              </div>
              <div className="text-sm font-medium text-gray-500 dark:text-gray-400 mt-0.5 break-all">
                {tokenAmount.tokenName}
              </div>
            </div>

            {/* Status Footer */}
            {status === 'pending' && (
              <div className="text-[10px] bg-yellow-500/10 text-yellow-500 px-2 py-1 rounded border border-yellow-500/20 self-start animate-pulse">
                Waiting for network...
              </div>
            )}
          </div>
        )}

        {/* Charm with enhanced animation */}
        {isCharm && animationData && (
          <motion.div
            className="relative"
            initial={{ scale: 0.8, rotate: -5 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: "spring", stiffness: 200, damping: 10 }}
          >
            {/* Glow Effect behind charm */}
            <div className="absolute inset-0 bg-yellow-400/20 blur-2xl rounded-full scale-150 animate-pulse" />

            <div className="w-40 h-40 relative z-10 drop-shadow-xl filter">
              <Lottie animationData={animationData} loop={true} />
            </div>
          </motion.div>
        )}

        {/* Text with Link Parsing */}
        {text && (
          <p className={`leading-relaxed whitespace-pre-wrap break-all mt-2 ${isTokenTransfer
            ? 'text-gray-600 dark:text-gray-300 font-normal border-t border-gray-200 dark:border-gray-600 pt-2 text-[15px]'
            : isJumboEmoji
              ? 'text-5xl leading-tight py-2' // Jumbo size for emojis
              : 'text-gray-800 dark:text-gray-100 text-[15px]'
            } ${isCharm ? 'text-center font-medium bg-white/50 dark:bg-black/20 backdrop-blur-sm px-3 py-1 rounded-full text-sm inline-block shadow-sm' : ''}`}>
            {text.split(/((?:https?:\/\/|www\.)[^\s]+)/g).map((part, i) => {
              // Only render as link if it actually LOOKS like a URL (matches the split regex logic)
              if ((part.startsWith('http') || part.startsWith('www.')) && /^(?:https?:\/\/|www\.)[^\s]+$/.test(part)) {
                const url = safeUrl(part);
                if (url) {
                  return (
                    <a
                      key={i}
                      href={url}
                      target="_blank"

                      rel="noopener noreferrer"
                      className="text-primary-600 dark:text-primary-400 hover:underline"
                      onClick={(e) => e.stopPropagation()} // Prevent bubble click handlers
                    >
                      {part}
                    </a>
                  );
                }
              }
              return part;
            })}
          </p>
        )}

        {/* Charm content */}
        {isCharm && (
          <div className="mt-2">
            {amount != null && (
              <motion.div
                initial={{ scale: 0.8, y: 10 }}
                animate={{ scale: 1, y: 0 }}
                transition={{ type: "spring", stiffness: 300, damping: 15, delay: 0.1 }}
                className="text-sm font-bold text-gray-700 bg-white/80 backdrop-blur-md px-3 py-1 rounded-full shadow-sm border border-white/50 inline-flex items-center gap-1.5"
              >
                <span>💎</span>
                {amount} MINIMA
              </motion.div>
            )}
          </div>
        )}

        {/* Status indicator */}
        <div className={`text-xs mt-1 text-right flex items-center justify-end gap-1 ${fromMe ? (status === 'failed' ? 'text-red-500' : 'text-gray-600 dark:text-gray-400') : 'text-gray-400 dark:text-gray-500'
          }`}>
          {status === 'pending' && (
            <span className="flex items-center gap-1 bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded text-[10px] font-medium">
              <span className="animate-spin">⏳</span> Waiting Approval
            </span>
          )}

          {((isCharm && charm) || (isTokenTransfer && tokenAmount)) && (status === 'sent' || status === 'delivered' || status === 'read') && fromMe && (
            <span className="flex items-center gap-1 bg-green-100 text-green-700 px-1.5 py-0.5 rounded text-[10px] font-medium mr-1">
              <span>✓</span> Transaction Confirmed
            </span>
          )}

          {((isCharm && charm) || (isTokenTransfer && tokenAmount)) && status === 'failed' && fromMe && (
            <span className="flex items-center gap-1 bg-red-100 text-red-700 px-1.5 py-0.5 rounded text-[10px] font-medium mr-1">
              <span>❌</span> Transaction Denied
            </span>
          )}

          <span>
            {new Date(timestamp || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
          {fromMe && (
            <span className="flex items-center ml-1">
              {status === 'sent' && (
                <svg className="w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              )}
              {status === 'delivered' && (
                <div className="flex relative w-5 h-3.5">
                  <svg className="w-3.5 h-3.5 text-gray-400 absolute left-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                  <svg className="w-3.5 h-3.5 text-gray-400 absolute left-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
              )}
              {status === 'read' && (
                <div className="flex relative w-5 h-3.5">
                  <svg className="w-3.5 h-3.5 text-primary-600 absolute left-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                  <svg className="w-3.5 h-3.5 text-primary-600 absolute left-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
              )}
              {status === 'failed' && <span className="text-xs">❌</span>}
            </span>
          )}
        </div>
      </div>
    </>
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{
        opacity: isPending ? 0.85 : 1,
        y: 0,
        scale: isPending ? [1, 1.02, 1] : 1
      }}
      transition={isPending ? {
        opacity: { duration: 0.3 },
        y: { duration: 0.3 },
        scale: { duration: 1.5, repeat: Infinity, ease: "easeInOut" }
      } : { duration: 0.3 }}
      className={`flex flex-col max-w-[80%] mb-2 ${alignment} relative`}
    >
      {!fromMe && senderName ? (
        <div className="flex items-end gap-2 max-w-full">
          {/* Avatar */}
          <div
            className={`flex-shrink-0 mb-1 ${onAvatarClick ? 'cursor-pointer hover:opacity-80 transition-opacity' : ''}`}
            onClick={onAvatarClick}
          >
            {senderImage ? (
              <img
                src={senderImage}
                alt={senderName}
                className="w-8 h-8 rounded-full bg-gray-200 object-cover border border-gray-100"
              />
            ) : (
              <img
                src={defaultAvatar}
                alt={senderName}
                className="w-8 h-8 rounded-full bg-gray-200 object-cover border border-gray-100"
              />
            )}
          </div>

          <div className="flex flex-col items-start min-w-0">
            <span className="text-[11px] text-gray-500 dark:text-gray-400 ml-1 mb-0.5 truncate max-w-[200px]">
              {senderName}
            </span>
            {renderBubbleContent()}
          </div>
        </div>
      ) : (
        renderBubbleContent()
      )}
    </motion.div>
  );
}
