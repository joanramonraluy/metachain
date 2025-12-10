import { motion, AnimatePresence } from "framer-motion"
import { useRouterState } from "@tanstack/react-router"

export default function PageTransition({ children }: { children: React.ReactNode }) {
  const { location } = useRouterState()

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={location.pathname}
        initial={{ opacity: 0, x: 15 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -15 }}
        transition={{ duration: 0.25 }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  )
}
