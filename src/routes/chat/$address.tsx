// src/routes/chat/$address.tsx
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/chat/$address")({
  // Component will be lazy loaded from .lazy.tsx
});