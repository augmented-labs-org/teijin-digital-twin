import type { World } from "@/core/world"
import { create } from "zustand"

type WorldStore = {
    world: World | undefined
    setWorld: (world: World | undefined) => void
}

/**
 * Holds the Babylon world instance for the React layer. The world itself is the
 * source of truth; this store just makes the instance reactively available.
 */
export const useWorld = create<WorldStore>((set) => ({
    world: undefined,
    setWorld: (world) => set({ world }),
}))
