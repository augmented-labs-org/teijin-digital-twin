import factorySvg from "lucide-static/icons/factory.svg?raw"
import L from "leaflet"
import "leaflet/dist/leaflet.css"
import { useEffect, useRef } from "react"

/** Zoom level, past which zooming in near a marker counts as "entering" the factory. */
const ENTER_ZOOM = 16

/** Screen-space radius (px) around a marker that still counts as "inside" it while zoomed in. */
const ENTER_RADIUS_PX = 160

type Factory = {
    id: string
    name: string
    lat: number
    lng: number
}

// Coordinates taken from the Teijin Automotive Technologies plant in Leça
// (Google Maps: https://www.google.com/maps/place/Teijin+Automotive+Technologies/@41.2195354,-8.633184,1619m/).
const FACTORIES: Factory[] = [
    { id: "teijin-leca", name: "Teijin Leça", lat: 41.2195354, lng: -8.633184 },
]

const markerIcon = L.divIcon({
    className: "",
    html: `
        <div class="flex flex-col items-center -translate-x-1/2 -translate-y-full cursor-pointer group">
            <div class="px-2 py-0.5 mb-1 rounded-full bg-primary/90 text-primary-foreground text-xs font-semibold whitespace-nowrap shadow group-hover:bg-primary transition-colors">
                Teijin Leça
            </div>
            <div class="p-2 rounded-full bg-primary/90 text-primary-foreground shadow-lg group-hover:bg-primary transition-colors [&_svg]:w-5 [&_svg]:h-5">
                ${factorySvg}
            </div>
        </div>
    `,
    iconSize: [0, 0],
})

type WorldMapProps = {
    /** Called when a factory marker is clicked, or the map is zoomed in a lot near one. */
    onSelectFactory: (factory: Factory) => void
}

/** World map (Leaflet) showing every factory as a marker; the map takes over the scene when zoomed out a lot. */
export function WorldMap({ onSelectFactory }: WorldMapProps) {
    const containerRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        const container = containerRef.current
        if (!container) {
            return
        }

        const map = L.map(container, {
            center: [20, 0],
            zoom: 2,
            minZoom: 2,
            maxZoom: 19,
            worldCopyJump: true,
            // Fractional zoom: scroll/pinch glide continuously (CSS-scaling the
            // nearest loaded tile level) instead of jumping a whole level at a time.
            zoomSnap: 0.25,
            zoomDelta: 0.25,
            wheelPxPerZoomLevel: 120,
            easeLinearity: 0.25,
        })

        L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
            subdomains: "abcd",
            maxZoom: 19,
        }).addTo(map)

        const markers = FACTORIES.map((factory) => {
            const marker = L.marker([factory.lat, factory.lng], { icon: markerIcon }).addTo(map)
            marker.on("click", () => onSelectFactory(factory))
            return { factory, marker }
        })

        // Zooming in a lot while centered near a marker also counts as "entering" it.
        const checkZoomedIntoFactory = () => {
            if (map.getZoom() < ENTER_ZOOM) {
                return
            }

            const center = map.latLngToContainerPoint(map.getCenter())
            for (const { factory, marker } of markers) {
                const point = map.latLngToContainerPoint(marker.getLatLng())
                if (point.distanceTo(center) <= ENTER_RADIUS_PX) {
                    onSelectFactory(factory)
                    return
                }
            }
        }

        map.on("zoomend", checkZoomedIntoFactory)

        const resize = () => map.invalidateSize()
        window.addEventListener("resize", resize)

        return () => {
            window.removeEventListener("resize", resize)
            map.remove()
        }
    }, [onSelectFactory])

    return <div ref={containerRef} className="h-full w-full" />
}
