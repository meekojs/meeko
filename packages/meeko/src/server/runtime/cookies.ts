/** Whether a Cookie header includes a cookie by name, regardless of its value. */
export function cookieNamed(header: string | null, name: string): boolean {
  return (header ?? "").split(";").some((cookie) => {
    const separator = cookie.indexOf("=");
    return separator > 0 && cookie.slice(0, separator).trim() === name;
  });
}
