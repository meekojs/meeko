import * as v from 'valibot'

// The administrator login (F5). The messages never say whether the user or the password failed;
// they are catalog keys (app/locales/<locale>/common.json), said in the language of the page.
export const loginInput = v.object({
	username: v.pipe(v.string('validation.username'), v.trim(), v.minLength(1, 'validation.username'), v.maxLength(200, 'validation.max200')),
	// Not trimmed: a password may start or end with spaces. The cap is the one of verifyPassword.
	password: v.pipe(v.string('validation.password'), v.minLength(1, 'validation.password'), v.maxLength(4096, 'validation.max4096')),
	/** Where to go afterwards, a path of the dashboard; anything else goes to `/`. */
	next: v.optional(v.string(), '/'),
})

/** Where the browser goes after logging in: a checked path of the dashboard. */
export const loginResult = v.object({ next: v.string() })

/** Who is logged in, or `null` on the login page. */
export const sessionSchema = v.object({ user: v.nullable(v.string()) })
