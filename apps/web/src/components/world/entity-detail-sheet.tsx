import type { Entity } from "@/core/building/entity"
import { BADGE_TONE_COLOR, UiStatValue } from "@/core/building/ui-schema"
import type { Sample } from "@/core/telemetry/timeline"
import { statIconDataUri } from "@/core/utils/icons"
import { useEntityDetail } from "@/hooks/use-entity-detail"
import { useTimeline } from "@/hooks/use-timeline"
import { useWorld } from "@/hooks/use-world"
import { Button } from "@workspace/ui/components/button"
import { Card, CardContent, CardHeader } from "@workspace/ui/components/card"
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@workspace/ui/components/chart"
import { XIcon } from "lucide-react"
import { AnimatePresence, motion } from "motion/react"
import { useEffect, useMemo, useState } from "react"
import { CartesianGrid, Line, LineChart, ReferenceLine, XAxis, YAxis } from "recharts"

/** `#rrggbb` → `rgba(r, g, b, alpha)`, used to tint an icon/badge backdrop by the entity's accent color. */
function hexToRgba(hex: string, alpha: number): string {
    const value = hex.replace("#", "")
    const r = parseInt(value.substring(0, 2), 16)
    const g = parseInt(value.substring(2, 4), 16)
    const b = parseInt(value.substring(4, 6), 16)
    return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function formatTime(t: number): string {
    return new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}

function StatCard({
    stat,
    data,
    color,
    currentTime,
}: {
    stat: UiStatValue
    data: { t: number; value: number }[]
    color: string
    currentTime?: number
}) {
    const chartConfig: ChartConfig = { value: { label: stat.name, color } }

    return (
        <Card size="sm" className="pb-1">
            <CardHeader className="flex flex-row items-center gap-2">
                <div className="flex flex-col gap-2">
                    <span
                        className="flex size-6 shrink-0 items-center justify-center rounded-md"
                        style={{ backgroundColor: hexToRgba(color, 0.07) }}
                    >
                        <img src={statIconDataUri(stat.icon, color)} alt="" className="size-3.5" />
                    </span>

                    <span className="text-xs font-medium text-foreground">{stat.name}</span>
                </div>

                <span className="ml-auto text-sm font-semibold text-foreground">{stat.value}</span>
            </CardHeader>
            <CardContent>
                <ChartContainer config={chartConfig} className="aspect-auto h-24 w-full">
                    <LineChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -4 }}>
                        <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="var(--border)" />
                        <XAxis
                            dataKey="t"
                            type="number"
                            domain={["dataMin", "dataMax"]}
                            tickFormatter={formatTime}
                            tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                            axisLine={false}
                            tickLine={false}
                            minTickGap={32}
                        />
                        <YAxis
                            tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                            axisLine={false}
                            tickLine={false}
                            width={32}
                        />
                        <ChartTooltip
                            content={
                                <ChartTooltipContent
                                    labelFormatter={(t) => new Date(Number(t)).toLocaleTimeString()}
                                />
                            }
                        />
                        <Line
                            type="monotone"
                            dataKey="value"
                            stroke="var(--color-value)"
                            strokeWidth={2}
                            dot={false}
                            activeDot={{ r: 4 }}
                            isAnimationActive={false}
                        />
                        {currentTime !== undefined && (
                            <ReferenceLine
                                x={currentTime}
                                stroke="var(--muted-foreground)"
                                strokeDasharray="3 3"
                                ifOverflow="extendDomain"
                            />
                        )}
                    </LineChart>
                </ChartContainer>
            </CardContent>
        </Card>
    )
}

/**
 * Per-stat time series for the charts, derived by replaying `buildUiSchema`
 * against each historical sample. `UiStatValue` only carries the reading it was
 * built from, not which state field it came from, so there is no way to read a
 * stat's past values directly off `history` — instead each sample's state is
 * swapped onto the entity just long enough to rebuild its schema and read the
 * matching stat's `raw` value back off, then restored. `Entity.state` is a
 * plain, side-effect-free property, and this runs to completion synchronously
 * (no `await` inside the loop), so no other code can observe the swap.
 */
