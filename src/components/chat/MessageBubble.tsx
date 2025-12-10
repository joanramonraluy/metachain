// src/components/chat/MessageBubble.tsx

import Lottie from "lottie-react";
import { motion, AnimatePresence } from "framer-motion";
import { useState, useEffect } from "react";

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
    bubbleColor = "bg-red-50 border-2 border-red-200 shadow-sm opacity-90 grayscale-[0.3]";
  } else if (isCharm) {
    bubbleColor = "bg-gradient-to-br from-indigo-100 to-blue-50 border-2 border-indigo-200 shadow-lg";
  } else if (isTokenTransfer) {
    bubbleColor = "bg-gradient-to-br from-cyan-100 via-sky-50 to-blue-50 border-2 border-cyan-300 shadow-lg";
  } else if (fromMe) {
    bubbleColor = "bg-blue-50 shadow-sm";
  } else {
    bubbleColor = "bg-white shadow-sm";
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
        className={`relative px-3 py-2 ${borderRadius} ${bubbleColor} min-w-[80px] overflow-visible`}
        style={{ position: 'relative' }}
      >
        {/* Token Transfer Badge with enhanced styling */}
        {isTokenTransfer && (
          <motion.div
            initial={{ scale: 0.8, opacity: 0, y: -10 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 15 }}
            className="flex items-center gap-3 mb-2 relative"
          >
            {/* Animated money icon */}
            <motion.span
              className="text-3xl"
              animate={status === 'pending' ? {
                rotate: [0, -10, 10, -10, 0],
                scale: [1, 1.1, 1]
              } : {}}
              transition={{
                duration: 0.5,
                repeat: status === 'pending' ? Infinity : 0,
                repeatDelay: 0.5
              }}
            >
              💰
            </motion.span>
            <div>
              <div className="text-xl font-bold bg-gradient-to-r from-cyan-700 to-blue-600 bg-clip-text text-transparent">
                {tokenAmount.amount} {tokenAmount.tokenName}
              </div>
              <div className="text-xs font-semibold text-cyan-600 uppercase tracking-wide flex items-center gap-1">
                <motion.span
                  animate={status === 'pending' ? { opacity: [1, 0.5, 1] } : {}}
                  transition={{ duration: 1, repeat: Infinity }}
                >
                  {status === 'pending' ? '⏳ Sending...' : '✓ Token Transfer'}
                </motion.span>
              </div>
            </div>
          </motion.div>
        )}

        {/* Charm with enhanced animation */}
        {isCharm && animationData && (
          <motion.div
            className="w-32 h-32 mb-1"
            initial={{ scale: 0.8, rotate: -10 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: "spring", stiffness: 200, damping: 12 }}
          >
            <Lottie animationData={animationData} loop={true} />
          </motion.div>
        )}

        {/* Text */}
        {text && (
          <p className={`text-[15px] leading-relaxed whitespace-pre-wrap break-words ${isTokenTransfer ? 'text-gray-700 font-medium' : 'text-gray-800'
            }`}>
            {text}
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
                className="text-base font-bold bg-gradient-to-r from-indigo-700 to-blue-600 bg-clip-text text-transparent flex items-center gap-1.5"
              >
                <motion.span
                  animate={{ rotate: [0, -10, 10, -10, 0] }}
                  transition={{ duration: 0.5, delay: 0.2 }}
                >
                  💎
                </motion.span>
                {amount} MINIMA
              </motion.div>
            )}
          </div>
        )}

        {/* Status indicator */}
        <div className={`text-xs mt-1 text-right flex items-center justify-end gap-1 ${fromMe ? (status === 'failed' ? 'text-red-500' : 'text-gray-600') : 'text-gray-400'
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
                  <svg className="w-3.5 h-3.5 text-blue-600 absolute left-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                  <svg className="w-3.5 h-3.5 text-blue-600 absolute left-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
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
            <span className="text-[11px] text-gray-500 ml-1 mb-0.5 truncate max-w-[200px]">
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
