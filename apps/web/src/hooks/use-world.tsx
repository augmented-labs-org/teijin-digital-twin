/* eslint-disable react-refresh/only-export-components */
import type { World } from "@/core/world"
import * as React from "react"

type WorldProviderProps = {
    world: World | undefined
    children: React.ReactNode
}

type WorldProviderState = {
    world: World | undefined
}

const WorldProviderContext = React.createContext<WorldProviderState | undefined>(
    undefined
)

export function WorldProvider({ world, children }: WorldProviderProps) {
    return (
        <WorldProviderContext.Provider value={{ world }}>
            {children}
        </WorldProviderContext.Provider>
    )
}

export const useWorld = () => {
    const context = React.useContext(WorldProviderContext)

    if (context === undefined) {
        throw new Error("useWorld must be used within a WorldProvider")
    }

    return context
}
