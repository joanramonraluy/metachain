import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Lottie from "lottie-react";

interface Charm {
  id: string;
  label: string;
  name: string;
  animationData: any; // Lottie JSON data
}

// Dynamic import of all .json files in src/assets/animations
const charmModules = import.meta.glob('../../assets/animations/*.json', { eager: true });

const charms: Charm[] = Object.keys(charmModules).map((path) => {
  const fileName = path.split('/').pop() || '';
  const id = fileName.replace('.json', '');
  // Generate a readable name from the filename (e.g., "super_star" -> "Super Star")
  const name = id.split(/[_-]/).map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');

  // Assign a default label based on keywords in the filename
  let label = "✨";
  if (id.includes("star")) label = "⭐";
  else if (id.includes("heart")) label = "❤️";
  else if (id.includes("fire")) label = "🔥";

  return {
    id,
    label,
    name,
    animationData: (charmModules[path] as any).default
  };
});

const presetAmounts = [1, 5, 10, 20];

interface CharmSelectorProps {
  onSend: (data: { charmId: string; charmLabel: string; charmAnimation: any; amount: number }) => void;
  onClose: () => void;
}

export default function CharmSelector({ onSend, onClose }: CharmSelectorProps) {
  const [selectedCharm, setSelectedCharm] = useState<Charm | null>(null);
  const [selectedAmount, setSelectedAmount] = useState<number | "custom" | null>(null);
  const [customAmount, setCustomAmount] = useState("");

  const handleSend = () => {
    const amount =
      selectedAmount === "custom" ? Number(customAmount) : selectedAmount;
    if (!selectedCharm || !amount || amount <= 0) return;

    onSend({
      charmId: selectedCharm.id,
      charmLabel: selectedCharm.label,
      charmAnimation: selectedCharm.animationData, // Passing JSON data
      amount
    });
    onClose();
  };

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 bg-gray-900 bg-opacity-75 flex items-center justify-center z-50 p-4"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      >
        <motion.div
          className="bg-gray-800 rounded-xl shadow-xl w-96 max-w-full p-6"
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.9, opacity: 0 }}
        >
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-xl font-bold text-white">Send a Charm</h3>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-200 transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
          </div>

          {/* Charm selector */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-300 mb-2">Select Charm</label>
            <div className="grid grid-cols-3 gap-3">
              {charms.map((c) => (
                <button
                  key={c.id}
                  className={`p-3 rounded-lg border transition-all ${selectedCharm === c
                    ? "bg-blue-900/50 border-blue-500 border-2"
                    : "border-gray-600 bg-gray-700 hover:bg-gray-600"
                    } `}
                  onClick={() => setSelectedCharm(c)}
                  title={c.name}
                >
                  <div className="h-[60px] w-[60px] flex items-center justify-center">
                    <Lottie animationData={c.animationData} loop={true} />
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Amount selector */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-300 mb-2">Minima Amount</label>
            <div className="flex flex-wrap gap-2 mb-3">
              {presetAmounts.map((amt) => (
                <button
                  key={amt}
                  className={`px-4 py-2 rounded-md border transition-all font-medium ${selectedAmount === amt
                    ? "bg-blue-900/50 border-blue-500 text-blue-300"
                    : "border-gray-600 bg-gray-700 text-gray-300 hover:bg-gray-600"
                    } `}
                  onClick={() => setSelectedAmount(amt)}
                >
                  {amt}
                </button>
              ))}
              <button
                className={`px-4 py-2 rounded-md border transition-all font-medium ${selectedAmount === "custom"
                  ? "bg-blue-900/50 border-blue-500 text-blue-300"
                  : "border-gray-600 bg-gray-700 text-gray-300 hover:bg-gray-600"
                  } `}
                onClick={() => setSelectedAmount("custom")}
              >
                Other
              </button>
            </div>
            {selectedAmount === "custom" && (
              <input
                type="number"
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 text-white rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent placeholder-gray-400 outline-none"
                value={customAmount}
                min={1}
                placeholder="Enter amount"
                onChange={(e) => setCustomAmount(e.target.value)}
              />
            )}
          </div>

          <div className="flex gap-3 pt-2">
            <button
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-gray-600 text-gray-300 rounded-lg hover:bg-gray-700 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSend}
              disabled={!selectedCharm || !selectedAmount}
              className={`flex-1 px-4 py-2 rounded-lg transition-colors font-medium ${selectedCharm && selectedAmount
                ? "bg-blue-600 hover:bg-blue-700 text-white"
                : "bg-gray-700 text-gray-500 cursor-not-allowed border border-gray-600"
                } `}
            >
              Send Charm
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
