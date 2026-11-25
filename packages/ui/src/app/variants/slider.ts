// The look of <UISlider>: a label over a native range. WebKit and Blink have no pseudo-element for the
// filled part of the track, so the component gives its position in --slider-fill and the track paints it
// with a gradient; Firefox has ::-moz-range-progress.
import { tv } from 'tailwind-variants/lite'

export const slider = tv({
	slots: {
		base: [
			'flex min-h-(--ui-control-height-md) flex-col items-stretch gap-2',
			'font-sans text-md leading-normal font-regular text-text',
			'has-disabled:cursor-not-allowed has-disabled:opacity-(--ui-opacity-disabled)',
		],
		input: [
			'm-0 min-h-(--ui-control-height-md) w-full shrink-0 pointer-coarse:min-h-(--ui-control-height-lg)',
			'cursor-pointer appearance-none bg-transparent accent-primary disabled:cursor-[inherit] forced-colors:appearance-auto',
			'focus-visible:outline-(length:--ui-focus-ring-width) focus-visible:outline-focus focus-visible:outline-offset-(--ui-focus-ring-offset) focus-visible:outline-solid',
			// The track of WebKit and Blink, filled up to --slider-fill from the start of the line.
			'[&:dir(rtl)]:[--slider-direction:left]',
			'[&::-webkit-slider-runnable-track]:h-(--ui-slider-track) [&::-webkit-slider-runnable-track]:rounded-full',
			'[&::-webkit-slider-runnable-track]:[background:linear-gradient(to_var(--slider-direction,right),var(--ui-color-primary)_var(--slider-fill,0%),var(--ui-color-control-border)_var(--slider-fill,0%))]',
			'[&::-webkit-slider-thumb]:size-(--ui-slider-thumb) [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary-contrast',
			'[&::-webkit-slider-thumb]:border-(length:--ui-border-width) [&::-webkit-slider-thumb]:border-solid [&::-webkit-slider-thumb]:border-primary',
			'[&::-webkit-slider-thumb]:mt-[calc((var(--ui-slider-track)-var(--ui-slider-thumb))/2)]',
			// The track, the filled part and the thumb of Firefox.
			'[&::-moz-range-track]:h-(--ui-slider-track) [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-control-border',
			'[&::-moz-range-progress]:h-(--ui-slider-track) [&::-moz-range-progress]:rounded-full [&::-moz-range-progress]:bg-primary',
			'[&::-moz-range-thumb]:box-border [&::-moz-range-thumb]:size-(--ui-slider-thumb) [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-primary-contrast',
			'[&::-moz-range-thumb]:border-(length:--ui-border-width) [&::-moz-range-thumb]:border-solid [&::-moz-range-thumb]:border-primary',
		],
	},
})
