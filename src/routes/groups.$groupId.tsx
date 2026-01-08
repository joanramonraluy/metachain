// src/routes/groups.$groupId.tsx
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/groups/$groupId")({
  // Component will be lazy loaded from .lazy.tsx
});