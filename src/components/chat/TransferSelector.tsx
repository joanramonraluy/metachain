import React, { useEffect, useState } from 'react';
import { getCharms, Charm } from '../../services/charm.service';
import Lottie from "lottie-react";
import { BalanceAmount } from '../common/BalanceAmount';
import { useAppContext, TokenBalance } from '../../AppContext';
import { X, Zap, Wallet, Image as ImageIcon } from "lucide-react";

type Token = TokenBalance;

interface TransferSelectorProps {
    onSend: (data: { tokenId: string; amount: string; tokenName: string; charmId?: string }) => void;
    onCancel: () => void;
}

const TransferSelector: React.FC<TransferSelectorProps> = ({ onSend, onCancel }) => {
    const [selectedTokenId, setSelectedTokenId] = useState<string>('0x00');
    const [amount, setAmount] = useState<string>('');
    const [selectedCharm, setSelectedCharm] = useState<Charm | null>(null);
    const [charms, setCharms] = useState<Charm[]>([]);

    const { synced, balance: tokens } = useAppContext();

    useEffect(() => {
        setCharms(getCharms());
    }, []);

    const handleSendClick = () => {
        if (!synced) return; // double check

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

    return (
        <div
            className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-[100] p-4 md:p-8 animate-in fade-in duration-500"
            onClick={onCancel}
        >
            <div
                className="bg-white/90 dark:bg-gray-950/80 backdrop-blur-3xl border border-white/20 dark:border-white/5 rounded-[3rem] shadow-[0_40px_100px_rgba(0,0,0,0.3)] w-full max-w-lg p-3 overflow-hidden animate-in zoom-in-95 duration-500"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Elite Modal Header */}
                <div className="p-8 pb-4 flex items-center justify-between">
                    <div className="flex items-center gap-5">
                       <div className="w-16 h-16 bg-primary-500/10 rounded-[1.5rem] flex items-center justify-center text-primary-500 shadow-inner">
                          <Wallet size={32} strokeWidth={2.5} />
                       </div>
                       <div className="flex flex-col">
                          <span className="text-[10px] font-black text-primary-500 uppercase tracking-[0.4em] mb-1">Grid Protocol</span>
                          <h3 className="text-2xl font-black text-gray-900 dark:text-white uppercase tracking-tight leading-none">Send Value</h3>
                       </div>
                    </div>
                    <button
                        onClick={onCancel}
                        className="w-14 h-14 flex items-center justify-center bg-gray-100 dark:bg-white/5 text-gray-400 hover:text-red-500 rounded-2xl transition-all duration-300 active:scale-90"
                    >
                        <X size={24} strokeWidth={3} />
                    </button>
                </div>

                {/* Status Warning */}
                {!synced && (
                    <div className="mx-8 mb-4 p-5 bg-amber-500/10 border border-amber-500/20 rounded-[1.5rem] flex items-center gap-4 text-amber-600 dark:text-amber-400">
                        <div className="w-10 h-10 bg-amber-500/10 rounded-xl flex items-center justify-center flex-shrink-0">
                           <Zap size={20} className="animate-pulse" />
                        </div>
                        <span className="text-[10px] font-black uppercase tracking-widest leading-relaxed">Transactions are disabled while grid is offline</span>
                    </div>
                )}

                <div className="p-8 pt-4 space-y-8 max-h-[70vh] overflow-y-auto custom-scrollbar">
                    {/* Token Selection */}
                    <div>
                        <div className="px-2 mb-4 flex items-center justify-between">
                           <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.3em]">Select Registry Asset</label>
                           <span className="text-[10px] font-black text-primary-500 uppercase tracking-[0.2em]">{tokens.length} Available</span>
                        </div>
                        
                        <div className="space-y-2">
                            {tokens.map((t) => (
                                <button
                                    key={t.tokenid}
                                    onClick={() => {
                                        setSelectedTokenId(t.tokenid);
                                        if (t.tokenid !== '0x00') setSelectedCharm(null);
                                    }}
                                    className={`w-full p-5 rounded-[1.75rem] transition-all duration-500 flex justify-between items-center group/card ${
                                        selectedTokenId === t.tokenid 
                                        ? 'bg-primary-500 text-white shadow-xl shadow-primary-500/20' 
                                        : 'bg-gray-100 dark:bg-white/5 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-white/10'
                                    }`}
                                >
                                    <div className="flex items-center gap-5 min-w-0">
                                        <div className={`w-14 h-14 rounded-2xl flex items-center justify-center text-2xl shadow-inner transition-transform duration-500 group-hover/card:scale-110 ${selectedTokenId === t.tokenid ? 'bg-white/20' : 'bg-white dark:bg-gray-800'}`}>
                                            {t.tokenid === '0x00' ? '💎' : '🪙'}
                                        </div>
                                        <div className="flex flex-col items-start min-w-0">
                                            <span className="text-sm font-black uppercase tracking-tight truncate w-full">
                                                {t.tokenid === '0x00' ? 'Minima' : getTokenName(t)}
                                            </span>
                                            <span className={`text-[9px] font-black uppercase tracking-[0.2em] ${selectedTokenId === t.tokenid ? 'text-white/60' : 'text-gray-400'}`}>
                                                {t.tokenid === '0x00' ? 'Native Chain' : 'User Asset'}
                                            </span>
                                        </div>
                                    </div>
                                    <div className="flex flex-col items-end flex-shrink-0">
                                        <BalanceAmount
                                            amount={t.sendable}
                                            unconfirmed={t.unconfirmed || '0'}
                                            className={`text-lg font-black tracking-tight ${selectedTokenId === t.tokenid ? 'text-white' : 'text-gray-900 dark:text-white'}`}
                                        />
                                        <span className={`text-[8px] font-black uppercase tracking-widest ${selectedTokenId === t.tokenid ? 'text-white/40' : 'text-gray-400'}`}>Balance Signal</span>
                                    </div>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Amount Input Block */}
                    <div>
                        <div className="px-2 mb-4">
                           <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.3em]">Transmission Amount</label>
                        </div>
                        <div className="relative group">
                            <div className="absolute inset-0 bg-primary-500/5 rounded-[1.75rem] blur-xl opacity-0 group-focus-within:opacity-100 transition-opacity duration-500" />
                            <input
                                type="text"
                                inputMode="decimal"
                                value={amount}
                                onKeyDown={(e) => {
                                    if (['Backspace', 'Delete', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Tab', 'Enter', 'Home', 'End'].includes(e.key) || e.ctrlKey || e.metaKey || e.altKey) return;
                                    if (['-', '+', 'e', 'E'].includes(e.key)) { e.preventDefault(); return; }
                                    if (!/^[0-9.]$/.test(e.key)) e.preventDefault();
                                }}
                                onChange={(e) => {
                                    const val = e.target.value;
                                    if (val === '' || /^\d*\.?\d*$/.test(val)) {
                                        if (val.length <= 20) setAmount(val);
                                    }
                                }}
                                className="relative w-full px-8 py-7 bg-gray-100 dark:bg-white/5 border-2 border-transparent focus:border-primary-500/30 text-gray-900 dark:text-white rounded-[1.75rem] focus:outline-none transition-all text-2xl font-black tracking-tight placeholder-gray-300 dark:placeholder-gray-700"
                                placeholder="0.00"
                            />
                            <div className="absolute right-6 top-1/2 -translate-y-1/2 flex flex-col items-end">
                                <span className="text-[10px] font-black text-primary-500 uppercase tracking-[0.3em]">Units</span>
                                <span className="text-xs font-black text-gray-400 uppercase tracking-widest truncate max-w-[100px]">
                                    {tokens.find(t => t.tokenid === selectedTokenId) ? (tokens.find(t => t.tokenid === selectedTokenId)?.tokenid === '0x00' ? 'Minima' : getTokenName(tokens.find(t => t.tokenid === selectedTokenId)!)) : '--'}
                                </span>
                            </div>
                        </div>
                    </div>

                    {/* Charm Selection */}
                    <div className={`transition-all duration-500 ${!isMinimaSelected ? 'opacity-30 pointer-events-none scale-95 blur-[2px]' : ''}`}>
                        <div className="px-2 mb-4 flex items-center justify-between">
                            <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.3em]">Attach Charm (Optional)</label>
                            {!isMinimaSelected && <span className="text-[8px] font-black text-amber-500 uppercase tracking-widest bg-amber-500/10 px-3 py-1 rounded-full">Minima Only</span>}
                        </div>

                        <div className="grid grid-cols-4 gap-3">
                            <button
                                className={`aspect-square rounded-2xl flex flex-col items-center justify-center gap-1 transition-all duration-500 ${selectedCharm === null
                                    ? "bg-primary-500 text-white shadow-lg shadow-primary-500/20"
                                    : "bg-gray-100 dark:bg-white/5 text-gray-400 hover:bg-gray-200 dark:hover:bg-white/10"
                                    } `}
                                onClick={() => setSelectedCharm(null)}
                            >
                                <span className="text-2xl opacity-40 italic">∅</span>
                                <span className="text-[8px] font-black uppercase tracking-[0.2em]">None</span>
                            </button>

                            {charms.map((c) => (
                                <button
                                    key={c.id}
                                    className={`aspect-square rounded-2xl flex flex-col items-center justify-center transition-all duration-500 p-2 group/charm ${selectedCharm === c
                                        ? "bg-primary-500 shadow-lg shadow-primary-500/20 scale-105 border-transparent"
                                        : "bg-gray-100 dark:bg-white/5 border-transparent hover:bg-white dark:hover:bg-white/10"
                                        } `}
                                    onClick={() => setSelectedCharm(c)}
                                    title={c.name}
                                >
                                    <div className="w-12 h-12 flex items-center justify-center transition-transform duration-500 group-hover/charm:scale-110">
                                        {c.type === 'lottie' ? (
                                            <Lottie animationData={c.data} loop={true} />
                                        ) : (
                                            <img src={c.data} alt={c.name} className="w-full h-full object-contain" />
                                        )}
                                    </div>
                                    <span className={`text-[8px] font-black uppercase tracking-[0.1em] mt-1 truncate w-full text-center ${selectedCharm === c ? 'text-white' : 'text-gray-400'}`}>{c.name}</span>
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Final Actions */}
                <div className="p-8 flex gap-4 pt-4 border-t border-gray-100 dark:border-white/5">
                    <button
                        onClick={onCancel}
                        className="flex-1 py-5 bg-gray-100 dark:bg-white/5 text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white rounded-[1.75rem] font-black text-xs uppercase tracking-[0.3em] transition-all active:scale-95"
                    >
                        Abort
                    </button>
                    <button
                        onClick={handleSendClick}
                        disabled={!synced || !amount || parseFloat(amount) <= 0}
                        className={`flex-1 py-5 rounded-[1.75rem] font-black text-xs uppercase tracking-[0.3em] transition-all duration-500 shadow-2xl relative overflow-hidden active:scale-95 ${!synced || !amount || parseFloat(amount) <= 0
                            ? "bg-gray-100 dark:bg-white/5 text-gray-300 dark:text-gray-600 cursor-not-allowed"
                            : "bg-primary-500 text-white shadow-primary-500/30 hover:scale-[1.02]"
                            }`}
                    >
                        <div className="absolute inset-0 bg-gradient-to-tr from-white/20 to-transparent opacity-0 hover:opacity-100 transition-opacity duration-700" />
                        <div className="flex items-center justify-center gap-3 relative z-10">
                            {selectedCharm ? <ImageIcon size={18} strokeWidth={3} /> : <Zap size={18} strokeWidth={3} />}
                            <span>{selectedCharm ? "Send Charm" : "Transmit"}</span>
                        </div>
                    </button>
                </div>
            </div>
        </div>
    );
};

export default TransferSelector;
