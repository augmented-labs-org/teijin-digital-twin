import banSvg from "lucide-static/icons/ban.svg?raw"
import clockSvg from "lucide-static/icons/clock.svg?raw"
import dropletSvg from "lucide-static/icons/droplet.svg?raw"
import flameSvg from "lucide-static/icons/flame.svg?raw"
import gaugeSvg from "lucide-static/icons/gauge.svg?raw"
import hashSvg from "lucide-static/icons/hash.svg?raw"
import hourglassSvg from "lucide-static/icons/hourglass.svg?raw"
import moveSvg from "lucide-static/icons/move.svg?raw"
import rulerSvg from "lucide-static/icons/ruler.svg?raw"
import settingsSvg from "lucide-static/icons/settings.svg?raw"
import sirenSvg from "lucide-static/icons/siren.svg?raw"
import tagSvg from "lucide-static/icons/tag.svg?raw"
import testTubeSvg from "lucide-static/icons/test-tube.svg?raw"
import thermometerSvg from "lucide-static/icons/thermometer.svg?raw"
import timerSvg from "lucide-static/icons/timer.svg?raw"
import zapSvg from "lucide-static/icons/zap.svg?raw"

/** Raw `lucide-static` markup (stroke="currentColor") for every icon usable as a stat glyph. */
const ICONS = {
    ban: banSvg,
    clock: clockSvg,
    droplet: dropletSvg,
    flame: flameSvg,
    gauge: gaugeSvg,
    hash: hashSvg,
    hourglass: hourglassSvg,
    move: moveSvg,
    ruler: rulerSvg,
    settings: settingsSvg,
    siren: sirenSvg,
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
