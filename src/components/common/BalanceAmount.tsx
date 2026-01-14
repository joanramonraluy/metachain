import { useEffect, useState } from 'react';

interface BalanceProps {
    amount: string;
    unconfirmed: string;
    className?: string;
    forceActive?: boolean;
}

export const BalanceAmount = ({ amount, unconfirmed, className = "", forceActive = false }: BalanceProps) => {
    // 0 = Normal, 1 = Dimmed
    const [blinkState, setBlinkState] = useState<number>(0);

    // Explicitly check if unconfirmed is NOT '0' and NOT undefined/null
    // Also handle possible "0.00" or similar string representations
    const hasUnconfirmed = forceActive || (unconfirmed &&
        unconfirmed !== '0' &&
        unconfirmed !== '0.00' &&
        parseFloat(unconfirmed) > 0);

    useEffect(() => {
        if (hasUnconfirmed) {
            console.log("💡 [BalanceAmount] Blinking active. Unconfirmed:", unconfirmed);
            const interval = setInterval(() => {
                setBlinkState(prev => prev === 0 ? 1 : 0);
            }, 1000); // 1 second interval like wallet
            return () => clearInterval(interval);
        } else {
            setBlinkState(0);
        }
    }, [hasUnconfirmed, unconfirmed]);

    // Use !important to override parent styles (like text-white in SideMenu)
    // We utilize opacity for a smoother "breathing" effect that works on all backgrounds
    const blinkClass = blinkState === 1 ? '!opacity-50' : '!opacity-100';

    return (
        <span className={`transition-opacity duration-200 ${className} ${blinkClass}`}>
            {amount}
        </span>
    );
};
