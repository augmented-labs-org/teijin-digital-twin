import { WorldProvider } from "@/hooks/use-world";
import { useState } from "react";
import { BabylonWorld } from "./components/babylon";
import { BuildingLayers } from "./components/world/building-layers";
import { World } from "./core/world";


export function App() {
  const [world, setWorld] = useState<World>()
  return (
    <WorldProvider world={world}>
      <div className="flex flex-col md:flex-row h-screen w-full">
        <BabylonWorld onWorldLoad={setWorld} className="flex-1 min-w-0 outline-0" />

        <div className="h-64 w-full md:w-64 md:h-full shrink-0 p-8">
          {world && <>
            <BuildingLayers />
          </>}
        </div>
      </div>
    </WorldProvider>
  )
}
