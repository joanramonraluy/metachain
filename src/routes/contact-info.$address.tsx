import { createFileRoute } from "@tanstack/react-router";

// Define search params validation
interface ContactInfoSearch {
    returnTo?: string;
    tab?: string;
}

export const Route = createFileRoute("/contact-info/$address")({
    validateSearch: (search: Record<string, unknown>): ContactInfoSearch => {
        return {
            returnTo: search.returnTo as string | undefined,
            tab: search.tab as string | undefined,
        };
    },
});
