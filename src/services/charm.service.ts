
// Dynamic import of all supported animation files
const charmModules = import.meta.glob([
    '../assets/animations/*.json',
    '../assets/animations/*.gif',
    '../assets/animations/*.webp'
], { eager: true });

export interface Charm {
    id: string;
    label: string;
    name: string;
    type: 'lottie' | 'image';
    data: any; // Lottie JSON or Image URL string
}

export const getCharms = (): Charm[] => {
    return Object.keys(charmModules).map((path) => {
        const fileName = path.split('/').pop() || '';
        const id = fileName.replace(/\.(json|gif|webp)$/, '');
        const extension = fileName.split('.').pop()?.toLowerCase();

        // Generate a readable name from the filename
        const name = id.split(/[_-]/).map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');

        // Assign a default label based on keywords
        let label = "✨";
        if (id.includes("star")) label = "⭐";
        else if (id.includes("heart")) label = "❤️";
        else if (id.includes("fire")) label = "🔥";
        else if (id.includes("money") || id.includes("cash")) label = "💸";
        else if (id.includes("rocket")) label = "🚀";

        const module = charmModules[path] as any;

        // Determine type and data needed for rendering
        const isLottie = extension === 'json';
        const data = isLottie ? module.default : module.default; // Both import defaults (JSON object or URL string)

        return {
            id,
            label,
            name,
            type: isLottie ? 'lottie' : 'image',
            data
        };
    });
};

export const getCharmById = (id: string): Charm | undefined => {
    const charms = getCharms();
    return charms.find(c => c.id === id);
};
