// index.tsx
import { createFileRoute } from "@tanstack/react-router"
import ChatsAndGroups from "../components/chat/ChatsAndGroups"

export const Route = createFileRoute("/")({
  component: () => <ChatsAndGroups />,
})