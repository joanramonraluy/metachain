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
            }, 500); // Fast interval
            return () => clearInterval(interval);
        } else {
            console.log("🔇 [BalanceAmount] Blinking INACTIVE");
            setBlinkState(0);
        }
    }, [hasUnconfirmed, unconfirmed, forceActive]);

    // DEBUG: Red color to confirm logic activation
    // Inline opacity to guarantee visibility
    const style = {
        opacity: blinkState === 1 ? 0.2 : 1,
        transition: 'opacity 0.2s ease-in-out',
        color: hasUnconfirmed ? '#ff4444' : undefined // Red if active
    };

    return (
        <span className={className} style={style}>
            {amount}
        </span>
    );
};