function buildStatHistories(entity: Entity, history: Sample[]): Map<string, { t: number; value: number }[]> {
    const histories = new Map<string, { t: number; value: number }[]>()
    const liveState = entity.state

    try {
        for (const sample of history) {
            entity.state = sample.state
            for (const { stats } of entity.buildUiSchema().statGroups) {
                for (const stat of stats) {
                    if (typeof stat.raw !== "number") {
                        continue
                    }
                    const series = histories.get(stat.name) ?? []
                    series.push({ t: sample.t, value: stat.raw })
                    histories.set(stat.name, series)
                }
            }
        }
    } finally {
        entity.state = liveState
    }

    return histories
}

function EntityDetailBody({
    entity,
    history,
    markTime,
    onClose,
}: {
    entity: Entity
    history: Sample[]
    markTime?: number
    onClose: () => void
}) {
    const schema = entity.buildUiSchema()
    const color = schema.color

    const histories = useMemo(() => buildStatHistories(entity, history), [entity, history])

    return (
        <>
            <div className="flex flex-col gap-1.5 p-6 pr-14">
                <div className="flex items-center gap-2">
                    <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
                    <h2 className="font-heading text-base font-medium text-foreground">{schema.name}</h2>
                </div>
                <p className="text-sm text-muted-foreground">{schema.status}</p>
                {schema.badges.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5">
                        {schema.badges.map((badge) => {
                            const badgeColor = BADGE_TONE_COLOR[badge.tone ?? "neutral"]
                            return (
                                <span
                                    key={badge.label}
                                    className="rounded-full px-2 py-0.5 text-xs font-semibold"
                                    style={{ backgroundColor: hexToRgba(badgeColor, 0.12), color: badgeColor }}
                                >
                                    {badge.label}
                                </span>
                            )
                        })}
                    </div>
                )}
            </div>

            <Button
                variant="ghost"
                size="icon-sm"
                className="absolute top-4 right-4 bg-secondary"
                onClick={onClose}
            >
                <XIcon />
                <span className="sr-only">Close</span>
            </Button>

            <div className="flex-1 overflow-y-auto px-6 pb-6">
                {schema.error && (
                    <p className="mb-4 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{schema.error}</p>
                )}

                {schema.statGroups.map(({ group, stats }) => (
                    <div key={group ?? "_"} className="mb-4 flex flex-col gap-2">
                        {schema.statGroups.length > 1 && group && (
                            <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                                {group}
                            </span>
                        )}
                        <div className="flex flex-col gap-2">
                            {stats.map((stat) => (
                                <StatCard
                                    key={stat.name}
                                    stat={stat}
                                    data={histories.get(stat.name) ?? []}
                                    color={color}
                                    currentTime={markTime}
                                />
                            ))}
                        </div>
                    </div>
                ))}
            </div>
        </>
    )
}

/**
 * The entity detail panel, opened from the button on an {@link EntityTag}'s
 * expanded detail card. Reads `world.focusedEntity`/`detailPanelOpen` via
 * {@link useEntityDetail}. Each stat gets its own chart of whatever history the
 * timeline source has recorded for it (possibly none).
 *
 * The chart *data* is driven by the raw {@link TimelineSource.onChanged} (new
 * samples arriving), not the higher-level {@link Timeline.onChanged} — that
 * also fires on seek/goLive, which would make the charts jump around while
 * someone scrubs the history slider. This panel always shows full live history
 * regardless of where that scrubber sits; only the scrub-position marker line
 * (via {@link useTimeline}) reacts to seek/goLive.
 */
export function EntityDetailSheet() {
    const { entity, open, close } = useEntityDetail()
    const world = useWorld((s) => s.world)
    const { live, currentTime } = useTimeline()
    const [, forceUpdate] = useState(0)

    useEffect(() => {
        if (!world || !entity || !open) {
            return
        }
        const observer = world.timeline.source.onChanged.add(() => forceUpdate((n) => n + 1))
        return () => observer.remove()
    }, [world, entity, open])

    const history = world && entity ? world.timeline.history(entity.id) : []

    return (
        <AnimatePresence>
            {open && entity && (
                <motion.div
                    key={entity.id}
                    initial={{ x: "100%" }}
                    animate={{ x: 0 }}
                    exit={{ x: "100%" }}
                    transition={{ type: "spring", stiffness: 320, damping: 32 }}
                    className="fixed inset-y-0 right-0 z-40 flex w-full flex-col border-l bg-popover bg-clip-padding text-sm text-popover-foreground shadow-xl sm:max-w-md"
                >
                    <EntityDetailBody
                        entity={entity}
                        history={history}
                        markTime={live ? undefined : currentTime}
                        onClose={close}
                    />
                </motion.div>
            )}
        </AnimatePresence>
    )
}
