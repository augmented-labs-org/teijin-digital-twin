import activitySvg from "lucide-static/icons/activity.svg?raw"
import banSvg from "lucide-static/icons/ban.svg?raw"
import circleCheckSvg from "lucide-static/icons/circle-check.svg?raw"
import circleXSvg from "lucide-static/icons/circle-x.svg?raw"
import clockSvg from "lucide-static/icons/clock.svg?raw"
import dropletSvg from "lucide-static/icons/droplet.svg?raw"
import flameSvg from "lucide-static/icons/flame.svg?raw"
import gaugeSvg from "lucide-static/icons/gauge.svg?raw"
import hashSvg from "lucide-static/icons/hash.svg?raw"
import hourglassSvg from "lucide-static/icons/hourglass.svg?raw"
import moveSvg from "lucide-static/icons/move.svg?raw"
import packageSvg from "lucide-static/icons/package.svg?raw"
import rulerSvg from "lucide-static/icons/ruler.svg?raw"
import scanEyeSvg from "lucide-static/icons/scan-eye.svg?raw"
import settingsSvg from "lucide-static/icons/settings.svg?raw"
import sirenSvg from "lucide-static/icons/siren.svg?raw"
import sprayCanSvg from "lucide-static/icons/spray-can.svg?raw"
import tagSvg from "lucide-static/icons/tag.svg?raw"
import testTubeSvg from "lucide-static/icons/test-tube.svg?raw"
import thermometerSvg from "lucide-static/icons/thermometer.svg?raw"
import timerSvg from "lucide-static/icons/timer.svg?raw"
import zapSvg from "lucide-static/icons/zap.svg?raw"

/** Raw `lucide-static` markup (stroke="currentColor") for every icon usable as a stat glyph. */
const ICONS = {
    activity: activitySvg,
    ban: banSvg,
    "circle-check": circleCheckSvg,
    "circle-x": circleXSvg,
    clock: clockSvg,
    droplet: dropletSvg,
    flame: flameSvg,
    gauge: gaugeSvg,
    hash: hashSvg,
    hourglass: hourglassSvg,
    move: moveSvg,
    package: packageSvg,
    ruler: rulerSvg,
    "scan-eye": scanEyeSvg,
    settings: settingsSvg,
    siren: sirenSvg,
    "spray-can": sprayCanSvg,
    tag: tagSvg,
    "test-tube": testTubeSvg,
    thermometer: thermometerSvg,
    timer: timerSvg,
    zap: zapSvg,
} as const

/** A `lucide-static` icon name usable as an {@link EntityStat} glyph. */
export type StatIcon = keyof typeof ICONS

const dataUriCache = new Map<string, string>()

/**
 * A {@link StatIcon} recolored and encoded as a `data:image/svg+xml` URI, ready
 * for a Babylon GUI `Image` control's `source`. Cached per icon+color pair since
 * the same combination is requested every frame.
 */
export function statIconDataUri(icon: StatIcon, color: string): string {
    const key = `${icon}:${color}`
    let uri = dataUriCache.get(key)
    if (!uri) {
        const svg = ICONS[icon].replaceAll("currentColor", color)
        uri = `data:image/svg+xml,${encodeURIComponent(svg)}`
        dataUriCache.set(key, uri)
    }
    return uri
}
