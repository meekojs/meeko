import * as v from 'valibot'

// The administrator login (F5). The messages never say whether the user or the password failed.
export const loginInput = v.object({
	username: v.pipe(v.string('Escribe tu usuario.'), v.trim(), v.minLength(1, 'Escribe tu usuario.'), v.maxLength(200, 'Como mucho 200 caracteres.')),
	// Not trimmed: a password may start or end with spaces. The cap is the one of verifyPassword.
	password: v.pipe(v.string('Escribe tu contraseña.'), v.minLength(1, 'Escribe tu contraseña.'), v.maxLength(4096, 'Como mucho 4096 caracteres.')),
	/** Where to go afterwards, a path of the dashboard; anything else goes to `/`. */
	next: v.optional(v.string(), '/'),
})

/** Where the browser goes after logging in: a checked path of the dashboard. */
export const loginResult = v.object({ next: v.string() })

/** Who is logged in, or `null` on the login page. */
export const sessionSchema = v.object({ user: v.nullable(v.string()) })
