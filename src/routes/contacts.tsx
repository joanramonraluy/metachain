// src/routes/contacts.tsx


import { createFileRoute } from "@tanstack/react-router"
import CheckContacts from "../components/init/CheckContacts"

export const Route = createFileRoute("/contacts")({
  component: () => <CheckContacts />,
})