# Switch to Modern Animation Technology (Rive)

## Goal Description
Replace the current Lottie animation implementation with **Rive** (or DotLottie as a fallback) to resolve `eval` security warnings during build and provide a more modern, high-performance, and "spectacular" animation experience for Charms.

## User Review Required
> [!IMPORTANT]
> **Rive Assets Required**: Switching to Rive requires `.riv` animation files. The current project uses Lottie `.json` files.
> **Decision Point**:
> 1.  **Switch to Rive**: Best performance and interactivity. Requires finding/creating new `.riv` assets for Star, Heart, and Fire.
> 2.  **Switch to DotLottie**: Keeps existing `.json` assets (compatible). Solves the `eval` build error. Less "spectacular" upgrade but safer and easier.

## Proposed Changes
### Dependencies
#### [MODIFY] package.json
- Remove `@lottiefiles/react-lottie-player` and `lottie-react` (or keep one if using DotLottie).
- Add `@rive-app/react-canvas` (for Rive) OR `@dotlottie/react-player` (for DotLottie).

### Components
#### [MODIFY] src/components/chat/CharmSelector.tsx
- Replace `Player` (Lottie) with `Rive` component.
- Update asset loading logic.

#### [MODIFY] src/components/chat/MessageBubble.tsx
- Replace `Lottie` component with `Rive` component.
- Update asset loading logic.

## Verification Plan
### Automated Tests
- Run `npm run build` to verify the `eval` warning is gone.

### Manual Verification
- Send a charm in the chat.
- Verify the animation plays correctly in the `CharmSelector`.
- Verify the animation plays correctly in the `MessageBubble`.
