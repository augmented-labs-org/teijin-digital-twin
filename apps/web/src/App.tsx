import { useWorld } from "@/hooks/use-world";
import { useWorldStoreSync } from "@/hooks/use-world-store-sync";
import { BabylonWorld } from "./components/babylon";
import { WorldOverlay } from "./components/world/world-overlay";

export function App() {
  const world = useWorld((s) => s.world)
  const setWorld = useWorld((s) => s.setWorld)
  useWorldStoreSync()

  return (
    <div className="flex flex-col md:flex-row h-dvh w-full relative">
      <BabylonWorld onWorldLoad={setWorld} className="flex-1 min-w-0 outline-0" />

      {world && <WorldOverlay />}
    </div>
  )
}
