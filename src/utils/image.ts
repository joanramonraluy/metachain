/**
 * Compresses an image file using an HTML5 Canvas to ensure it fits within Maxima's strict 64KB limit.
 * 
 * @param file The original image File object selected by the user
 * @param maxWidth The maximum width of the output image (default 800)
 * @param maxHeight The maximum height of the output image (default 800)
 * @param quality The JPEG compression quality from 0 to 1 (default 0.7)
 * @returns A Promise that resolves to a Base64 encoded JPEG string (e.g. data:image/jpeg;base64,...)
 */
export const compressImage = (
    file: File,
    maxWidth: number = 800,
    maxHeight: number = 800,
    quality: number = 0.7
): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.readAsDataURL(file);
        reader.onload = (event) => {
            const img = new Image();
            img.src = event.target?.result as string;

            img.onload = () => {
                let width = img.width;
                let height = img.height;

                // Calculate aspect ratio and new dimensions
                if (width > height) {
                    if (width > maxWidth) {
                        height = Math.round((height * maxWidth) / width);
                        width = maxWidth;
                    }
                } else {
                    if (height > maxHeight) {
                        width = Math.round((width * maxHeight) / height);
                        height = maxHeight;
                    }
                }

                const canvas = document.createElement("canvas");
                canvas.width = width;
                canvas.height = height;

                const ctx = canvas.getContext("2d");
                if (!ctx) {
                    reject(new Error("Failed to get canvas context"));
                    return;
                }

                // Draw the image onto the canvas at the new, smaller size
                ctx.drawImage(img, 0, 0, width, height);

                // Export as heavily compressed JPEG base64 string
                const compressedBase64 = canvas.toDataURL("image/jpeg", quality);
                resolve(compressedBase64);
            };

            img.onerror = () => {
                reject(new Error("Failed to load image for compression"));
            };
        };

        reader.onerror = () => {
            reject(new Error("Failed to read file"));
        };
    });
};
