import { useMapMode } from "@/hooks/use-map-mode";
import { useWorld } from "@/hooks/use-world";
import { useWorldStoreSync } from "@/hooks/use-world-store-sync";
import { cn } from "@workspace/ui/lib/utils";
import { AnimatePresence, motion } from "motion/react";
import { useCallback } from "react";
import { BabylonWorld } from "./components/babylon";
import { WorldMap } from "./components/world/world-map";
import { WorldOverlay } from "./components/world/world-overlay";

export function App() {
  const world = useWorld((s) => s.world)
  const setWorld = useWorld((s) => s.setWorld)
  useWorldStoreSync()

  const mapMode = useMapMode()

  const enterScene = useCallback(() => world?.exitMapMode(), [world])

  return (
    <div className="flex flex-col md:flex-row h-dvh w-full relative">
      <BabylonWorld
        onWorldLoad={setWorld}
        className={cn(
          "flex-1 min-w-0 outline-0 transition-opacity duration-700",
          mapMode ? "opacity-0 pointer-events-none" : "opacity-100",
        )}
      />

      {world && !mapMode && <WorldOverlay />}

      <AnimatePresence>
        {mapMode && (
          <motion.div
            key="world-map"
            className="absolute inset-0"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.7 }}
          >
            <WorldMap onSelectFactory={enterScene} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
