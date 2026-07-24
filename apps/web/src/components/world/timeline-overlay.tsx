import { useTimeline } from "@/hooks/use-timeline"
import { Slider } from "@workspace/ui/components/slider"
import { cn } from "@workspace/ui/lib/utils"
import { Radio } from "lucide-react"
import { AnimatePresence, motion } from "motion/react"

function formatTime(t: number | undefined): string {
    return t === undefined ? "--:--:--" : new Date(t).toLocaleTimeString()
}

/**
 * Bottom seekbar for scrubbing the scene through recorded history. Hidden until
 * there is a scrubbable span. Dragging pins the scene to a past instant; the
 * "Live" pill jumps back to the present and resumes tracking incoming data.
 */
export function TimelineOverlay() {
    const { start, end, currentTime, live, hasHistory, seek, goLive } = useTimeline()

    return (
        <div className="absolute bottom-0 inset-x-0 flex justify-center p-4 pointer-events-none">
            <AnimatePresence>
                {hasHistory && start !== undefined && end !== undefined && (
                    <motion.div
                        className="pointer-events-auto flex items-center gap-4 w-full max-w-2xl bg-background rounded-full px-4 py-2 text-primary border-border border"
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 10 }}
                    >
                        <span className="w-20 shrink-0 text-xs font-medium tabular-nums">
                            {formatTime(start)}
                        </span>

                        <Slider
                            className="flex-1"
                            min={start}
                            max={end}
                            value={currentTime ?? end}
                            onValueChange={(value) => seek(value as number)}
                        />

                        <span className="w-20 shrink-0 text-right text-xs font-medium tabular-nums">
                            {formatTime(currentTime)}
                        </span>

                        <button
                            type="button"
                            onClick={goLive}
                            aria-pressed={live}
                            className={cn(
                                "flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition-colors",
                                live
                                    ? "bg-red-500 text-white"
                                    : "bg-white/80 text-primary hover:bg-white",
                            )}
                        >
                            <Radio className="size-3.5" />
                            LIVE
                        </button>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    )
}
