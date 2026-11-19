// The geometry of <UISparkline>, pure so the server and the client draw the same path. The series is laid
// on a box of 100 by 32 that the <svg> stretches to its own size (preserveAspectRatio="none"), with a
// stroke that does not scale: its width comes from CSS, never from JavaScript, so nothing moves on hydration.

/** The box of the paths: 100 units wide, whatever the width of the <svg>, and the height of its token. */
export const sparklineBox = { width: 100, height: 32, inset: 2 } as const

/** The lowest, highest and last values of a series, for its accessible summary. */
export interface SparklineSummary {
	readonly min: number
	readonly max: number
	readonly last: number
}

/** The `d` of the line and of the area under it, and the summary; without values, empty paths. */
export interface SparklineShape {
	readonly line: string
	readonly area: string
	readonly summary: SparklineSummary | undefined
}

/** The scale of the vertical axis: by default, from the lowest to the highest value. */
export interface SparklineScale {
	readonly min?: number | undefined
	readonly max?: number | undefined
}

const round = (value: number): number => Math.round(value * 100) / 100

/**
 * Draws a series on the box. A value that is not a finite number is left out; one value is a flat line
 * across the box, and so is a series whose values are all the same.
 */
export function sparklineShape(values: readonly number[], scale: SparklineScale = {}): SparklineShape {
	const points = values.filter((value) => Number.isFinite(value))
	if (!points.length) return { line: '', area: '', summary: undefined }
	const summary = { min: Math.min(...points), max: Math.max(...points), last: points.at(-1)! }
	const low = Number.isFinite(scale.min) ? scale.min! : summary.min
	const high = Number.isFinite(scale.max) ? scale.max! : summary.max
	const { width, height, inset } = sparklineBox
	const y = (value: number): number => {
		if (high <= low) return height / 2
		const ratio = Math.min(Math.max((high - value) / (high - low), 0), 1)
		return round(inset + ratio * (height - 2 * inset))
	}
	const coordinates = points.length === 1 ? [`0,${y(points[0]!)}`, `${width},${y(points[0]!)}`] : points.map((value, index) => `${round((index / (points.length - 1)) * width)},${y(value)}`)
	const line = `M${coordinates.join('L')}`
	return { line, area: `${line}L${width},${height}L0,${height}Z`, summary }
}
