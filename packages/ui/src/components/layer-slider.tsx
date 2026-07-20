import { Slider as SliderPrimitive } from "@base-ui/react/slider"

import { cn } from "@workspace/ui/lib/utils"

function LayerSlider({
  className,
  defaultValue,
  value,
  min = 0,
  max = 100,
  step = 1,
  orientation = "horizontal",
  ...props
}: SliderPrimitive.Root.Props) {
  const _values = Array.isArray(value)
    ? value
    : Array.isArray(defaultValue)
      ? defaultValue
      : [min, max]

  const markCount = step > 0 ? Math.round((max - min) / step) : 0
  const marks = Array.from({ length: markCount + 1 }, (_, i) => min + i * step)

  return (
    <SliderPrimitive.Root
      className={cn("data-horizontal:w-full data-vertical:h-full", className)}
      data-slot="slider"
      defaultValue={defaultValue}
      value={value}
      min={min}
      max={max}
      step={step}
      orientation={orientation}
      thumbAlignment="edge"
      {...props}
    >
      <SliderPrimitive.Control className="relative flex w-full touch-none items-center select-none data-disabled:opacity-50 data-vertical:h-full data-vertical:min-h-40 data-vertical:w-auto data-vertical:flex-col">
        <SliderPrimitive.Track
          data-slot="slider-track"
          className="relative grow rounded-2xl bg-white select-none data-horizontal:h-1 data-horizontal:w-full data-vertical:h-full data-vertical:w-1"
        >
          <div
            aria-hidden
            data-slot="slider-marks"
            data-orientation={orientation}
            className="pointer-events-none absolute flex justify-between select-none data-horizontal:inset-x-0 data-horizontal:top-1/2 data-horizontal:h-3 data-horizontal:-translate-y-1/2 data-horizontal:items-center data-vertical:inset-y-0 data-vertical:left-1/2 data-vertical:w-3 data-vertical:-translate-x-1/2 data-vertical:flex-col-reverse"
          >
            {marks.map((markValue) => (
              <span
                key={markValue}
                data-orientation={orientation}
                className="bg-white data-horizontal:h-full data-horizontal:w-1 data-vertical:h-1 rounded-2xl data-vertical:w-full"
              />
            ))}
          </div>
        </SliderPrimitive.Track>
        {Array.from({ length: _values.length }, (_, index) => (
          <SliderPrimitive.Thumb
            data-slot="slider-thumb"
            key={index}
            className="block size-3.5 shrink-0 rounded-2xl bg-white ring-1 ring-black/10 transition-[color,box-shadow] duration-200 select-none not-dark:bg-clip-padding hover:ring-4 hover:ring-ring/30 focus-visible:ring-4 focus-visible:ring-ring/30 focus-visible:outline-hidden disabled:pointer-events-none disabled:opacity-50"
          />
        ))}
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  )
}

export { LayerSlider }
