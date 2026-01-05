import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/contact-info/$address')({
  component: RouteComponent,
})

function RouteComponent() {
  return <div>Hello "/contact-info/$address"!</div>
}
