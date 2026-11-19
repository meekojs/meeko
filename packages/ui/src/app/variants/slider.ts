// The look of <UISlider>: a label over a native range. WebKit and Blink have no pseudo-element for the
// filled part of the track, so the component gives its position in --slider-fill and the track paints it
// with a gradient; Firefox has ::-moz-range-progress.
import { tv } from 'tailwind-variants/lite'

export const slider = tv({
	slots: {
		base: [
			'ui:flex ui:min-h-(--ui-control-height-md) ui:flex-col ui:items-stretch ui:gap-2',
			'ui:font-sans ui:text-md ui:leading-normal ui:font-regular ui:text-text',
			'ui:has-disabled:cursor-not-allowed ui:has-disabled:opacity-(--ui-opacity-disabled)',
		],
		input: [
			'ui:m-0 ui:min-h-(--ui-control-height-md) ui:w-full ui:shrink-0 ui:pointer-coarse:min-h-(--ui-control-height-lg)',
			'ui:cursor-pointer ui:appearance-none ui:bg-transparent ui:accent-primary ui:disabled:cursor-[inherit] ui:forced-colors:appearance-auto',
			'ui:focus-visible:outline-(length:--ui-focus-ring-width) ui:focus-visible:outline-focus ui:focus-visible:outline-offset-(--ui-focus-ring-offset) ui:focus-visible:outline-solid',
			// The track of WebKit and Blink, filled up to --slider-fill from the start of the line.
			'ui:[&:dir(rtl)]:[--slider-direction:left]',
			'ui:[&::-webkit-slider-runnable-track]:h-(--ui-slider-track) ui:[&::-webkit-slider-runnable-track]:rounded-full',
			'ui:[&::-webkit-slider-runnable-track]:[background:linear-gradient(to_var(--slider-direction,right),var(--ui-color-primary)_var(--slider-fill,0%),var(--ui-color-control-border)_var(--slider-fill,0%))]',
			'ui:[&::-webkit-slider-thumb]:size-(--ui-slider-thumb) ui:[&::-webkit-slider-thumb]:appearance-none ui:[&::-webkit-slider-thumb]:rounded-full ui:[&::-webkit-slider-thumb]:bg-primary-contrast',
			'ui:[&::-webkit-slider-thumb]:border-(length:--ui-border-width) ui:[&::-webkit-slider-thumb]:border-solid ui:[&::-webkit-slider-thumb]:border-primary',
			'ui:[&::-webkit-slider-thumb]:mt-[calc((var(--ui-slider-track)-var(--ui-slider-thumb))/2)]',
			// The track, the filled part and the thumb of Firefox.
			'ui:[&::-moz-range-track]:h-(--ui-slider-track) ui:[&::-moz-range-track]:rounded-full ui:[&::-moz-range-track]:bg-control-border',
			'ui:[&::-moz-range-progress]:h-(--ui-slider-track) ui:[&::-moz-range-progress]:rounded-full ui:[&::-moz-range-progress]:bg-primary',
			'ui:[&::-moz-range-thumb]:box-border ui:[&::-moz-range-thumb]:size-(--ui-slider-thumb) ui:[&::-moz-range-thumb]:rounded-full ui:[&::-moz-range-thumb]:bg-primary-contrast',
			'ui:[&::-moz-range-thumb]:border-(length:--ui-border-width) ui:[&::-moz-range-thumb]:border-solid ui:[&::-moz-range-thumb]:border-primary',
		],
	},
})
