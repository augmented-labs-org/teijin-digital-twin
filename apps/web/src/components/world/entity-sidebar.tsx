import { EntityDetailPanel } from "@/components/world/entity-detail-panel"
import { EntityTreePanel } from "@/components/world/entity-tree-panel"
import { useFocusedEntity } from "@/hooks/use-focused-entity"
import { Button } from "@workspace/ui/components/button"
import { InfoIcon, ListTreeIcon, XIcon } from "lucide-react"
import { AnimatePresence, motion } from "motion/react"
import { useState } from "react"

type PanelKey = "details" | "tree"

const RAIL_WIDTH = "3.5rem"

/**
 * The world's persistent icon rail plus the sheet it expands into. Unlike the
 * old `EntityDetailSheet`, whether the sheet is open (and which panel it shows)
 * is owned entirely by this component's own state — Babylon only ever reports
 * which entity is focused via {@link useFocusedEntity}, it has no say in
 * whether any panel is open.
 */
export function EntitySidebar() {
    const [activePanel, setActivePanel] = useState<PanelKey | null>(null)
    const focused = useFocusedEntity()

    const toggle = (panel: PanelKey) => {
        setActivePanel((current) => (current === panel ? null : panel))
    }

    return (
        <>
            <AnimatePresence>
                {activePanel !== null && (
                    <motion.div
                        key="entity-sidebar-panel"
                        initial={{ x: "-100%" }}
                        animate={{ x: 0 }}
                        exit={{ x: "-100%" }}
                        transition={{ type: "spring", stiffness: 320, damping: 32 }}
                        style={{ left: RAIL_WIDTH }}
                        className="fixed inset-y-0 z-40 flex w-full flex-col border-r bg-popover bg-clip-padding text-sm text-popover-foreground shadow-xl sm:max-w-md"
                    >
                        <Button
                            variant="ghost"
                            size="icon-sm"
                            className="absolute top-4 right-4 bg-secondary"
                            onClick={() => setActivePanel(null)}
                        >
                            <XIcon />
                            <span className="sr-only">Close</span>
                        </Button>

                        {activePanel === "details" ? (
                            <EntityDetailPanel entity={focused} />
                        ) : (
                            <EntityTreePanel />
                        )}
                    </motion.div>
                )}
            </AnimatePresence>

            <div
                style={{ width: RAIL_WIDTH }}
                className="fixed inset-y-0 left-0 z-50 flex flex-col items-center gap-2 border-r bg-popover bg-clip-padding py-4"
            >
                <Button
                    variant="ghost"
                    size="icon"
                    aria-expanded={activePanel === "details"}
                    aria-label="Entity details"
                    onClick={() => toggle("details")}
                >
                    <InfoIcon />
                </Button>
                <Button
                    variant="ghost"
                    size="icon"
                    aria-expanded={activePanel === "tree"}
                    aria-label="Entity tree"
                    onClick={() => toggle("tree")}
                >
                    <ListTreeIcon />
                </Button>
            </div>
        </>
    )
}
