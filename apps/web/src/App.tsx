import { useWorld } from "@/hooks/use-world";
import { useWorldStoreSync } from "@/hooks/use-world-store-sync";
import { BabylonWorld } from "./components/babylon";
import { BuildingLayers } from "./components/world/building-layers";

export function App() {
  const world = useWorld((s) => s.world)
  const setWorld = useWorld((s) => s.setWorld)
  useWorldStoreSync()

  return (
    <div className="flex flex-col md:flex-row h-screen w-full">
      <BabylonWorld onWorldLoad={setWorld} className="flex-1 min-w-0 outline-0" />

      <div className="h-64 w-full md:w-64 md:h-full shrink-0 p-8">
        {world && <BuildingLayers />}
      </div>
    </div>
  )
}
