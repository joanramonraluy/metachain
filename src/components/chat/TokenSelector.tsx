import React, { useEffect, useState } from 'react';
import { minimaService } from '../../services/minima.service';

interface Token {
    tokenid: string;
    token: string | { name: string; url?: string };
    sendable: string;
    confirmed: string;
}

interface TokenSelectorProps {
    onSend: (tokenId: string, amount: string, tokenName: string) => void;
    onCancel: () => void;
}

const TokenSelector: React.FC<TokenSelectorProps> = ({ onSend, onCancel }) => {
    const [tokens, setTokens] = useState<Token[]>([]);
    const [selectedTokenId, setSelectedTokenId] = useState<string>('0x00');
    const [amount, setAmount] = useState<string>('');
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchBalance = async () => {
            const balance = await minimaService.getBalance();
            setTokens(balance);
            setLoading(false);
        };
        fetchBalance();
    }, []);

    const handleSend = () => {
        if (!amount || parseFloat(amount) <= 0) {
            alert("Please enter a valid amount");
            return;
        }
        const token = tokens.find(t => t.tokenid === selectedTokenId);
        const tokenName = typeof token?.token === 'string' ? token.token : token?.token.name || 'Minima';

        onSend(selectedTokenId, amount, tokenName);
    };

    const getTokenName = (t: Token) => {
        if (t.tokenid === '0x00') return 'Minima';
        if (typeof t.token === 'string') return JSON.parse(t.token).name;
        return t.token.name;
    };

    if (loading) return <div className="p-4 text-center">Loading tokens...</div>;

    return (
        <div className="fixed inset-0 bg-gray-900 bg-opacity-75 flex items-center justify-center z-50 p-4">
            <div className="bg-gray-800 rounded-xl shadow-xl w-96 max-w-full p-6">
                <div className="flex justify-between items-center mb-4">
                    <h3 className="text-xl font-bold text-white">Send Tokens</h3>
                    <button
                        onClick={onCancel}
                        className="text-gray-400 hover:text-gray-200 transition-colors"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                    </button>
                </div>

                <div className="mb-4">
                    <label className="block text-sm font-medium text-gray-300 mb-2">Select Token</label>
                    <div className="max-h-48 overflow-y-auto border border-gray-600 rounded-lg bg-gray-700">
                        {tokens.map((t) => (
                            <div
                                key={t.tokenid}
                                onClick={() => setSelectedTokenId(t.tokenid)}
                                className={`p-3 cursor-pointer flex justify-between items-center hover:bg-gray-600 transition-colors ${selectedTokenId === t.tokenid ? 'bg-blue-900/50 border-l-4 border-blue-500' : 'border-l-4 border-transparent'}`}
                            >
                                <span className="font-medium text-white">{getTokenName(t)}</span>
                                <span className="text-sm text-gray-400">{t.sendable}</span>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="mb-6">
                    <label className="block text-sm font-medium text-gray-300 mb-2">Amount</label>
                    <input
                        type="number"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        className="w-full px-3 py-2 bg-gray-700 border border-gray-600 text-white rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent placeholder-gray-400 outline-none"
                        placeholder="0.00"
                    />
                </div>

                <div className="flex gap-3 pt-2">
                    <button
                        onClick={onCancel}
                        className="flex-1 px-4 py-2 border border-gray-600 text-gray-300 rounded-lg hover:bg-gray-700 transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSend}
                        className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors font-medium"
                    >
                        Send Token
                    </button>
                </div>
            </div>
        </div>
    );
};

export default TokenSelector;
