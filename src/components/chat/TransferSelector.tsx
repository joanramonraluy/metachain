import React, { useEffect, useState } from 'react';
import { minimaService } from '../../services/minima.service';
import { getCharms, Charm } from '../../services/charm.service';
import Lottie from "lottie-react";
import { BalanceAmount } from '../common/BalanceAmount';

interface Token {
    tokenid: string;
    token: string | { name: string; url?: string };
    sendable: string;
    confirmed: string;
    unconfirmed?: string;
}

interface TransferSelectorProps {
    onSend: (data: { tokenId: string; amount: string; tokenName: string; charmId?: string }) => void;
    onCancel: () => void;
}

const TransferSelector: React.FC<TransferSelectorProps> = ({ onSend, onCancel }) => {
    const [tokens, setTokens] = useState<Token[]>([]);
    const [selectedTokenId, setSelectedTokenId] = useState<string>('0x00');
    const [amount, setAmount] = useState<string>('');
    const [selectedCharm, setSelectedCharm] = useState<Charm | null>(null);
    const [loading, setLoading] = useState(true);
    const [charms, setCharms] = useState<Charm[]>([]);

    useEffect(() => {
        let mounted = true;
        const loadData = async () => {
            try {
                // Load balances
                const balance = await minimaService.getBalance();
                if (mounted) {
                    setTokens(balance || []);
                }

                // Load charms (sync)
                if (mounted) {
                    setCharms(getCharms());
                    setLoading(false);
                }
            } catch (err) {
                console.error("Error loading transfer data:", err);
                if (mounted) setLoading(false);
            }
        };
        loadData();
        return () => { mounted = false; };
    }, []);

    const handleSendClick = () => {
        // Validation matches TokenSelector.tsx
        if (!amount || parseFloat(amount) <= 0) {
            alert("Please enter a valid amount");
            return;
        }
        executeSend();
    };

    const executeSend = () => {
        try {
            console.log("TransferSelector: executeSend started");

            const token = tokens.find(t => t.tokenid === selectedTokenId);
            // Simplified token name logic matching TokenSelector.tsx
            const tokenName = typeof token?.token === 'string' ? token.token : token?.token?.name || 'Minima';

            // Explicitly construct the payload to prevent any unseen getters/setters or proxy issues
            const payload = {
                tokenId: selectedTokenId,
                amount: amount,
                tokenName: tokenName,
                charmId: selectedCharm ? selectedCharm.id : undefined
            };

            console.log("TransferSelector: Executing onSend with payload:", JSON.stringify(payload));
            onSend(payload);
        } catch (err: any) {
            console.error("TransferSelector: executeSend failed:", err);
            alert("Error preparing transfer: " + (err.message || err));
        }
    };

    const getTokenName = (t: Token) => {
        if (t.tokenid === '0x00') return 'Minima';
        if (typeof t.token === 'string') return JSON.parse(t.token).name;
        // Handle potential object structure
        return t.token.name || "Unknown Token";
    };

    const isMinimaSelected = selectedTokenId === '0x00';

    if (loading) {
        return (
            <div
                className="fixed inset-0 bg-gray-900 bg-opacity-75 flex items-center justify-center z-[100] p-4"
                onClick={onCancel}
            >
                <div
                    className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-[480px] max-w-full p-6 border border-gray-200 dark:border-gray-700 flex items-center justify-center min-h-[300px]"
                    onClick={(e) => e.stopPropagation()}
                >
                    <div className="flex flex-col items-center gap-3">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500"></div>
                        <span className="text-gray-500 dark:text-gray-400 font-medium">Loading assets...</span>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div
            className="fixed inset-0 bg-gray-900 bg-opacity-75 flex items-center justify-center z-[100] p-4"
            onClick={onCancel}
        >
            <div
                className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-[480px] max-w-full p-6 max-h-[90vh] overflow-y-auto border border-gray-200 dark:border-gray-700"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex justify-between items-center mb-6">
                    <h3 className="text-xl font-bold text-gray-900 dark:text-white">Send Value</h3>
                    <button
                        onClick={onCancel}
                        className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                    </button>
                </div>

                <div className="space-y-6">
                    {/* Token Selection */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Select Asset</label>
                        <div className="max-h-48 overflow-y-auto border border-gray-200 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700">
                            {tokens.map((t) => (
                                <div
                                    key={t.tokenid}
                                    onClick={() => {
                                        setSelectedTokenId(t.tokenid);
                                        // Reset charm if switching away from Minima
                                        if (t.tokenid !== '0x00') setSelectedCharm(null);
                                    }}
                                    className={`p-3 cursor-pointer flex justify-between items-center hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors ${selectedTokenId === t.tokenid ? 'bg-primary-50 dark:bg-primary-900/50 border-l-4 border-primary-500' : 'border-l-4 border-transparent'}`}
                                >
                                    <div className="flex items-center gap-2">
                                        {t.tokenid === '0x00' && <span className="text-xl">💎</span>}
                                        <span className="font-medium text-gray-900 dark:text-white">{t.tokenid === '0x00' ? 'Minima' : getTokenName(t)}</span>
                                    </div>
                                    <div className="flex flex-col items-end">
                                        <BalanceAmount
                                            amount={t.sendable}
                                            unconfirmed={t.unconfirmed || '0'}
                                            className="text-sm font-bold text-gray-700 dark:text-gray-300"
                                        />
                                        <span className="text-xs text-gray-500 dark:text-gray-400">Available</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Amount Selection */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Amount</label>
                        <div className="relative">
                            <input
                                type="text"
                                inputMode="decimal"
                                value={amount}
                                onKeyDown={(e) => {
                                    // Allow control keys (Backspace, Delete, Arrow keys, Tab, Enter)
                                    if ([
                                        'Backspace', 'Delete', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Tab', 'Enter', 'Home', 'End'
                                    ].includes(e.key) || e.ctrlKey || e.metaKey || e.altKey) {
                                        return;
                                    }

                                    // Block invalid keys for a positive amount: minus, plus, e
                                    if (['-', '+', 'e', 'E'].includes(e.key)) {
                                        e.preventDefault();
                                        return;
                                    }

                                    // Block if it's not a number or period
                                    // Note: This logic is tricky with regex, simpler to rely on onChange for full validation
                                    // but blocking obvious non-numeric keys is good UX.
                                    if (!/^[0-9.]$/.test(e.key)) {
                                        e.preventDefault();
                                    }
                                }}
                                onChange={(e) => {
                                    const val = e.target.value;
                                    // Regex: allow empty string (user deletes all) OR positive decimal numbers
                                    // ^\d* matches start with digits (optional)
                                    // \.? matches optional decimal point
                                    // \d* matches digits after decimal
                                    // This allows ".5" or "10." which are valid intermediate states
                                    if (val === '' || /^\d*\.?\d*$/.test(val)) {
                                        if (val.length <= 20) {
                                            setAmount(val);
                                        }
                                    }
                                }}
                                className="w-full pl-4 pr-24 py-3 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 text-gray-900 dark:text-white rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent placeholder-gray-400 dark:placeholder-gray-400 outline-none text-lg"
                                placeholder="0.00"
                            />
                            <span className="absolute right-4 top-1/2 transform -translate-y-1/2 text-gray-500 dark:text-gray-400 font-medium pointer-events-none max-w-[80px] truncate text-right">
                                {tokens.find(t => t.tokenid === selectedTokenId) ? (tokens.find(t => t.tokenid === selectedTokenId)?.tokenid === '0x00' ? 'Minima' : getTokenName(tokens.find(t => t.tokenid === selectedTokenId)!)) : ''}
                            </span>
                        </div>
                    </div>

                    {/* Charm Selection - Conditional */}
                    <div className={`transition-all duration-300 ${!isMinimaSelected ? 'opacity-50 pointer-events-none grayscale' : ''}`}>
                        <div className="flex items-center justify-between mb-2">
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                                Attach Charm <span className="text-gray-500 font-normal ml-1">(Optional)</span>
                            </label>
                            {!isMinimaSelected && (
                                <span className="text-xs text-yellow-600 dark:text-yellow-500">Only available with Minima</span>
                            )}
                        </div>

                        <div className="grid grid-cols-4 gap-2">
                            {/* None Option */}
                            <button
                                className={`p-2 rounded-lg border transition-all h-[80px] flex flex-col items-center justify-center gap-1 ${selectedCharm === null
                                    ? "bg-primary-50 dark:bg-primary-900/50 border-primary-500 border-2"
                                    : "border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600"
                                    } `}
                                onClick={() => setSelectedCharm(null)}
                            >
                                <span className="text-2xl text-gray-400">∅</span>
                                <span className="text-[10px] text-gray-600 dark:text-gray-300">None</span>
                            </button>

                            {charms.map((c) => (
                                <button
                                    key={c.id}
                                    className={`p-1 rounded-lg border transition-all h-[80px] flex flex-col items-center justify-center ${selectedCharm === c
                                        ? "bg-primary-50 dark:bg-primary-900/50 border-primary-500 border-2"
                                        : "border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600"
                                        } `}
                                    onClick={() => setSelectedCharm(c)}
                                    title={c.name}
                                >
                                    <div className="h-[50px] w-[50px] flex items-center justify-center">
                                        {c.type === 'lottie' ? (
                                            <Lottie animationData={c.data} loop={true} />
                                        ) : (
                                            <img src={c.data} alt={c.name} className="h-full w-full object-contain" />
                                        )}
                                    </div>
                                    <span className="text-[10px] text-gray-600 dark:text-gray-300 truncate w-full text-center px-1">{c.name}</span>
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="flex gap-3 pt-4 border-t border-gray-200 dark:border-gray-700">
                        <button
                            onClick={onCancel}
                            className="flex-1 px-4 py-3 border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors font-medium"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleSendClick}
                            className="flex-1 px-4 py-3 bg-primary-600 hover:bg-primary-700 text-white rounded-lg transition-colors font-medium shadow-lg shadow-primary-900/20"
                        >
                            {selectedCharm ? "Send Charm" : "Transfer"}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default TransferSelector;
