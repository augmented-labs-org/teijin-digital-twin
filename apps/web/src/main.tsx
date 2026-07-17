import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import "@workspace/ui/globals.css"

import { App } from "./App"
import { ThemeProvider } from "@/components/theme-provider"

import { registerBuiltInLoaders } from "@babylonjs/loaders/dynamic";

registerBuiltInLoaders()

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>
)
