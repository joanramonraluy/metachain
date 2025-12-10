declare module "*.json" {
    const value: any;
    export default value;
}

declare module "@lottiefiles/react-lottie-player" {
    import { CSSProperties } from "react";

    export interface PlayerProps {
        autoplay?: boolean;
        loop?: boolean;
        src?: string | object;
        style?: CSSProperties;
        className?: string;
        speed?: number;
        direction?: number;
        onEvent?: (event: string) => void;
    }

    export const Player: React.FC<PlayerProps>;
}
