import { StatIcon } from "../utils/icons";

export type BadgeTone = "neutral" | "positive" | "warning" | "critical"

export type EntityBadge = { label: string; tone?: BadgeTone }

export const BADGE_TONE_COLOR: Record<BadgeTone, string> = {
    neutral: "#6b7280",
    positive: "#22c55e",
    warning: "#f59e0b",
    critical: "#ef4444",
}

/*

*/

export type UiStatValue = {
    name: string,
    icon: StatIcon,
    value: string,
} & ({
    raw: string
} | {
    raw: number
})

type UiStatGroup = {
    group: string,
    stats: UiStatValue[]
}

export type UiSchema = {
    name: string
    status: string
    color: string
    badges: EntityBadge[]
    error?: string
    statGroups: UiStatGroup[]
}
