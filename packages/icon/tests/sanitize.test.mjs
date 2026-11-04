import assert from 'node:assert/strict'
import test from 'node:test'

import { sanitizeSvg } from '../dist/sanitize.js'

test('dangerous elements and attributes are removed', () => {
	const [viewBox, body] = sanitizeSvg(
		`<?xml version="1.0" encoding="UTF-8"?>
<!-- exported -->
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 24 24" onload="alert(1)" style="color:red" class="x">
	<title>Logo</title>
	<script>alert(1)</script>
	<style>path { fill: red }</style>
	<foreignObject><div>html</div></foreignObject>
	<a href="https://example.com"><path d="M9 9"/></a>
	<image href="https://example.com/x.png"/>
	<animate attributeName="d"/>
	<path d="M0 0h24v24z" onclick="steal()" style="fill:red" data-x="1" fill="#000"/>
	<use href="https://evil.example/s.svg#a"/>
	<use xlink:href="#ok"/>
	<rect id="ok" width="2" height="2" fill="url(https://evil.example/#p)"/>
</svg>`,
		'logo.svg',
	)
	assert.equal(viewBox, '0 0 24 24')
	assert.equal(body, '<path d="M0 0h24v24z" fill="currentColor"/><use/><use xlink:href="#ok"/><rect id="ok" width="2" height="2"/>')
	for (const forbidden of ['script', 'style', 'onload', 'onclick', 'foreignObject', 'image', 'animate', 'title', 'https:', 'class', 'data-x']) assert.ok(!body.includes(forbidden), forbidden)
})

test('monochrome icons take currentColor; multicolor icons keep their colors and internal gradients', () => {
	assert.equal(sanitizeSvg('<svg viewBox="0 0 2 2"><path d="M0 0" fill="#111"/><circle r="1" stroke="#111" fill="none"/></svg>', 'a.svg')[1], '<path d="M0 0" fill="currentColor"/><circle r="1" stroke="currentColor" fill="none"/>')
	const colorful = sanitizeSvg('<svg viewBox="0 0 2 2"><defs><linearGradient id="g"><stop offset="0" stop-color="red"/><stop offset="1" stop-color="blue"/></linearGradient></defs><path d="M0 0" fill="url(#g)"/></svg>', 'b.svg')[1]
	assert.equal(colorful, '<defs><linearGradient id="g"><stop offset="0" stop-color="red"/><stop offset="1" stop-color="blue"/></linearGradient></defs><path d="M0 0" fill="url(#g)"/>')
})

test('presentation attributes of the root are kept on a group; viewBox may come from width and height', () => {
	const [viewBox, body] = sanitizeSvg('<svg width="16" height="16px" fill="none" stroke="#333" stroke-width="2"><path d="M1 1"/></svg>', 'c.svg')
	assert.equal(viewBox, '0 0 16 16')
	assert.equal(body, '<g fill="none" stroke="currentColor" stroke-width="2"><path d="M1 1"/></g>')
})

test('invalid files fail with the file name', () => {
	assert.throws(() => sanitizeSvg('<svg><path d="M0 0"/></svg>', 'd.svg'), /icon: d\.svg: needs a viewBox/)
	assert.throws(() => sanitizeSvg('<div></div>', 'e.svg'), /exactly one <svg> element/)
	assert.throws(() => sanitizeSvg('<svg viewBox="0 0 1 1"><path></svg>', 'f.svg'), /unexpected <\/svg>/)
	assert.throws(() => sanitizeSvg('<!DOCTYPE svg [<!ENTITY x "y">]><svg viewBox="0 0 1 1"><path d="M0 0"/></svg>', 'g.svg'), /internal subset/)
	assert.throws(() => sanitizeSvg('<svg viewBox="0 0 1 1"><script>x</script></svg>', 'h.svg'), /no drawable content/)
})

test('entities in text and attributes are decoded and escaped again', () => {
	assert.equal(sanitizeSvg('<svg viewBox="0 0 9 9"><text x="1" font-family="A &amp; B">a &lt; b</text></svg>', 'i.svg')[1], '<text x="1" font-family="A &amp; B">a &lt; b</text>')
})
