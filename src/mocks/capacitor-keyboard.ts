import { registerPlugin } from '@capacitor/core';

export interface KeyboardPlugin {
    resize: string;
    addListener(eventName: string, listenerFunc: Function): Promise<import('@capacitor/core').PluginListenerHandle> & import('@capacitor/core').PluginListenerHandle;
    removeAllListeners(): Promise<void>;
}

const Keyboard = registerPlugin<KeyboardPlugin>('Keyboard');

export { Keyboard };
